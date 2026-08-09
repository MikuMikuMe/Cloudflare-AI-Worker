import { estimatePromptTokens, estimateTextTokens } from './chat';
import { API_CORS, json } from './http';
import type { ChatCompletionRequest, ChatMessage, ChatTool, ToolChoice, Usage } from '../types';

export type AnthropicErrorType =
  | 'invalid_request_error'
  | 'authentication_error'
  | 'permission_error'
  | 'not_found_error'
  | 'request_too_large'
  | 'rate_limit_error'
  | 'timeout_error'
  | 'overloaded_error'
  | 'api_error'
  | 'billing_error';

export interface AnthropicTranslation {
  request: ChatCompletionRequest;
  messages: ChatMessage[];
  requestedModel: string;
  inputTokens: number;
}

interface TranslateOptions {
  requireMaxTokens?: boolean;
}

interface AnthropicResponseOptions {
  requestId: string;
  messageId: string;
  model: string;
  inputTokens: number;
  stream: boolean;
}

type JsonRecord = Record<string, unknown>;

export class AnthropicRequestError extends Error {
  constructor(
    message: string,
    public readonly param: string | null = null,
  ) {
    super(message);
    this.name = 'AnthropicRequestError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, param: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AnthropicRequestError(`'${param}' is required and must be a non-empty string.`, param);
  }
  return value.trim();
}

function textBlocks(value: unknown, param: string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value) || value.length === 0) {
    throw new AnthropicRequestError(`'${param}' must be a string or a non-empty array of text blocks.`, param);
  }

  const parts: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const block = value[index];
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
      throw new AnthropicRequestError(
        `Only text blocks are supported in '${param}'.`,
        `${param}.${index}`,
      );
    }
    parts.push(block.text);
  }
  return parts.join('');
}

function toolResultText(value: unknown, param: string): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) {
    throw new AnthropicRequestError(`'${param}' must be a string or an array of text blocks.`, param);
  }

  return value.map((block, index) => {
    if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') {
      throw new AnthropicRequestError(
        `Only text tool-result blocks are supported in '${param}'.`,
        `${param}.${index}`,
      );
    }
    return block.text;
  }).join('');
}

function translateUserContent(content: unknown, param: string): ChatMessage[] {
  if (typeof content === 'string') return [{ role: 'user', content }];
  if (!Array.isArray(content) || content.length === 0) {
    throw new AnthropicRequestError(`'${param}' must be a string or a non-empty content-block array.`, param);
  }

  const messages: ChatMessage[] = [];
  let pendingText: string[] = [];
  let sawText = false;
  const flushText = (): void => {
    if (!sawText) return;
    messages.push({ role: 'user', content: pendingText.join('') });
    pendingText = [];
    sawText = false;
  };

  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    const blockParam = `${param}.${index}`;
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new AnthropicRequestError(`'${blockParam}' must be a content block.`, blockParam);
    }

    if (block.type === 'text') {
      if (typeof block.text !== 'string') {
        throw new AnthropicRequestError(`'${blockParam}.text' must be a string.`, `${blockParam}.text`);
      }
      pendingText.push(block.text);
      sawText = true;
      continue;
    }

    if (block.type === 'tool_result') {
      flushText();
      const toolUseId = requireString(block.tool_use_id, `${blockParam}.tool_use_id`);
      const result = toolResultText(block.content ?? '', `${blockParam}.content`);
      messages.push({
        role: 'tool',
        tool_call_id: toolUseId.slice(0, 128),
        content: block.is_error === true ? `Tool error: ${result}` : result,
      });
      continue;
    }

    throw new AnthropicRequestError(
      `Content block type '${block.type}' is not supported. This gateway currently accepts text and tool_result user blocks.`,
      blockParam,
    );
  }

  flushText();
  return messages;
}

