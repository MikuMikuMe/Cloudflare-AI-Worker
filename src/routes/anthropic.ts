/** Anthropic Messages-compatible surface: /v1/messages and token counting. */

import {
  AnthropicRequestError,
  anthropicError,
  newAnthropicMessageId,
  newAnthropicRequestId,
  toAnthropicErrorResponse,
  toAnthropicResponse,
  translateAnthropicRequest,
} from '../lib/anthropic';
import { API_CORS, json } from '../lib/http';
import { getNvidiaModelIndex } from '../lib/nvidia';
import { resolveChatModel } from '../lib/models';
import type { Env } from '../types';
import { authoriseApiRequest, handleChatCompletions } from './v1';

function invalidMethod(requestId: string): Response {
  return anthropicError('Use POST for this endpoint.', 405, 'invalid_request_error', requestId);
}

function parseFailure(requestId: string): Response {
  return anthropicError(
    'We could not parse the JSON body of your request.',
    400,
    'invalid_request_error',
    requestId,
  );
}

export async function handleAnthropicMessages(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  trustedAccess = false,
): Promise<Response> {
  const requestId = newAnthropicRequestId();
  if (request.method.toUpperCase() !== 'POST') return invalidMethod(requestId);

  const auth = trustedAccess
    ? ({ ok: true, keyId: null } as const)
    : await authoriseApiRequest(request, env);
  if (!auth.ok) return toAnthropicErrorResponse(auth.response, requestId);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return parseFailure(requestId);
  }

  let translated;
  try {
    translated = translateAnthropicRequest(raw);
  } catch (error) {
    if (error instanceof AnthropicRequestError) {
      return anthropicError(error.message, 400, 'invalid_request_error', requestId);
    }
    return anthropicError('The request could not be validated.', 400, 'invalid_request_error', requestId);
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  headers.delete('content-encoding');
  const openAIRequest = new Request(new URL('/v1/chat/completions', request.url), {
    method: 'POST',
    headers,
    body: JSON.stringify(translated.request),
    signal: request.signal,
  });
  const response = await handleChatCompletions(openAIRequest, env, ctx, trustedAccess, auth.keyId);
  return toAnthropicResponse(response, {
    requestId,
    messageId: newAnthropicMessageId(),
    model: translated.requestedModel,
    inputTokens: translated.inputTokens,
    stream: translated.request.stream === true,
  });
}

export async function handleAnthropicTokenCount(
  request: Request,
  env: Env,
  trustedAccess = false,
): Promise<Response> {
  const requestId = newAnthropicRequestId();
  if (request.method.toUpperCase() !== 'POST') return invalidMethod(requestId);

  if (!trustedAccess) {
    const auth = await authoriseApiRequest(request, env);
    if (!auth.ok) return toAnthropicErrorResponse(auth.response, requestId);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return parseFailure(requestId);
  }

  let translated;
  try {
    translated = translateAnthropicRequest(raw, { requireMaxTokens: false });
  } catch (error) {
    if (error instanceof AnthropicRequestError) {
      return anthropicError(error.message, 400, 'invalid_request_error', requestId);
    }
    return anthropicError('The request could not be validated.', 400, 'invalid_request_error', requestId);
  }

  const nvidiaModels = await getNvidiaModelIndex(env);
  if (!resolveChatModel(translated.requestedModel, env.DEFAULT_MODEL, nvidiaModels)) {
    return anthropicError(
      `The model '${translated.requestedModel}' does not exist or is not available.`,
      404,
      'not_found_error',
      requestId,
    );
  }

  const headers = new Headers(API_CORS);
  headers.set('request-id', requestId);
  return json({ input_tokens: translated.inputTokens }, 200, headers);
}
