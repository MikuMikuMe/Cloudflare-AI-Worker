import type { Env } from '../types';

const CLOUDFLARE_GRAPHQL_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';
const DAILY_NEURON_LIMIT = 10_000;
const QUOTA_ERROR_CODES = new Set(['3036']);
const PROVIDER_STATUS_KEY = 'cloudflare-workers-ai';
const QUOTA_RETRY_INTERVAL_MS = 5 * 60_000;

export const CLOUDFLARE_NEURONS_EXHAUSTED_CODE = 'cloudflare_neurons_exhausted';
export const CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE =
  "Cloudflare is currently rejecting Workers AI requests with its daily 10,000-Neuron allocation error. Its usage dashboard can reset before inference access recovers, so the gateway will retry Cloudflare shortly; signed-in users can choose NVIDIA or explicitly enable NVIDIA backup.";
export const CLOUDFLARE_PAID_PLAN_REQUIRED_CODE = 'cloudflare_paid_plan_required';
export const CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE =
  'This Workers AI model now requires the Workers Paid plan or prepaid AI Gateway credits.';

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
          errorCode
        }
      }
    }
  }
`;

type JsonRecord = Record<string, unknown>;

export type CloudflareNeuronsUsage = {
  date_utc: string;
  used_neurons: number | null;
  daily_limit_neurons: number;
  quota_exhausted: boolean;
  reset_at: string;
  source: 'cloudflare-account-analytics-api' | 'workers-ai-binding-quota-circuit';
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

function quotaErrorCode(value: unknown): boolean {
  return QUOTA_ERROR_CODES.has(String(value ?? '').trim());
}

/**
 * Cloudflare currently documents account-limit error 3036, while production
 * Workers AI binding and analytics responses can emit 4006 for the same
 * 10,000-Neuron free-allocation rejection. Accept both plus the guarded
 * message form so callers do not collapse an actionable 429 into a generic
 * upstream 502 when the binding omits a structured code.
 */
export function isCloudflareNeuronsExhaustedError(error: unknown): boolean {
  const record = isRecord(error) ? error : null;
  const nestedError = isRecord(record?.error) ? record.error : null;
  const cause = isRecord(record?.cause) ? record.cause : null;
  const nestedCause = isRecord(nestedError?.cause) ? nestedError.cause : null;
  const codes = [
    record?.code,
    record?.errorCode,
    nestedError?.code,
    nestedError?.errorCode,
    cause?.code,
    cause?.errorCode,
    nestedCause?.code,
    nestedCause?.errorCode,
  ].map((value) => String(value ?? '').trim());
  if (codes.some((code) => quotaErrorCode(code))) return true;

  const message = [
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
    textField(record ?? {}, 'message'),
    textField(nestedError ?? {}, 'message'),
    textField(cause ?? {}, 'message'),
    textField(nestedCause ?? {}, 'message'),
  ].filter(Boolean).join(' ');

  if (/workers_ai_free_allocation_exceeded/i.test(message)) return true;
  if (codes.includes('4006') && /(?:neuron|allocation|account limited)/i.test(message)) return true;
  if (/(?:^|\D)(?:3036|4006)(?:\D|$)/.test(message) && /(?:neuron|allocation|account limited)/i.test(message)) {
    return true;
  }
  return /daily free allocation/i.test(message) && /10,?000\s+neurons/i.test(message);
}

function quotaWindow(now: Date): { day: string; resetAt: number } {
  const day = utcDay(now);
  return {
    day,
    resetAt: Date.parse(`${day}T00:00:00.000Z`) + 86400_000,
  };
}

async function hasConfirmedQuotaExhaustion(db: D1Database, now: Date): Promise<boolean> {
  const { day } = quotaWindow(now);
  const recentObservationCutoff = now.getTime() - QUOTA_RETRY_INTERVAL_MS;
  try {
    const row = await db.prepare(
      `SELECT reason_code
         FROM provider_daily_status
        WHERE provider = ? AND day_utc = ? AND state = 'quota_exhausted'
          AND expires_at > ? AND observed_at > ?
        LIMIT 1`,
    ).bind(PROVIDER_STATUS_KEY, day, now.getTime(), recentObservationCutoff).first<{ reason_code: string }>();
    return row?.reason_code === CLOUDFLARE_NEURONS_EXHAUSTED_CODE;
  } catch {
    // Deploys remain fail-open if the additive migration has not landed yet.
    return false;
  }
}

/** Cloudflare uses internal code 5035 when a model is unavailable on Workers Free. */
export function isCloudflarePaidPlanRequiredError(error: unknown): boolean {
  const record = isRecord(error) ? error : null;
  const nestedError = isRecord(record?.error) ? record.error : null;
  const cause = isRecord(record?.cause) ? record.cause : null;
  const codes = [
    record?.code,
    record?.errorCode,
    nestedError?.code,
    nestedError?.errorCode,
    cause?.code,
    cause?.errorCode,
  ].map((value) => String(value ?? '').trim());
  if (codes.includes('5035')) return true;

  const message = [
    error instanceof Error ? error.message : typeof error === 'string' ? error : '',
    typeof record?.message === 'string' ? record.message : '',
    typeof nestedError?.message === 'string' ? nestedError.message : '',
    typeof cause?.message === 'string' ? cause.message : '',
  ].filter(Boolean).join(' ');
  return /(?:^|\D)5035(?:\D|$)/.test(message)
    || /(?:workers paid plan|paid billing method|upgrade[^.]{0,80}(?:workers )?paid)/i.test(message);
}

export async function recordCloudflareNeuronsExhausted(db: D1Database, now = new Date()): Promise<void> {
  const { day, resetAt } = quotaWindow(now);
  const retryAt = Math.min(resetAt, now.getTime() + QUOTA_RETRY_INTERVAL_MS);
  await db.prepare(
    `INSERT INTO provider_daily_status
       (provider, day_utc, state, reason_code, expires_at, observed_at)
     VALUES (?, ?, 'quota_exhausted', ?, ?, ?)
     ON CONFLICT(provider, day_utc) DO UPDATE SET
       state = excluded.state,
       reason_code = excluded.reason_code,
       expires_at = excluded.expires_at,
       observed_at = excluded.observed_at`,
  ).bind(
    PROVIDER_STATUS_KEY,
    day,
    CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
    retryAt,
    now.getTime(),
  ).run();
}

function confirmedQuotaUsage(now: Date): CloudflareNeuronsUsage {
  const { day, resetAt } = quotaWindow(now);
  return {
    date_utc: day,
    used_neurons: null,
    daily_limit_neurons: DAILY_NEURON_LIMIT,
    quota_exhausted: true,
    reset_at: new Date(resetAt).toISOString(),
    source: 'workers-ai-binding-quota-circuit',
  };
}

/**
 * Read the account-level Workers AI Neurons metric from the same GraphQL
 * analytics dataset used by Cloudflare's Workers AI dashboard. The API token
 * is deliberately server-side only; the dashboard browser receives the small
 * normalized result below, never the token or raw analytics rows.
 */
export async function fetchCloudflareNeurons(env: Env, now = new Date()): Promise<CloudflareNeuronsUsage> {
  if (await hasConfirmedQuotaExhaustion(env.DB, now)) return confirmedQuotaUsage(now);

  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_USAGE_API_TOKEN?.trim();

  if (!accountId || !token) {
    throw new CloudflareUsageError(
      'cloudflare_usage_not_configured',
      'Live Cloudflare usage needs a read-only Account Analytics API token configured on the Worker.',
      503,
    );
  }

  const { day, resetAt } = quotaWindow(now);
  const tomorrow = utcDay(new Date(resetAt));

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

  const records = extractInferenceRecords(body).filter((record) => recordBelongsToDay(record, day));
  const observedNeurons = records
    .reduce((sum, record) => sum + neuronQuantity(record), 0);
  // Error 4006 is emitted by the inference allocator even when the dashboard
  // has reset to zero. A historical rejection must not create an all-day
  // circuit; only the documented 3036 code or the measured limit is durable.
  const quotaExhausted = records.some((record) => quotaErrorCode(record.errorCode)) || observedNeurons >= DAILY_NEURON_LIMIT;
  if (quotaExhausted) await recordCloudflareNeuronsExhausted(env.DB, now).catch(() => undefined);

  return {
    date_utc: day,
    used_neurons: roundNeurons(observedNeurons),
    daily_limit_neurons: DAILY_NEURON_LIMIT,
    quota_exhausted: quotaExhausted,
    reset_at: new Date(resetAt).toISOString(),
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
  now = new Date(),
): Promise<{ depleted: boolean; usage?: CloudflareNeuronsUsage }> {
  try {
    const usage = await fetchCloudflareNeurons(env, now);
    return { depleted: usage.quota_exhausted, usage };
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