function translateAssistantContent(content: unknown, param: string): ChatMessage[] {
  if (typeof content === 'string') return [{ role: 'assistant', content }];
  if (!Array.isArray(content) || content.length === 0) {
    throw new AnthropicRequestError(`'${param}' must be a string or a non-empty content-block array.`, param);
  }

  const text: string[] = [];
  const toolCalls: NonNullable<ChatMessage['tool_calls']> = [];
  for (let index = 0; index < content.length; index += 1) {
    const block = content[index];
    const blockParam = `${param}.${index}`;
    if (!isRecord(block) || typeof block.type !== 'string') {
      throw new AnthropicRequestError(`'${blockParam}' must be a content block.`, blockParam);
    }

    if (block.type === 'text') {
      if (typeof block.text !== 'string') {
        throw new AnthropicRequestError(`'${blockParam}.text' must be a string.`, `${blockParam}.text`);
      }
      text.push(block.text);
      continue;
    }

    if (block.type === 'tool_use') {
      const id = requireString(block.id, `${blockParam}.id`);
      const name = requireString(block.name, `${blockParam}.name`);
      if (!isRecord(block.input)) {
        throw new AnthropicRequestError(`'${blockParam}.input' must be an object.`, `${blockParam}.input`);
      }
      toolCalls.push({
        id: id.slice(0, 128),
        type: 'function',
        function: { name: name.slice(0, 128), arguments: JSON.stringify(block.input) },
      });
      continue;
    }

    throw new AnthropicRequestError(
      `Content block type '${block.type}' is not supported in assistant messages.`,
      blockParam,
    );
  }

  return [{
    role: 'assistant',
    content: text.length ? text.join('') : null,
    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
  }];
}

function translateMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AnthropicRequestError(
      "'messages' is required and must be a non-empty array of user and assistant messages.",
      'messages',
    );
  }

  return value.flatMap((message, index) => {
    const param = `messages.${index}`;
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')) {
      throw new AnthropicRequestError(
        `'${param}.role' must be either 'user' or 'assistant'. Put system instructions in the top-level 'system' field.`,
        `${param}.role`,
      );
    }
    return message.role === 'user'
      ? translateUserContent(message.content, `${param}.content`)
      : translateAssistantContent(message.content, `${param}.content`);
  });
}

function translateTools(value: unknown): ChatTool[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) throw new AnthropicRequestError("'tools' must be an array.", 'tools');

  return value.map((tool, index) => {
    const param = `tools.${index}`;
    if (!isRecord(tool)) throw new AnthropicRequestError(`'${param}' must be an object.`, param);
    const name = requireString(tool.name, `${param}.name`);
    if (!isRecord(tool.input_schema)) {
      throw new AnthropicRequestError(`'${param}.input_schema' must be a JSON Schema object.`, `${param}.input_schema`);
    }
    if (tool.description != null && typeof tool.description !== 'string') {
      throw new AnthropicRequestError(`'${param}.description' must be a string.`, `${param}.description`);
    }
    return {
      type: 'function',
      function: {
        name: name.slice(0, 128),
        ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
        parameters: tool.input_schema,
      },
    };
  });
}

function translateToolChoice(value: unknown): { choice?: ToolChoice; parallel?: boolean } {
  if (value == null) return {};
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new AnthropicRequestError("'tool_choice' must be an object with a supported type.", 'tool_choice');
  }

  const parallel = value.disable_parallel_tool_use === true ? false : undefined;
  if (value.type === 'auto') return { choice: 'auto', parallel };
  if (value.type === 'any') return { choice: 'required', parallel };
  if (value.type === 'none') return { choice: 'none', parallel };
  if (value.type === 'tool') {
    const name = requireString(value.name, 'tool_choice.name');
    return { choice: { type: 'function', function: { name: name.slice(0, 128) } }, parallel };
  }
  throw new AnthropicRequestError(
    "'tool_choice.type' must be 'auto', 'any', 'tool', or 'none'.",
    'tool_choice.type',
  );
}

function optionalNumber(
  value: unknown,
  param: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new AnthropicRequestError(`'${param}' must be a number from ${minimum} to ${maximum}.`, param);
  }
  return value;
}

