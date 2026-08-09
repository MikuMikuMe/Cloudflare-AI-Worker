import {
  finalizeConversationTurn,
  getConversationPromptMessages,
  type BeginConversationTurnResult,
  type ConversationMessageRecord,
  type ConversationOwner,
} from '../lib/conversations';
import { CLOUDFLARE_NEURONS_EXHAUSTED_CODE } from '../lib/cloudflare-usage';
import { wrapPersistedSseResponse, type PersistedAssistantResult } from '../lib/persisted-stream';
import { json } from '../lib/http';
import { handleChatCompletions } from './v1';
import { handleConversationApi } from './conversations';
import type { AccessIdentity, ChatMessage, Env } from '../types';

const TURN_PATH = /^\/admin\/api\/conversations\/([A-Za-z0-9-]{1,128})\/turns$/;
const NO_STORE = { 'cache-control': 'no-store' };
const MAX_PROMPT_MESSAGES = 80;
const MAX_PROMPT_CHARACTERS = 160_000;

interface TurnRequestBody {
  model: string;
  client_turn_id: string;
}

interface TurnDependencies {
  runChat?: typeof handleChatCompletions;
}

function owner(identity: AccessIdentity): ConversationOwner {
  return { scope: identity.aud, sub: identity.sub, email: identity.email };
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ error, message }, status, NO_STORE);
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Build bounded working context while retaining the complete transcript in D1. */
export function conversationPromptMessages(messages: ConversationMessageRecord[]): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let characters = 0;

  for (let index = messages.length - 1; index >= 0 && selected.length < MAX_PROMPT_MESSAGES; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.status !== 'complete') continue;
    if (message.role === 'assistant' && !message.content) continue;
    if (message.role === 'user' && message.status !== 'complete') continue;
    if (selected.length > 0 && characters + message.content.length > MAX_PROMPT_CHARACTERS) break;
    characters += message.content.length;
    selected.push({ role: message.role, content: message.content });
  }

  return selected.reverse();
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function replayCompletedTurn(
  message: ConversationMessageRecord,
  conversation: BeginConversationTurnResult['conversation'],
): Response {
  const metadata = jsonRecord(message.metadata);
  const chunks = [
    sseEvent({ conversation, choices: [] }),
    sseEvent({
      id: `chatcmpl-${message.id.replace(/-/g, '')}`,
      object: 'chat.completion.chunk',
      model: message.model,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    }),
  ];
  const webSearch = jsonRecord(metadata?.web_search);
  const siteSearch = jsonRecord(metadata?.site_search);
  if (webSearch || siteSearch) {
    chunks.push(
      sseEvent({
        id: `chatcmpl-${message.id.replace(/-/g, '')}`,
        object: 'chat.completion.chunk',
        model: message.model,
        choices: [],
        ...(webSearch ? { web_search: webSearch } : {}),
        ...(siteSearch ? { site_search: siteSearch } : {}),
      }),
    );
  }
  chunks.push(
    sseEvent({
      id: `chatcmpl-${message.id.replace(/-/g, '')}`,
      object: 'chat.completion.chunk',
      model: message.model,
      choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }],
    }),
    sseEvent({
      id: `chatcmpl-${message.id.replace(/-/g, '')}`,
      object: 'chat.completion.chunk',
      model: message.model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }),
    'data: [DONE]\n\n',
  );
  return new Response(chunks.join(''), {
    headers: {
      ...NO_STORE,
      'content-type': 'text/event-stream; charset=utf-8',
      'x-conversation-replay': 'true',
    },
  });
}

function keepAlive(ctx: ExecutionContext, promise: Promise<unknown>): void {
  ctx.waitUntil(promise.then(() => undefined).catch(() => undefined));
}

async function safeUpstreamFailure(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body = jsonRecord(await response.clone().json());
    const error = jsonRecord(body?.error);
    const code = typeof error?.code === 'string' ? error.code.slice(0, 100) : 'upstream_error';
    const message = typeof error?.message === 'string' ? error.message.slice(0, 500) : 'The model request failed.';
    return { code, message };
  } catch {
    return { code: 'upstream_error', message: 'The model request failed.' };
  }
}

function sameOriginResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('access-control-')) headers.delete(name);
  }
  headers.set('cache-control', 'no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function persistFailedTurn(
  env: Env,
  ctx: ExecutionContext,
  conversationOwner: ConversationOwner,
  conversationId: string,
  turnId: string,
  model: string,
  code: string,
): Promise<boolean> {
  const persistence = finalizeConversationTurn(
    env.DB,
    conversationOwner,
    conversationId,
    turnId,
    {
      content: '',
      status: 'error',
      model,
      metadata: { failure: { code } },
    },
  ).then((saved) => {
    if (!saved || saved.status !== 'error') throw new Error('failed turn changed before finalization');
  });
  keepAlive(ctx, persistence);
  try {
    await persistence;
    return true;
  } catch {
    return false;
  }
}

