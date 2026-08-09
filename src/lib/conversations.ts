export interface ConversationOwner {
  scope: string;
  sub: string;
  email: string;
}

export interface ConversationRecord {
  id: string;
  title: string;
  last_model: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export type ConversationMessageStatus = 'complete' | 'generating' | 'interrupted' | 'error';

export interface ConversationMessageRecord {
  id: string;
  conversation_id: string;
  client_turn_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: ConversationMessageStatus;
  model: string;
  metadata: unknown | null;
  created_at: number;
  completed_at: number | null;
}

export interface ConversationDetail {
  conversation: ConversationRecord;
  messages: ConversationMessageRecord[];
  next_before_seq: number | null;
}

export interface ConversationPage {
  items: ConversationRecord[];
  next_cursor: string | null;
}

export interface BeginConversationTurnInput {
  content: string;
  model: string;
  client_turn_id: string;
  expected_version: number;
}

export interface BeginConversationTurnResult {
  conversation: ConversationRecord;
  messages: ConversationMessageRecord[];
  created: boolean;
}

export interface FinalizeConversationTurnInput {
  content: string;
  status: Exclude<ConversationMessageStatus, 'generating'>;
  model: string;
  /** Keep the user's selected model as the conversation preference after provider fallback. */
  lastModel?: string;
  metadata?: unknown;
}

interface ConversationRow extends ConversationRecord {
  owner_scope: string;
  owner_sub: string;
  owner_email: string;
  next_seq: number;
}

interface ConversationMessageRow {
  id: string;
  conversation_id: string;
  client_turn_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  status: ConversationMessageStatus;
  model: string;
  metadata_json: string | null;
  created_at: number;
  completed_at: number | null;
}

interface CreateOptions {
  id?: string;
  now?: number;
}

interface BeginOptions {
  userMessageId?: string;
  assistantMessageId?: string;
  now?: number;
}

interface ConversationMessagePageOptions {
  messageLimit?: number;
  beforeSeq?: number | null;
  now?: number;
}

const MAX_TITLE_LENGTH = 120;
const MAX_MODEL_LENGTH = 200;
const MAX_USER_CONTENT_LENGTH = 32_000;
const MAX_ASSISTANT_CONTENT_LENGTH = 128_000;
const MAX_METADATA_LENGTH = 32_000;
const MAX_CLIENT_TURN_ID_LENGTH = 128;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGE_SIZE = 200;
const STALE_GENERATION_MS = 5 * 60 * 1000;
const READ_STALE_GENERATION_MS = 30 * 60 * 1000;
const DEFAULT_CONVERSATION_TITLE = 'New chat';

const CONVERSATION_COLUMNS =
  'id, owner_scope, owner_sub, owner_email, title, last_model, version, next_seq, created_at, updated_at';
const MESSAGE_COLUMNS =
  'id, conversation_id, client_turn_id, seq, role, content, status, model, metadata_json, created_at, completed_at';
const SCOPED_MESSAGE_COLUMNS = MESSAGE_COLUMNS.split(', ').map((column) => `m.${column}`).join(', ');

export class ConversationConflictError extends Error {
  constructor(message = 'The conversation changed. Reload it and try again.') {
    super(message);
    this.name = 'ConversationConflictError';
  }
}

export class ConversationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationValidationError';
  }
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConversationValidationError(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new ConversationValidationError(`${field} must be at most ${maxLength} characters.`);
  }
  return normalized;
}

function messageContent(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConversationValidationError('content must be a non-empty string.');
  }
  if (value.length > maxLength) {
    throw new ConversationValidationError(`content must be at most ${maxLength} characters.`);
  }
  return value;
}

function assistantContent(value: unknown, status: Exclude<ConversationMessageStatus, 'generating'>): string {
  if (typeof value !== 'string') throw new ConversationValidationError('content must be a string.');
  if (status === 'complete' && !value.trim()) {
    throw new ConversationValidationError('content must be a non-empty string for a completed response.');
  }
  if (value.length > MAX_ASSISTANT_CONTENT_LENGTH) {
    throw new ConversationValidationError(`content must be at most ${MAX_ASSISTANT_CONTENT_LENGTH} characters.`);
  }
  return value;
}

