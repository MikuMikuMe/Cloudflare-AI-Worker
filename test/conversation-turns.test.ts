import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createConversation,
  getConversation,
  type ConversationMessageRecord,
} from '../src/lib/conversations';
import {
  conversationPromptMessages,
  handlePersistentConversationTurn,
} from '../src/routes/conversation-turns';

const { Miniflare } = createRequire(`${process.cwd()}/package.json`)('miniflare') as typeof import('miniflare');

const identity = { aud: 'aud-main', sub: 'subject-a', email: 'a@example.com' };
const owner = { scope: identity.aud, sub: identity.sub, email: identity.email };

async function database(): Promise<{ db: D1Database; dispose(): Promise<void> }> {
  const mf = new Miniflare({
    compatibilityDate: '2026-08-08',
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } }',
    d1Databases: ['DB'],
  });
  const db = await mf.getD1Database('DB');
  const rawMigration = await readFile('migrations/0003_conversations.sql', 'utf8');
  const statements = rawMigration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
  return { db, dispose: () => mf.dispose() };
}

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

test('working context excludes unfinished assistant placeholders and is bounded', () => {
  const messages: ConversationMessageRecord[] = Array.from({ length: 100 }, (_, index) => ({
    id: `message-${index}`,
    conversation_id: 'conversation',
    client_turn_id: `turn_${String(index).padStart(8, '0')}`,
    seq: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: index === 99 ? 'unfinished' : 'x'.repeat(3_000),
    status: index === 99 ? 'generating' : 'complete',
    model: 'model/test',
    metadata: null,
    created_at: index,
    completed_at: index,
  }));

  const prompt = conversationPromptMessages(messages);
  assert.ok(prompt.length <= 80);
  assert.ok(prompt.reduce((sum, message) => sum + (message.content?.length ?? 0), 0) <= 160_000);
  assert.equal(prompt.some((message) => message.content === 'unfinished'), false);
});

test('stateful turn uses canonical D1 history, commits before DONE, and replays retries', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(
    store.db,
    owner,
    { title: 'Persistent chat', model: 'model/test' },
    { id: '10000000-0000-4000-8000-000000000001', now: 100 },
  );
  const env = { DB: store.db, DEFAULT_MODEL: 'model/test' } as any;
  let modelCalls = 0;
  const runChat = async (request: Request): Promise<Response> => {
    modelCalls += 1;
    const body = (await request.json()) as any;
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Remember this' }]);
    assert.equal(body.stream, true);
    return new Response(
      [
        'data: {"choices":[],"web_search":{"performed":true,"provider":"test","sources":[{"url":"https://example.com/source","title":"Source"}]}}\n\n',
        'data: {"choices":[{"delta":{"content":"Stored answer"}}]}\n\n',
        'data: [DONE]\n\n',
      ].join(''),
      { headers: { 'content-type': 'text/event-stream', 'access-control-allow-origin': '*' } },
    );
  };
  const payload = {
    content: 'Remember this',
    model: 'model/test',
    client_turn_id: 'turn_00000001',
    expected_version: conversation.version,
    messages: [{ role: 'system', content: 'untrusted browser history' }],
  };
  const request = new Request(
    `https://app.test/admin/api/conversations/${conversation.id}/turns`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  );
  const response = await handlePersistentConversationTurn(
    request,
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
    { runChat: runChat as any },
  );

  assert.ok(response);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.includes('[DONE]')) {
      const detail = await getConversation(store.db, owner, conversation.id);
      assert.equal(detail?.messages.at(-1)?.status, 'complete');
      assert.equal(detail?.messages.at(-1)?.content, 'Stored answer');
    }
    output += chunk;
  }
  assert.match(output, /\[DONE\]/);
  assert.match(output, /"conversation":\{"id":"10000000-0000-4000-8000-000000000001"/);
  assert.match(output, /"version":1/);
  assert.equal(modelCalls, 1);

  const retry = await handlePersistentConversationTurn(
    new Request(request.url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }),
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
    { runChat: runChat as any },
  );
  assert.equal(retry?.headers.get('x-conversation-replay'), 'true');
  assert.match(await retry!.text(), /Stored answer/);
  assert.equal(modelCalls, 1);

  const detail = await getConversation(store.db, owner, conversation.id);
  assert.deepEqual(detail?.messages.at(-1)?.metadata, {
    web_search: {
      performed: true,
      provider: 'test',
      sources: [{ number: 1, url: 'https://example.com/source', title: 'Source' }],
    },
  });
});

