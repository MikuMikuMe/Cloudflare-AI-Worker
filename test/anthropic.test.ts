import assert from 'node:assert/strict';
import test from 'node:test';
import Anthropic from '@anthropic-ai/sdk';
import worker from '../src/index';
import {
  toAnthropicStream,
  translateAnthropicRequest,
} from '../src/lib/anthropic';
import { handleAnthropicMessages, handleAnthropicTokenCount } from '../src/routes/anthropic';

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const encoder = new TextEncoder();

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function database(validKey = true): D1Database {
  return {
    prepare(query: string) {
      return {
        bind() { return this; },
        async first() {
          if (query.includes('FROM api_keys')) return validKey ? { id: 'anthropic-key' } : null;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true }; },
      };
    },
    async batch() { return []; },
  } as unknown as D1Database;
}

function environment(run: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  return {
    AI: { run },
    AI_SEARCH: undefined,
    DB: database(),
    DEFAULT_MODEL: MODEL,
    ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
  } as any;
}

function eventPayloads(value: string): Array<{ event: string; data: any }> {
  return value.trim().split(/\n\n+/).map((frame) => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? '';
    const data = lines.find((line) => line.startsWith('data: '))?.slice(6) ?? 'null';
    return { event, data: JSON.parse(data) };
  });
}

test('translates Anthropic text, tool-use, and tool-result blocks into chat-completions inputs', () => {
  const translated = translateAnthropicRequest({
    model: MODEL,
    max_tokens: 256,
    system: [{ type: 'text', text: 'Be concise.' }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Check Paris.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will check.' },
          { type: 'tool_use', id: 'toolu_weather', name: 'weather', input: { city: 'Paris' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_weather', content: 'Sunny' },
          { type: 'text', text: 'Summarize that.' },
        ],
      },
    ],
    tools: [
      {
        name: 'weather',
        description: 'Look up weather',
        input_schema: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
    ],
    tool_choice: { type: 'any', disable_parallel_tool_use: true },
    metadata: { user_id: 'user-123' },
    stop_sequences: ['STOP'],
  });

  assert.equal(translated.request.model, MODEL);
  assert.equal(translated.request.max_tokens, 256);
  assert.deepEqual(translated.messages.map((message) => message.role), [
    'system',
    'user',
    'assistant',
    'tool',
    'user',
  ]);
  assert.equal(translated.messages[2].tool_calls?.[0].function.name, 'weather');
  assert.equal(translated.messages[3].tool_call_id, 'toolu_weather');
  assert.equal(translated.request.tools?.[0].function.parameters?.type, 'object');
  assert.equal(translated.request.tool_choice, 'required');
  assert.equal(translated.request.parallel_tool_calls, false);
  assert.equal(translated.request.user, 'user-123');
  assert.deepEqual(translated.request.stop, ['STOP']);
  assert.ok(translated.inputTokens > 0);
});

test('rejects streamed tool use instead of returning an incomplete tool_use block', () => {
  assert.throws(
    () => translateAnthropicRequest({
      model: MODEL,
      max_tokens: 64,
      stream: true,
      messages: [{ role: 'user', content: 'Call the weather tool.' }],
      tools: [{ name: 'weather', input_schema: { type: 'object' } }],
    }),
    /Streaming tool use is not supported/,
  );
});

test('the public Messages route accepts x-api-key and returns an Anthropic message', async () => {
  let capturedModel = '';
  let capturedInput: Record<string, unknown> | undefined;
  const env = environment(async (model, input) => {
    capturedModel = model;
    capturedInput = input;
    return {
      response: 'Hello from Workers AI.',
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    };
  });

  const response = await worker.fetch(
    new Request('https://ai.example.test/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-cfai-anthropic-test',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 64,
        system: 'Answer plainly.',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    }),
    env,
    context(),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('request-id') ?? '', /^req_/);
  const body = await response.json() as any;
  assert.match(body.id, /^msg_/);
  assert.equal(body.type, 'message');
  assert.equal(body.role, 'assistant');
  assert.equal(body.model, 'claude-3-5-sonnet-latest');
  assert.deepEqual(body.content, [{ type: 'text', text: 'Hello from Workers AI.' }]);
  assert.equal(body.stop_reason, 'end_turn');
  assert.deepEqual(body.usage, { input_tokens: 7, output_tokens: 5 });
  assert.equal(capturedModel, MODEL);
  assert.equal((capturedInput?.messages as any[])[0].role, 'system');
  assert.equal(capturedInput?.max_tokens, 64);
});

test('Messages streaming emits the Anthropic SSE lifecycle without buffering the answer', async () => {
  const env = environment(async (_model, input) => {
    assert.equal(input.stream, true);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"response":"Hel"}\n'));
        controller.enqueue(encoder.encode('{"response":"lo"}\n[DONE]\n'));
        controller.close();
      },
    });
  });

  const response = await handleAnthropicMessages(
    new Request('https://ai.example.test/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    }),
    env,
    context(),
    true,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
  const raw = await response.text();
  assert.doesNotMatch(raw, /\[DONE\]/);
  const frames = eventPayloads(raw);
  assert.deepEqual(frames.map((frame) => frame.event), [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop',
  ]);
  assert.equal(frames[2].data.delta.text, 'Hel');
  assert.equal(frames[3].data.delta.text, 'lo');
  assert.equal(frames[5].data.delta.stop_reason, 'end_turn');
  assert.equal(frames[6].data.type, 'message_stop');
});

