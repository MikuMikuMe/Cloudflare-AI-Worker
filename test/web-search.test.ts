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

function installSearchResponse() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      results: [
        {
          url: 'https://example.com/current-fact',
          title: 'Current fact',
          content: 'A current fact from the public web.',
          engine: 'test',
        },
      ],
    })) as typeof fetch;
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

test('a planner input error falls back to deterministic web search', async () => {
  const restoreFetch = installSearchResponse();
  try {
    const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
    const env = environment(async (model, input) => {
      calls.push({ model, input });
      if (input.tools) throw new Error('8001: Invalid input');
      return { response: 'Grounded answer', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
    });

    const result = await prepareWebSearchAgent(
      env,
      [{ role: 'user', content: 'What is current on the web?', }],
      { messages: [{ role: 'user', content: 'What is current on the web?' }] },
      { maxNumResults: 5, maxFetchChars: 20_000 },
      MODEL,
    );

    assert.equal(result.provider, 'searxng');
    assert.equal(result.sources.length, 1);
    assert.equal(calls.length, 1);
  } finally {
    restoreFetch();
  }
});

test('chat completions search by default without a web_search request flag', async () => {
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
    assert.equal(body.web_search.sources[0].url, 'https://example.com/current-fact');
    assert.equal(calls[0].model, MODEL);
    assert.ok(calls[0].input.tools);
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
});