function clientTurnId(value: unknown): string {
  const id = requiredString(value, 'client_turn_id', MAX_CLIENT_TURN_ID_LENGTH);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    throw new ConversationValidationError('client_turn_id must contain only letters, numbers, underscores, or hyphens.');
  }
  return id;
}

function expectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ConversationValidationError('expected_version must be a non-negative integer.');
  }
  return Number(value);
}

function titleFromFirstMessage(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 80) || DEFAULT_CONVERSATION_TITLE;
}

function publicConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    last_model: row.last_model,
    version: Number(row.version),
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  };
}

function parseMetadata(value: string | null): unknown | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function publicMessage(row: ConversationMessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    client_turn_id: row.client_turn_id,
    seq: Number(row.seq),
    role: row.role,
    content: row.content,
    status: row.status,
    model: row.model,
    metadata: parseMetadata(row.metadata_json),
    created_at: Number(row.created_at),
    completed_at: row.completed_at == null ? null : Number(row.completed_at),
  };
}

function changed(result: D1Result<unknown>): number {
  return Number(result.meta?.changes ?? 0);
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isConstraintError(error: unknown): boolean {
  return /(?:unique|constraint failed)/i.test(asErrorMessage(error));
}

export function isConversationSchemaMissing(error: unknown): boolean {
  const message = asErrorMessage(error);
  return /no such table/i.test(message) && /(?:conversations|conversation_messages)/i.test(message);
}

function encodeCursor(updatedAt: number, id: string): string {
  return btoa(JSON.stringify([updatedAt, id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string): { updatedAt: number; id: string } {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as unknown;
    if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error('invalid shape');
    const [updatedAt, id] = decoded;
    if (!Number.isInteger(updatedAt) || Number(updatedAt) < 0 || typeof id !== 'string' || !id) {
      throw new Error('invalid values');
    }
    return { updatedAt: Number(updatedAt), id };
  } catch {
    throw new ConversationValidationError('cursor is invalid.');
  }
}

async function findConversationRow(
  db: D1Database,
  owner: ConversationOwner,
  id: string,
): Promise<ConversationRow | null> {
  return db
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS}
         FROM conversations
        WHERE id = ? AND owner_scope = ? AND owner_sub = ?
        LIMIT 1`,
    )
    .bind(id, owner.scope, owner.sub)
    .first<ConversationRow>();
}

async function getTurnMessages(
  db: D1Database,
  conversationId: string,
  turnId: string,
): Promise<ConversationMessageRecord[]> {
  const result = await db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
         FROM conversation_messages
        WHERE conversation_id = ? AND client_turn_id = ?
        ORDER BY seq ASC`,
    )
    .bind(conversationId, turnId)
    .all<ConversationMessageRow>();
  return (result.results ?? []).map(publicMessage);
}

function assertIdempotentTurn(
  messages: ConversationMessageRecord[],
  content: string,
  model: string,
): void {
  const existingUser = messages.find((message) => message.role === 'user');
  if (!existingUser || existingUser.content !== content || existingUser.model !== model) {
    throw new ConversationConflictError('client_turn_id was already used with a different request.');
  }
}

export async function createConversation(
  db: D1Database,
  owner: ConversationOwner,
  input: { title?: string; model: string },
  options: CreateOptions = {},
): Promise<ConversationRecord> {
  const title = input.title == null ? DEFAULT_CONVERSATION_TITLE : requiredString(input.title, 'title', MAX_TITLE_LENGTH);
  const model = requiredString(input.model, 'model', MAX_MODEL_LENGTH);
  const id = options.id ?? crypto.randomUUID();
  const now = options.now ?? Date.now();

  await db
    .prepare(
      `INSERT INTO conversations
         (id, owner_scope, owner_sub, owner_email, title, last_model, version, next_seq, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    )
    .bind(id, owner.scope, owner.sub, owner.email, title, model, now, now)
    .run();

  return { id, title, last_model: model, version: 0, created_at: now, updated_at: now };
}

export async function listConversations(
  db: D1Database,
  owner: ConversationOwner,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<ConversationPage> {
  const requestedLimit = options.limit ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE) {
    throw new ConversationValidationError(`limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  }
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const limit = requestedLimit + 1;
  const query = cursor
    ? `SELECT ${CONVERSATION_COLUMNS}
         FROM conversations
        WHERE owner_scope = ? AND owner_sub = ?
          AND (updated_at < ? OR (updated_at = ? AND id < ?))
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`
    : `SELECT ${CONVERSATION_COLUMNS}
         FROM conversations
        WHERE owner_scope = ? AND owner_sub = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`;
  const statement = cursor
    ? db.prepare(query).bind(owner.scope, owner.sub, cursor.updatedAt, cursor.updatedAt, cursor.id, limit)
    : db.prepare(query).bind(owner.scope, owner.sub, limit);
  const result = await statement.all<ConversationRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > requestedLimit;
  const pageRows = rows.slice(0, requestedLimit);
  const last = pageRows[pageRows.length - 1];

  return {
    items: pageRows.map(publicConversation),
    next_cursor: hasMore && last ? encodeCursor(Number(last.updated_at), last.id) : null,
  };
}

export async function getConversation(
  db: D1Database,
  owner: ConversationOwner,
  id: string,
  options: ConversationMessagePageOptions = {},
): Promise<ConversationDetail | null> {
  const row = await findConversationRow(db, owner, id);
  if (!row) return null;
  const requestedLimit = options.messageLimit ?? DEFAULT_MESSAGE_PAGE_SIZE;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_MESSAGE_PAGE_SIZE) {
    throw new ConversationValidationError(`message_limit must be an integer from 1 to ${MAX_MESSAGE_PAGE_SIZE}.`);
  }
  const before = options.beforeSeq;
  if (before != null && (!Number.isInteger(before) || before < 1)) {
    throw new ConversationValidationError('before_seq must be a positive integer.');
  }

  const now = options.now ?? Date.now();
  await db
    .prepare(
      `UPDATE conversation_messages
          SET status = 'interrupted', completed_at = ?
        WHERE conversation_id = ? AND role = 'assistant' AND status = 'generating'
          AND created_at <= ?`,
    )
    // Reading should repair truly orphaned rows without interrupting a long,
    // actively streaming answer. Starting another turn retains the shorter
    // five-minute recovery window above.
    .bind(now, id, now - READ_STALE_GENERATION_MS)
    .run();

  const limit = requestedLimit + 1;
  const statement = before == null
    ? db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
           FROM conversation_messages
          WHERE conversation_id = ?
          ORDER BY seq DESC
          LIMIT ?`,
      )
      .bind(id, limit)
    : db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS}
           FROM conversation_messages
          WHERE conversation_id = ? AND seq < ?
          ORDER BY seq DESC
          LIMIT ?`,
      )
      .bind(id, before, limit);
  const result = await statement.all<ConversationMessageRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > requestedLimit;
  const pageRows = rows.slice(0, requestedLimit).reverse();
  return {
    conversation: publicConversation(row),
    messages: pageRows.map(publicMessage),
    next_before_seq: hasMore && pageRows.length ? Number(pageRows[0].seq) : null,
  };
}