export function translateAnthropicRequest(
  value: unknown,
  options: TranslateOptions = {},
): AnthropicTranslation {
  if (!isRecord(value)) throw new AnthropicRequestError('The request body must be a JSON object.');

  const requestedModel = requireString(value.model, 'model');
  const requireMaxTokens = options.requireMaxTokens !== false;
  if (
    requireMaxTokens
    && (!Number.isInteger(value.max_tokens) || Number(value.max_tokens) <= 0)
  ) {
    throw new AnthropicRequestError("'max_tokens' is required and must be a positive integer.", 'max_tokens');
  }
  if (value.max_tokens != null && (!Number.isInteger(value.max_tokens) || Number(value.max_tokens) <= 0)) {
    throw new AnthropicRequestError("'max_tokens' must be a positive integer.", 'max_tokens');
  }
  if (value.stream != null && typeof value.stream !== 'boolean') {
    throw new AnthropicRequestError("'stream' must be a boolean.", 'stream');
  }

  const messages = translateMessages(value.messages);
  if (value.system != null) {
    messages.unshift({ role: 'system', content: textBlocks(value.system, 'system') });
  }

  const tools = translateTools(value.tools);
  const toolChoice = translateToolChoice(value.tool_choice);
  if (toolChoice.choice != null && toolChoice.choice !== 'none' && (!tools || tools.length === 0)) {
    throw new AnthropicRequestError("'tool_choice' requires at least one tool definition.", 'tool_choice');
  }
  if (value.stream === true && tools?.length) {
    throw new AnthropicRequestError(
      "Streaming tool use is not supported by this gateway. Send the same request with 'stream: false'.",
      'stream',
    );
  }

  let stop: string[] | undefined;
  if (value.stop_sequences != null) {
    if (
      !Array.isArray(value.stop_sequences)
      || value.stop_sequences.length > 4
      || value.stop_sequences.some((item) => typeof item !== 'string' || item.length === 0)
    ) {
      throw new AnthropicRequestError(
        "'stop_sequences' must contain at most four non-empty strings.",
        'stop_sequences',
      );
    }
    stop = value.stop_sequences;
  }

  const metadata = value.metadata == null ? null : value.metadata;
  if (metadata != null && !isRecord(metadata)) {
    throw new AnthropicRequestError("'metadata' must be an object.", 'metadata');
  }
  const userId = isRecord(metadata) && typeof metadata.user_id === 'string' && metadata.user_id.trim()
    ? metadata.user_id.trim().slice(0, 256)
    : undefined;

  const temperature = optionalNumber(value.temperature, 'temperature', 0, 1);
  const topP = optionalNumber(value.top_p, 'top_p', 0, 1);
  const request: ChatCompletionRequest = {
    model: requestedModel,
    messages,
    stream: value.stream === true,
    ...(value.stream === true ? { stream_options: { include_usage: true } } : {}),
    ...(typeof value.max_tokens === 'number' ? { max_tokens: value.max_tokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(topP != null ? { top_p: topP } : {}),
    ...(stop ? { stop } : {}),
    ...(tools ? { tools } : {}),
    ...(toolChoice.choice != null ? { tool_choice: toolChoice.choice } : {}),
    ...(toolChoice.parallel != null ? { parallel_tool_calls: toolChoice.parallel } : {}),
    ...(userId ? { user: userId } : {}),
    ...(typeof value.web_search === 'boolean' ? { web_search: value.web_search } : {}),
    ...(typeof value.site_search === 'boolean' ? { site_search: value.site_search } : {}),
    ...(isRecord(value.web_search_options) ? { web_search_options: value.web_search_options } : {}),
    ...(typeof value.allow_provider_fallback === 'boolean'
      ? { allow_provider_fallback: value.allow_provider_fallback }
      : {}),
  };

  const toolTokens = tools ? estimateTextTokens(JSON.stringify(tools)) : 0;
  return {
    request,
    messages,
    requestedModel,
    inputTokens: estimatePromptTokens(messages) + toolTokens,
  };
}

export function newAnthropicRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function newAnthropicMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`;
}

function responseHeaders(source: Headers | undefined, requestId: string, contentType: string): Headers {
  const headers = new Headers(source);
  new Headers(API_CORS).forEach((value, key) => headers.set(key, value));
  headers.set('content-type', contentType);
  headers.set('cache-control', contentType.startsWith('text/event-stream') ? 'no-cache, no-transform' : 'no-store');
  headers.set('request-id', requestId);
  headers.set('x-content-type-options', 'nosniff');
  headers.delete('content-length');
  headers.delete('content-encoding');
  return headers;
}

export function anthropicError(
  message: string,
  status: number,
  type: AnthropicErrorType,
  requestId = newAnthropicRequestId(),
  sourceHeaders?: Headers,
): Response {
  return json(
    { type: 'error', error: { type, message }, request_id: requestId },
    status,
    responseHeaders(sourceHeaders, requestId, 'application/json; charset=utf-8'),
  );
}

function safeErrorType(status: number, sourceType: unknown, code: unknown): AnthropicErrorType {
  const known = new Set<AnthropicErrorType>([
    'invalid_request_error',
    'authentication_error',
    'permission_error',
    'not_found_error',
    'request_too_large',
    'rate_limit_error',
    'timeout_error',
    'overloaded_error',
    'api_error',
    'billing_error',
  ]);
  const normalizedCode = typeof code === 'string' ? code.toLowerCase() : '';
  if (normalizedCode === 'cloudflare_neurons_exhausted') return 'rate_limit_error';
  if (normalizedCode === 'cloudflare_paid_plan_required') return 'permission_error';
  if (normalizedCode.includes('timeout')) return 'timeout_error';
  if (typeof sourceType === 'string' && known.has(sourceType as AnthropicErrorType)) {
    return sourceType as AnthropicErrorType;
  }
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 402) return 'billing_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 408) return 'timeout_error';
  if (status === 413) return 'request_too_large';
  if (status === 429) return 'rate_limit_error';
  if (status === 529) return 'overloaded_error';
  return 'api_error';
}

export async function toAnthropicErrorResponse(response: Response, requestId: string): Promise<Response> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Fall back to the status text below when an upstream response is unreadable.
  }
  const root = isRecord(body) ? body : null;
  const source = isRecord(root?.error) ? root.error : root;
  const message = typeof source?.message === 'string' && source.message.trim()
    ? source.message
    : response.statusText || 'The request could not be completed.';
  return anthropicError(
    message,
    response.status || 500,
    safeErrorType(response.status, source?.type, source?.code),
    requestId,
    response.headers,
  );
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : fallback;
}

function openAIToolBlocks(message: JsonRecord | null): JsonRecord[] {
  if (!Array.isArray(message?.tool_calls)) return [];
  return message.tool_calls.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const fn = isRecord(candidate.function) ? candidate.function : null;
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) return [];
    let input: JsonRecord = {};
    if (typeof fn.arguments === 'string' && fn.arguments.trim()) {
      try {
        const parsed: unknown = JSON.parse(fn.arguments);
        if (isRecord(parsed)) input = parsed;
      } catch {
        input = { value: fn.arguments };
      }
    } else if (isRecord(fn.arguments)) {
      input = fn.arguments;
    }
    return [{
      type: 'tool_use',
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `toolu_${crypto.randomUUID()}`,
      name: fn.name,
      input,
    }];
  });
}

function stopReason(finishReason: unknown, hasToolUse: boolean): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' {
  if (hasToolUse || finishReason === 'tool_calls' || finishReason === 'function_call') return 'tool_use';
  if (finishReason === 'length') return 'max_tokens';
  return 'end_turn';
}

async function toAnthropicMessageResponse(
  response: Response,
  options: AnthropicResponseOptions,
): Promise<Response> {
  if (!response.ok) return toAnthropicErrorResponse(response, options.requestId);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return anthropicError(
      'The upstream model returned an unreadable response.',
      502,
      'api_error',
      options.requestId,
      response.headers,
    );
  }
  const root = isRecord(value) ? value : null;
  if (!root || isRecord(root.error)) {
    const synthetic = new Response(JSON.stringify(value), {
      status: isRecord(root?.error) ? 500 : 502,
      headers: response.headers,
    });
    return toAnthropicErrorResponse(synthetic, options.requestId);
  }

  const choices = Array.isArray(root.choices) ? root.choices : [];
  const choice = isRecord(choices[0]) ? choices[0] : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  const text = typeof message?.content === 'string' ? message.content : '';
  const toolBlocks = openAIToolBlocks(message);
  const content: JsonRecord[] = [];
  if (text || toolBlocks.length === 0) content.push({ type: 'text', text });
  content.push(...toolBlocks);

  const sourceUsage = isRecord(root.usage) ? root.usage : null;
  const usage: Usage = {
    prompt_tokens: nonNegativeInteger(sourceUsage?.prompt_tokens, options.inputTokens),
    completion_tokens: nonNegativeInteger(sourceUsage?.completion_tokens, estimateTextTokens(text)),
    total_tokens: 0,
  };
  usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;

  return json(
    {
      id: options.messageId,
      type: 'message',
      role: 'assistant',
      content,
      model: options.model,
      stop_reason: stopReason(choice?.finish_reason, toolBlocks.length > 0),
      stop_sequence: null,
      usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens },
    },
    200,
    responseHeaders(response.headers, options.requestId, 'application/json; charset=utf-8'),
  );
}

function anthropicSse(encoder: TextEncoder, event: string, payload: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function toAnthropicStream(
  upstream: ReadableStream<Uint8Array>,
  options: Omit<AnthropicResponseOptions, 'stream'>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(anthropicSse(encoder, 'message_start', {
        type: 'message_start',
        message: {
          id: options.messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model: options.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: options.inputTokens, output_tokens: 0 },
        },
      }));
      controller.enqueue(anthropicSse(encoder, 'content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }));

      void (async () => {
        const reader = upstream.getReader();
        upstreamReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        let outputCharacters = 0;
        let outputTokens: number | null = null;
        let finishReason: unknown = null;
        let sawDone = false;
        let failed = false;

        const emitError = (message: string, type: AnthropicErrorType): void => {
          if (cancelled || failed) return;
          failed = true;
          controller.enqueue(anthropicSse(encoder, 'error', {
            type: 'error',
            error: { type, message },
            request_id: options.requestId,
          }));
          controller.close();
        };

        const consumeLine = (line: string): void => {
          let payload = line.trim();
          if (!payload || payload.startsWith(':') || payload.startsWith('event:') || payload.startsWith('id:')) return;
          if (payload.startsWith('data:')) payload = payload.slice(5).trim();
          if (!payload) return;
          if (payload === '[DONE]') {
            sawDone = true;
            return;
          }

          let value: unknown;
          try {
            value = JSON.parse(payload);
          } catch {
            emitError('The upstream model emitted an unreadable stream event.', 'api_error');
            return;
          }
          const root = isRecord(value) ? value : null;
          const error = isRecord(root?.error) ? root.error : null;
          if (error) {
            const message = typeof error.message === 'string' && error.message.trim()
              ? error.message
              : 'The upstream model stream failed.';
            emitError(message, safeErrorType(500, error.type, error.code));
            return;
          }

          const usage = isRecord(root?.usage) ? root.usage : null;
          if (usage) {
            const estimate = Math.ceil(outputCharacters / 4);
            outputTokens = nonNegativeInteger(usage.completion_tokens, outputTokens ?? estimate);
          }
          const choices = Array.isArray(root?.choices) ? root.choices : [];
          const choice = isRecord(choices[0]) ? choices[0] : null;
          if (choice?.finish_reason != null) finishReason = choice.finish_reason;
          const delta = isRecord(choice?.delta) ? choice.delta : null;
          if (typeof delta?.content === 'string' && delta.content) {
            outputCharacters += delta.content.length;
            controller.enqueue(anthropicSse(encoder, 'content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: delta.content },
            }));
          }
        };

        try {
          while (!cancelled && !sawDone && !failed) {
            const step = await reader.read();
            if (step.done) break;
            buffer += decoder.decode(step.value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              consumeLine(line);
              if (sawDone || failed) break;
            }
          }
          if (cancelled) return;
          if (failed) {
            await reader.cancel('upstream stream error').catch(() => undefined);
            return;
          }
          buffer += decoder.decode();
          if (buffer.trim() && !sawDone) consumeLine(buffer);
          if (failed) {
            await reader.cancel('upstream stream error').catch(() => undefined);
            return;
          }
          if (!sawDone) {
            emitError('The upstream model stream ended before completion.', 'api_error');
            return;
          }

          await reader.cancel('completion received').catch(() => undefined);

          controller.enqueue(anthropicSse(encoder, 'content_block_stop', {
            type: 'content_block_stop',
            index: 0,
          }));
          controller.enqueue(anthropicSse(encoder, 'message_delta', {
            type: 'message_delta',
            delta: { stop_reason: stopReason(finishReason, false), stop_sequence: null },
            usage: { output_tokens: outputTokens ?? Math.ceil(outputCharacters / 4) },
          }));
          controller.enqueue(anthropicSse(encoder, 'message_stop', { type: 'message_stop' }));
          controller.close();
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          emitError(`Upstream model error: ${message}`, 'api_error');
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

export async function toAnthropicResponse(
  response: Response,
  options: AnthropicResponseOptions,
): Promise<Response> {
  if (!options.stream || !response.ok || !response.body) {
    return response.ok
      ? toAnthropicMessageResponse(response, options)
      : toAnthropicErrorResponse(response, options.requestId);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    return toAnthropicMessageResponse(response, options);
  }

  return new Response(toAnthropicStream(response.body, options), {
    status: 200,
    headers: responseHeaders(response.headers, options.requestId, 'text/event-stream; charset=utf-8'),
  });
}
