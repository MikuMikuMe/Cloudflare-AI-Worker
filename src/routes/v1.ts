/** OpenAI-compatible surface: /v1/models, /v1/chat/completions, /v1/embeddings. */

import { verifyAccessJwt } from '../lib/access';
import {
  buildCompletion,
  estimatePromptTokens,
  extractText,
  extractUsage,
  newCompletionId,
  toOpenAIStream,
} from '../lib/chat';
import { API_CORS, apiError, json } from '../lib/http';
import { authenticateKey, extractBearer, recordUsage } from '../lib/keys';
import {
  modelListPayload,
  resolveChatModel,
  resolveEmbeddingModel,
} from '../lib/models';
import type { ChatCompletionRequest, ChatMessage, EmbeddingsRequest, Env } from '../types';

type AuthResult = { ok: true; keyId: string | null } | { ok: false; response: Response };

/** API keys are for external callers; an Access session is also accepted for convenience. */
async function authorise(request: Request, env: Env): Promise<AuthResult> {
  const bearer = extractBearer(request);

  if (bearer) {
    const key = await authenticateKey(env, bearer);
    if (!key) {
      return {
        ok: false,
        response: apiError(
          'Incorrect API key provided. You can create or revoke keys in the dashboard.',
          401,
          'authentication_error',
          'invalid_api_key',
        ),
      };
    }
    return { ok: true, keyId: key.id };
  }

  const identity = await verifyAccessJwt(request, env);
  if (identity) return { ok: true, keyId: null };

  return {
    ok: false,
    response: apiError(
      'You did not provide an API key. Include Authorization: Bearer sk-cfai-... or use the signed-in dashboard.',
      401,
      'authentication_error',
      'missing_api_key',
      null,
      { 'www-authenticate': 'Bearer' },
    ),
  };
}

const VALID_ROLES = new Set<ChatMessage['role']>(['system', 'user', 'assistant', 'tool', 'developer']);

function normaliseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: ChatMessage[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null;
    const message = value as Record<string, unknown>;
    if (typeof message.role !== 'string' || !VALID_ROLES.has(message.role as ChatMessage['role'])) return null;

    let content = '';
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      const parts: string[] = [];
      for (const part of message.content) {
        if (typeof part === 'string') {
          parts.push(part);
          continue;
        }
        if (!part || typeof part !== 'object') return null;
        const item = part as Record<string, unknown>;
        if ((item.type === 'text' || item.type === 'input_text') && typeof item.text === 'string') {
          parts.push(item.text);
          continue;
        }
        return null;
      }
      content = parts.join('');
    } else if (message.content != null) {
      return null;
    }

    out.push({
      role: message.role as ChatMessage['role'],
      content,
      ...(typeof message.name === 'string' ? { name: message.name.slice(0, 64) } : {}),
    });
  }
  return out;
}

function copyNumber(
  target: Record<string, unknown>,
  source: ChatCompletionRequest,
  field: keyof Pick<ChatCompletionRequest, 'temperature' | 'top_p' | 'frequency_penalty' | 'presence_penalty' | 'seed'>,
): void {
  const value = source[field];
  if (typeof value === 'number' && Number.isFinite(value)) target[field] = value;
}

