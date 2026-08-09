import { extractText } from './chat';
import type { Usage } from '../types';

export type PersistedAssistantStatus = 'complete' | 'interrupted' | 'error';

export interface PersistedAssistantResult {
  text: string;
  status: PersistedAssistantStatus;
  metadata: Record<string, unknown>;
  model?: string;
  usage?: Usage;
  error?: string;
  errorCode?: string;
}

type FinalizeAssistant = (result: PersistedAssistantResult) => Promise<void>;

interface SafeSource {
  number: number;
  url: string;
  id?: string;
  title?: string;
  snippet?: string;
  score?: number;
}

interface SafeQuery {
  query: string;
  result_count?: number;
}

const MAX_PERSISTED_ASSISTANT_CHARACTERS = 128_000;
const MAX_PERSISTED_METADATA_CHARACTERS = 30_000;
const MAX_SSE_BUFFER_CHARACTERS = 512_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    const safe = url.toString();
    return safe.length <= 2_048 ? safe : undefined;
  } catch {
    return undefined;
  }
}

function safeSources(value: unknown): SafeSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: SafeSource[] = [];
  for (const [index, raw] of value.slice(0, 20).entries()) {
    const source = asRecord(raw);
    const url = safeUrl(source?.url ?? source?.key);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const id = boundedString(source?.id, 128);
    const title = boundedString(source?.title, 200);
    const snippet = boundedString(source?.snippet ?? source?.text, 500);
    const score = typeof source?.score === 'number' && Number.isFinite(source.score) ? source.score : undefined;
    const sourceNumber = source?.number;
    const number = typeof sourceNumber === 'number' && Number.isInteger(sourceNumber) && sourceNumber > 0
      ? sourceNumber
      : index + 1;
    sources.push({
      number,
      url,
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(score == null ? {} : { score }),
    });
  }
  return sources;
}

function safeQueries(value: unknown): SafeQuery[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((raw): SafeQuery[] => {
    const query = asRecord(raw);
    const text = boundedString(query?.query, 240);
    if (!text) return [];
    const count = query?.result_count;
    return [{
      query: text,
      ...(typeof count === 'number' && Number.isFinite(count)
        ? { result_count: Math.max(0, Math.round(count)) }
        : {}),
    }];
  });
}

