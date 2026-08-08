import type { ApiKeyRow, Env, Usage } from '../types';

const KEY_PREFIX = 'sk-cfai-';
const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createPlaintextKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${KEY_PREFIX}${bytesToHex(bytes)}`;
}

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  return bytesToHex(new Uint8Array(digest));
}

export function extractBearer(request: Request): string | null {
  const value = request.headers.get('authorization')?.trim();
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1].trim() || null;
}

export async function createKey(
  env: Env,
  ownerEmail: string,
  name: string,
): Promise<{ id: string; name: string; key_prefix: string; created_at: number; plaintext: string }> {
  const plaintext = createPlaintextKey();
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const safeName = name.trim().slice(0, 64) || 'Untitled key';

  await env.DB.prepare(
    `INSERT INTO api_keys (id, name, key_hash, key_prefix, owner_email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, safeName, await hashKey(plaintext), plaintext.slice(0, 16), ownerEmail.toLowerCase(), createdAt)
    .run();

  return { id, name: safeName, key_prefix: plaintext.slice(0, 16), created_at: createdAt, plaintext };
}

export async function authenticateKey(env: Env, plaintext: string): Promise<ApiKeyRow | null> {
  if (!plaintext.startsWith(KEY_PREFIX)) return null;
  const keyHash = await hashKey(plaintext);
  return env.DB.prepare(
    `SELECT id, name, key_hash, key_prefix, owner_email, created_at,
            last_used_at, revoked_at, request_count, total_tokens
       FROM api_keys
      WHERE key_hash = ? AND revoked_at IS NULL
      LIMIT 1`,
  )
    .bind(keyHash)
    .first<ApiKeyRow>();
}

export async function listKeys(env: Env, ownerEmail: string): Promise<ApiKeyRow[]> {
  const result = await env.DB.prepare(
    `SELECT id, name, key_hash, key_prefix, owner_email, created_at,
            last_used_at, revoked_at, request_count, total_tokens
       FROM api_keys
      WHERE owner_email = ?
      ORDER BY created_at DESC`,
  )
    .bind(ownerEmail.toLowerCase())
    .all<ApiKeyRow>();
  return result.results ?? [];
}

export async function revokeKey(env: Env, ownerEmail: string, id: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE api_keys SET revoked_at = ?
      WHERE id = ? AND owner_email = ? AND revoked_at IS NULL`,
  )
    .bind(Date.now(), id, ownerEmail.toLowerCase())
    .run();
  return result.meta.changes > 0;
}

export async function deleteKey(env: Env, ownerEmail: string, id: string): Promise<boolean> {
  const result = await env.DB.prepare(`DELETE FROM api_keys WHERE id = ? AND owner_email = ?`)
    .bind(id, ownerEmail.toLowerCase())
    .run();
  return result.meta.changes > 0;
}

export async function recordUsage(env: Env, keyId: string, model: string, usage: Usage): Promise<void> {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE api_keys
          SET last_used_at = ?,
              request_count = request_count + 1,
              total_tokens = total_tokens + ?
        WHERE id = ?`,
    ).bind(now, usage.total_tokens, keyId),
    env.DB.prepare(
      `INSERT INTO usage_daily (day, key_id, model, requests, prompt_tokens, completion_tokens)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(day, key_id, model) DO UPDATE SET
         requests = requests + 1,
         prompt_tokens = prompt_tokens + excluded.prompt_tokens,
         completion_tokens = completion_tokens + excluded.completion_tokens`,
    ).bind(day, keyId, model, usage.prompt_tokens, usage.completion_tokens),
  ]);
}
