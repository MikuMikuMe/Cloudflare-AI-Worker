import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CloudflareUsageError,
  cloudflareNeuronsExhausted,
  fetchCloudflareNeurons,
  isCloudflareNeuronsExhaustedError,
  isCloudflarePaidPlanRequiredError,
  recordCloudflareNeuronsExhausted,
} from '../src/lib/cloudflare-usage';

function quotaDatabase(): D1Database {
  let row: { provider: string; day: string; reason: string; expiresAt: number; observedAt: number } | null = null;
  return {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) {
          values = next;
          return this;
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
    assert.match(body.query, /errorCode/);
    assert.equal(body.variables.accountTag, 'account-test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not turn a historical 4006 analytics row with zero neurons into an all-day circuit', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      data: {
        viewer: {
          accounts: [{ aiInferenceAdaptive: [{ neurons: 0, sampleInterval: 1, errorCode: 4006 }] }],
        },
      },
    })) as typeof fetch;

  try {
    const result = await fetchCloudflareNeurons(environment() as any);
    assert.equal(result.used_neurons, 0);
    assert.equal(result.quota_exhausted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an authoritative quota circuit is retried shortly and never crosses the next UTC reset', async () => {
  const db = quotaDatabase();
  const observedAt = new Date('2026-08-09T12:00:00.000Z');
  await recordCloudflareNeuronsExhausted(db, observedAt);

  const env = { DB: db } as any;
  const beforeRetry = await cloudflareNeuronsExhausted(env, new Date('2026-08-09T12:04:59.999Z'));
  assert.equal(beforeRetry.depleted, true);
  assert.equal(beforeRetry.usage?.used_neurons, null);
  assert.equal(beforeRetry.usage?.source, 'workers-ai-binding-quota-circuit');
  assert.equal(beforeRetry.usage?.reset_at, '2026-08-10T00:00:00.000Z');

  const afterRetry = await cloudflareNeuronsExhausted(env, new Date('2026-08-09T12:05:00.000Z'));
  assert.equal(afterRetry.depleted, false);

  const nearResetDb = quotaDatabase();
  await recordCloudflareNeuronsExhausted(nearResetDb, new Date('2026-08-09T23:59:00.000Z'));
  const afterReset = await cloudflareNeuronsExhausted(
    { DB: nearResetDb } as any,
    new Date('2026-08-10T00:00:00.000Z'),
  );
  assert.equal(afterReset.depleted, false);
});

test('recognizes documented and production Workers AI quota errors without matching capacity errors', () => {
  assert.equal(
    isCloudflareNeuronsExhaustedError(Object.assign(new Error('account limited'), { code: 3036 })),
    true,
  );
  assert.equal(
    isCloudflareNeuronsExhaustedError(
      new Error('4006: you have used up your daily free allocation of 10,000 neurons'),
    ),
    true,
  );
  assert.equal(
    isCloudflareNeuronsExhaustedError({
      error: { code: 4006, message: 'daily free allocation reached' },
    }),
    true,
  );
  assert.equal(isCloudflareNeuronsExhaustedError(Object.assign(new Error('out of capacity'), { code: 3040 })), false);
});

test('recognizes the paid-model 5035 response without treating it as neuron exhaustion', () => {
  const error = { error: { code: 5035, message: 'Upgrade to the Workers Paid plan' } };
  assert.equal(isCloudflarePaidPlanRequiredError(error), true);
  assert.equal(isCloudflareNeuronsExhaustedError(error), false);
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
