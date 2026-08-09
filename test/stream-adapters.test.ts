import assert from 'node:assert/strict';
import test from 'node:test';
import { toOpenAISearchStream } from '../src/lib/ai-search';
import { toOpenAIStream } from '../src/lib/chat';

const encoder = new TextEncoder();

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function completionOptions(
  onDone: () => void,
  onError: (code: string) => void = () => undefined,
  normalizeCloudflareQuota = false,
) {
  return {
    id: 'chatcmpl-test',
    model: 'model/test',
    includeUsage: true,
    promptTokens: 4,
    onDone: () => onDone(),
    onError,
    normalizeCloudflareQuota,
  };
}

test('model adapter reports truncated EOF without synthesizing DONE or usage completion', async () => {
  let completions = 0;
  const output = await new Response(
    toOpenAIStream(
      streamOf(['{"response":"partial"}\n']),
      completionOptions(() => { completions += 1; }),
    ),
  ).text();

  assert.match(output, /"content":"partial"/);
  assert.match(output, /stream ended before completion/i);
  assert.doesNotMatch(output, /data: \[DONE\]/);
  assert.equal(completions, 0);
});

test('model adapter completes only after the upstream terminal sentinel', async () => {
  let completions = 0;
  const output = await new Response(
    toOpenAIStream(
      streamOf([
        'data: {"choices":[{"delta":{"content":"complete"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      completionOptions(() => { completions += 1; }),
    ),
  ).text();

  assert.match(output, /"content":"complete"/);
  assert.match(output, /data: \[DONE\]/);
  assert.doesNotMatch(output, /"error"/);
  assert.equal(completions, 1);
});

test('model adapter propagates downstream cancellation to its upstream reader', async () => {
  let cancelReason: unknown;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"response":"partial"}\n'));
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const reader = toOpenAIStream(upstream, completionOptions(() => undefined)).getReader();

  await reader.read();
  await reader.cancel('downstream stopped');

  assert.equal(cancelReason, 'downstream stopped');
});

test('model adapter preserves a quota error that surfaces while reading the stream', async () => {
  const codes: string[] = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(Object.assign(new Error('account limited'), { code: 4006 }));
    },
  });

  const output = await new Response(
    toOpenAIStream(
      upstream,
      completionOptions(() => undefined, (code) => codes.push(code), true),
    ),
  ).text();

  assert.match(output, /"code":"cloudflare_neurons_exhausted"/);
  assert.match(output, /00:00 UTC reset/);
  assert.doesNotMatch(output, /data: \[DONE\]/);
  assert.deepEqual(codes, ['cloudflare_neurons_exhausted']);
});

test('model adapter preserves a structured quota error event', async () => {
  const output = await new Response(
    toOpenAIStream(
      streamOf([
        'data: {"error":{"code":4006,"message":"daily free allocation of 10,000 neurons reached"}}\n\n',
      ]),
      completionOptions(() => undefined, () => undefined, true),
    ),
  ).text();

  assert.match(output, /"code":"cloudflare_neurons_exhausted"/);
  assert.doesNotMatch(output, /data: \[DONE\]/);
});

test('model adapter does not label another provider numeric error as Cloudflare quota', async () => {
  const output = await new Response(
    toOpenAIStream(
      streamOf([
        'data: {"error":{"code":4006,"message":"provider-specific failure"}}\n\n',
      ]),
      completionOptions(() => undefined),
    ),
  ).text();

  assert.match(output, /"code":"upstream_error"/);
  assert.doesNotMatch(output, /cloudflare_neurons_exhausted/);
});

test('AI Search adapter reports truncated EOF without synthesizing DONE or usage completion', async () => {
  let completions = 0;
  const output = await new Response(
    toOpenAISearchStream(
      streamOf(['data: {"choices":[{"delta":{"content":"partial"},"finish_reason":null}]}\n\n']),
      completionOptions(() => { completions += 1; }),
    ),
  ).text();

  assert.match(output, /"content":"partial"/);
  assert.match(output, /stream ended before completion/i);
  assert.doesNotMatch(output, /data: \[DONE\]/);
  assert.equal(completions, 0);
});

test('AI Search adapter completes only after the upstream terminal sentinel', async () => {
  let completions = 0;
  const output = await new Response(
    toOpenAISearchStream(
      streamOf([
        'data: {"choices":[{"delta":{"content":"complete"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      completionOptions(() => { completions += 1; }),
    ),
  ).text();

  assert.match(output, /"content":"complete"/);
  assert.match(output, /data: \[DONE\]/);
  assert.doesNotMatch(output, /"error"/);
  assert.equal(completions, 1);
});

test('AI Search adapter propagates downstream cancellation to its upstream reader', async () => {
  let cancelReason: unknown;
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[]}\n\n'));
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const reader = toOpenAISearchStream(upstream, completionOptions(() => undefined)).getReader();

  await reader.read();
  await reader.cancel('downstream stopped');

  assert.equal(cancelReason, 'downstream stopped');
});

test('AI Search adapter preserves a stream-time neuron quota failure', async () => {
  const codes: string[] = [];
  const upstream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(Object.assign(new Error('account limited'), { code: 4006 }));
    },
  });

  const output = await new Response(
    toOpenAISearchStream(
      upstream,
      completionOptions(() => undefined, (code) => codes.push(code)),
    ),
  ).text();

  assert.match(output, /"code":"cloudflare_neurons_exhausted"/);
  assert.deepEqual(codes, ['cloudflare_neurons_exhausted']);
  assert.doesNotMatch(output, /data: \[DONE\]/);
});
