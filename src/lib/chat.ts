import type { ChatMessage, Usage } from '../types';

interface CompletionOptions {
  id: string;
  model: string;
  includeUsage: boolean;
  promptTokens: number;
  onDone: (usage: Usage) => void;
  priorUsage?: Usage;
  webSearch?: Record<string, unknown>;
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

export function extractUsage(value: unknown, promptTokens: number, text: string): Usage {
  const record = asRecord(value);
  const usage = asRecord(record?.usage) ?? asRecord(asRecord(record?.result)?.usage);
  const prompt = integer(usage?.prompt_tokens ?? usage?.promptTokens, promptTokens);
  const completion = integer(usage?.completion_tokens ?? usage?.completionTokens, estimateTextTokens(text));
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

export function buildCompletion(id: string, model: string, text: string, usage: Usage): Record<string, unknown> {
  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage,
  };
}

function parseStreamLine(line: string): { text?: string; done?: boolean } {
  let payload = line.trim();
  if (!payload) return {};
  if (payload.startsWith('data:')) payload = payload.slice(5).trim();
  if (!payload) return {};
  if (payload === '[DONE]') return { done: true };

  try {
    return { text: extractText(JSON.parse(payload)) };
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
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let finishedByUpstream = false;

        const consumeLine = (line: string): boolean => {
          const parsed = parseStreamLine(line);
          if (parsed.done) return true;
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
          while (true) {
            const { value, done } = await reader.read();
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

          buffer += decoder.decode();
          if (buffer.trim() && !finishedByUpstream) consumeLine(buffer);

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
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(
            sseLine(encoder, {
              error: { message: `Upstream model error: ${message}`, type: 'api_error', code: 'upstream_error' },
            }),
          );
          controller.enqueue(doneLine(encoder));
          controller.close();
        } finally {
          reader.releaseLock();
        }
      })();
    },
  });
}