test('a model failure finalizes an empty assistant instead of leaving a generating lock', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, owner, { model: 'model/test' });
  const env = { DB: store.db, DEFAULT_MODEL: 'model/test' } as any;
  const response = await handlePersistentConversationTurn(
    new Request(`https://app.test/admin/api/conversations/${conversation.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Fail safely', model: 'model/test', client_turn_id: 'turn_00000002', expected_version: 0,
      }),
    }),
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
    {
      runChat: async () =>
        new Response(JSON.stringify({ error: { message: 'provider detail', code: 'upstream_error' } }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    },
  );

  assert.equal(response?.status, 502);
  const detail = await getConversation(store.db, owner, conversation.id);
  assert.equal(detail?.conversation.title, 'Fail safely');
  assert.equal(detail?.messages.at(-1)?.status, 'error');
  assert.equal(detail?.messages.at(-1)?.content, '');
  assert.deepEqual(detail?.messages.at(-1)?.metadata, { failure: { code: 'upstream_error' } });
  assert.doesNotMatch(JSON.stringify(detail), /provider detail/);
});

test('a neuron quota failure persists its actionable code without raw provider details', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, owner, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  const env = { DB: store.db, DEFAULT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } as any;
  const response = await handlePersistentConversationTurn(
    new Request(`https://app.test/admin/api/conversations/${conversation.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Fail with a useful reason',
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        client_turn_id: 'turn_quota_0001',
        expected_version: 0,
      }),
    }),
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
    {
      runChat: async () =>
        new Response(JSON.stringify({
          error: {
            message: 'Safe quota guidance',
            code: 'cloudflare_neurons_exhausted',
          },
        }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        }),
    },
  );

  assert.equal(response?.status, 429);
  const detail = await getConversation(store.db, owner, conversation.id);
  assert.equal(detail?.messages.at(-1)?.status, 'error');
  assert.deepEqual(detail?.messages.at(-1)?.metadata, {
    failure: { code: 'cloudflare_neurons_exhausted' },
  });
  assert.doesNotMatch(JSON.stringify(detail), /Safe quota guidance/);
});

test('a streamed neuron quota failure keeps its actionable code', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const conversation = await createConversation(store.db, owner, { model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' });
  const env = { DB: store.db, DEFAULT_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' } as any;
  const response = await handlePersistentConversationTurn(
    new Request(`https://app.test/admin/api/conversations/${conversation.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Stream a useful failure',
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        client_turn_id: 'turn_quota_0002',
        expected_version: 0,
      }),
    }),
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
    {
      runChat: async () => new Response(
        'data: {"error":{"message":"Safe streamed guidance","code":"cloudflare_neurons_exhausted","debug":"provider detail"}}\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    },
  );

  assert.equal(response?.status, 200);
  await response?.text();
  const detail = await getConversation(store.db, owner, conversation.id);
  assert.equal(detail?.messages.at(-1)?.status, 'error');
  assert.deepEqual(detail?.messages.at(-1)?.metadata, {
    failure: { code: 'cloudflare_neurons_exhausted' },
  });
  assert.doesNotMatch(JSON.stringify(detail), /Safe streamed guidance|provider detail/);
});

test('a provider EOF stays an error through the model adapter and persistence wrapper', async (t) => {
  const store = await database();
  t.after(store.dispose);
  const model = '@cf/meta/llama-3.1-8b-instruct-fp8';
  const conversation = await createConversation(store.db, owner, { model });
  const env = {
    DB: store.db,
    DEFAULT_MODEL: model,
    AI_SEARCH: undefined,
    AI: {
      async run(_model: string, input: Record<string, unknown>) {
        assert.equal(input.stream, true);
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"response":"partial provider answer"}\n'));
            controller.close();
          },
        });
      },
    },
  } as any;

  const response = await handlePersistentConversationTurn(
    new Request(`https://app.test/admin/api/conversations/${conversation.id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: 'Do not save a truncated answer as complete',
        model,
        client_turn_id: 'turn_eof_000001',
        expected_version: 0,
      }),
    }),
    env,
    `/admin/api/conversations/${conversation.id}/turns`,
    context(),
    identity,
  );

  const output = await response!.text();
  assert.match(output, /stream ended before completion/i);
  assert.doesNotMatch(output, /data: \[DONE\]/);
  const detail = await getConversation(store.db, owner, conversation.id);
  assert.equal(detail?.messages.at(-1)?.status, 'error');
  assert.equal(detail?.messages.at(-1)?.content, 'partial provider answer');
});
