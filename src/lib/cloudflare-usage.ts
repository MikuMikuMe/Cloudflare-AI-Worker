import type { Env } from '../types';

const CLOUDFLARE_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DAILY_NEURON_LIMIT = 10_000;
const WORKERS_AI_USAGE_QUERY = `
  query WorkersAiDailyUsage($accountTag: string, $start: Time, $end: Time) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        aiInferenceAdaptive(
          filter: { datetime_geq: $start, datetime_lt: $end }
          limit: 10000
        ) {
          datetime
          neurons
          sampleInterval
        }
      }
    }
  }
`;

type JsonRecord = Record<string, unknown>;

export type CloudflareNeuronsUsage = {
  date_utc: string;
  used_neurons: number;
  daily_limit_neurons: number;
  source: 'cloudflare-account-analytics-api';
};

export type CloudflareUsageErrorCode =
  | 'cloudflare_usage_not_configured'
  | 'cloudflare_usage_unauthorized'
  | 'cloudflare_usage_unavailable'
  | 'cloudflare_neurons_not_returned';

export class CloudflareUsageError extends Error {
  constructor(
    public readonly code: CloudflareUsageErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'CloudflareUsageError';
  }
}

/**
 * Read the account-level Workers AI Neurons metric from the same GraphQL
 * analytics dataset used by Cloudflare's Workers AI dashboard. The API token
 * is deliberately server-side only; the dashboard browser receives the small
 * normalized result below, never the token or raw analytics rows.
 */
export async function fetchCloudflareNeurons(env: Env): Promise<CloudflareNeuronsUsage> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_USAGE_API_TOKEN?.trim();

  if (!accountId || !token) {
    throw new CloudflareUsageError(
      'cloudflare_usage_not_configured',
      'Live Cloudflare usage needs a read-only Account Analytics API token configured on the Worker.',
      503,
    );
  }

  const day = utcDay(new Date());
  const tomorrow = utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400_000));

  let response: Response;
  try {
    response = await fetch(CLOUDFLARE_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: WORKERS_AI_USAGE_QUERY,
        variables: {
          accountTag: accountId,
          start: `${day}T00:00:00Z`,
          end: `${tomorrow}T00:00:00Z`,
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new CloudflareUsageError(
      'cloudflare_usage_unavailable',
      'Cloudflare account usage could not be reached. Try refreshing in a moment.',
      502,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new CloudflareUsageError(
      'cloudflare_usage_unavailable',
      'Cloudflare returned an unreadable usage response.',
      502,
    );
  }

  if (response.status === 401 || response.status === 403 || hasGraphqlPermissionError(body)) {
    throw new CloudflareUsageError(
      'cloudflare_usage_unauthorized',
      'Cloudflare rejected the usage token. It needs account Account Analytics: Read permission.',
      502,
    );
  }

  if (!response.ok || !isRecord(body) || !isRecord(body.data)) {
    throw new CloudflareUsageError(
      'cloudflare_usage_unavailable',
      'Cloudflare Workers AI analytics are temporarily unavailable.',
      502,
    );
  }

  const records = extractInferenceRecords(body);
  const usedNeurons = records
    .filter((record) => recordBelongsToDay(record, day))
    .reduce((sum, record) => sum + neuronQuantity(record), 0);

  return {
    date_utc: day,
    used_neurons: roundNeurons(usedNeurons),
    daily_limit_neurons: DAILY_NEURON_LIMIT,
    source: 'cloudflare-account-analytics-api',
  };
}

/**
 * Quota checks are fail-open when analytics is unavailable. A stale analytics
 * response should not disable every model; the upstream Workers AI error will
 * still be surfaced if Cloudflare itself rejects a request.
 */
export async function cloudflareNeuronsExhausted(
  env: Env,
): Promise<{ depleted: boolean; usage?: CloudflareNeuronsUsage }> {
  if (!env.CLOUDFLARE_ACCOUNT_ID?.trim() || !env.CLOUDFLARE_USAGE_API_TOKEN?.trim()) {
    return { depleted: false };
  }

  try {
    const usage = await fetchCloudflareNeurons(env);
    return { depleted: usage.used_neurons >= usage.daily_limit_neurons, usage };
  } catch {
    return { depleted: false };
  }
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textField(record: JsonRecord, name: string): string {
  const value = record[name];
  return typeof value === 'string' ? value : '';
}

function recordBelongsToDay(record: JsonRecord, day: string): boolean {
  const start = textField(record, 'datetime') || textField(record, 'ChargePeriodStart');
  return !start || start.slice(0, 10) === day;
}

function extractInferenceRecords(body: JsonRecord): JsonRecord[] {
  const data = body.data;
  if (!isRecord(data)) return [];

  const viewer = data.viewer;
  if (!isRecord(viewer) || !Array.isArray(viewer.accounts)) return [];

  return viewer.accounts.flatMap((account) => {
    if (!isRecord(account) || !Array.isArray(account.aiInferenceAdaptive)) return [];
    return account.aiInferenceAdaptive.filter(isRecord);
  });
}

function hasGraphqlPermissionError(body: unknown): boolean {
  if (!isRecord(body) || !Array.isArray(body.errors)) return false;
  return body.errors.some((error) => {
    if (!isRecord(error)) return false;
    const message = textField(error, 'message').toLowerCase();
    return message.includes('permission') || message.includes('unauthor') || message.includes('forbidden');
  });
}

function neuronQuantity(record: JsonRecord): number {
  const neurons = numericField(record, 'neurons');
  const sampleInterval = numericField(record, 'sampleInterval');
  const weight = sampleInterval > 0 ? sampleInterval : 1;
  return neurons >= 0 ? neurons * weight : 0;
}

function numericField(record: JsonRecord, name: string): number {
  const value = record[name];
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundNeurons(value: number): number {
  return Math.round(value * 100) / 100;
}
