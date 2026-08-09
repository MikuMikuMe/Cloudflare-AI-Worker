import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardPage } from '../src/ui/dashboard';
import { landingPage } from '../src/ui/landing';
import { handleChatCompletions } from '../src/routes/v1';
import { prepareWebSearchAgent, WEB_SEARCH_TOOLS } from '../src/lib/web-search';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

function environment(run: (model: string, input: Record<string, unknown>) => Promise<unknown>) {
  return {
    AI: { run },
    AI_SEARCH: undefined,
    DB: {},
    DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    SEARXNG_URL: 'https://search.example.test',
    SEARXNG_API_KEY: 'test-only',
    ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
  } as any;
}

function installSearchResponse(body: unknown = {
  results: [
    {
      url: 'https://example.com/current-fact',
      title: 'Current fact',
      content: 'A current fact from the public web.',
      engine: 'test',
    },
  ],
}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('Workers AI tool properties use the accepted legacy schema', () => {
  for (const tool of WEB_SEARCH_TOOLS) {
    assert.equal(typeof tool.name, 'string');
    assert.equal(typeof tool.description, 'string');
    for (const property of Object.values(tool.parameters.properties)) {
      assert.deepEqual(Object.keys(property).sort(), ['description', 'type']);
    }
  }
});

test('a planner input error falls back to a normal answer without searching', async () => {
  const restoreFetch = installSearchResponse();
  try {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const env = environment(async (model, input) => {
      calls.push({ model, input });
      if (input.tools) throw new Error('8001: Invalid input');
      return { response: 'Normal answer', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });

    const result = await prepareWebSearchAgent(
      env,
      [{ role: 'user', content: 'Say hello.' }],
      { messages: [{ role: 'user', content: 'Say hello.' }] },
      { maxNumResults: 5, maxFetchChars: 20_000 },
      MODEL,
    );

    assert.equal(result.performed, false);
    assert.equal(result.response && (result.response as any).response, 'Normal answer');
    assert.equal(result.provider, null);
    assert.equal(result.sources.length, 0);
    assert.equal(result.searches.length, 0);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].input.tools, undefined);
  } finally {
    restoreFetch();
  }
});

for (const model of ['@cf/qwen/qwen3-30b-a3b-fp8', '@cf/nvidia/nemotron-3-120b-a12b']) {
  test(`${model} receives the native web-search tool`, async () => {
    const restoreFetch = installSearchResponse();
    try {
      const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
      const env = environment(async (calledModel, input) => {
        calls.push({ model: calledModel, input });
        if (input.tools) {
          return { response: '', tool_calls: [{ name: 'web_search', arguments: { query: 'What is current on the web?' } }] };
        }
        return { response: 'Grounded answer' };
      });

      await prepareWebSearchAgent(
        env,
        [{ role: 'user', content: 'What is current on the web?' }],
        { messages: [{ role: 'user', content: 'What is current on the web?' }] },
        { maxNumResults: 5, maxFetchChars: 20_000 },
        model,
      );

      assert.equal(calls[0].model, model);
      assert.ok(calls[0].input.tools);
    } finally {
      restoreFetch();
    }
  });
}

test('the selected model receives web tools even when it is not on a capability allowlist', async () => {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const selectedModel = '@cf/meta/llama-3.1-8b-instruct-fp8';
  const env = environment(async (model, input) => {
    calls.push({ model, input });
    return { response: 'Direct answer' };
  });

  const result = await prepareWebSearchAgent(
    env,
    [{ role: 'user', content: 'hi' }],
    { messages: [{ role: 'user', content: 'hi' }] },
    { maxNumResults: 5, maxFetchChars: 20_000 },
    selectedModel,
  );

  assert.equal(result.performed, false);
  assert.equal(calls[0].model, selectedModel);
  assert.ok(calls[0].input.tools);
});

