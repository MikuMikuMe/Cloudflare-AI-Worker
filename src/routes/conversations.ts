import {
  beginConversationTurn,
  ConversationConflictError,
  ConversationValidationError,
  createConversation,
  deleteConversation,
  getConversation,
  isConversationSchemaMissing,
  listConversations,
  renameConversation,
  type ConversationOwner,
} from '../lib/conversations';
import { json } from '../lib/http';
import type { AccessIdentity, Env } from '../types';

const BASE_PATH = '/admin/api/conversations';
const NO_STORE = { 'cache-control': 'no-store' };
const RESOURCE_ID = '[A-Za-z0-9-]{1,128}';

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ConversationValidationError('Content-Type must be application/json.');
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ConversationValidationError('The request body must be valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConversationValidationError('The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

function owner(identity: AccessIdentity): ConversationOwner {
  return { scope: identity.aud, sub: identity.sub, email: identity.email };
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ error, message }, status, NO_STORE);
}

function notFound(): Response {
  return errorResponse('not_found', 'Conversation not found.', 404);
}

function methodNotAllowed(): Response {
  return errorResponse('method_not_allowed', 'Method not allowed.', 405);
}

function pageLimit(request: Request): number | undefined {
  const value = new URL(request.url).searchParams.get('limit');
  if (value == null || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new ConversationValidationError('limit must be an integer from 1 to 100.');
  return Number(value);
}

function optionalInteger(request: Request, name: string): number | undefined {
  const value = new URL(request.url).searchParams.get(name);
  if (value == null || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new ConversationValidationError(`${name} must be a positive integer.`);
  return Number(value);
}

async function routeConversationApi(
  request: Request,
  env: Env,
  path: string,
  identity: AccessIdentity,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const conversationOwner = owner(identity);

  if (path === BASE_PATH) {
    if (method === 'GET') {
      const url = new URL(request.url);
      const result = await listConversations(env.DB, conversationOwner, {
        limit: pageLimit(request),
        cursor: url.searchParams.get('cursor'),
      });
      return json(result, 200, NO_STORE);
    }
    if (method === 'POST') {
      const body = await jsonObject(request);
      if (body.title != null && typeof body.title !== 'string') {
        throw new ConversationValidationError('title must be a string.');
      }
      if (body.model != null && typeof body.model !== 'string') {
        throw new ConversationValidationError('model must be a string.');
      }
      const conversation = await createConversation(env.DB, conversationOwner, {
        ...(typeof body.title === 'string' ? { title: body.title } : {}),
        model: typeof body.model === 'string' ? body.model : env.DEFAULT_MODEL,
      });
      return json({ conversation }, 201, NO_STORE);
    }
    return methodNotAllowed();
  }

  const turnMatch = new RegExp(`^${BASE_PATH}/(${RESOURCE_ID})/turns$`).exec(path);
  if (turnMatch) {
    if (method !== 'POST') return methodNotAllowed();
    const body = await jsonObject(request);
    const result = await beginConversationTurn(env.DB, conversationOwner, turnMatch[1], {
      content: body.content as string,
      model: body.model as string,
      client_turn_id: body.client_turn_id as string,
      expected_version: body.expected_version as number,
    });
    if (!result) return notFound();
    return json(result, result.created ? 201 : 200, NO_STORE);
  }

  const itemMatch = new RegExp(`^${BASE_PATH}/(${RESOURCE_ID})$`).exec(path);
  if (itemMatch) {
    const id = itemMatch[1];
    if (method === 'GET') {
      const detail = await getConversation(env.DB, conversationOwner, id, {
        messageLimit: optionalInteger(request, 'message_limit'),
        beforeSeq: optionalInteger(request, 'before_seq'),
      });
      if (!detail) return notFound();
      return json(detail, 200, NO_STORE);
    }
    if (method === 'PATCH') {
      const body = await jsonObject(request);
      const conversation = await renameConversation(
        env.DB,
        conversationOwner,
        id,
        body.title as string,
        body.expected_version == null ? undefined : (body.expected_version as number),
      );
      if (!conversation) return notFound();
      return json({ conversation }, 200, NO_STORE);
    }
    if (method === 'DELETE') {
      const deleted = await deleteConversation(env.DB, conversationOwner, id);
      if (!deleted) return notFound();
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    return methodNotAllowed();
  }

  return notFound();
}

/**
 * Handle the Access-only persistent conversation surface.
 * Returns null for unrelated admin routes so the existing dashboard API can continue routing.
 */
export async function handleConversationApi(
  request: Request,
  env: Env,
  path: string,
  identity: AccessIdentity,
): Promise<Response | null> {
  if (path !== BASE_PATH && !path.startsWith(`${BASE_PATH}/`)) return null;

  try {
    return await routeConversationApi(request, env, path, identity);
  } catch (error) {
    if (isConversationSchemaMissing(error)) {
      return errorResponse(
        'conversation_storage_unavailable',
        'Conversation storage is not initialized. Apply D1 migrations and try again.',
        503,
      );
    }
    if (error instanceof ConversationValidationError) {
      return errorResponse('invalid_request', error.message, 400);
    }
    if (error instanceof ConversationConflictError) {
      return errorResponse('conversation_conflict', error.message, 409);
    }
    return errorResponse('conversation_storage_error', 'Conversation storage is temporarily unavailable.', 500);
  }
}
