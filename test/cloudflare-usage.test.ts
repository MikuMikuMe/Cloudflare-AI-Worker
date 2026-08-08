import assert from 'node:assert/strict';
import test from 'node:test';
import { CloudflareUsageError, fetchCloudflareNeurons } from '../src/lib/cloudflare-usage';

function environment(): Record<string, unknown> {
  return {
    AI: {},
    AI_SEARCH: {},
    DB: {},
    DEFAULT_MODEL: '@cf/meta/llama-3.1-8b-instruct-fp8',
    ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    ACCESS_AUD: 'test-audience',
    CLOUDFLARE_ACCOUNT_ID: 'account-test',
    CLOUDFLARE_USAGE_API_TOKEN: 'secret-test-token',
  };
}

test('reads today’s Workers AI neurons from Cloudflare GraphQL analytics', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; init?: RequestInit } | undefined;

  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), init };
    return Response.json({
      data: {
        viewer: {
          accounts: [
            {
              aiInferenceAdaptive: [
                { neurons: 4.38, sampleInterval: 1 },
                { neurons: 1.2, sampleInterval: 2 },
              ],
            },
          ],
        },
      },
    });
  }) as typeof fetch;

  try {
    const result = await fetchCloudflareNeurons(environment() as any);

    assert.equal(result.used_neurons, 6.78);
    assert.equal(result.daily_limit_neurons, 10_000);
    assert.equal(result.source, 'cloudflare-account-analytics-api');
    assert.equal(request?.url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(request?.init?.method, 'POST');
    assert.equal((request?.init?.headers as Record<string, string>).authorization, 'Bearer secret-test-token');

    const body = JSON.parse(String(request?.init?.body));
    assert.match(body.query, /aiInferenceAdaptive/);
    assert.match(body.query, /neurons/);
    assert.match(body.query, /sampleInterval/);
    assert.equal(body.variables.accountTag, 'account-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns zero when Cloudflare has no Workers AI inference rows today', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      data: { viewer: { accounts: [{ aiInferenceAdaptive: [] }] } },
    })) as typeof fetch;

  try {
    const result = await fetchCloudflareNeurons(environment() as any);
    assert.equal(result.used_neurons, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('maps a rejected analytics token to a safe configuration error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: [{ message: 'insufficient permissions' }] }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  try {
    await assert.rejects(
      () => fetchCloudflareNeurons(environment() as any),
      (error: unknown) =>
        error instanceof CloudflareUsageError &&
        error.code === 'cloudflare_usage_unauthorized' &&
        error.status === 502,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
