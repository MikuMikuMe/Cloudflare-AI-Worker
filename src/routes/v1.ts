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
  DEFAULT_EMBEDDING_MODEL,
  modelListPayload,
  resolveChatModel,
  resolveEmbeddingModel,
} from '../lib/models';
import type { ChatCompletionRequest, ChatMessage, EmbeddingsRequest, Env } from '../types';

/**
 * Two ways to call the API:
 *  1. an API key you minted in the dashboard (the normal path), or
 *  2. a live Cloudflare Access session, so the built-in playground works
 *     without forcing you to create a key first.
 */
async function authorise(
  request: Request,
  env: Env,
): Promise<{ ok: true; keyId: string | null } | { ok: false; response: Response }> {
  const bearer = extractBearer(request);

  if (bearer) {
    const key = await authenticateKey(env, bearer);
    if (!key) {
      return {
        ok: false,
        response: apiError(
          'Incorrect API key provided. You can find or create a key in the dashboard.',
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
      'You didn\'t provide an API key. Include it in an Authorization header: "Authorization: Bearer sk-cfai-...".',
      401,
      'authentication_error',
      'missing_api_key',
      null,
      { 'www-authenticate': 'Bearer' },
    ),
  };
}

function normaliseMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null;
    const msg = m as Record<string, any>;
    if (typeof msg.role !== 'string') return null;

    // Content may be a plain string or OpenAI's multipart array form.
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content
        .map((part: any) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text ?? '' : ''))
        .join('');
    } else if (msg.content == null) {
      content = '';
    } else {
      return null;
    }

    out.push({ role: msg.role as ChatMessage['role'], content });
  }
  return out;
}

export async function handleChatCompletions(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await authorise(request, env);
  if (!auth.ok) return auth.response;

  let body: ChatCompletionRequest;
  try {
    body = (await request.json()) as ChatCompletionRequest;
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

  const model = resolveChatModel(body.model, env.DEFAULT_MODEL);
  if (!model) {
    return apiError(
      `The model '${body.model}' does not exist or you do not have access to it. Call GET /v1/models for the list.`,
      404,
      'not_found_error',
      'model_not_found',
      'model',
    );
  }

  const inputs: Record<string, unknown> = { messages };
  if (typeof body.temperature === 'number') inputs.temperature = body.temperature;
  if (typeof body.top_p === 'number') inputs.top_p = body.top_p;
  if (typeof body.frequency_penalty === 'number') inputs.frequency_penalty = body.frequency_penalty;
  if (typeof body.presence_penalty === 'number') inputs.presence_penalty = body.presence_penalty;
  if (typeof body.seed === 'number') inputs.seed = body.seed;

  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (typeof maxTokens === 'number') inputs.max_tokens = maxTokens;

  const id = newCompletionId();
  const promptTokens = estimatePromptTokens(messages);

  try {
    if (body.stream === true) {
      const upstream = (await env.AI.run(model as any, { ...inputs, stream: true } as any)) as ReadableStream;

      const stream = toOpenAIStream(upstream, {
        id,
        model,
        includeUsage: body.stream_options?.include_usage === true,
        promptTokens,
        onDone: (usage) => {
          if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId!, model, usage).catch(() => {}));
        },
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

    if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId, model, usage).catch(() => {}));

    return json(buildCompletion(id, model, text, usage), 200, API_CORS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError(`Upstream model error: ${message}`, 502, 'api_error', 'upstream_error');
  }
}

export async function handleEmbeddings(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authorise(request, env);
  if (!auth.ok) return auth.response;

  let body: EmbeddingsRequest;
  try {
    body = (await request.json()) as EmbeddingsRequest;
  } catch {
    return apiError('We could not parse the JSON body of your request.', 400, 'invalid_request_error');
  }

  const inputs = typeof body.input === 'string' ? [body.input] : body.input;
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.some((i) => typeof i !== 'string')) {
    return apiError(
      "'input' is required and must be a string or an array of strings.",
      400,
      'invalid_request_error',
      null,
      'input',
    );
  }

  const model = resolveEmbeddingModel(body.model) ?? DEFAULT_EMBEDDING_MODEL;

  try {
    const result: any = await env.AI.run(model as any, { text: inputs } as any);
    const vectors: number[][] = result?.data ?? result?.result?.data ?? [];

    const promptTokens = inputs.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    const usage = { prompt_tokens: promptTokens, completion_tokens: 0, total_tokens: promptTokens };

    if (auth.keyId) ctx.waitUntil(recordUsage(env, auth.keyId, model, usage).catch(() => {}));

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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return apiError(`Upstream model error: ${message}`, 502, 'api_error', 'upstream_error');
  }
}

export function handleModels(): Response {
  return json(modelListPayload(), 200, API_CORS);
}
