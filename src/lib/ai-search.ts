import { estimateTextTokens, extractText } from './chat';
import type { Usage } from '../types';

export interface AiSearchStreamOptions {
  id: string;
  model: string;
  includeUsage: boolean;
  promptTokens: number;
  onDone: (usage: Usage) => void;
}

export interface AiSearchSource {
  id: string;
  url: string;
  score?: number;
  snippet?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Reduce AI Search chunks to a small, stable citation shape for API clients and the dashboard. */
export function extractSearchSources(value: unknown): AiSearchSource[] {
  const record = asRecord(value);
  const chunks = Array.isArray(value)
    ? value
    : Array.isArray(record?.chunks)
      ? record.chunks
      : [];

  return chunks.flatMap((chunk): AiSearchSource[] => {
    const item = asRecord(asRecord(chunk)?.item);
    const url = typeof item?.key === 'string' ? item.key : '';
    if (!url) return [];

    const source = asRecord(chunk);
    const id = typeof source?.id === 'string' ? source.id : url;
    const score = typeof source?.score === 'number' && Number.isFinite(source.score) ? source.score : undefined;
    const text = typeof source?.text === 'string' ? source.text.trim() : '';

    return [
      {
        id,
        url,
        ...(score == null ? {} : { score }),
        ...(text ? { snippet: text.slice(0, 240) } : {}),
      },
    ];
  });
}

function sseLine(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function doneLine(encoder: TextEncoder): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

function parseEventData(block: string): string {
  return block
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('data:'))
    .map((line) => line.slice(line.indexOf(':') + 1).trim())
    .join('\n')
    .trim();
}

function hasEvent(block: string, name: string): boolean {
  return block.split(/\r?\n/).some((line) => line.trim() === `event: ${name}`);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Normalize AI Search's SSE stream for OpenAI clients.
 *
 * AI Search emits an initial `event: chunks` citation event. OpenAI SDKs expect
 * every data event to be a ChatCompletionChunk, so citations become a normal
 * empty-choice chunk with a `web_search.sources` extension. Content chunks and
 * [DONE] remain standard OpenAI SSE.
 */
export function toOpenAISearchStream(
  upstream: ReadableStream,
  options: AiSearchStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const reader = upstream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let sawFinish = false;
        let finalized = false;

        const finish = (): void => {
          if (finalized) return;
          finalized = true;

          const completionTokens = estimateTextTokens(text);
          const usage: Usage = {
            prompt_tokens: options.promptTokens,
            completion_tokens: completionTokens,
            total_tokens: options.promptTokens + completionTokens,
          };

          if (!sawFinish) {
            controller.enqueue(
              sseLine(encoder, {
                id: options.id,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: null,
              }),
            );
          }

          if (options.includeUsage) {
            controller.enqueue(
              sseLine(encoder, {
                id: options.id,
                object: 'chat.completion.chunk',
                created,
                model: options.model,
                choices: [],
                usage,
              }),
            );
          }

          options.onDone(usage);
          controller.enqueue(doneLine(encoder));
          controller.close();
        };

        const processBlock = (block: string): boolean => {
          const data = parseEventData(block);
          if (!data) return false;

          if (hasEvent(block, 'chunks')) {
            const sources = extractSearchSources(parseJson(data));
            if (sources.length) {
              controller.enqueue(
                sseLine(encoder, {
                  id: options.id,
                  object: 'chat.completion.chunk',
                  created,
                  model: options.model,
                  choices: [],
                  web_search: { sources },
                }),
              );
            }
            return false;
          }

          if (data === '[DONE]') {
            finish();
            return true;
          }

          const payload = parseJson(data);
          if (payload) {
            const piece = extractText(payload);
            if (piece) text += piece;
            const payloadRecord = asRecord(payload);
            const choices = Array.isArray(payloadRecord?.choices) ? payloadRecord.choices : [];
            const choice = asRecord(choices[0]);
            if (choice?.finish_reason) sawFinish = true;
          }

          controller.enqueue(encoder.encode(`${block.trim()}\n\n`));
          return false;
        };

        try {
          let upstreamDone = false;
          while (!upstreamDone) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            while (true) {
              const boundary = /\r?\n\r?\n/.exec(buffer);
              if (!boundary || boundary.index == null) break;
              const block = buffer.slice(0, boundary.index);
              buffer = buffer.slice(boundary.index + boundary[0].length);
              if (processBlock(block)) {
                upstreamDone = true;
                break;
              }
            }
          }

          buffer += decoder.decode();
          if (!finalized && buffer.trim()) processBlock(buffer);
          if (!finalized) finish();
        } catch (error) {
          if (!finalized) {
            const message = error instanceof Error ? error.message : String(error);
            controller.enqueue(
              sseLine(encoder, {
                error: { message: `Upstream web search error: ${message}`, type: 'api_error', code: 'upstream_error' },
              }),
            );
            controller.enqueue(doneLine(encoder));
            controller.close();
          }
        } finally {
          reader.releaseLock();
        }
      })();
    },
  });
}
