import type { Env } from '../types';

export const NVIDIA_NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODELS_URL = `${NVIDIA_NIM_BASE_URL}/models`;
const NVIDIA_FREE_CATALOG_URL = 'https://build.nvidia.com/models?filters=nimType%3Anim_type_preview';
const REQUEST_TIMEOUT_MS = 15_000;

export interface NvidiaModelRecord {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  provider: 'nvidia';
  free_endpoint: true;
}

export class NvidiaApiError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = 'NvidiaApiError';
  }
}

const FALLBACK_FREE_CHAT_MODELS = new Set([
  'google/diffusiongemma-26b-a4b-it',
  'google/gemma-4-31b-it',
  'meta/llama-3.3-70b-instruct',
  'minimaxai/minimax-m3',
  'nvidia/ising-calibration-1.5-31b',
  'nvidia/nemotron-3-nano-30b-a3b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'nvidia/nemotron-mini-4b-instruct',
  'nvidia/nvidia-nemotron-nano-9b-v2',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
  'poolside/laguna-xs-2.1',
  'stepfun-ai/step-3.7-flash',
  'thinkingmachines/inkling',
  'z-ai/glm-5.2',
]);

const NON_CHAT_MODEL = /(?:^|[-_/])(embed|embedding|rerank|bge|clip|parse|translate|safety|guard|detector|cosmos|riva|voice|image|video|audio|deplot|vila|neva)(?:[-_/]|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

/** Keep only IDs that can be sent to the OpenAI-compatible chat endpoint. */
export function isLikelyNvidiaChatModel(id: string): boolean {
  return !NON_CHAT_MODEL.test(id);
}

/** Normalize NVIDIA's OpenAI-compatible GET /v1/models response. */
export function normalizeNvidiaModels(body: unknown): Array<{ id: string; created: number; owned_by: string }> {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];

  return body.data.flatMap((value) => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) return [];
    const id = value.id.trim();
    if (!isLikelyNvidiaChatModel(id)) return [];
    return [{
      id,
      created: positiveInteger(value.created, 0),
      owned_by: typeof value.owned_by === 'string' && value.owned_by.trim() ? value.owned_by.trim() : id.split('/')[0] ?? 'nvidia',
    }];
  });
}

/**
 * The public catalog marks free access as `nim_type_preview`, but the
 * authenticated /v1/models response does not carry that field. Parse the
 * server-rendered catalog when it is available; a WAF challenge is treated as
 * a refresh miss and never becomes a reason to expose unknown models.
 */
export function parseFreeNvidiaCatalog(html: string): Set<string> {
  const decoded = html.replace(/\\+(?=")/g, '');
  const resources = decoded.match(/"resourceType":"ENDPOINT","resourceId":"[^"]+"[\s\S]*?(?="resourceType":"ENDPOINT","resourceId":"|$)/g) ?? [];
  const ids = new Set<string>();

  for (const resource of resources) {
    const name = /"name":"([^"]+)"/.exec(resource)?.[1]?.trim();
    const publisher = /"key":"publisher","values":\["([^"]+)"/.exec(resource)?.[1]?.trim();
    const free = /"key":"nimType","values":\[[^\]]*"Free Endpoint"/.test(resource);
    if (!name || !publisher || !free) continue;

    const id = `${publisher}/${name}`;
    if (isLikelyNvidiaChatModel(id)) ids.add(id);
  }

  return ids;
}

export function selectFreeNvidiaModels(
  callable: Array<{ id: string; created: number; owned_by: string }>,
  catalogIds: ReadonlySet<string>,
  previousIds: ReadonlySet<string> = new Set(),
): NvidiaModelRecord[] {
  // A non-empty catalog is authoritative. Previous data is used only when the
  // catalog request failed, which prevents a successful refresh from keeping
  // an endpoint that NVIDIA no longer marks as free.
  const allowed = catalogIds.size
    ? catalogIds
    : previousIds.size
      ? previousIds
      : FALLBACK_FREE_CHAT_MODELS;

  return callable
    .filter((model) => allowed.has(model.id))
    .map((model) => ({
      ...model,
      object: 'model' as const,
      provider: 'nvidia' as const,
      free_endpoint: true as const,
    }));
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) return `HTTP ${response.status}`;
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string') {
      return body.error.message.slice(0, 240);
    }
  } catch {
    // Keep a short plain-text provider error for diagnostics.
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 240) || `HTTP ${response.status}`;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

export async function fetchNvidiaCallableModels(apiKey: string): Promise<Array<{ id: string; created: number; owned_by: string }>> {
  let response: Response;
  try {
    response = await fetchWithTimeout(NVIDIA_MODELS_URL, {
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
    });
  } catch {
    throw new NvidiaApiError('NVIDIA model catalog could not be reached.', 502);
  }

  if (!response.ok) throw new NvidiaApiError(`NVIDIA model catalog returned ${await responseMessage(response)}.`, response.status >= 500 ? 502 : response.status);

  const body = await response.json().catch(() => null);
  const models = normalizeNvidiaModels(body);
  if (!models.length) throw new NvidiaApiError('NVIDIA returned no chat-capable models.', 502);
  return models;
}

async function fetchNvidiaFreeCatalogPage(page: number): Promise<string | null> {
  const url = new URL(NVIDIA_FREE_CATALOG_URL);
  if (page > 1) url.searchParams.set('page', String(page));

  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'Cloudflare-AI-Worker/2.2 NVIDIA catalog refresh',
      },
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;
  return response.text().catch(() => null);
}

