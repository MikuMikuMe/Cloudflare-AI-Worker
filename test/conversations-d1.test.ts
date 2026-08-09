import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  beginConversationTurn,
  ConversationConflictError,
  createConversation,
  deleteConversation,
  type ConversationOwner,
} from '../src/lib/conversations';

const { Miniflare } = createRequire(`${process.cwd()}/package.json`)('miniflare') as typeof import('miniflare');

const OWNER: ConversationOwner = {
  scope: 'aud-integration',
  sub: 'subject-integration',
  email: 'integration@example.com',
};

async function migratedDatabase(): Promise<{ db: D1Database; dispose(): Promise<void> }> {
  const miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  const db = await miniflare.getD1Database('DB');
  const statements = (await readFile('migrations/0003_conversations.sql', 'utf8'))
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
  return { db, dispose: () => miniflare.dispose() };
}

test('migration 0003 cascade removes persisted messages when a conversation is hard-deleted', async (t) => {
  const store = await migratedDatabase();
  t.after(store.dispose);

  const conversation = await createConversation(
    store.db,
    OWNER,
    { title: 'Delete cascade', model: 'model/one' },
    { id: 'd1000000-0000-4000-8000-000000000001', now: 100 },
  );
  await beginConversationTurn(
    store.db,
    OWNER,
    conversation.id,
    {
      content: 'Delete this turn with its parent.',
      model: 'model/one',
      client_turn_id: 'turn_delete_0001',
      expected_version: 0,
    },
    {
      userMessageId: 'd1000000-0000-4000-8000-000000000011',
      assistantMessageId: 'd1000000-0000-4000-8000-000000000012',
      now: 200,
    },
  );

  const beforeDelete = await store.db
    .prepare('SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ?')
    .bind(conversation.id)
    .first<{ count: number }>();
  assert.equal(Number(beforeDelete?.count), 2);

  assert.equal(await deleteConversation(store.db, OWNER, conversation.id), true);

  const afterDelete = await store.db
    .prepare('SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ?')
    .bind(conversation.id)
    .first<{ count: number }>();
  assert.equal(Number(afterDelete?.count), 0);
});

test('an idempotency key cannot be reused with different turn content or model', async (t) => {
  const store = await migratedDatabase();
  t.after(store.dispose);

  const conversation = await createConversation(
    store.db,
    OWNER,
    { title: 'Idempotency payload', model: 'model/one' },
    { id: 'd2000000-0000-4000-8000-000000000001', now: 100 },
  );
  const original = {
    content: 'Original message',
    model: 'model/one',
    client_turn_id: 'turn_retry_0001',
    expected_version: 0,
  };

  const created = await beginConversationTurn(store.db, OWNER, conversation.id, original, {
    userMessageId: 'd2000000-0000-4000-8000-000000000011',
    assistantMessageId: 'd2000000-0000-4000-8000-000000000012',
    now: 200,
  });
  const retried = await beginConversationTurn(store.db, OWNER, conversation.id, original);
  assert.equal(retried?.created, false);
  assert.deepEqual(retried?.messages.map((message) => message.id), created?.messages.map((message) => message.id));

  await assert.rejects(
    () => beginConversationTurn(store.db, OWNER, conversation.id, { ...original, content: 'Changed message' }),
    ConversationConflictError,
  );
  await assert.rejects(
    () => beginConversationTurn(store.db, OWNER, conversation.id, { ...original, model: 'model/two' }),
    ConversationConflictError,
  );

  const rows = await store.db
    .prepare(
      `SELECT role, content, model
         FROM conversation_messages
        WHERE conversation_id = ? AND client_turn_id = ?
        ORDER BY seq ASC`,
    )
    .bind(conversation.id, original.client_turn_id)
    .all<{ role: 'user' | 'assistant'; content: string; model: string }>();
  assert.deepEqual(rows.results, [
    { role: 'user', content: original.content, model: original.model },
    { role: 'assistant', content: '', model: original.model },
  ]);
});
