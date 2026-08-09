/** OpenAI-compatible surface: /v1/models, /v1/chat/completions, /v1/embeddings. */

import { verifyAccessJwt } from '../lib/access';
import { extractSearchSources, toOpenAISearchStream } from '../lib/ai-search';
import {
  CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
  CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE,
  CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
  CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE,
  cloudflareNeuronsExhausted,
  isCloudflareNeuronsExhaustedError,
  isCloudflarePaidPlanRequiredError,
  recordCloudflareNeuronsExhausted,
} from '../lib/cloudflare-usage';
import {
  buildCompletion,
  estimatePromptTokens,
  extractText,
  extractToolCalls,
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
  shouldUseAutomaticWebSearch,
} from '../lib/web-search';
import {
  getNvidiaModelIndex,
  NvidiaApiError,
  requestNvidiaChat,
  requestNvidiaJson,
} from '../lib/nvidia';
import {
  isCloudflareModel,
  isNvidiaModel,
  modelListPayload,
  resolveChatModel,
  resolveEmbeddingModel,
  resolveNvidiaFallbackModel,
} from '../lib/models';
import type { ChatCompletionRequest, ChatMessage, ChatToolCall, EmbeddingsRequest, Env } from '../types';

const WEB_SEARCH_INSTANCE = 'lofuyu-web-search';
const CLOUDFLARE_STREAM_PREFLIGHT_LIMIT = 64 * 1024;

export const PROVIDER_FALLBACK_FROM_HEADER = 'x-ai-provider-fallback-from';
export const PROVIDER_FALLBACK_TO_HEADER = 'x-ai-provider-fallback-to';
export const PROVIDER_FALLBACK_REASON_HEADER = 'x-ai-provider-fallback-reason';

type AuthResult = { ok: true; keyId: string | null } | { ok: false; response: Response };

function cloudflareNeuronsExhaustedResponse(): Response {
  return apiError(
    CLOUDFLARE_NEURONS_EXHAUSTED_MESSAGE,
    429,
    'rate_limit_error',
    CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
    'model',
  );
}

function cloudflarePaidPlanRequiredResponse(): Response {
  return apiError(
    CLOUDFLARE_PAID_PLAN_REQUIRED_MESSAGE,
    403,
    'permission_error',
    CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
    'model',
  );
}

