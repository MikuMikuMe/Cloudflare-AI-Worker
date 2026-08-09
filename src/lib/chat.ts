import {
  CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
  CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE,
  CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
  CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE,
  isCloudflareNeuronsExhaustedError,
  isCloudflarePaidPlanRequiredError,
} from './cloudflare-usage';
import type { ChatMessage, ChatToolCall, Usage } from '../types';

interface CompletionOptions {
  id: string;
  model: string;
  includeUsage: boolean;
  promptTokens: number;
  onDone: (usage: Usage) => void;
  priorUsage?: Usage;
  webSearch?: Record<string, unknown>;
  onError?: (code: string) => void;
  normalizeCloudflareQuota?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function integer(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
}

export function estimateTextTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

export function estimatePromptTokens(messages: ChatMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      4 +
      estimateTextTokens(message.content ?? '') +
      estimateTextTokens(message.name ?? '') +
      estimateTextTokens(message.tool_call_id ?? '') +
      estimateTextTokens(message.tool_calls ? JSON.stringify(message.tool_calls) : ''),
    2,
  );
}

export function newCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, '')}`;
}

/** Extract text from the response shapes used by Workers AI and compatible mocks. */
export function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  if (!record) return '';

  if (typeof record.response === 'string') return record.response;
  if (typeof record.output_text === 'string') return record.output_text;

  const result = asRecord(record.result);
  if (result && typeof result.response === 'string') return result.response;

  const choices = Array.isArray(record.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  if (message && typeof message.content === 'string') return message.content;
  const delta = asRecord(firstChoice?.delta);
  if (delta && typeof delta.content === 'string') return delta.content;

  return '';
}

/** Normalize tool calls returned by Workers AI and OpenAI-compatible providers. */
export function extractToolCalls(value: unknown): ChatToolCall[] {
  const record = asRecord(value);
  const result = asRecord(record?.result);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const candidates = [record?.tool_calls, result?.tool_calls, message?.tool_calls].find(Array.isArray);
  if (!Array.isArray(candidates)) return [];

  return candidates.flatMap((candidate, index) => {
    const call = asRecord(candidate);
    if (!call) return [];
    const fn = asRecord(call.function);
    const nameValue = fn?.name ?? call.name;
    const name = typeof nameValue === 'string' ? nameValue.trim() : '';
    if (!name) return [];
    const args = fn?.arguments ?? call.arguments ?? {};
    let argumentsText: string;
    if (typeof args === 'string') {
      argumentsText = args;
    } else {
      try {
        argumentsText = JSON.stringify(args) ?? '{}';
      } catch {
        argumentsText = '{}';
      }
    }
    return [{
      id: typeof call.id === 'string' && call.id.trim()
        ? call.id.trim().slice(0, 128)
        : `call_${index + 1}_${crypto.randomUUID().replace(/-/g, '')}`,
      type: 'function' as const,
      function: { name: name.slice(0, 128), arguments: argumentsText },
    }];
  });
}

export function extractUsage(value: unknown, promptTokens: number, text: string): Usage {
  const record = asRecord(value);
  const usage = asRecord(record?.usage) ?? asRecord(asRecord(record?.result)?.usage);
  const prompt = integer(usage?.prompt_tokens ?? usage?.promptTokens, promptTokens);
  const completion = integer(usage?.completion_tokens ?? usage?.completionTokens, estimateTextTokens(text));
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

export function buildCompletion(
  id: string,
  model: string,
  text: string,
  usage: Usage,
  toolCalls: ChatToolCall[] = [],
): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text || (toolCalls.length ? null : ''),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      },
    ],
    usage,
  };
}

function parseStreamLine(line: string, normalizeCloudflareQuota: boolean): {
  text?: string;
  done?: boolean;
  error?: { message: string; code: string };
} {
  let payload = line.trim();
  if (!payload) return {};
  if (payload.startsWith('data:')) payload = payload.slice(5).trim();
  if (!payload) return {};
  if (payload === '[DONE]') return { done: true };

  try {
    const value: unknown = JSON.parse(payload);
    if (normalizeCloudflareQuota && isCloudflareNeuronsExhaustedError(value)) {
      return {
        error: {
          message: CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE,
          code: CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
        },
      };
    }
    if (normalizeCloudflareQuota && isCloudflarePaidPlanRequiredError(value)) {
      return {
        error: {
          message: CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE,
          code: CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
        },
      };
    }

    const record = asRecord(value);
    const error = asRecord(record?.error);
    if (error) {
      const message = typeof error.message === 'string' && error.message.trim()
        ? `Upstream model error: ${error.message}`
        : 'Upstream model stream failed.';
      return { error: { message, code: 'upstream_error' } };
    }
    return { text: extractText(value) };
  } catch {
    // A few Workers AI model versions emit plain text lines.
    return { text: payload };
  }
}

function sseLine(encoder: TextEncoder, payload: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function doneLine(encoder: TextEncoder): Uint8Array {
  return encoder.encode('data: [DONE]\n\n');
}

function combineUsage(prior: Usage | undefined, promptTokens: number, text: string): Usage {
  const completionTokens = estimateTextTokens(text);
  return {
    prompt_tokens: (prior?.prompt_tokens ?? 0) + promptTokens,
    completion_tokens: (prior?.completion_tokens ?? 0) + completionTokens,
    total_tokens: (prior?.total_tokens ?? 0) + promptTokens + completionTokens,
  };
}

/** Convert Workers AI's NDJSON stream into OpenAI Chat Completions SSE. */
export function toOpenAIStream(upstream: ReadableStream, options: CompletionOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const created = Math.floor(Date.now() / 1000);
  let upstreamReader: ReadableStreamDefaultReader | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        sseLine(encoder, {
          id: options.id,
          object: 'chat.completion.chunk',
          created,
          model: options.model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }),
      );

      if (options.webSearch) {
        controller.enqueue(
          sseLine(encoder, {
            id: options.id,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [],
            web_search: options.webSearch,
          }),
        );
      }

      void (async () => {
        const reader = upstream.getReader();
        upstreamReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let finishedByUpstream = false;
        let failedByUpstream = false;

        const fail = (message: string, code = 'upstream_error'): void => {
          if (cancelled) return;
          try {
            options.onError?.(code);
          } catch {
            // Error reporting must not replace the original stream failure.
          }
          controller.enqueue(
            sseLine(encoder, {
              error: { message, type: 'api_error', code },
            }),
          );
          controller.close();
        };

        const consumeLine = (line: string): boolean => {
          const parsed = parseStreamLine(line, options.normalizeCloudflareQuota === true);
          if (parsed.done) return true;
          if (parsed.error) {
            failedByUpstream = true;
            fail(parsed.error.message, parsed.error.code);
            return true;
          }
          if (!parsed.text) return false;
          text += parsed.text;
          controller.enqueue(
            sseLine(encoder, {
              id: options.id,
              object: 'chat.completion.chunk',
              created,
              model: options.model,
              choices: [{ index: 0, delta: { content: parsed.text }, finish_reason: null }],
            }),
          );
          return false;
        };

        try {
          while (!cancelled) {
            const { value, done } = await reader.read();
            if (cancelled) return;
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              if (consumeLine(line)) {
                finishedByUpstream = true;
                break;
              }
            }
            if (finishedByUpstream) break;
          }

          if (cancelled) return;
          buffer += decoder.decode();
          if (buffer.trim() && !finishedByUpstream) finishedByUpstream = consumeLine(buffer);
          if (failedByUpstream) return;
          if (!finishedByUpstream) {
            fail('Upstream model stream ended before completion.');
            return;
          }

          const usage = combineUsage(options.priorUsage, options.promptTokens, text);
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
        } catch (error) {
          if (cancelled) return;
          if (options.normalizeCloudflareQuota === true && isCloudflareNeuronsExhaustedError(error)) {
            fail(CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE, CLOUDFLARE_NEURONS_EXHAUSTED_CODE);
          } else if (options.normalizeCloudflareQuota === true && isCloudflarePaidPlanRequiredError(error)) {
            fail(CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE, CLOUDFLARE_PAID_PLAN_REQUIRED_CODE);
          } else {
            const message = error instanceof Error ? error.message : String(error);
            fail(`Upstream model error: ${message}`);
          }
        } finally {
          if (upstreamReader === reader) upstreamReader = null;
          reader.releaseLock();
        }
      })();
    },
    async cancel(reason) {
      cancelled = true;
      if (upstreamReader) await upstreamReader.cancel(reason);
    },
  });
}