test('chat completions expose tools but do not search when the model declines', async () => {
  const restoreFetch = installSearchResponse();
  try {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const env = environment(async (model, input) => {
      calls.push({ model, input });
      return { response: 'Hello without searching.', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });

    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'hi' }] }),
      }),
      env,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.choices[0].message.content, 'Hello without searching.');
    assert.equal(body.web_search, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, MODEL);
    assert.ok(calls[0].input.tools);
    assert.equal(calls[0].input.messages[0].role, 'system');
  } finally {
    restoreFetch();
  }
});

test('chat completions execute web tools only after the model calls one', async () => {
  const restoreFetch = installSearchResponse();
  try {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const env = environment(async (model, input) => {
      calls.push({ model, input });
      if (input.tools) {
        return { response: '', tool_calls: [{ name: 'web_search', arguments: { query: 'What is current on the web?' } }] };
      }
      return { response: 'Grounded answer', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });

    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'What is current on the web?' }] }),
      }),
      env,
      context(),
      true,
    );

    assert.equal(response.status, 200);
    const body = await response.json() as any;
    assert.equal(body.choices[0].message.content, 'Grounded answer');
    assert.equal(body.web_search.provider, 'searxng');
    assert.equal(body.web_search.performed, true);
    assert.equal(body.web_search.sources[0].url, 'https://example.com/current-fact');
    assert.ok(calls.length >= 2);
    assert.ok(calls[0].input.tools);
  } finally {
    restoreFetch();
  }
});

test('streaming reports that web search ran even when the provider returns no URLs', async () => {
  const restoreFetch = installSearchResponse({ results: [] });
  try {
    const env = environment(async (_model, input) => {
      if (input.tools) {
        return { response: '', tool_calls: [{ name: 'web_search', arguments: { query: 'What is current on the web?' } }] };
      }
      if (input.stream) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"response":"No matching pages."}\n'));
            controller.close();
          },
        });
      }
      return { response: 'No matching pages.' };
    });

    const response = await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: 'What is current on the web?' }],
          stream: true,
        }),
      }),
      env,
      context(),
      true,
    );

    const streamText = await response.text();
    const metadataLine = streamText
      .split(/\r?\n/)
      .find((line) => line.startsWith('data: ') && line.includes('"web_search"'));
    assert.ok(metadataLine, 'stream should contain a web_search metadata chunk');
    const metadata = JSON.parse(metadataLine!.slice('data: '.length));
    assert.equal(metadata.web_search.performed, true);
    assert.equal(metadata.web_search.sources.length, 0);
    assert.equal(metadata.web_search.queries[0].result_count, 0);
  } finally {
    restoreFetch();
  }
});

test('the final model is told not to emit client-side tool invocation JSON', async () => {
  const restoreFetch = installSearchResponse();
  try {
    let finalInput: Record<string, unknown> | undefined;
    const env = environment(async (_model, input) => {
      if (input.tools) {
        return { response: '', tool_calls: [{ name: 'web_search', arguments: { query: 'What is current on the web?' } }] };
      }
      finalInput = input;
      return { response: 'Grounded answer' };
    });

    await handleChatCompletions(
      new Request('https://ai.example.test/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: 'Search the web.' }] }),
      }),
      env,
      context(),
      true,
    );

    const finalMessages = (finalInput?.messages ?? []) as Array<{ content?: string | null }>;
    const finalSystemMessage = finalMessages[finalMessages.length - 1]?.content ?? '';
    assert.match(finalSystemMessage, /already executed live web search/i);
    assert.match(finalSystemMessage, /do not emit.*invocation/i);
    assert.match(finalSystemMessage, /web_fetcher/i);
  } finally {
    restoreFetch();
  }
});

test('the playground and public docs do not present web search as an option', () => {
  const dashboard = dashboardPage('user@example.com', 'example.cloudflareaccess.com');
  const landing = landingPage('https://ai.example.test');

  assert.doesNotMatch(dashboard, /id="web-search"/);
  assert.doesNotMatch(dashboard, /web_search: \$\('#web-search'\)/);
  assert.doesNotMatch(landing, /Opt-in web search/i);
  assert.doesNotMatch(landing, /"web_search":true/);
  assert.match(dashboard, /Web search:/);
  assert.match(dashboard, /result_count/);
});