test('buffered model tool calls become Anthropic tool_use blocks', async () => {
  const env = environment(async () => ({
    response: '',
    tool_calls: [
      { id: 'toolu_weather', name: 'weather', arguments: { city: 'Paris' } },
    ],
    usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
  }));
  const response = await handleAnthropicMessages(
    new Request('https://ai.example.test/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 64,
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'weather',
            input_schema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      }),
    }),
    env,
    context(),
    true,
  );

  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.stop_reason, 'tool_use');
  assert.deepEqual(body.content, [
    { type: 'tool_use', id: 'toolu_weather', name: 'weather', input: { city: 'Paris' } },
  ]);
});

test('Anthropic streaming converts an OpenAI stream error into a named error event', async () => {
  const output = await new Response(toAnthropicStream(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"error":{"type":"api_error","code":"cloudflare_neurons_exhausted","message":"quota"}}\n\n',
        ));
        controller.close();
      },
    }),
    {
      requestId: 'req_test',
      messageId: 'msg_test',
      model: MODEL,
      inputTokens: 4,
    },
  )).text();

  const frames = eventPayloads(output);
  assert.equal(frames.at(-1)?.event, 'error');
  assert.equal(frames.at(-1)?.data.error.type, 'rate_limit_error');
  assert.doesNotMatch(output, /event: message_stop/);
});

test('Anthropic streaming propagates downstream cancellation', async () => {
  let reason: unknown;
  const upstream = new ReadableStream<Uint8Array>({
    cancel(value) { reason = value; },
  });
  const reader = toAnthropicStream(upstream, {
    requestId: 'req_test',
    messageId: 'msg_test',
    model: MODEL,
    inputTokens: 1,
  }).getReader();

  await reader.read();
  await reader.cancel('client disconnected');
  assert.equal(reason, 'client disconnected');
});

test('validation and provider quota failures use Anthropic error envelopes', async () => {
  const env = environment(async () => {
    throw Object.assign(new Error('account limited'), { code: 4006 });
  });

  const invalid = await handleAnthropicMessages(
    new Request('https://ai.example.test/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Hello' }] }),
    }),
    env,
    context(),
    true,
  );
  assert.equal(invalid.status, 400);
  const invalidBody = await invalid.json() as any;
  assert.equal(invalidBody.type, 'error');
  assert.equal(invalidBody.error.type, 'invalid_request_error');
  assert.match(invalidBody.error.message, /max_tokens/);

  const quota = await handleAnthropicMessages(
    new Request('https://ai.example.test/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    }),
    env,
    context(),
    true,
  );
  assert.equal(quota.status, 429);
  const quotaBody = await quota.json() as any;
  assert.equal(quotaBody.type, 'error');
  assert.equal(quotaBody.error.type, 'rate_limit_error');
});

test('count_tokens estimates Anthropic input without invoking a model', async () => {
  let calls = 0;
  const env = environment(async () => {
    calls += 1;
    return { response: 'unused' };
  });
  const response = await handleAnthropicTokenCount(
    new Request('https://ai.example.test/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        system: 'Be helpful.',
        messages: [{ role: 'user', content: 'Count this input.' }],
      }),
    }),
    env,
    true,
  );

  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.ok(Number.isInteger(body.input_tokens));
  assert.ok(body.input_tokens > 0);
  assert.equal(calls, 0);
});

test('Anthropic browser preflight allows SDK authentication and version headers', async () => {
  const response = await worker.fetch(
    new Request('https://ai.example.test/v1/messages', { method: 'OPTIONS' }),
    {} as any,
    context(),
  );
  const allowed = response.headers.get('access-control-allow-headers') ?? '';
  assert.equal(response.status, 204);
  assert.match(allowed, /X-API-Key/i);
  assert.match(allowed, /Anthropic-Version/i);
  assert.match(allowed, /Anthropic-Beta/i);
  assert.match(allowed, /X-Stainless-Helper-Method/i);
  assert.match(response.headers.get('access-control-expose-headers') ?? '', /Request-Id/i);
});

test('the unmodified Anthropic SDK parses buffered and streamed Messages responses', async () => {
  const env = environment(async (_model, input) => {
    if (input.stream === true) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"response":"SDK "}\n'));
          controller.enqueue(encoder.encode('{"response":"stream"}\n[DONE]\n'));
          controller.close();
        },
      });
    }
    return {
      response: 'SDK buffered',
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    };
  });
  const client = new Anthropic({
    apiKey: 'sk-cfai-sdk-test',
    baseURL: 'https://ai.example.test',
    fetch: (input, init) => worker.fetch(new Request(input, init), env, context()),
  });

  const buffered = await client.messages.create({
    model: MODEL,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Buffered' }],
  });
  assert.equal(buffered.type, 'message');
  assert.equal(buffered.content[0]?.type, 'text');
  assert.equal(buffered.content[0]?.type === 'text' ? buffered.content[0].text : '', 'SDK buffered');

  const count = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: 'user', content: 'Count this.' }],
  });
  assert.ok(Number.isInteger(count.input_tokens));
  assert.ok(count.input_tokens > 0);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Stream' }],
  });
  const final = await stream.finalMessage();
  assert.equal(final.content[0]?.type, 'text');
  assert.equal(final.content[0]?.type === 'text' ? final.content[0].text : '', 'SDK stream');
  assert.equal(final.stop_reason, 'end_turn');
});

test('the Anthropic SDK receives an authentication_error for an invalid x-api-key', async () => {
  const env = environment(async () => ({ response: 'must not run' }));
  env.DB = database(false);
  const client = new Anthropic({
    apiKey: 'sk-cfai-invalid',
    baseURL: 'https://ai.example.test',
    fetch: (input, init) => worker.fetch(new Request(input, init), env, context()),
  });

  await assert.rejects(
    client.messages.create({
      model: MODEL,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Hello' }],
    }),
    (error: any) => {
      assert.equal(error.status, 401);
      assert.equal(error.error?.type, 'error');
      assert.equal(error.error?.error?.type, 'authentication_error');
      return true;
    },
  );
});