function catalogPageCount(html: string): number {
  const decoded = html.replace(/\\+(?=")/g, '');
  const pages = /["']resultPageTotal["']\s*:\s*(\d+)/.exec(decoded)?.[1];
  const count = pages ? Number(pages) : 1;
  return Number.isInteger(count) && count > 0 ? Math.min(count, 10) : 1;
}

export async function fetchNvidiaFreeCatalog(): Promise<Set<string>> {
  const firstPage = await fetchNvidiaFreeCatalogPage(1);
  if (!firstPage) return new Set();

  const pages = catalogPageCount(firstPage);
  const pageBodies = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) => fetchNvidiaFreeCatalogPage(index + 2)),
  );
  if (pageBodies.some((body) => body == null)) return new Set();

  const ids = parseFreeNvidiaCatalog(firstPage);
  for (const body of pageBodies) {
    for (const id of parseFreeNvidiaCatalog(body ?? '')) ids.add(id);
  }
  return ids;
}

export async function requestNvidiaChat(
  env: Pick<Env, 'NVIDIA_NIM_API_KEY'>,
  model: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const apiKey = env.NVIDIA_NIM_API_KEY?.trim();
  if (!apiKey) throw new NvidiaApiError('NVIDIA NIM is not configured on this Worker.', 503);

  let response: Response;
  try {
    response = await fetchWithTimeout(`${NVIDIA_NIM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        accept: body.stream === true ? 'text/event-stream' : 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...body, model }),
    });
  } catch {
    throw new NvidiaApiError('NVIDIA NIM could not be reached.', 502);
  }

  if (!response.ok) {
    throw new NvidiaApiError(`NVIDIA NIM returned ${await responseMessage(response)}.`, response.status >= 500 ? 502 : response.status);
  }
  return response;
}

export async function requestNvidiaJson(
  env: Pick<Env, 'NVIDIA_NIM_API_KEY'>,
  model: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await requestNvidiaChat(env, model, { ...body, stream: false });
  const value: unknown = await response.json().catch(() => null);
  if (!isRecord(value)) throw new NvidiaApiError('NVIDIA NIM returned an unreadable response.', 502);
  return value;
}

export function nvidiaFallbackModelIds(): ReadonlySet<string> {
  return FALLBACK_FREE_CHAT_MODELS;
}

interface NvidiaModelRow {
  id: string;
  created: number;
  owned_by: string;
}

function storedModelPayload(row: NvidiaModelRow): NvidiaModelRecord {
  return {
    ...row,
    object: 'model',
    provider: 'nvidia',
    free_endpoint: true,
  };
}

async function loadStoredNvidiaModels(env: Pick<Env, 'DB'>): Promise<NvidiaModelRecord[]> {
  try {
    const result = await env.DB.prepare(
      `SELECT id, created, owned_by
         FROM nvidia_models
        WHERE active = 1
        ORDER BY id ASC`,
    ).all<NvidiaModelRow>();
    return (result.results ?? []).map(storedModelPayload);
  } catch {
    // A first deploy can briefly run before the migration is applied. Do not
    // turn that into a permanent API outage; the next scheduled refresh will
    // repopulate the table after the schema is available.
    return [];
  }
}

async function storeNvidiaModels(env: Pick<Env, 'DB'>, models: NvidiaModelRecord[]): Promise<void> {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM nvidia_models')];
  for (const model of models) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO nvidia_models
          (id, created, owned_by, free_endpoint, active, last_seen_at)
         VALUES (?, ?, ?, 1, 1, ?)
         ON CONFLICT(id) DO UPDATE SET
           created = excluded.created,
           owned_by = excluded.owned_by,
           free_endpoint = 1,
           active = 1,
           last_seen_at = excluded.last_seen_at`,
      ).bind(model.id, model.created, model.owned_by, now),
    );
  }
  await env.DB.batch(statements);
}

/** Refresh the free NVIDIA chat catalog. Called by the daily Worker cron. */
export async function refreshNvidiaModelIndex(env: Pick<Env, 'DB' | 'NVIDIA_NIM_API_KEY'>): Promise<NvidiaModelRecord[]> {
  const previous = await loadStoredNvidiaModels(env);
  const apiKey = env.NVIDIA_NIM_API_KEY?.trim();
  if (!apiKey) return previous;

  let callable: Array<{ id: string; created: number; owned_by: string }>;
  try {
    callable = await fetchNvidiaCallableModels(apiKey);
  } catch {
    return previous;
  }

  const catalogIds = await fetchNvidiaFreeCatalog();
  const models = selectFreeNvidiaModels(callable, catalogIds, new Set(previous.map((model) => model.id)));
  try {
    await storeNvidiaModels(env, models);
  } catch {
    // Keep serving the in-memory result even if D1 is temporarily unavailable.
  }
  return models;
}

/** Read the last indexed set, initializing it lazily on the first API call. */
export async function getNvidiaModelIndex(env: Pick<Env, 'DB' | 'NVIDIA_NIM_API_KEY'>): Promise<NvidiaModelRecord[]> {
  if (!env.NVIDIA_NIM_API_KEY?.trim()) return [];
  const stored = await loadStoredNvidiaModels(env);
  if (stored.length) return stored;
  return refreshNvidiaModelIndex(env);
}
