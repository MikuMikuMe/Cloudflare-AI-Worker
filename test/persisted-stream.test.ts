import assert from 'node:assert/strict';
import test from 'node:test';
import {
  wrapPersistedSseResponse,
  type PersistedAssistantResult,
} from '../src/lib/persisted-stream.ts';

const encoder = new TextEncoder();

function sseResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'x-test': 'kept' } },
  );
}

test('persists assistant text and safe source metadata before forwarding DONE', async () => {
  const calls: PersistedAssistantResult[] = [];
  let persisted = false;
  const response = wrapPersistedSseResponse(
    sseResponse([
      'data: {"choices":[],"web_search":{"performed":true,"provider":"tavily","queries":[{"query":"release notes","result_count":3,"secret":"drop"}],"sources":[',
      '{"url":"https://user:secret@example.com/a#fragment","title":"Example","snippet":"Useful"},',
      '{"url":"javascript:alert(1)","title":"Unsafe"}]}}\n\n',
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}\n\n',
      'data: [DONE]\n\n',
    ]),
    async (result) => {
      await Promise.resolve();
      calls.push(result);
      persisted = true;
    },
  );

  assert.equal(response.headers.get('x-test'), 'kept');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.includes('[DONE]')) assert.equal(persisted, true);
    output += chunk;
  }

  assert.match(output, /data: \[DONE\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'complete');
  assert.equal(calls[0].text, 'Hello world');
  assert.deepEqual(calls[0].usage, { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
  assert.deepEqual(calls[0].metadata, {
    web_search: {
      performed: true,
      provider: 'tavily',
      queries: [{ query: 'release notes', result_count: 3 }],
      sources: [{ number: 1, url: 'https://example.com/a', title: 'Example', snippet: 'Useful' }],
    },
  });
});

test('fast NVIDIA delta parsing preserves escaped content exactly', async () => {
  const calls: PersistedAssistantResult[] = [];
  const expected = 'line 1\n"quoted" \\ slash 😀';
  const response = wrapPersistedSseResponse(
    sseResponse([
      `data: ${JSON.stringify({ model: 'nvidia/test', choices: [{ delta: { role: 'assistant' } }] })}\n\n`,
      `data: ${JSON.stringify({ model: 'nvidia/test', choices: [{ delta: { content: expected } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]),
    async (result) => calls.push(result),
  );

  const output = await response.text();
  assert.match(output, /data: \[DONE\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'complete');
  assert.equal(calls[0].text, expected);
  assert.equal(calls[0].model, 'nvidia/test');
});

test('flushes a small pending token batch while the provider remains open', async () => {
  let sendSecond: () => void = () => undefined;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"first"}}]}\n\n'));
        sendSecond = () => {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" second"}}]}\n\n'));
        };
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const response = wrapPersistedSseResponse(upstream, async () => undefined);
  const reader = response.body!.getReader();

  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  sendSecond();
  const pendingBatch = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('pending batch was not flushed')), 1_000)),
  ]);
  assert.match(new TextDecoder().decode(pendingBatch.value), /second/);
  await reader.cancel('test complete');
});

test('preserves actionable errors thrown by a raw provider stream', async () => {
  const calls: PersistedAssistantResult[] = [];
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(Object.assign(new Error('NVIDIA stopped sending output.'), {
          code: 'nvidia_stream_timeout',
        }));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const response = wrapPersistedSseResponse(upstream, async (result) => calls.push(result));

  const output = await response.text();
  assert.match(output, /nvidia_stream_timeout/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].errorCode, 'nvidia_stream_timeout');
});

test('persists an error when the upstream emits an SSE error', async () => {
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(
    sseResponse([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"message":"provider exploded","debug":"secret"}}\n\n',
      'data: [DONE]\n\n',
    ]),
    async (result) => calls.push(result),
  );

  await response.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].text, 'partial');
  assert.equal(calls[0].error, 'provider exploded');
  assert.doesNotMatch(JSON.stringify(calls[0]), /debug|secret/);
});

test('preserves the canonical quota code without persisting provider details', async () => {
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(
    sseResponse([
      'data: {"error":{"message":"safe quota guidance","code":"cloudflare_neurons_exhausted","debug":"provider detail"}}\n\n',
    ]),
    async (result) => calls.push(result),
  );

  await response.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].errorCode, 'cloudflare_neurons_exhausted');
  assert.doesNotMatch(JSON.stringify(calls[0]), /debug|provider detail/);
});

test('marks a response interrupted when the upstream closes without DONE', async () => {
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(
    sseResponse(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n']),
    async (result) => calls.push(result),
  );

  const output = await response.text();
  assert.doesNotMatch(output, /\[DONE\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'interrupted');
  assert.equal(calls[0].text, 'partial');
});

test('finalizes a zero-text DONE response as an error instead of leaving a generating row', async () => {
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(
    sseResponse(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n']),
    async (result) => calls.push(result),
  );

  assert.match(await response.text(), /\[DONE\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].text, '');
  assert.match(calls[0].error ?? '', /empty response/i);
});

test('marks a response interrupted when the browser cancels the stream', async () => {
  let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(upstream, async (result) => calls.push(result));
  const reader = response.body!.getReader();

  await reader.read();
  await reader.cancel('navigation');
  upstreamController = undefined;

  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'interrupted');
  assert.equal(calls[0].text, 'partial');
});

test('protects disconnect finalization with waitUntil before the request is aborted', async () => {
  let upstreamCancelled = false;
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
      },
      cancel() {
        upstreamCancelled = true;
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const abortController = new AbortController();
  const calls: PersistedAssistantResult[] = [];
  let protectedLifecycle: Promise<void> | undefined;
  const response = wrapPersistedSseResponse(
    upstream,
    async (result) => calls.push(result),
    [],
    {
      signal: abortController.signal,
      waitUntil(promise) {
        protectedLifecycle = promise;
      },
    },
  );
  const reader = response.body!.getReader();

  await reader.read();
  assert.ok(protectedLifecycle, 'the lifecycle must be protected before a disconnect');
  abortController.abort('tab closed');
  await protectedLifecycle;

  assert.equal(upstreamCancelled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'interrupted');
  assert.equal(calls[0].text, 'partial');
});

test('retains error status if the browser cancels after an error event', async () => {
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"error":{"message":"provider failed"}}\n\n'));
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(upstream, async (result) => calls.push(result));
  const reader = response.body!.getReader();

  await reader.read();
  await reader.cancel('client stopped after error');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].error, 'provider failed');
});

test('does not acknowledge DONE when persistence fails', async () => {
  const response = wrapPersistedSseResponse(
    sseResponse([
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ]),
    async () => {
      throw new Error('database unavailable');
    },
  );

  const output = await response.text();
  assert.doesNotMatch(output, /data: \[DONE\]/);
  assert.match(output, /"code":"persistence_error"/);
  assert.doesNotMatch(output, /database unavailable/);
});

test('finalizes an oversized answer as an error instead of leaving a generating placeholder', async () => {
  const calls: PersistedAssistantResult[] = [];
  const response = wrapPersistedSseResponse(
    sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(128_001) } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]),
    async (result) => calls.push(result),
  );

  const output = await response.text();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'error');
  assert.equal(calls[0].text, '');
  assert.match(calls[0].error ?? '', /saved-answer limit/i);
  assert.match(output, /"code":"response_too_large"/);
  assert.doesNotMatch(output, /data: \[DONE\]/);
});

test('compacts oversized source metadata below the D1 persistence limit', async () => {
  const calls: PersistedAssistantResult[] = [];
  const sources = Array.from({ length: 20 }, (_, index) => ({
    number: index + 1,
    url: `https://example.com/${index}/${'a'.repeat(1_700)}`,
    title: `Source ${index} ${'"'.repeat(180)}`,
    snippet: '\\'.repeat(500),
  }));
  const queries = Array.from({ length: 10 }, (_, index) => ({
    query: `query ${index} ${'"'.repeat(220)}`,
    result_count: 20,
  }));
  const response = wrapPersistedSseResponse(
    sseResponse([
      `data: ${JSON.stringify({
        choices: [{ delta: { content: 'Grounded answer' } }],
        web_search: { performed: true, provider: 'web', sources, queries },
        site_search: { performed: true, provider: 'site', sources, queries },
      })}\n\n`,
      'data: [DONE]\n\n',
    ]),
    async (result) => calls.push(result),
  );

  assert.match(await response.text(), /data: \[DONE\]/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'complete');
  assert.ok(JSON.stringify(calls[0].metadata).length <= 30_000);
  assert.ok(((calls[0].metadata.web_search as any).sources as unknown[]).length <= 5);
  assert.ok(((calls[0].metadata.site_search as any).sources as unknown[]).length <= 5);
});