export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  trustedAccess = false,
): Promise<Response> {
  const auth = trustedAccess ? ({ ok: true, keyId: null } as const) : await authorise(request, env);
  if (!auth.ok) return auth.response;

  let body: ChatCompletionRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('body must be an object');
    body = parsed as ChatCompletionRequest;
  } catch {
    return apiError('We could not parse the JSON body of your request.', 400, 'invalid_request_error');
  }

  const messages = normaliseMessages(body.messages);
  if (!messages) {
    return apiError(
      "'messages' is required and must be a non-empty array of {role, content} objects.",
      400,
      'invalid_request_error',
      null,
      'messages',
    );
  }

  if (body.n != null && body.n !== 1) {
    return apiError('Only n=1 is supported by this gateway.', 400, 'invalid_request_error', 'unsupported_value', 'n');
  }

  const model = resolveChatModel(body.model, env.DEFAULT_MODEL);
  if (!model) {
    return apiError(
      `The model '${body.model ?? ''}' does not exist or is not available. Call GET /v1/models for the list.`,
      404,
      'not_found_error',
      'model_not_found',
      'model',
    );
  }

  const inputs: Record<string, unknown> = { messages };
  copyNumber(inputs, body, 'temperature');
  copyNumber(inputs, body, 'top_p');
  copyNumber(inputs, body, 'frequency_penalty');
  copyNumber(inputs, body, 'presence_penalty');
  copyNumber(inputs, body, 'seed');

  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) inputs.max_tokens = maxTokens;

  const id = newCompletionId();
  const responseModel = body.model?.trim() || model;
  const promptTokens = estimatePromptTokens(messages);
  const accountUsage = (usage: Parameters<typeof recordUsage>[3]): void => {
    if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId, model, usage).catch(() => undefined));
  };

  try {
    if (body.stream === true) {
      const upstream = (await env.AI.run(model as any, { ...inputs, stream: true } as any)) as ReadableStream;
      const stream = toOpenAIStream(upstream, {
        id,
        model: responseModel,
        includeUsage: body.stream_options?.include_usage === true,
        promptTokens,
        onDone: accountUsage,
      });

      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          ...API_CORS,
        },
      });
    }

    const result = await env.AI.run(model as any, inputs as any);
    const text = extractText(result);
    const usage = extractUsage(result, promptTokens, text);
    accountUsage(usage);
    return json(buildCompletion(id, responseModel, text, usage), 200, API_CORS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiError(`Upstream model error: ${message}`, 502, 'api_error', 'upstream_error');
  }
}

function extractVectors(value: unknown): number[][] {
  if (Array.isArray(value)) return value.filter((item): item is number[] => Array.isArray(item));
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const data: unknown[] = Array.isArray(record.data)
    ? record.data
    : Array.isArray((record.result as any)?.data)
      ? (record.result as any).data
      : [];
  return data.flatMap((item) => {
    if (Array.isArray(item)) return [item.filter((n): n is number => typeof n === 'number')];
    if (item && typeof item === 'object' && Array.isArray((item as any).embedding)) {
      return [[...(item as any).embedding].filter((n): n is number => typeof n === 'number')];
    }
    return [];
  });
}

export async function handleEmbeddings(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authorise(request, env);
  if (!auth.ok) return auth.response;

  let body: EmbeddingsRequest;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object') throw new Error('body must be an object');
    body = parsed as EmbeddingsRequest;
  } catch {
    return apiError('We could not parse the JSON body of your request.', 400, 'invalid_request_error');
  }

  const inputs = typeof body.input === 'string' ? [body.input] : body.input;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.some((item) => typeof item !== 'string')) {
    return apiError(
      "'input' is required and must be a string or an array of strings.",
      400,
      'invalid_request_error',
      null,
      'input',
    );
  }

  const model = resolveEmbeddingModel(body.model);
  if (!model) {
    return apiError(
      `The embedding model '${body.model ?? ''}' does not exist. Call GET /v1/models for the list.`,
      404,
      'not_found_error',
      'model_not_found',
      'model',
    );
  }

  try {
    const result = await env.AI.run(model as any, { text: inputs } as any);
    const vectors = extractVectors(result);
    if (vectors.length !== inputs.length) throw new Error('embedding model returned an unexpected shape');

    const promptTokens = inputs.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
    const usage = { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: promptTokens };
    if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId, model, usage).catch(() => undefined));

    return json(
      {
        object: 'list',
        data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        model,
        usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
      },
      200,
      API_CORS,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return apiError(`Upstream model error: ${message}`, 502, 'api_error', 'upstream_error');
  }
}

export function handleModels(): Response {
  return json(modelListPayload(), 200, API_CORS);
}