/**
 * Orchestrate the dashboard-only stateful turn endpoint. The public /v1 route
 * stays stateless; only this Access-authenticated path loads canonical history.
 */
export async function handlePersistentConversationTurn(
  request: Request,
  env: Env,
  path: string,
  ctx: ExecutionContext,
  identity: AccessIdentity,
  dependencies: TurnDependencies = {},
): Promise<Response | null> {
  const match = TURN_PATH.exec(path);
  if (!match || request.method.toUpperCase() !== 'POST') return null;

  const beginResponse = await handleConversationApi(request.clone(), env, path, identity);
  if (!beginResponse || !beginResponse.ok) return beginResponse;

  let body: TurnRequestBody;
  let begun: BeginConversationTurnResult;
  try {
    body = (await request.json()) as TurnRequestBody;
    begun = (await beginResponse.json()) as BeginConversationTurnResult;
  } catch {
    return errorResponse('invalid_request', 'The request body must be valid JSON.', 400);
  }

  const assistant = begun.messages.find((message) => message.role === 'assistant');
  if (!assistant) {
    return errorResponse('conversation_storage_error', 'The conversation turn could not be loaded.', 500);
  }
  if (!begun.created) {
    if (assistant.status === 'complete') return replayCompletedTurn(assistant, begun.conversation);
    return errorResponse(
      'turn_not_replayable',
      assistant.status === 'generating'
        ? 'This response is still generating on another request.'
        : 'This attempt was interrupted. Send it again as a new turn.',
      409,
    );
  }

  const conversationOwner = owner(identity);
  let storedMessages: ConversationMessageRecord[];
  try {
    storedMessages = await getConversationPromptMessages(
      env.DB,
      conversationOwner,
      match[1],
      MAX_PROMPT_MESSAGES,
    );
  } catch {
    const saved = await persistFailedTurn(
      env,
      ctx,
      conversationOwner,
      match[1],
      body.client_turn_id,
      body.model,
      'conversation_history_unavailable',
    );
    return errorResponse(
      saved ? 'conversation_storage_error' : 'conversation_storage_unavailable',
      saved ? 'The conversation history could not be loaded.' : 'The failed turn could not be saved.',
      503,
    );
  }
  if (!storedMessages.length) return errorResponse('not_found', 'Conversation not found.', 404);
  const messages = conversationPromptMessages(storedMessages);
  const chatRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: body.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  const runChat = dependencies.runChat ?? handleChatCompletions;
  let upstream: Response;
  try {
    upstream = await runChat(chatRequest, env, ctx, true);
  } catch {
    if (!await persistFailedTurn(
      env,
      ctx,
      conversationOwner,
      match[1],
      body.client_turn_id,
      body.model,
      'upstream_error',
    )) {
      return errorResponse('conversation_storage_error', 'The failed turn could not be saved.', 503);
    }
    return errorResponse('upstream_error', 'The model request failed.', 502);
  }
  const contentType = upstream.headers.get('content-type')?.toLowerCase() ?? '';
  if (!upstream.ok || !upstream.body || !contentType.includes('text/event-stream')) {
    const failure = await safeUpstreamFailure(upstream);
    if (!await persistFailedTurn(
      env,
      ctx,
      conversationOwner,
      match[1],
      body.client_turn_id,
      body.model,
      failure.code,
    )) {
      return errorResponse('conversation_storage_error', 'The failed turn could not be saved.', 503);
    }
    return sameOriginResponse(upstream);
  }

  const sameOriginUpstream = sameOriginResponse(upstream);

  return wrapPersistedSseResponse(sameOriginUpstream, async (result: PersistedAssistantResult) => {
    const failureCode = result.errorCode === CLOUDFLARE_NEURONS_EXHAUSTED_CODE
      ? CLOUDFLARE_NEURONS_EXHAUSTED_CODE
      : 'upstream_error';
    const metadata = {
      ...result.metadata,
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.error ? { failure: { code: failureCode } } : {}),
    };
    const persistence = finalizeConversationTurn(
      env.DB,
      conversationOwner,
      match[1],
      body.client_turn_id,
      {
        content: result.text,
        status: result.status,
        model: body.model,
        metadata,
      },
    ).then((saved) => {
      if (!saved || saved.status !== result.status || saved.content !== result.text) {
        throw new Error('assistant turn changed before finalization');
      }
    });
    keepAlive(ctx, persistence);
    await persistence;
  }, [{ conversation: begun.conversation, choices: [] }]);
}
