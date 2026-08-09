import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  beginConversationTurn,
  ConversationConflictError,
  createConversation,
  deleteConversation,
  finalizeConversationTurn,
  getConversation,
  getConversationPromptMessages,
  listConversations,
  renameConversation,
  type ConversationOwner,
} from '../src/lib/conversations';
import { handleConversationApi } from '../src/routes/conversations';

const { Miniflare } = createRequire(`${process.cwd()}/package.json`)('miniflare') as typeof import('miniflare');

const OWNER_A: ConversationOwner = { scope: 'aud-main', sub: 'subject-a', email: 'a@example.com' };
const OWNER_B: ConversationOwner = { scope: 'aud-main', sub: 'subject-b', email: 'b@example.com' };

async function database(migrate = true): Promise<{ db: D1Database; dispose(): Promise<void> }> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  const db = await mf.getD1Database('DB');
  if (migrate) {
    const migration = await readFile('migrations/0003_conversations.sql', 'utf8');
    const statements = migration.replace(/^--.*$/gm, '').split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  }
  return { db, dispose: () => mf.dispose() };
}

test('conversation CRUD is isolated by Access subject and rename is version-aware', async (t) => {
  const store = await database();
  t.after(store.dispose);

  const created = await createConversation(
    store.db,
    OWNER_A,
    { title: 'First chat', model: 'model/one' },
    { id: '10000000-0000-4000-8000-000000000001', now: 100 },
  );
  assert.equal(created.title, 'First chat');
  assert.equal(created.version, 0);

  assert.equal(await getConversation(store.db, OWNER_B, created.id), null);
  assert.equal(await renameConversation(store.db, OWNER_B, created.id, 'Stolen', 0), null);
  assert.equal(await deleteConversation(store.db, OWNER_B, created.id), false);

  const renamed = await renameConversation(store.db, OWNER_A, created.id, 'Renamed chat', 0, 200);
  assert.equal(renamed?.title, 'Renamed chat');
  assert.equal(renamed?.version, 1);
  await assert.rejects(
    () => renameConversation(store.db, OWNER_A, created.id, 'Stale rename', 0),
    ConversationConflictError,
  );

  const detail = await getConversation(store.db, OWNER_A, created.id);
  assert.equal(detail?.conversation.title, 'Renamed chat');
  assert.deepEqual(detail?.messages, []);
  assert.equal(await deleteConversation(store.db, OWNER_A, created.id), true);
  assert.equal(await getConversation(store.db, OWNER_A, created.id), null);
});

test('conversation list uses stable descending keyset pagination', async (t) => {
  const store = await database();
  t.after(store.dispose);

  await createConversation(store.db, OWNER_A, { title: 'Old', model: 'm' }, {
    id: '10000000-0000-4000-8000-000000000001', now: 100,
  });
  await createConversation(store.db, OWNER_A, { title: 'Middle', model: 'm' }, {
    id: '20000000-0000-4000-8000-000000000002', now: 200,
  });
  await createConversation(store.db, OWNER_A, { title: 'New', model: 'm' }, {
    id: '30000000-0000-4000-8000-000000000003', now: 300,
  });
  await createConversation(store.db, OWNER_B, { title: 'Other owner', model: 'm' }, {
    id: '40000000-0000-4000-8000-000000000004', now: 400,
  });

  const first = await listConversations(store.db, OWNER_A, { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.title), ['New', 'Middle']);
  assert.ok(first.next_cursor);

  const second = await listConversations(store.db, OWNER_A, { limit: 2, cursor: first.next_cursor });
  assert.deepEqual(second.items.map((item) => item.title), ['Old']);
  assert.equal(second.next_cursor, null);
});