/** Read only the bounded, usable tail needed to construct a model prompt. */
export async function getConversationPromptMessages(
  db: D1Database,
  owner: ConversationOwner,
  id: string,
  limit: number,
): Promise<ConversationMessageRecord[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_MESSAGE_PAGE_SIZE) {
    throw new ConversationValidationError(`prompt message limit must be an integer from 1 to ${MAX_MESSAGE_PAGE_SIZE}.`);
  }
  const result = await db
    .prepare(
      `SELECT ${SCOPED_MESSAGE_COLUMNS}
         FROM conversation_messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE c.id = ? AND c.owner_scope = ? AND c.owner_sub = ?
          AND m.status = 'complete'
          AND (m.role = 'user' OR (m.role = 'assistant' AND length(m.content) > 0))
        ORDER BY m.seq DESC
        LIMIT ?`,
    )
    .bind(id, owner.scope, owner.sub, limit)
    .all<ConversationMessageRow>();
  return (result.results ?? []).reverse().map(publicMessage);
}

export async function renameConversation(
  db: D1Database,
  owner: ConversationOwner,
  id: string,
  value: string,
  expected: number | undefined,
  now = Date.now(),
): Promise<ConversationRecord | null> {
  const title = requiredString(value, 'title', MAX_TITLE_LENGTH);
  const row = await findConversationRow(db, owner, id);
  if (!row) return null;
  if (expected != null && expectedVersion(expected) !== Number(row.version)) throw new ConversationConflictError();

  const result = await db
    .prepare(
      `UPDATE conversations
          SET title = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND owner_scope = ? AND owner_sub = ? AND version = ?`,
    )
    .bind(title, now, id, owner.scope, owner.sub, row.version)
    .run();
  if (changed(result) === 0) throw new ConversationConflictError();
  return { ...publicConversation(row), title, version: Number(row.version) + 1, updated_at: now };
}

