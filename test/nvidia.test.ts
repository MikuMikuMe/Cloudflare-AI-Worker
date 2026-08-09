import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getNvidiaModelIndex,
  normalizeNvidiaModels,
  parseFreeNvidiaCatalog,
  requestNvidiaChat,
  selectFreeNvidiaModels,
} from '../src/lib/nvidia';
import {
  modelListPayload,
  resolveChatModel,
  resolveNvidiaFallbackModel,
} from '../src/lib/models';
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

function publicApiDatabase(
  models: Array<{ id: string; created: number; owned_by: string }> = [],
): D1Database {
  return {
    prepare(query: string) {
      return {
        bind() { return this; },
        async all() { return { results: models }; },
        async first() {
          return query.includes('FROM api_keys') ? { id: 'external-key' } : null;
        },
        async run() { return { success: true }; },
      };
    },
  } as unknown as D1Database;
}

function quotaCircuitDatabase(
  models: Array<{ id: string; created: number; owned_by: string }> = [],
): D1Database {
  let row: { provider: string; day: string; reason: string; expiresAt: number; observedAt: number } | null = null;
  return {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          values = next;
          return this;
        },
        async all() {
          return { results: models };
        },
        async first() {
          if (!query.includes('provider_daily_status') || !query.includes('SELECT') || !row) return null;
          const [provider, day, now, recentObservationCutoff] = values;
          return row.provider === provider && row.day === day && row.expiresAt > Number(now)
            && row.observedAt > Number(recentObservationCutoff)
            ? { reason_code: row.reason }
            : null;
        },
        async run() {
          if (query.includes('INSERT INTO provider_daily_status')) {
            row = {
              provider: String(values[0]),
              day: String(values[1]),
              reason: String(values[2]),
              expiresAt: Number(values[3]),
              observedAt: Number(values[4]),
            };
          }
          return { success: true };
        },
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
    await response.body?.cancel();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NVIDIA streaming uses a constant number of timeout registrations', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  let timeoutRegistrations = 0;

  (globalThis as any).setTimeout = (handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    timeoutRegistrations += 1;
    return originalSetTimeout(handler, timeout, ...args);
  };
  globalThis.fetch = (async () => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (let index = 0; index < 100; index += 1) {
          controller.enqueue(encoder.encode(`data: {"index":${index}}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  )) as typeof fetch;

  try {
    const response = await requestNvidiaChat(
      { NVIDIA_NIM_API_KEY: 'test-nvidia-secret' },
      'nvidia/nemotron-3-ultra-550b-a55b',
      { messages: [{ role: 'user', content: 'hello' }], stream: true },
    );
    await response.text();
    assert.ok(timeoutRegistrations <= 2, `expected constant timers, got ${timeoutRegistrations}`);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
});

for (const prompt of [
  'hello',
  'write a cpp code and also give me a python equivalent, teach me cpp',
]) {
  test(`NVIDIA streams ${JSON.stringify(prompt)} directly without a blocking web planner`, async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    let firstChunkProduced = false;
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => {
              firstChunkProduced = true;
              controller.enqueue(new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"first "}}]}\n\n',
              ));
              controller.enqueue(new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"second"}}]}\n\ndata: [DONE]\n\n',
              ));
              controller.close();
            }, 20);
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    try {
      const env = {
        AI: {},
        AI_SEARCH: undefined,
        DB: database([{ id: 'nvidia/nemotron-3-ultra-550b-a55b', created: 1, owned_by: 'nvidia' }]),
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        NVIDIA_NIM_API_KEY: 'test-nvidia-secret',
        SEARXNG_URL: 'https://search.example.test',
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'test-audience',
      } as any;

      const response = await handleChatCompletions(
        new Request('https://ai.example.test/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'nvidia/nemotron-3-ultra-550b-a55b',
            messages: [{ role: 'user', content: prompt }],
            stream: true,
          }),
        }),
        env,
        context(),
        true,
      );

      assert.equal(response.status, 200);
      assert.equal(firstChunkProduced, false, 'the Worker should return before NVIDIA finishes generating');
      const output = await response.text();
      assert.match(output, /"content":"first "/);
      assert.match(output, /"content":"second"/);
      assert.match(output, /data: \[DONE\]/);
      assert.doesNotMatch(output, /chatcmpl-/, 'trusted NVIDIA SSE should be relayed without token-by-token rewriting');
      assert.equal(requests.length, 1);
      assert.equal(requests[0].stream, true);
      assert.equal(requests[0].tools, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

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

test('model list advertises a mapped NVIDIA backup before the Cloudflare retry circuit opens', () => {
  const nvidia = selectFreeNvidiaModels(
    [{ id: 'google/gemma-4-31b-it', created: 1, owned_by: 'google' }],
    new Set(['google/gemma-4-31b-it']),
  );
  const payload = modelListPayload({ nvidiaModels: nvidia });
  const cloudflare = payload.data.find((model) => model.id === '@cf/meta/llama-3.1-8b-instruct-fp8');

  assert.equal(cloudflare?.disabled, undefined);
  assert.equal(cloudflare?.fallback_model, 'google/gemma-4-31b-it');
});

test('model list labels paid-billing Cloudflare models without disabling paid deployments', () => {
  const payload = modelListPayload();
  for (const id of [
    '@cf/moonshotai/kimi-k2.6',
    '@cf/moonshotai/kimi-k2.7-code',
    '@cf/zai-org/glm-5.2',
  ]) {
    const model = payload.data.find((candidate) => candidate.id === id);
    assert.equal(model?.requires_paid_plan, true);
    assert.equal(model?.disabled, undefined);
  }
});

test('does not expose a stored NVIDIA catalog when its credential is missing', async () => {
  const models = await getNvidiaModelIndex({
    DB: database([{ id: 'meta/llama-3.3-70b-instruct', created: 2, owned_by: 'meta' }]),
  });
  assert.deepEqual(models, []);
});

test('selects the closest indexed NVIDIA fallback for a Cloudflare model', () => {
  const nvidia = [
    { id: 'nvidia/nemotron-3-nano-30b-a3b', created: 1, owned_by: 'nvidia', provider: 'nvidia' as const, free_endpoint: true as const },
    { id: 'meta/llama-3.3-70b-instruct', created: 2, owned_by: 'meta', provider: 'nvidia' as const, free_endpoint: true as const },
  ];

  assert.equal(
    resolveNvidiaFallbackModel('@cf/meta/llama-3.3-70b-instruct-fp8-fast', nvidia),
    'meta/llama-3.3-70b-instruct',
  );
  assert.equal(
    resolveNvidiaFallbackModel('@cf/qwen/qwen3-30b-a3b-fp8', nvidia),
    'nvidia/nemotron-3-nano-30b-a3b',
  );
  assert.equal(
    modelListPayload({ nvidiaModels: nvidia }).data.find(
      (model) => model.id === 'nvidia/nemotron-3-nano-30b-a3b',
    )?.recommended_fallback,
    true,
  );
});

test('trusted dashboard chat retries a Cloudflare quota rejection with the closest NVIDIA model', async () => {
  const originalFetch = globalThis.fetch;
  const fallbackModel = 'meta/llama-3.3-70b-instruct';
  let cloudflareCalls = 0;
  let nvidiaRequestModel = '';

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } } });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') {
      nvidiaRequestModel = JSON.parse(String(init?.body)).model;
      return new Response(
        `data: {"model":"${fallbackModel}","choices":[{"delta":{"content":"fallback answer"}}]}\n\ndata: [DONE]\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
          allow_provider_fallback: true,
        }),
      }),
      {
        AI: {
          async run() {
            cloudflareCalls += 1;
            throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
          },
        },
        AI_SEARCH: undefined,
        DB: database([{ id: fallbackModel, created: 2, owned_by: 'meta' }]),
        NVIDIA_NIM_API_KEY: 'nvidia-test-key',
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        CLOUDFLARE_ACCOUNT_ID: 'account-test',
        CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'test-audience',
      } as any,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /fallback answer/);
    assert.match(output, new RegExp(fallbackModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(cloudflareCalls, 1);
    assert.equal(nvidiaRequestModel, fallbackModel);
    assert.equal(
      response.headers.get('x-ai-provider-fallback-from'),
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    );
    assert.equal(response.headers.get('x-ai-provider-fallback-to'), fallbackModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-reason'), 'cloudflare_neurons_exhausted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('trusted dashboard non-streaming chat discloses a thrown quota fallback', async () => {
  const originalFetch = globalThis.fetch;
  const requestedModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const fallbackModel = 'meta/llama-3.3-70b-instruct';

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } } });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') {
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'non-stream fallback' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: requestedModel,
          messages: [{ role: 'user', content: 'hello' }],
          allow_provider_fallback: true,
        }),
      }),
      {
        AI: {
          async run() {
            throw Object.assign(new Error('account limited'), { code: 4006 });
          },
        },
        AI_SEARCH: undefined,
        DB: database([{ id: fallbackModel, created: 2, owned_by: 'meta' }]),
        NVIDIA_NIM_API_KEY: 'nvidia-test-key',
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        CLOUDFLARE_ACCOUNT_ID: 'account-test',
        CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
      } as any,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.model, fallbackModel);
    assert.equal(body.choices[0].message.content, 'non-stream fallback');
    assert.equal(response.headers.get('x-ai-provider-fallback-from'), requestedModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-to'), fallbackModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-reason'), 'cloudflare_neurons_exhausted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('opted-in dashboard chat retries a quota error raised by the first stream read', async () => {
  const originalFetch = globalThis.fetch;
  const fallbackModel = 'meta/llama-3.3-70b-instruct';
  let nvidiaCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } } });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') {
      nvidiaCalls += 1;
      return new Response(
        'data: {"choices":[{"delta":{"content":"stream fallback"}}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
          allow_provider_fallback: true,
        }),
      }),
      {
        AI: {
          async run() {
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(Object.assign(new Error('account limited'), { code: 4006 }));
              },
            });
          },
        },
        AI_SEARCH: undefined,
        DB: database([{ id: fallbackModel, created: 2, owned_by: 'meta' }]),
        NVIDIA_NIM_API_KEY: 'nvidia-test-key',
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        CLOUDFLARE_ACCOUNT_ID: 'account-test',
        CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'test-audience',
      } as any,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    assert.match(await response.text(), /stream fallback/);
    assert.equal(nvidiaCalls, 1);
    assert.equal(
      response.headers.get('x-ai-provider-fallback-from'),
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    );
    assert.equal(response.headers.get('x-ai-provider-fallback-to'), fallbackModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-reason'), 'cloudflare_neurons_exhausted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an open binding quota circuit discloses streaming and non-streaming fallbacks', async () => {
  const originalFetch = globalThis.fetch;
  const requestedModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  const fallbackModel = 'meta/llama-3.3-70b-instruct';
  const db = quotaCircuitDatabase([{ id: fallbackModel, created: 2, owned_by: 'meta' }]);
  let cloudflareCalls = 0;
  let nvidiaCalls = 0;

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } } });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') {
      nvidiaCalls += 1;
      const body = JSON.parse(String(init?.body));
      if (body.stream === true) {
        return new Response(
          `data: {"model":"${fallbackModel}","choices":[{"delta":{"content":"circuit stream fallback"}}]}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'circuit non-stream fallback' } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const env = {
    AI: {
      async run() {
        cloudflareCalls += 1;
        throw Object.assign(new Error('account limited'), { code: 4006 });
      },
    },
    AI_SEARCH: undefined,
    DB: db,
    NVIDIA_NIM_API_KEY: 'nvidia-test-key',
    DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    CLOUDFLARE_ACCOUNT_ID: 'account-test',
    CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
  } as any;
  const request = (stream: boolean, allowProviderFallback: boolean) => new Request(
    'https://ai.example.test/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: requestedModel,
        messages: [{ role: 'user', content: 'hello' }],
        stream,
        allow_provider_fallback: allowProviderFallback,
      }),
    },
  );
  const assertFallbackHeaders = (response: Response): void => {
    assert.equal(response.headers.get('x-ai-provider-fallback-from'), requestedModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-to'), fallbackModel);
    assert.equal(response.headers.get('x-ai-provider-fallback-reason'), 'cloudflare_neurons_exhausted');
  };

  try {
    const opensCircuit = await handleChatCompletions(request(false, false), env, context(), true);
    assert.equal(opensCircuit.status, 429);

    const nonStreaming = await handleChatCompletions(request(false, true), env, context(), true);
    assert.equal(nonStreaming.status, 200);
    assertFallbackHeaders(nonStreaming);
    const nonStreamingBody = await nonStreaming.json() as any;
    assert.equal(nonStreamingBody.model, fallbackModel);
    assert.equal(nonStreamingBody.choices[0].message.content, 'circuit non-stream fallback');

    const streaming = await handleChatCompletions(request(true, true), env, context(), true);
    assert.equal(streaming.status, 200);
    assertFallbackHeaders(streaming);
    const streamingBody = await streaming.text();
    assert.match(streamingBody, /circuit stream fallback/);
    assert.match(streamingBody, new RegExp(fallbackModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    assert.equal(cloudflareCalls, 1);
    assert.equal(nvidiaCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard stream quota failure stays provider-strict without prior NVIDIA consent', async () => {
  const originalFetch = globalThis.fetch;
  let nvidiaCalls = 0;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({ data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } } });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') nvidiaCalls += 1;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          messages: [{ role: 'user', content: 'hello' }],
          stream: true,
        }),
      }),
      {
        AI: {
          async run() {
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.error(Object.assign(new Error('account limited'), { code: 4006 }));
              },
            });
          },
        },
        AI_SEARCH: undefined,
        DB: database([{ id: 'meta/llama-3.3-70b-instruct', created: 2, owned_by: 'meta' }]),
        NVIDIA_NIM_API_KEY: 'nvidia-test-key',
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
    assert.equal((await response.json() as any).error.code, 'cloudflare_neurons_exhausted');
    assert.equal(nvidiaCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an external API key cannot opt into cross-provider fallback', async () => {
  const originalFetch = globalThis.fetch;
  const fallbackModel = 'meta/llama-3.3-70b-instruct';
  let nvidiaCalls = 0;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes('/graphql')) {
      return Response.json({
        data: { viewer: { accounts: [{ aiInferenceAdaptive: [{ neurons: 10_000, sampleInterval: 1 }] }] } },
      });
    }
    if (url === 'https://integrate.api.nvidia.com/v1/chat/completions') nvidiaCalls += 1;
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk-cfai-external-test-key',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          messages: [{ role: 'user', content: 'hello' }],
          allow_provider_fallback: true,
        }),
      }),
      {
        AI: {},
        AI_SEARCH: undefined,
        DB: publicApiDatabase([{ id: fallbackModel, created: 2, owned_by: 'meta' }]),
        NVIDIA_NIM_API_KEY: 'nvidia-test-key',
        DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
        CLOUDFLARE_ACCOUNT_ID: 'account-test',
        CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
      } as any,
      context(),
    );

    assert.equal(response.status, 429);
    assert.equal((await response.json() as any).error.code, 'cloudflare_neurons_exhausted');
    assert.equal(response.headers.get('x-ai-provider-fallback-to'), null);
    assert.equal(nvidiaCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NVIDIA model uses the same default web-search and OpenAI response path', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  let plannerTools: unknown;
  let plannerTurns = 0;
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/chat/completions')) {
      const requestBody = JSON.parse(String(init?.body));
      if (requestBody.tools) {
        plannerTools = requestBody.tools;
        plannerTurns += 1;
        if (plannerTurns > 1) {
          return Response.json({
            choices: [{ message: { role: 'assistant', content: 'Search complete' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        }
        return Response.json({
          choices: [{ message: { content: '<search><query>Opus 5 released date</query></search>' } }],
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
        body: JSON.stringify({
          model: 'google/gemma-4-31b-it',
          messages: [{ role: 'user', content: 'search when was opus 5 released' }],
        }),
      }),
      env,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.choices[0].message.content, 'Grounded NVIDIA answer');
    assert.equal(body.web_search.performed, true);
    assert.equal((plannerTools as any[])[0].type, 'function');
    assert.equal((plannerTools as any[])[0].function.name, 'web_search');
    assert.ok(calls.some((url) => url.includes('search.example.test/search')));
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

test('a paid-only Workers AI rejection returns an actionable 403 instead of a generic failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } },
  })) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: '@cf/moonshotai/kimi-k2.6',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
      {
        AI: {
          async run() {
            throw Object.assign(new Error('Upgrade to Workers Paid'), { code: 5035 });
          },
        },
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

    assert.equal(response.status, 403);
    const body = await response.json() as any;
    assert.equal(body.error.code, 'cloudflare_paid_plan_required');
    assert.match(body.error.message, /Workers Paid plan/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an authoritative Workers AI quota exception remains an actionable 429 if circuit storage fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    data: { viewer: { accounts: [{ aiInferenceAdaptive: [{ neurons: 0, sampleInterval: 1 }] }] } },
  })) as typeof fetch;

  try {
    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', messages: [{ role: 'user', content: 'hello' }] }),
      }),
      {
        AI: {
          async run() {
            throw new Error('4006: you have used up your daily free allocation of 10,000 neurons');
          },
        },
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
    assert.equal(body.error.type, 'rate_limit_error');
    assert.equal(body.error.code, 'cloudflare_neurons_exhausted');
    assert.match(body.error.message, /10,000-Neuron allocation/);
    assert.doesNotMatch(body.error.message, /Upstream model error/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an authoritative Workers AI quota exception opens a circuit for later requests', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({
    data: { viewer: { accounts: [{ aiInferenceAdaptive: [{ neurons: 0, sampleInterval: 1 }] }] } },
  })) as typeof fetch;

  const db = quotaCircuitDatabase();
  let modelCalls = 0;
  const env = {
    AI: {
      async run() {
        modelCalls += 1;
        throw Object.assign(new Error('account limited'), { code: 4006 });
      },
    },
    AI_SEARCH: undefined,
    DB: db,
    DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    CLOUDFLARE_ACCOUNT_ID: 'account-test',
    CLOUDFLARE_USAGE_API_TOKEN: 'usage-secret',
    ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
  } as any;
  const request = () => new Request('https://ai.example.test/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', messages: [{ role: 'user', content: 'hello' }] }),
  });

  try {
    const first = await handleChatCompletions(request(), env, context(), true);
    const second = await handleChatCompletions(request(), env, context(), true);

    assert.equal(first.status, 429);
    assert.equal(second.status, 429);
    assert.equal(modelCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
