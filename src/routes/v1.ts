/** OpenAI-compatible surface: /v1/models, /v1/chat/completions, /v1/embeddings. */

import { verifyAccessJwt } from '../lib/access';
import { extractSearchSources, toOpenAISearchStream } from '../lib/ai-search';
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
  WebSearchError,
  normalizeWebSearchOptions,
  prepareWebSearchAgent,
} from '../lib/web-search';
import {
  modelListPayload,
  resolveChatModel,
  resolveEmbeddingModel,
} from '../lib/models';
import type { ChatCompletionRequest, ChatMessage, ChatToolCall, EmbeddingsRequest, Env } from '../types';

const WEB_SEARCH_INSTANCE = 'lofuyu-web-search';

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

function normaliseToolCalls(raw: unknown): ChatToolCall[] | null {
  if (!Array.isArray(raw)) return null;
  const calls: ChatToolCall[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null;
    const call = value as Record<string, unknown>;
    const fn = call.function && typeof call.function === 'object' ? (call.function as Record<string, unknown>) : null;
    const name = typeof fn?.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : '';
    const args = fn?.arguments ?? call.arguments;
    const id = typeof call.id === 'string' && call.id.trim() ? call.id.trim().slice(0, 128) : crypto.randomUUID();
    if (!name || (typeof args !== 'string' && (!args || typeof args !== 'object'))) return null;
    calls.push({
      id,
      type: 'function',
      function: { name: name.slice(0, 128), arguments: typeof args === 'string' ? args : JSON.stringify(args) },
    });
  }
  return calls;
}

function normaliseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: ChatMessage[] = [];
  for (const value of raw) {
    if (!value || typeof value !== 'object') return null;
    const message = value as Record<string, unknown>;
    if (typeof message.role !== 'string' || !VALID_ROLES.has(message.role as ChatMessage['role'])) return null;

    let content: string | null = null;
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
      ...(typeof message.tool_call_id === 'string' ? { tool_call_id: message.tool_call_id.slice(0, 128) } : {}),
      ...(message.tool_calls == null
        ? {}
        : (() => {
            const toolCalls = normaliseToolCalls(message.tool_calls);
            return toolCalls ? { tool_calls: toolCalls } : null;
          })()),
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

  let webSearchMaxResults = 5;
  let webSearchMaxFetchChars = 20_000;
  let searchScope: 'web' | 'site' = 'web';
  if (body.web_search_options != null) {
    if (typeof body.web_search_options !== 'object' || Array.isArray(body.web_search_options)) {
      return apiError('web_search_options must be an object.', 400, 'invalid_request_error', null, 'web_search_options');
    }

    const requested = body.web_search_options.max_num_results;
    if (requested != null && (!Number.isInteger(requested) || requested < 1 || requested > 50)) {
      return apiError(
        'web_search_options.max_num_results must be an integer from 1 to 50.',
        400,
        'invalid_request_error',
        'invalid_value',
        'web_search_options.max_num_results',
      );
    }
    if (requested != null) webSearchMaxResults = requested;

    const requestedChars = body.web_search_options.max_fetch_chars;
    if (requestedChars != null && (!Number.isInteger(requestedChars) || requestedChars < 2_000 || requestedChars > 40_000)) {
      return apiError(
        'web_search_options.max_fetch_chars must be an integer from 2000 to 40000.',
        400,
        'invalid_request_error',
        'invalid_value',
        'web_search_options.max_fetch_chars',
      );
    }
    if (requestedChars != null) webSearchMaxFetchChars = requestedChars;

    if (body.web_search_options.scope != null && body.web_search_options.scope !== 'web' && body.web_search_options.scope !== 'site') {
      return apiError(
        'web_search_options.scope must be either "web" or "site".',
        400,
        'invalid_request_error',
        'invalid_value',
        'web_search_options.scope',
      );
    }
    if (body.web_search_options.scope != null) searchScope = body.web_search_options.scope;
  }

  // Public web search is part of every chat completion. The legacy
  // `web_search` flag is accepted but no longer controls execution; clients
  // can still explicitly choose the indexed site-search path.
  const siteSearchEnabled = body.site_search === true || searchScope === 'site';
  const webSearchEnabled = !siteSearchEnabled;

  try {
    if (siteSearchEnabled) {
      if (!env.AI_SEARCH) {
        return apiError(
          'Web search is not configured on this Worker yet.',
          503,
          'api_error',
          'web_search_unavailable',
        );
      }

      const searchRequest: Record<string, unknown> = {
        ...inputs,
        model,
        stream: body.stream === true,
        ai_search_options: {
          retrieval: { max_num_results: webSearchMaxResults, return_on_failure: true },
        },
      };

      if (body.stream === true) {
        const upstream = (await env.AI_SEARCH.chatCompletions(searchRequest as any)) as ReadableStream;
        const stream = toOpenAISearchStream(upstream, {
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
            'x-ai-search-instance': WEB_SEARCH_INSTANCE,
            ...API_CORS,
          },
        });
      }

      const raw = (await env.AI_SEARCH.chatCompletions(searchRequest as any)) as unknown as Record<string, unknown>;
      const text = extractText(raw);
      const usage = extractUsage(raw, promptTokens, text);
      accountUsage(usage);
      const choices = Array.isArray(raw.choices) && raw.choices.length
        ? raw.choices
        : [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              logprobs: null,
              finish_reason: 'stop',
            },
          ];

      return json(
        {
          ...raw,
          id: typeof raw.id === 'string' ? raw.id : id,
          object: 'chat.completion',
          created: typeof raw.created === 'number' ? raw.created : Math.floor(Date.now() / 1000),
          model: typeof raw.model === 'string' ? raw.model : responseModel,
          choices,
          usage: raw.usage ?? usage,
          site_search: {
            instance: WEB_SEARCH_INSTANCE,
            sources: extractSearchSources(raw.chunks),
          },
        },
        200,
        API_CORS,
      );
    }

    if (webSearchEnabled) {
      let webAgent;
      try {
        webAgent = await prepareWebSearchAgent(
          env,
          messages,
          inputs,
          normalizeWebSearchOptions({ max_num_results: webSearchMaxResults, max_fetch_chars: webSearchMaxFetchChars }),
          model,
        );
      } catch (error) {
        if (error instanceof WebSearchError) {
          const status = error.code === 'provider_not_configured' ? 503 : 502;
          return apiError(error.message, status, 'api_error', error.code);
        }
        throw error;
      }

      const finalInputs: Record<string, unknown> = { ...inputs, messages: webAgent.messages };
      const finalPromptTokens = estimatePromptTokens(webAgent.messages);
      const webSearchSources = webAgent.sources.map((source) => ({ ...source }));
      const webSearch = {
        performed: true,
        provider: webAgent.provider,
        queries: webAgent.searches.map((search) => ({ ...search })),
        sources: webSearchSources,
      };

      if (body.stream === true) {
        const upstream = (await env.AI.run(model as any, { ...finalInputs, stream: true } as any)) as ReadableStream;
        const stream = toOpenAIStream(upstream, {
          id,
          model: responseModel,
          includeUsage: body.stream_options?.include_usage === true,
          promptTokens: finalPromptTokens,
          priorUsage: webAgent.priorUsage,
          webSearch,
          onDone: accountUsage,
        });

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
            'x-web-search-provider': webAgent.provider,
            ...API_CORS,
          },
        });
      }

      const raw = (await env.AI.run(model as any, finalInputs as any)) as unknown as Record<string, unknown>;
      const text = extractText(raw);
      const finalUsage = extractUsage(raw, finalPromptTokens, text);
      const usage = {
        prompt_tokens: webAgent.priorUsage.prompt_tokens + finalUsage.prompt_tokens,
        completion_tokens: webAgent.priorUsage.completion_tokens + finalUsage.completion_tokens,
        total_tokens: webAgent.priorUsage.total_tokens + finalUsage.total_tokens,
      };
      accountUsage(usage);

      return json(
        {
          ...buildCompletion(id, responseModel, text, usage),
          web_search: webSearch,
        },
        200,
        API_CORS,
      );
    }

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