test('turn creation is versioned and idempotent, and finalization stores assistant metadata', async (t) => {
  const store = await database();
  t.after(store.dispose);

  const conversation = await createConversation(store.db, OWNER_A, { title: 'Turn test', model: 'model/one' }, {
    id: '10000000-0000-4000-8000-000000000001', now: 100,
  });
  const request = {
    content: 'Hello',
    model: 'model/two',
    client_turn_id: 'turn_00000001',
    expected_version: conversation.version,
  };

  const begun = await beginConversationTurn(store.db, OWNER_A, conversation.id, request, {
    userMessageId: '10000000-0000-4000-8000-000000000011',
    assistantMessageId: '10000000-0000-4000-8000-000000000012',
    now: 200,
  });
  assert.equal(begun.created, true);
  assert.equal(begun.conversation.version, 1);
  assert.deepEqual(begun.messages.map((message) => [message.role, message.status, message.seq]), [
    ['user', 'complete', 1],
    ['assistant', 'generating', 2],
  ]);

  const retried = await beginConversationTurn(store.db, OWNER_A, conversation.id, request);
  assert.equal(retried.created, false);
  assert.deepEqual(retried.messages.map((message) => message.id), begun.messages.map((message) => message.id));
  await assert.rejects(
    () => beginConversationTurn(store.db, OWNER_A, conversation.id, { ...request, content: 'Different payload' }),
    ConversationConflictError,
  );

  await assert.rejects(
    () => beginConversationTurn(store.db, OWNER_A, conversation.id, {
      ...request,
      client_turn_id: 'turn_00000002',
    }),
    ConversationConflictError,
  );

  const finalized = await finalizeConversationTurn(store.db, OWNER_A, conversation.id, request.client_turn_id, {
    content: 'Hello back',
    status: 'complete',
    model: request.model,
    metadata: { web_search: { sources: [{ url: 'https://example.com' }] } },
  }, 300);
  assert.equal(finalized?.content, 'Hello back');
  assert.equal(finalized?.status, 'complete');
  assert.deepEqual(finalized?.metadata, { web_search: { sources: [{ url: 'https://example.com' }] } });

  const finalizedAgain = await finalizeConversationTurn(store.db, OWNER_A, conversation.id, request.client_turn_id, {
    content: 'must not overwrite', status: 'error', model: request.model,
  }, 400);
  assert.equal(finalizedAgain?.content, 'Hello back');
  assert.equal(finalizedAgain?.status, 'complete');

  const detail = await getConversation(store.db, OWNER_A, conversation.id);
  assert.equal(detail?.messages.length, 2);

  const second = await beginConversationTurn(store.db, OWNER_A, conversation.id, {
    content: 'Second turn', model: request.model, client_turn_id: 'turn_00000003', expected_version: 1,
  }, { now: 500 });
  assert.equal(second?.created, true);
  const interrupted = await finalizeConversationTurn(store.db, OWNER_A, conversation.id, 'turn_00000003', {
    content: '', status: 'interrupted', model: request.model,
  }, 600);
  assert.equal(interrupted?.content, '');
  assert.equal(interrupted?.status, 'interrupted');
});

test('a stale generating turn is marked interrupted before the next turn begins', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, OWNER_A, { title: 'Recovery', model: 'model/one' }, {
    id: '10000000-0000-4000-8000-000000000001', now: 100,
  });
  await beginConversationTurn(store.db, OWNER_A, conversation.id, {
    content: 'Abandoned', model: 'model/one', client_turn_id: 'turn_00000001', expected_version: 0,
  }, { now: 1_000 });

  const recovered = await beginConversationTurn(store.db, OWNER_A, conversation.id, {
    content: 'Continue', model: 'model/one', client_turn_id: 'turn_00000002', expected_version: 1,
  }, { now: 301_001 });
  assert.equal(recovered?.created, true);

  const detail = await getConversation(store.db, OWNER_A, conversation.id, { now: 301_001 });
  assert.deepEqual(detail?.messages.map((message) => message.status), [
    'complete', 'interrupted', 'complete', 'generating',
  ]);
  assert.equal(detail?.messages[1].completed_at, 301_001);
});

test('reading a conversation recovers an orphaned generating turn', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, OWNER_A, { title: 'Read recovery', model: 'model/one' }, {
    id: '10000000-0000-4000-8000-000000000001', now: 100,
  });
  await beginConversationTurn(store.db, OWNER_A, conversation.id, {
    content: 'Abandoned', model: 'model/one', client_turn_id: 'turn_00000001', expected_version: 0,
  }, { now: 1_000 });

  const fresh = await getConversation(store.db, OWNER_A, conversation.id, { now: 1_800_999 });
  assert.equal(fresh?.messages[1].status, 'generating');

  const recovered = await getConversation(store.db, OWNER_A, conversation.id, { now: 1_801_000 });
  assert.equal(recovered?.messages[1].status, 'interrupted');
  assert.equal(recovered?.messages[1].completed_at, 1_801_000);
});