export async function deleteConversation(
  db: D1Database,
  owner: ConversationOwner,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM conversations WHERE id = ? AND owner_scope = ? AND owner_sub = ?')
    .bind(id, owner.scope, owner.sub)
    .run();
  return changed(result) > 0;
}

export async function beginConversationTurn(
  db: D1Database,
  owner: ConversationOwner,
  conversationId: string,
  input: BeginConversationTurnInput,
  options: BeginOptions = {},
): Promise<BeginConversationTurnResult | null> {
  const content = messageContent(input.content, MAX_USER_CONTENT_LENGTH);
  const model = requiredString(input.model, 'model', MAX_MODEL_LENGTH);
  const turnId = clientTurnId(input.client_turn_id);
  const expected = expectedVersion(input.expected_version);
  const row = await findConversationRow(db, owner, conversationId);
  if (!row) return null;

  const existing = await getTurnMessages(db, conversationId, turnId);
  if (existing.length) {
    assertIdempotentTurn(existing, content, model);
    return { conversation: publicConversation(row), messages: existing, created: false };
  }
  if (Number(row.version) !== expected) throw new ConversationConflictError();

  const now = options.now ?? Date.now();
  const active = await db
    .prepare(
      `SELECT id, created_at FROM conversation_messages
        WHERE conversation_id = ? AND role = 'assistant' AND status = 'generating'
        LIMIT 1`,
    )
    .bind(conversationId)
    .first<{ id: string; created_at: number }>();
  if (active) {
    if (Number(active.created_at) > now - STALE_GENERATION_MS) {
      throw new ConversationConflictError('A response is already generating for this conversation.');
    }
    const recovered = await db
      .prepare(
        `UPDATE conversation_messages
            SET status = 'interrupted', completed_at = ?
          WHERE id = ? AND status = 'generating' AND created_at <= ?`,
      )
      .bind(now, active.id, now - STALE_GENERATION_MS)
      .run();
    if (changed(recovered) === 0) {
      throw new ConversationConflictError('A response is already generating for this conversation.');
    }
  }

  const userId = options.userMessageId ?? crypto.randomUUID();
  const assistantId = options.assistantMessageId ?? crypto.randomUUID();
  const userSeq = Number(row.next_seq);
  const assistantSeq = userSeq + 1;
  const automaticTitle = titleFromFirstMessage(content);

  try {
    const results = await db.batch([
      db
        .prepare(
          `INSERT INTO conversation_messages
             (id, conversation_id, client_turn_id, seq, role, content, status, model, metadata_json, created_at, completed_at)
           SELECT ?, id, ?, ?, 'user', ?, 'complete', ?, NULL, ?, ?
             FROM conversations
            WHERE id = ? AND owner_scope = ? AND owner_sub = ? AND version = ?`,
        )
        .bind(userId, turnId, userSeq, content, model, now, now, conversationId, owner.scope, owner.sub, expected),
      db
        .prepare(
          `INSERT INTO conversation_messages
             (id, conversation_id, client_turn_id, seq, role, content, status, model, metadata_json, created_at, completed_at)
           SELECT ?, id, ?, ?, 'assistant', '', 'generating', ?, NULL, ?, NULL
             FROM conversations
            WHERE id = ? AND owner_scope = ? AND owner_sub = ? AND version = ?`,
        )
        .bind(assistantId, turnId, assistantSeq, model, now, conversationId, owner.scope, owner.sub, expected),
      db
        .prepare(
          `UPDATE conversations
              SET title = CASE
                    WHEN next_seq = 1 AND title IN ('New chat', 'New conversation') THEN ?
                    ELSE title
                  END,
                  last_model = ?, version = version + 1, next_seq = next_seq + 2, updated_at = ?
            WHERE id = ? AND owner_scope = ? AND owner_sub = ? AND version = ?`,
        )
        .bind(automaticTitle, model, now, conversationId, owner.scope, owner.sub, expected),
    ]);

    if (results.some((result) => changed(result) === 0)) throw new ConversationConflictError();
  } catch (error) {
    const retried = await getTurnMessages(db, conversationId, turnId);
    if (retried.length) {
      assertIdempotentTurn(retried, content, model);
      const refreshed = await findConversationRow(db, owner, conversationId);
      if (!refreshed) return null;
      return { conversation: publicConversation(refreshed), messages: retried, created: false };
    }
    if (error instanceof ConversationConflictError || isConstraintError(error)) throw new ConversationConflictError();
    throw error;
  }

  const title = Number(row.next_seq) === 1 && ['New chat', 'New conversation'].includes(row.title)
    ? automaticTitle
    : row.title;
  const conversation: ConversationRecord = {
    ...publicConversation(row),
    title,
    last_model: model,
    version: Number(row.version) + 1,
    updated_at: now,
  };
  const messages: ConversationMessageRecord[] = [
    {
      id: userId,
      conversation_id: conversationId,
      client_turn_id: turnId,
      seq: userSeq,
      role: 'user',
      content,
      status: 'complete',
      model,
      metadata: null,
      created_at: now,
      completed_at: now,
    },
    {
      id: assistantId,
      conversation_id: conversationId,
      client_turn_id: turnId,
      seq: assistantSeq,
      role: 'assistant',
      content: '',
      status: 'generating',
      model,
      metadata: null,
      created_at: now,
      completed_at: null,
    },
  ];
  return { conversation, messages, created: true };
}

