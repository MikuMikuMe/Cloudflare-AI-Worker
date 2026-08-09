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

function completionOptions(onDone: () => void) {
  return {
    id: 'chatcmpl-test',
    model: 'model/test',
    includeUsage: true,
    promptTokens: 4,
    onDone: () => onDone(),
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