function withProviderFallbackHeaders(response: Response, from: string, to: string, reason: string): Response {
  const headers = new Headers(response.headers);
  headers.set(PROVIDER_FALLBACK_FROM_HEADER, from);
  headers.set(PROVIDER_FALLBACK_TO_HEADER, to);
  headers.set(PROVIDER_FALLBACK_REASON_HEADER, reason);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** API keys are for external callers; an Access session is also accepted for convenience. */
export async function authoriseApiRequest(request: Request, env: Env): Promise<AuthResult> {
  const bearer = extractBearer(request);
  const anthropicKey = request.headers.get('x-api-key')?.trim() || null;
  const credential = bearer ?? anthropicKey;

  if (credential) {
    const key = await authenticateKey(env, credential);
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
      'You did not provide an API key. Include Authorization: Bearer sk-cfai-..., x-api-key: sk-cfai-..., or use the signed-in dashboard.',
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

function copyNvidiaInputs(target: Record<string, unknown>, body: ChatCompletionRequest): void {
  if (Array.isArray(body.tools)) target.tools = body.tools;
  if (body.tool_choice != null) target.tool_choice = body.tool_choice;
  if (typeof body.parallel_tool_calls === 'boolean') target.parallel_tool_calls = body.parallel_tool_calls;
  if (typeof body.user === 'string' && body.user.trim()) target.user = body.user.slice(0, 256);
  if (typeof body.stop === 'string' || Array.isArray(body.stop)) target.stop = body.stop;
}

function toNvidiaToolSchema(inputs: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(inputs.tools)) return inputs;
  return {
    ...inputs,
    tools: inputs.tools.flatMap((tool) => {
      if (!tool || typeof tool !== 'object') return [];
      const value = tool as Record<string, unknown>;
      if (value.type === 'function' && value.function && typeof value.function === 'object') return [value];
      if (typeof value.name !== 'string' || !value.name.trim()) return [];
      return [
        {
          type: 'function',
          function: {
            name: value.name.trim(),
            ...(typeof value.description === 'string' ? { description: value.description } : {}),
            ...(value.parameters && typeof value.parameters === 'object' ? { parameters: value.parameters } : {}),
          },
        },
      ];
    }),
  };
}

function nvidiaRunner(env: Env, model: string) {
  return async (requestedModel: string, input: Record<string, unknown>): Promise<unknown> =>
    requestNvidiaJson(env, requestedModel || model, toNvidiaToolSchema(input));
}

function nvidiaStreamBody(inputs: Record<string, unknown>): Record<string, unknown> {
  return { ...inputs, stream: true };
}

function bufferedModelStream(value: unknown): ReadableStream<Uint8Array> {
  const payload = JSON.stringify(value ?? { response: '' }) ?? '{"response":""}';
  const bytes = new TextEncoder().encode(`${payload}\n[DONE]\n`);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function cloudflareProviderErrorInPrefix(prefix: string): unknown | null {
  for (const rawLine of prefix.split(/\r?\n/)) {
    let payload = rawLine.trim();
    if (!payload || payload.startsWith(':') || payload.startsWith('event:') || payload.startsWith('id:')) continue;
    if (payload.startsWith('data:')) payload = payload.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isCloudflareNeuronsExhaustedError(parsed) || isCloudflarePaidPlanRequiredError(parsed)) return parsed;
    } catch {
      // Wait for another chunk when the first provider event is split.
    }
  }
  return null;
}

function hasCompleteProviderEvent(prefix: string): boolean {
  const lines = prefix.split(/\r?\n/);
  if (lines.length < 2) return false;
  return lines.slice(0, -1).some((rawLine) => {
    let payload = rawLine.trim();
    if (!payload || payload.startsWith(':') || payload.startsWith('event:') || payload.startsWith('id:')) return false;
    if (payload.startsWith('data:')) payload = payload.slice(5).trim();
    return Boolean(payload);
  });
}

function replayPrefetchedStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  prefetched: Uint8Array[],
  sourceDone: boolean,
): ReadableStream<Uint8Array> {
  let index = 0;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < prefetched.length) {
        controller.enqueue(prefetched[index]);
        index += 1;
        if (sourceDone && index === prefetched.length) {
          release();
          controller.close();
        }
        return;
      }
      if (sourceDone) {
        release();
        controller.close();
        return;
      }
      try {
        const step = await reader.read();
        if (step.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(step.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
}

/**
 * Read only far enough to distinguish an immediate binding error from a real
 * stream. This keeps normal token streaming intact while still allowing an
 * opted-in dashboard request to retry before any Cloudflare output is sent.
 */
async function preflightCloudflareStream(upstream: ReadableStream): Promise<ReadableStream<Uint8Array>> {
  const reader = upstream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  const prefetched: Uint8Array[] = [];
  let prefix = '';
  let byteLength = 0;
  let sourceDone = false;

  try {
    while (byteLength < CLOUDFLARE_STREAM_PREFLIGHT_LIMIT) {
      const step = await reader.read();
      if (step.done) {
        sourceDone = true;
        prefix += decoder.decode();
        const providerError = cloudflareProviderErrorInPrefix(prefix);
        if (providerError) throw providerError;
        break;
      }
      const chunk = step.value;
      prefetched.push(chunk);
      byteLength += chunk.byteLength;
      prefix += decoder.decode(chunk, { stream: true });
      const providerError = cloudflareProviderErrorInPrefix(prefix);
      if (providerError) throw providerError;
      if (hasCompleteProviderEvent(prefix)) break;
    }
    return replayPrefetchedStream(reader, prefetched, sourceDone);
  } catch (error) {
    await reader.cancel('Workers AI stream preflight failed').catch(() => undefined);
    reader.releaseLock();
    throw error;
  }
}

function logProviderEvent(
  event: string,
  completionId: string,
  model: string,
  details: Record<string, string | boolean> = {},
): void {
  console.warn(JSON.stringify({ event, completion_id: completionId, model, ...details }));
}

export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  trustedAccess = false,
  authenticatedKeyId?: string | null,
): Promise<Response> {
  const auth = authenticatedKeyId !== undefined
    ? ({ ok: true, keyId: authenticatedKeyId } as const)
    : trustedAccess
      ? ({ ok: true, keyId: null } as const)
      : await authoriseApiRequest(request, env);
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

  const nvidiaModels = await getNvidiaModelIndex(env);
  const requestedModel = resolveChatModel(body.model, env.DEFAULT_MODEL, nvidiaModels);
  if (!requestedModel) {
    return apiError(
      `The model '${body.model ?? ''}' does not exist or is not available. Call GET /v1/models for the list.`,
      404,
      'not_found_error',
      'model_not_found',
      'model',
    );
  }

  const model = requestedModel;
  const providerFallbackAllowed = trustedAccess
    && body.allow_provider_fallback === true
    && Boolean(env.NVIDIA_NIM_API_KEY?.trim())
    && body.site_search !== true
    && body.web_search_options?.scope !== 'site';
  let quotaObservationAt = new Date();
  if (isCloudflareModel(model)) {
    const quota = await cloudflareNeuronsExhausted(env, quotaObservationAt);
    if (quota.depleted) {
      const fallback = providerFallbackAllowed ? resolveNvidiaFallbackModel(model, nvidiaModels) : null;
      if (!fallback) return cloudflareNeuronsExhaustedResponse();
      const retryRequest = new Request(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, model: fallback, allow_provider_fallback: false }),
      });
      const fallbackResponse = await handleChatCompletions(retryRequest, env, ctx, true);
      return withProviderFallbackHeaders(
        fallbackResponse,
        model,
        fallback,
        CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
      );
    }
  }
  const nvidiaProvider = isNvidiaModel(model, nvidiaModels);

  const inputs: Record<string, unknown> = { messages };
  copyNumber(inputs, body, 'temperature');
  copyNumber(inputs, body, 'top_p');
  copyNumber(inputs, body, 'frequency_penalty');
  copyNumber(inputs, body, 'presence_penalty');
  copyNumber(inputs, body, 'seed');

  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (typeof maxTokens === 'number' && Number.isFinite(maxTokens) && maxTokens > 0) inputs.max_tokens = maxTokens;
  copyNvidiaInputs(inputs, body);

  const id = newCompletionId();
  const responseModel = body.model?.trim() || model;
  const promptTokens = estimatePromptTokens(messages);
  const accountUsage = (usage: Parameters<typeof recordUsage>[3]): void => {
    if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId, model, usage).catch(() => undefined));
  };
  const accountStreamError = (code: string): void => {
    if (isCloudflareModel(model) && code === CLOUDFLARE_NEURONS_EXHAUSTED_CODE) {
      logProviderEvent('workers_ai_quota_rejected', id, model, { phase: 'stream' });
      ctx.waitUntil(recordCloudflareNeuronsExhausted(env.DB, new Date()).catch(() => undefined));
    }
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

  // Cloudflare models can cheaply decide whether to call the server tools.
  // NVIDIA requests that plainly do not need fresh information bypass that
  // blocking, non-streaming planning turn so their answer can stream directly.
  const siteSearchEnabled = body.site_search === true || searchScope === 'site';
  const webSearchConfigured = Boolean(env.TAVILY_API_KEY?.trim() || env.WEBSEARCH || env.SEARXNG_URL);
  const nvidiaWebSearchRequested = body.web_search === true
    || body.web_search_options != null
    || shouldUseAutomaticWebSearch(messages);
  const webSearchEnabled = !siteSearchEnabled
    && webSearchConfigured
    && (!nvidiaProvider || nvidiaWebSearchRequested);

  try {
    if (siteSearchEnabled) {
      if (nvidiaProvider) {
        return apiError(
          'Indexed Cloudflare AI Search is available only for Cloudflare models. Use the model-controlled live web tools with this NVIDIA model.',
          400,
          'invalid_request_error',
          'unsupported_value',
          'site_search',
        );
      }
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
      quotaObservationAt = new Date();

      if (body.stream === true) {
        const upstream = (await env.AI_SEARCH.chatCompletions(searchRequest as any)) as ReadableStream;
        const stream = toOpenAISearchStream(upstream, {
          id,
          model: responseModel,
          includeUsage: body.stream_options?.include_usage === true,
          promptTokens,
          onDone: accountUsage,
          onError: accountStreamError,
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
        if (isCloudflareModel(model)) quotaObservationAt = new Date();
        webAgent = await prepareWebSearchAgent(
          env,
          messages,
          inputs,
          normalizeWebSearchOptions({ max_num_results: webSearchMaxResults, max_fetch_chars: webSearchMaxFetchChars }),
          model,
          nvidiaProvider ? nvidiaRunner(env, model) : undefined,
        );
      } catch (error) {
        if (error instanceof WebSearchError) {
          const status = error.code === 'provider_not_configured' ? 503 : 502;
          return apiError(error.message, status, 'api_error', error.code);
        }
        throw error;
      }

      if (!webAgent.performed) {
        const raw = webAgent.response ?? { response: '' };
        const text = extractText(raw);
        const usage = webAgent.priorUsage;
        accountUsage(usage);

        if (body.stream === true) {
          const stream = toOpenAIStream(bufferedModelStream(raw), {
            id,
            model: responseModel,
            includeUsage: body.stream_options?.include_usage === true,
            promptTokens,
            onDone: () => undefined,
            onError: accountStreamError,
            normalizeCloudflareQuota: isCloudflareModel(model),
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

        return json(buildCompletion(id, responseModel, text, usage, extractToolCalls(raw)), 200, API_CORS);
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
        if (!nvidiaProvider) quotaObservationAt = new Date();
        const rawUpstream = nvidiaProvider
          ? (await requestNvidiaChat(env, model, nvidiaStreamBody(finalInputs))).body
          : (await env.AI.run(model as any, { ...finalInputs, stream: true } as any)) as ReadableStream;
        if (!rawUpstream) throw new Error('upstream returned no response body');
        const upstream = nvidiaProvider
          ? rawUpstream
          : await preflightCloudflareStream(rawUpstream);
        const stream = toOpenAIStream(upstream, {
          id,
          model: responseModel,
          includeUsage: body.stream_options?.include_usage === true,
          promptTokens: finalPromptTokens,
          priorUsage: webAgent.priorUsage,
          webSearch,
          onDone: accountUsage,
          onError: accountStreamError,
          normalizeCloudflareQuota: isCloudflareModel(model),
        });

        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
            'x-web-search-provider': webAgent.provider ?? 'unknown',
            ...API_CORS,
          },
        });
      }

      if (!nvidiaProvider) quotaObservationAt = new Date();
      const raw = nvidiaProvider
        ? await requestNvidiaJson(env, model, finalInputs)
        : (await env.AI.run(model as any, finalInputs as any)) as unknown as Record<string, unknown>;
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
          ...buildCompletion(id, responseModel, text, usage, extractToolCalls(raw)),
          web_search: webSearch,
        },
        200,
        API_CORS,
      );
    }

    if (body.stream === true) {
      if (!nvidiaProvider) quotaObservationAt = new Date();
      const nvidiaResponse = nvidiaProvider
        ? await requestNvidiaChat(env, model, nvidiaStreamBody(inputs))
        : null;
      const rawUpstream = nvidiaResponse
        ? nvidiaResponse.body
        : (await env.AI.run(model as any, { ...inputs, stream: true } as any)) as ReadableStream;
      if (!rawUpstream) throw new Error('upstream returned no response body');

      // NVIDIA already speaks OpenAI-compatible SSE. The authenticated
      // dashboard can relay it verbatim, avoiding a parse/stringify pass for
      // every generated token. This is important on the Workers Free CPU
      // budget; the persistent conversation wrapper still validates the
      // terminal sentinel and saves the completed text.
      if (nvidiaResponse && trustedAccess) {
        return new Response(rawUpstream, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
            ...API_CORS,
          },
        });
      }

      const upstream = nvidiaProvider
        ? rawUpstream
        : await preflightCloudflareStream(rawUpstream);
      const stream = toOpenAIStream(upstream, {
        id,
        model: responseModel,
        includeUsage: body.stream_options?.include_usage === true,
        promptTokens,
        onDone: accountUsage,
        onError: accountStreamError,
        normalizeCloudflareQuota: isCloudflareModel(model),
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

    if (!nvidiaProvider) quotaObservationAt = new Date();
    const result = nvidiaProvider
      ? await requestNvidiaJson(env, model, inputs)
      : await env.AI.run(model as any, inputs as any);
    const text = extractText(result);
    const usage = extractUsage(result, promptTokens, text);
    accountUsage(usage);
    return json(buildCompletion(id, responseModel, text, usage, extractToolCalls(result)), 200, API_CORS);
  } catch (error) {
    if (isCloudflareModel(model) && isCloudflareNeuronsExhaustedError(error)) {
      const observedAt = new Date();
      await recordCloudflareNeuronsExhausted(env.DB, observedAt).catch(() => undefined);
      logProviderEvent('workers_ai_quota_rejected', id, model, { phase: 'request' });
      const fallback = providerFallbackAllowed ? resolveNvidiaFallbackModel(model, nvidiaModels) : null;
      if (fallback) {
        logProviderEvent('provider_fallback_started', id, model, {
          fallback_model: fallback,
          reason: CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
        });
        const retryRequest = new Request(request.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, model: fallback, allow_provider_fallback: false }),
        });
        const fallbackResponse = await handleChatCompletions(retryRequest, env, ctx, true);
        return withProviderFallbackHeaders(
          fallbackResponse,
          model,
          fallback,
          CLOUDFLARE_NEURONS_EXHAUSTED_CODE,
        );
      }
      return cloudflareNeuronsExhaustedResponse();
    }
    if (isCloudflareModel(model) && isCloudflarePaidPlanRequiredError(error)) {
      logProviderEvent('workers_ai_paid_plan_required', id, model);
      const fallback = providerFallbackAllowed ? resolveNvidiaFallbackModel(model, nvidiaModels) : null;
      if (fallback) {
        logProviderEvent('provider_fallback_started', id, model, {
          fallback_model: fallback,
          reason: CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
        });
        const retryRequest = new Request(request.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, model: fallback, allow_provider_fallback: false }),
        });
        const fallbackResponse = await handleChatCompletions(retryRequest, env, ctx, true);
        return withProviderFallbackHeaders(
          fallbackResponse,
          model,
          fallback,
          CLOUDFLARE_PAID_PLAN_REQUIRED_CODE,
        );
      }
      return cloudflarePaidPlanRequiredResponse();
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof NvidiaApiError ? error.status : 502;
    const code = error instanceof NvidiaApiError ? error.code : 'upstream_error';
    if (error instanceof NvidiaApiError) {
      logProviderEvent('nvidia_request_failed', id, model, {
        phase: body.stream === true ? 'stream' : 'request',
        reason: code,
      });
    }
    return apiError(`Upstream model error: ${message}`, status, 'api_error', code);
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
  const auth = await authoriseApiRequest(request, env);
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

  let quotaObservationAt = new Date();
  const quota = await cloudflareNeuronsExhausted(env, quotaObservationAt);
  if (quota.depleted) {
    return cloudflareNeuronsExhaustedResponse();
  }

  try {
    quotaObservationAt = new Date();
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
    if (isCloudflareNeuronsExhaustedError(error)) {
      await recordCloudflareNeuronsExhausted(env.DB, quotaObservationAt).catch(() => undefined);
      return cloudflareNeuronsExhaustedResponse();
    }
    const message = error instanceof Error ? error.message : String(error);
    return apiError(`Upstream model error: ${message}`, 502, 'api_error', 'upstream_error');
  }
}

export async function handleModels(env: Env): Promise<Response> {
  const [nvidiaModels, quota] = await Promise.all([
    getNvidiaModelIndex(env),
    cloudflareNeuronsExhausted(env),
  ]);
  return json(modelListPayload({ nvidiaModels, cloudflareDisabled: quota.depleted }), 200, API_CORS);
}
