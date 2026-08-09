import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeNvidiaModels,
  parseFreeNvidiaCatalog,
  requestNvidiaChat,
  selectFreeNvidiaModels,
} from '../src/lib/nvidia';
import { modelListPayload, resolveChatModel } from '../src/lib/models';
import { handleChatCompletions } from '../src/routes/v1';

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function database(models: Array<{ id: string; created: number; owned_by: string }> = []): D1Database {
  return {
    prepare() {
      return {
        all: async () => ({ results: models }),
        bind() { return this; },
      };
    },
  } as unknown as D1Database;
}

test('normalizes NVIDIA model catalog and removes non-chat endpoints', () => {
  const models = normalizeNvidiaModels({
    object: 'list',
    data: [
      { id: 'meta/llama-3.3-70b-instruct', created: 12, owned_by: 'meta' },
      { id: 'nvidia/nemotron-3-embed-1b', created: 13, owned_by: 'nvidia' },
      { id: 'openai/gpt-oss-20b', created: 14, owned_by: 'openai' },
    ],
  });

  assert.deepEqual(models, [
    { id: 'meta/llama-3.3-70b-instruct', created: 12, owned_by: 'meta' },
    { id: 'openai/gpt-oss-20b', created: 14, owned_by: 'openai' },
  ]);
});

test('reads Free Endpoint IDs from NVIDIA catalog metadata', () => {
  const html = String.raw`
    \\\"resourceType\\\":\\\"ENDPOINT\\\",\\\"resourceId\\\":\\\"org/google/gemma-4-31b-it\\\",\\\"name\\\":\\\"gemma-4-31b-it\\\",\\\"labels\\\":[{\\\"key\\\":\\\"nimType\\\",\\\"values\\\":[\\\"Free Endpoint\\\"]},{\\\"key\\\":\\\"publisher\\\",\\\"values\\\":[\\\"google\\\"]}]
    \\\"resourceType\\\":\\\"ENDPOINT\\\",\\\"resourceId\\\":\\\"org/nvidia/nemotron-3-embed-1b\\\",\\\"name\\\":\\\"nemotron-3-embed-1b\\\",\\\"labels\\\":[{\\\"key\\\":\\\"nimType\\\",\\\"values\\\":[\\\"Free Endpoint\\\"]},{\\\"key\\\":\\\"publisher\\\",\\\"values\\\":[\\\"nvidia\\\"]}]
  `;

  assert.deepEqual([...parseFreeNvidiaCatalog(html)], ['google/gemma-4-31b-it']);
});

test('only publishes callable models that are explicitly in the free catalog', () => {
  const models = selectFreeNvidiaModels(
    [
      { id: 'google/gemma-4-31b-it', created: 1, owned_by: 'google' },
      { id: 'meta/llama-3.3-70b-instruct', created: 2, owned_by: 'meta' },
    ],
    new Set(['google/gemma-4-31b-it']),
  );

  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'google/gemma-4-31b-it');
  assert.equal(models[0].free_endpoint, true);
});

test('a successful free catalog refresh removes stale model IDs', () => {
  const models = selectFreeNvidiaModels(
    [
      { id: 'google/gemma-4-31b-it', created: 1, owned_by: 'google' },
      { id: 'meta/llama-3.3-70b-instruct', created: 2, owned_by: 'meta' },
    ],
    new Set(['google/gemma-4-31b-it']),
    new Set(['meta/llama-3.3-70b-instruct']),
  );

  assert.deepEqual(models.map((model) => model.id), ['google/gemma-4-31b-it']);
});

test('NVIDIA chat request keeps streaming and never exposes the upstream key', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;

  try {
    const response = await requestNvidiaChat(
      { NVIDIA_NIM_API_KEY: 'test-nvidia-secret' },
      'google/gemma-4-31b-it',
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
    );

    assert.equal(response.status, 200);
    assert.equal(request?.url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    const headers = new Headers(request?.init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-nvidia-secret');
    assert.equal(headers.get('accept'), 'text/event-stream');
    assert.match(String(request?.init?.body), /"stream":true/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('model list disables Cloudflare models while keeping NVIDIA models selectable', () => {
  const nvidia = selectFreeNvidiaModels(
    [{ id: 'google/gemma-4-31b-it', created: 1, owned_by: 'google' }],
    new Set(['google/gemma-4-31b-it']),
  );
  const payload = modelListPayload({ nvidiaModels: nvidia, cloudflareDisabled: true });
  const cloudflare = payload.data.find((model) => model.id === '@cf/meta/llama-3.1-8b-instruct-fp8');
  const nim = payload.data.find((model) => model.id === 'google/gemma-4-31b-it');
  assert.equal(cloudflare?.disabled, true);
  assert.equal(nim?.disabled, undefined);
  assert.equal(resolveChatModel('google/gemma-4-31b-it', '@cf/meta/llama-3.1-8b-instruct-fp8', nvidia), 'google/gemma-4-31b-it');
});

test('NVIDIA model uses the same default web-search and OpenAI response path', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/chat/completions')) {
      const requestBody = JSON.parse(String(init?.body));
      if (requestBody.tools) {
        return Response.json({
          choices: [{ message: { content: '', tool_calls: [{ id: 'search-1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'current fact' }) } }] } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }
      return Response.json({
        id: 'nim-chat',
        choices: [{ message: { role: 'assistant', content: 'Grounded NVIDIA answer' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    }
    return Response.json({ results: [{ url: 'https://example.com/fact', title: 'Fact', content: 'Current fact.' }] });
  }) as typeof fetch;

  try {
    const env = {
      AI: {},
      AI_SEARCH: undefined,
      DB: database([{ id: 'google/gemma-4-31b-it', created: 1, owned_by: 'google' }]),
      DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
      NVIDIA_NIM_API_KEY: 'test-nvidia-secret',
      SEARXNG_URL: 'https://search.example.test',
      SEARXNG_API_KEY: 'test-only',
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'test-audience',
    } as any;

    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'google/gemma-4-31b-it', messages: [{ role: 'user', content: 'current fact' }] }),
      }),
      env,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.choices[0].message.content, 'Grounded NVIDIA answer');
    assert.equal(body.web_search.performed, true);
    assert.ok(calls.filter((url) => url.includes('/chat/completions')).length >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Cloudflare models are rejected when the live neuron limit is reached', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    data: { viewer: { accounts: [{ aiInferenceAdaptive: [{ neurons: 10_000, sampleInterval: 1 }] }] } },
  })) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: '@cf/meta/llama-3.1-8b-instruct-fp8', messages: [{ role: 'user', content: 'hello' }] }),
      }),
      {
        AI: {},
        AI_SEARCH: undefined,
        DB: database(),
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        CLOUDFLARE_ACCOUNT_ID: 'account-test',
        CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'test-audience',
      } as any,
      context(),
      true,
    );

    assert.equal(response.status, 429);
    const body = await response.json() as any;
    assert.equal(body.error.code, 'cloudflare_neurons_exhausted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