test('message history is keyset-paginated while prompt reads stay bounded to the recent tail', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, OWNER_A, { title: 'Long history', model: 'model/one' }, {
    id: '50000000-0000-4000-8000-000000000005', now: 100,
  });

  for (let index = 0; index < 3; index += 1) {
    const turnId = `turn_page_000${index}`;
    await beginConversationTurn(store.db, OWNER_A, conversation.id, {
      content: `Question ${index}`,
      model: 'model/one',
      client_turn_id: turnId,
      expected_version: index,
    }, { now: 200 + index * 20 });
    await finalizeConversationTurn(store.db, OWNER_A, conversation.id, turnId, {
      content: `Answer ${index}`,
      status: 'complete',
      model: 'model/one',
    }, 210 + index * 20);
  }

  const latest = await getConversation(store.db, OWNER_A, conversation.id, { messageLimit: 2 });
  assert.deepEqual(latest?.messages.map((message) => message.seq), [5, 6]);
  assert.equal(latest?.next_before_seq, 5);

  const middle = await getConversation(store.db, OWNER_A, conversation.id, {
    messageLimit: 2,
    beforeSeq: latest?.next_before_seq,
  });
  assert.deepEqual(middle?.messages.map((message) => message.seq), [3, 4]);
  assert.equal(middle?.next_before_seq, 3);

  const oldest = await getConversation(store.db, OWNER_A, conversation.id, {
    messageLimit: 2,
    beforeSeq: middle?.next_before_seq,
  });
  assert.deepEqual(oldest?.messages.map((message) => message.seq), [1, 2]);
  assert.equal(oldest?.next_before_seq, null);

  const promptTail = await getConversationPromptMessages(store.db, OWNER_A, conversation.id, 3);
  assert.deepEqual(promptTail.map((message) => message.seq), [4, 5, 6]);
  assert.deepEqual(await getConversationPromptMessages(store.db, OWNER_B, conversation.id, 3), []);
});

test('Access-only conversation API exposes snake-case CRUD and turn contracts', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const env = { DB: store.db, DEFAULT_MODEL: 'model/default' } as any;
  const identityA = { aud: OWNER_A.scope, sub: OWNER_A.sub, email: OWNER_A.email };
  const identityB = { aud: OWNER_B.scope, sub: OWNER_B.sub, email: OWNER_B.email };

  const createResponse = await handleConversationApi(
    new Request('https://app.test/admin/api/conversations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'API chat' }),
    }),
    env,
    '/admin/api/conversations',
    identityA,
  );
  assert.equal(createResponse?.status, 201);
  const createBody = await createResponse?.json() as any;
  assert.equal(createBody.conversation.title, 'API chat');
  assert.equal(createBody.conversation.last_model, 'model/default');
  const id = createBody.conversation.id as string;

  const hidden = await handleConversationApi(
    new Request(`https://app.test/admin/api/conversations/${id}`), env,
    `/admin/api/conversations/${id}`, identityB,
  );
  assert.equal(hidden?.status, 404);

  const turnResponse = await handleConversationApi(
    new Request(`https://app.test/admin/api/conversations/${id}/turns`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Persist me', model: 'model/default', client_turn_id: 'turn_00000001', expected_version: 0 }),
    }),
    env,
    `/admin/api/conversations/${id}/turns`,
    identityA,
  );
  assert.equal(turnResponse?.status, 201);
  const turnBody = await turnResponse?.json() as any;
  assert.equal(turnBody.created, true);
  assert.equal(turnBody.messages[0].client_turn_id, 'turn_00000001');

  const listResponse = await handleConversationApi(
    new Request('https://app.test/admin/api/conversations?limit=20'), env,
    '/admin/api/conversations', identityA,
  );
  assert.deepEqual(Object.keys(await listResponse?.json() as any).sort(), ['items', 'next_cursor']);

  const patchResponse = await handleConversationApi(
    new Request(`https://app.test/admin/api/conversations/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'API renamed', expected_version: 1 }),
    }),
    env,
    `/admin/api/conversations/${id}`,
    identityA,
  );
  assert.equal((await patchResponse?.json() as any).conversation.title, 'API renamed');

  const detailResponse = await handleConversationApi(
    new Request(`https://app.test/admin/api/conversations/${id}`), env,
    `/admin/api/conversations/${id}`, identityA,
  );
  const detailBody = await detailResponse?.json() as any;
  assert.deepEqual(Object.keys(detailBody).sort(), ['conversation', 'messages', 'next_before_seq']);

  const deleteResponse = await handleConversationApi(
    new Request(`https://app.test/admin/api/conversations/${id}`, { method: 'DELETE' }), env,
    `/admin/api/conversations/${id}`, identityA,
  );
  assert.equal(deleteResponse?.status, 204);
  assert.equal(await deleteResponse?.text(), '');
});

test('conversation API returns a controlled error when migration 0003 is missing', async (t) => {
  const store = await database(false);
  t.after(store.dispose);
  const response = await handleConversationApi(
    new Request('https://app.test/admin/api/conversations'),
    { DB: store.db, DEFAULT_MODEL: 'model/default' } as any,
    '/admin/api/conversations',
    { aud: OWNER_A.scope, sub: OWNER_A.sub, email: OWNER_A.email },
  );

  assert.equal(response?.status, 503);
  assert.deepEqual(await response?.json(), {
    error: 'conversation_storage_unavailable',
    message: 'Conversation storage is not initialized. Apply D1 migrations and try again.',
  });
});