function safeSearch(value: unknown): Record<string, unknown> | undefined {
  const search = asRecord(value);
  if (!search) return undefined;
  const sources = safeSources(search.sources);
  const queries = safeQueries(search.queries);
  const provider = boundedString(search.provider, 64);
  return {
    ...(typeof search.performed === 'boolean' ? { performed: search.performed } : {}),
    ...(provider ? { provider } : {}),
    ...(queries.length ? { queries } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

function metadataLength(value: Record<string, unknown>): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function compactSearch(value: Record<string, unknown>, sourceLimit: number, minimal: boolean): Record<string, unknown> {
  const sources = Array.isArray(value.sources)
    ? value.sources.slice(0, sourceLimit).flatMap((raw): Record<string, unknown>[] => {
      const source = asRecord(raw);
      if (!source || typeof source.url !== 'string') return [];
      return [{
        number: source.number,
        url: source.url,
        ...(!minimal && typeof source.title === 'string' ? { title: source.title } : {}),
      }];
    })
    : [];
  const queries = !minimal && Array.isArray(value.queries) ? value.queries.slice(0, 5) : [];
  return {
    ...(typeof value.performed === 'boolean' ? { performed: value.performed } : {}),
    ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
    ...(queries.length ? { queries } : {}),
    ...(sources.length ? { sources } : {}),
  };
}

function boundedMetadata(
  webSearch: Record<string, unknown> | undefined,
  siteSearch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const full = {
    ...(webSearch ? { web_search: webSearch } : {}),
    ...(siteSearch ? { site_search: siteSearch } : {}),
  };
  if (metadataLength(full) <= MAX_PERSISTED_METADATA_CHARACTERS) return full;

  const compact = {
    ...(webSearch ? { web_search: compactSearch(webSearch, 5, false) } : {}),
    ...(siteSearch ? { site_search: compactSearch(siteSearch, 5, false) } : {}),
  };
  if (metadataLength(compact) <= MAX_PERSISTED_METADATA_CHARACTERS) return compact;

  const minimal = {
    ...(webSearch ? { web_search: compactSearch(webSearch, 3, true) } : {}),
    ...(siteSearch ? { site_search: compactSearch(siteSearch, 3, true) } : {}),
  };
  if (metadataLength(minimal) <= MAX_PERSISTED_METADATA_CHARACTERS) return minimal;

  return {
    ...(webSearch ? { web_search: compactSearch(webSearch, 0, true) } : {}),
    ...(siteSearch ? { site_search: compactSearch(siteSearch, 0, true) } : {}),
  };
}

function safeUsage(value: unknown): Usage | undefined {
  const usage = asRecord(value);
  if (!usage) return undefined;
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const total = usage.total_tokens;
  if (
    typeof prompt !== 'number' ||
    !Number.isFinite(prompt) ||
    typeof completion !== 'number' ||
    !Number.isFinite(completion) ||
    typeof total !== 'number' ||
    !Number.isFinite(total)
  ) {
    return undefined;
  }
  return {
    prompt_tokens: Math.max(0, Math.round(prompt)),
    completion_tokens: Math.max(0, Math.round(completion)),
    total_tokens: Math.max(0, Math.round(total)),
  };
}

function eventData(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('data:'))
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .join('\n')
    .trim();
}

function encodedBlock(encoder: TextEncoder, block: string): Uint8Array {
  return encoder.encode(`${block.trim()}\n\n`);
}

/**
 * Observe an OpenAI-style SSE response and durably finalize the assistant row.
 * The completion sentinel is withheld until the D1 write succeeds, so a client
 * never treats an answer as committed before another device can reload it.
 */
export function wrapPersistedSseResponse(
  response: Response,
  finalize: FinalizeAssistant,
  initialEvents: unknown[] = [],
): Response {
  if (!response.body) return response;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const upstream = response.body.getReader();
  let buffer = '';
  let text = '';
  let usage: Usage | undefined;
  let responseModel: string | undefined;
  let errorMessage: string | undefined;
  let errorCode: string | undefined;
  let webSearch: Record<string, unknown> | undefined;
  let siteSearch: Record<string, unknown> | undefined;
  let persistenceLimitError: string | undefined;
  let cancelled = false;
  let finalization: Promise<void> | undefined;

  const snapshot = (status: PersistedAssistantStatus): PersistedAssistantResult => ({
    text,
    status,
    metadata: boundedMetadata(webSearch, siteSearch),
    ...(responseModel ? { model: responseModel } : {}),
    ...(usage ? { usage } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(errorMessage && errorCode ? { errorCode } : {}),
  });

  const finalizeOnce = (status: PersistedAssistantStatus): Promise<void> => {
    if (!finalization) finalization = finalize(snapshot(status));
    return finalization;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of initialEvents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      void (async () => {
        const forwardPersistenceError = (): void => {
          if (cancelled) return;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                error: {
                  message: 'The answer could not be saved. Retry this message.',
                  type: 'api_error',
                  code: 'persistence_error',
                },
              })}\n\n`,
            ),
          );
        };

        const forwardStreamError = (message: string, code: string): void => {
          if (cancelled) return;
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: { message, type: 'api_error', code } })}\n\n`,
            ),
          );
        };

        const processBlock = async (block: string): Promise<boolean> => {
          const data = eventData(block);
          if (!data) {
            if (!cancelled) controller.enqueue(encodedBlock(encoder, block));
            return false;
          }
          if (data === '[DONE]') {
            try {
              if (!errorMessage && !text.trim()) errorMessage = 'The model returned an empty response.';
              await finalizeOnce(errorMessage ? 'error' : 'complete');
              if (!cancelled) controller.enqueue(encodedBlock(encoder, block));
            } catch {
              forwardPersistenceError();
            }
            return true;
          }

          try {
            const payload = JSON.parse(data) as unknown;
            const record = asRecord(payload);
            const nextModel = boundedString(record?.model, 200);
            if (nextModel) responseModel = nextModel;
            const piece = extractText(payload);
            if (piece) {
              if (text.length + piece.length > MAX_PERSISTED_ASSISTANT_CHARACTERS) {
                persistenceLimitError = 'The model response exceeded the saved-answer limit.';
                errorMessage = persistenceLimitError;
              } else {
                text += piece;
              }
            }
            const nextUsage = safeUsage(record?.usage);
            if (nextUsage) usage = nextUsage;
            const nextWebSearch = safeSearch(record?.web_search);
            if (nextWebSearch) webSearch = nextWebSearch;
            const nextSiteSearch = safeSearch(record?.site_search);
            if (nextSiteSearch) siteSearch = nextSiteSearch;
            const error = asRecord(record?.error);
            const safeError = boundedString(error?.message, 500);
            if (safeError) errorMessage = safeError;
            const safeErrorCode = boundedString(error?.code, 100);
            if (safeErrorCode) errorCode = safeErrorCode;
          } catch {
            // Preserve extension events we do not understand, but never store them.
          }

          if (!cancelled && !persistenceLimitError) controller.enqueue(encodedBlock(encoder, block));
          return false;
        };

        try {
          let sawDone = false;
          while (!cancelled && !sawDone && !persistenceLimitError) {
            const { value, done } = await upstream.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > MAX_SSE_BUFFER_CHARACTERS) {
              persistenceLimitError = 'The model returned an oversized stream event.';
              errorMessage = persistenceLimitError;
              break;
            }
            while (true) {
              const boundary = /\r?\n\r?\n/.exec(buffer);
              if (!boundary || boundary.index == null) break;
              const block = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary[0].length);
              if (await processBlock(block)) {
                sawDone = true;
                break;
              }
              if (persistenceLimitError) break;
            }
          }

          if (cancelled) return;
          if (persistenceLimitError) {
            try {
              await finalizeOnce('error');
              forwardStreamError(persistenceLimitError, 'response_too_large');
            } catch {
              forwardPersistenceError();
            }
            await upstream.cancel('response exceeded persistence limit').catch(() => undefined);
            controller.close();
            return;
          }
          buffer += decoder.decode();
          if (!sawDone && buffer.trim()) sawDone = await processBlock(buffer);
          if (!sawDone) {
            try {
              await finalizeOnce(errorMessage ? 'error' : 'interrupted');
            } catch {
              forwardPersistenceError();
            }
          }
          if (sawDone) await upstream.cancel('completion received').catch(() => undefined);
          controller.close();
        } catch {
          if (cancelled) return;
          errorMessage = errorMessage ?? 'The response stream failed.';
          try {
            await finalizeOnce('error');
          } catch {
            forwardPersistenceError();
          }
          controller.close();
        } finally {
          upstream.releaseLock();
        }
      })();
    },
    async cancel(reason) {
      cancelled = true;
      await Promise.allSettled([
        upstream.cancel(reason),
        finalizeOnce(errorMessage ? 'error' : 'interrupted'),
      ]);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