export async function finalizeConversationTurn(
  db: D1Database,
  owner: ConversationOwner,
  conversationId: string,
  rawTurnId: string,
  input: FinalizeConversationTurnInput,
  now = Date.now(),
): Promise<ConversationMessageRecord | null> {
  const turnId = clientTurnId(rawTurnId);
  if (!['complete', 'interrupted', 'error'].includes(input.status)) {
    throw new ConversationValidationError('status must be complete, interrupted, or error.');
  }
  const content = assistantContent(input.content, input.status);
  const model = requiredString(input.model, 'model', MAX_MODEL_LENGTH);
  const lastModel = requiredString(input.lastModel ?? input.model, 'lastModel', MAX_MODEL_LENGTH);
  const ownerRow = await findConversationRow(db, owner, conversationId);
  if (!ownerRow) return null;
  const existing = (await getTurnMessages(db, conversationId, turnId)).find((message) => message.role === 'assistant');
  if (!existing) return null;
  if (existing.status !== 'generating') return existing;

  let metadataJson: string | null = null;
  if (input.metadata != null) {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input.metadata);
    } catch {
      throw new ConversationValidationError('metadata must be JSON-serializable.');
    }
    if (typeof serialized !== 'string') {
      throw new ConversationValidationError('metadata must be JSON-serializable.');
    }
    metadataJson = serialized;
    if (metadataJson.length > MAX_METADATA_LENGTH) {
      throw new ConversationValidationError(`metadata must be at most ${MAX_METADATA_LENGTH} characters.`);
    }
  }

  const [messageResult] = await db.batch([
    db
      .prepare(
        `UPDATE conversation_messages
            SET content = ?, status = ?, model = ?, metadata_json = ?, completed_at = ?
          WHERE id = ? AND conversation_id = ? AND client_turn_id = ?
            AND role = 'assistant' AND status = 'generating'`,
      )
      .bind(content, input.status, model, metadataJson, now, existing.id, conversationId, turnId),
    db
      .prepare(
        `UPDATE conversations
            SET last_model = ?, updated_at = ?
          WHERE id = ? AND owner_scope = ? AND owner_sub = ?
            AND EXISTS (
              SELECT 1 FROM conversation_messages
               WHERE id = ? AND conversation_id = ? AND client_turn_id = ?
                 AND role = 'assistant' AND status = ? AND content = ? AND model = ? AND completed_at = ?
            )`,
      )
      .bind(
        lastModel,
        now,
        conversationId,
        owner.scope,
        owner.sub,
        existing.id,
        conversationId,
        turnId,
        input.status,
        content,
        model,
        now,
      ),
  ]);

  if (changed(messageResult) === 0) {
    return (await getTurnMessages(db, conversationId, turnId)).find((message) => message.role === 'assistant') ?? null;
  }
  return {
    ...existing,
    content,
    status: input.status,
    model,
    metadata: input.metadata ?? null,
    completed_at: now,
  };
}
