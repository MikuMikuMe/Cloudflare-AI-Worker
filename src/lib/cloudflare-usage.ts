import type { Env } from '../types';

const CLOUDFLARE_USAGE_ENDPOINT =
  'https://api.cloudflare.com/client/v4/accounts/{account_id}/billable/usage';
const DAILY_NEURON_LIMIT = 10_000;

type JsonRecord = Record<string, unknown>;

export type CloudflareNeuronsUsage = {
  date_utc: string;
  used_neurons: number;
  daily_limit_neurons: number;
  source: 'cloudflare-account-usage-api';
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
 * Read the account-level Workers AI Neurons metric from Cloudflare's billing
 * usage API. The API token is deliberately server-side only; the dashboard
 * browser receives the small normalized result below, never the token or the
 * raw account usage response.
 */
export async function fetchCloudflareNeurons(env: Env): Promise<CloudflareNeuronsUsage> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_USAGE_API_TOKEN?.trim();

  if (!accountId || !token) {
    throw new CloudflareUsageError(
      'cloudflare_usage_not_configured',
      'Live Cloudflare usage needs a read-only Billing API token configured on the Worker.',
      503,
    );
  }

  const day = utcDay(new Date());
  const tomorrow = utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400_000));
  const endpoint = CLOUDFLARE_USAGE_ENDPOINT.replace('{account_id}', encodeURIComponent(accountId));
  const url = `${endpoint}?from=${encodeURIComponent(day)}&to=${encodeURIComponent(tomorrow)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
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

  if (response.status === 401 || response.status === 403) {
    throw new CloudflareUsageError(
      'cloudflare_usage_unauthorized',
      'Cloudflare rejected the usage token. It needs account Billing: Read permission.',
      502,
    );
  }

  if (!response.ok || !isRecord(body) || body.success !== true) {
    throw new CloudflareUsageError(
      'cloudflare_usage_unavailable',
      'Cloudflare account usage is temporarily unavailable.',
      502,
    );
  }

  const records = Array.isArray(body.result) ? body.result.filter(isRecord) : [];
  const todayRecords = records.filter((record) => recordBelongsToDay(record, day));
  const neuronRecords = todayRecords.filter(isWorkersAiNeuronsRecord);

  // An empty result is the expected response when the account has used no
  // metered products today. If Cloudflare returned other products but no
  // Neurons metric, do not turn an API/schema mismatch into a misleading 0.
  if (!neuronRecords.length && todayRecords.length > 0) {
    throw new CloudflareUsageError(
      'cloudflare_neurons_not_returned',
      'Cloudflare returned usage data, but no Workers AI Neurons metric for today.',
      502,
    );
  }

  const usedNeurons = neuronRecords.reduce((sum, record) => sum + consumedQuantity(record), 0);

  return {
    date_utc: day,
    used_neurons: roundNeurons(usedNeurons),
    daily_limit_neurons: DAILY_NEURON_LIMIT,
    source: 'cloudflare-account-usage-api',
  };
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
  const start = textField(record, 'ChargePeriodStart');
  return !start || start.slice(0, 10) === day;
}

function isWorkersAiNeuronsRecord(record: JsonRecord): boolean {
  const unit = textField(record, 'ConsumedUnit').toLowerCase();
  const labels = [
    'ServiceName',
    'ServiceFamilyName',
    'x_ProductFamilyName',
    'x_BillableMetricName',
    'x_BillableMetricId',
    'ChargeDescription',
  ]
    .map((field) => textField(record, field).toLowerCase())
    .join(' ');

  const hasNeurons = /\bneurons?\b/.test(unit) || /\bneurons?\b/.test(labels);
  const hasWorkersAiLabel =
    labels.includes('workers ai') ||
    labels.includes('workers_ai') ||
    labels.includes('workers-ai') ||
    labels.includes('ai inference');

  return hasNeurons && hasWorkersAiLabel;
}

function consumedQuantity(record: JsonRecord): number {
  const value = record.ConsumedQuantity;
  const quantity = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
}

function roundNeurons(value: number): number {
  return Math.round(value * 100) / 100;
}
