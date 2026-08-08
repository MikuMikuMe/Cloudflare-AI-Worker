/**
 * Dashboard API. Every route here requires a verified Cloudflare Access
 * session — there is no API-key path in, by design.
 */

import { isAccessConfigured, verifyAccessJwt } from '../lib/access';
import { json } from '../lib/http';
import { createKey, deleteKey, listKeys, revokeKey } from '../lib/keys';
import { handleChatCompletions } from './v1';
import type { AccessIdentity, Env } from '../types';

const NO_STORE = { 'cache-control': 'no-store' };

export async function requireIdentity(
  request: Request,
  env: Env,
): Promise<{ ok: true; identity: AccessIdentity } | { ok: false; response: Response }> {
  if (!isAccessConfigured(env)) {
    return {
      ok: false,
      response: json(
        {
          error: 'access_not_configured',
          message:
            'Cloudflare Access is not wired up yet. Set the ACCESS_TEAM_DOMAIN and ACCESS_AUD vars, then redeploy.',
        },
        503,
        NO_STORE,
      ),
    };
  }

  const identity = await verifyAccessJwt(request, env);
  if (!identity) {
    return {
      ok: false,
      response: json(
        { error: 'unauthorized', message: 'No valid Cloudflare Access session. Sign in again.' },
        401,
        NO_STORE,
      ),
    };
  }

  return { ok: true, identity };
}

export async function handleAdminApi(
  request: Request,
  env: Env,
  path: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const auth = await requireIdentity(request, env);
  if (!auth.ok) return auth.response;

  const { identity } = auth;
  const method = request.method.toUpperCase();

  // The browser playground is intentionally authenticated by the Access
  // session, not by an API key. External callers still use /v1/* with keys.
  if (path === '/admin/api/chat/completions' && method === 'POST') {
    return handleChatCompletions(request, env, ctx, true);
  }

  if (path === '/admin/api/me' && method === 'GET') {
    return json({ email: identity.email, sub: identity.sub }, 200, NO_STORE);
  }

  if (path === '/admin/api/keys' && method === 'GET') {
    const rows = await listKeys(env, identity.email);
    return json(
      {
        keys: rows.map((r) => ({
          id: r.id,
          name: r.name,
          key_prefix: r.key_prefix,
          created_at: r.created_at,
          last_used_at: r.last_used_at,
          revoked_at: r.revoked_at,
          request_count: r.request_count,
          total_tokens: r.total_tokens,
        })),
      },
      200,
      NO_STORE,
    );
  }

  if (path === '/admin/api/keys' && method === 'POST') {
    let name = 'Untitled key';
    try {
      const body = (await request.json()) as { name?: unknown };
      if (typeof body?.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, 64);
    } catch {
      // Body is optional; fall back to the default name.
    }

    const existing = await listKeys(env, identity.email);
    if (existing.filter((k) => !k.revoked_at).length >= 25) {
      return json(
        { error: 'limit_reached', message: 'You already have 25 active keys. Revoke one first.' },
        400,
        NO_STORE,
      );
    }

    const created = await createKey(env, identity.email, name);
    // `key` is the only time the plaintext ever leaves the Worker.
    return json({ ...created, key: created.plaintext, plaintext: undefined }, 201, NO_STORE);
  }

  const keyMatch = /^\/admin\/api\/keys\/([A-Za-z0-9-]+)$/.exec(path);
  if (keyMatch) {
    const id = keyMatch[1];

    if (method === 'DELETE') {
      const url = new URL(request.url);
      const hard = url.searchParams.get('hard') === 'true';
      const done = hard ? await deleteKey(env, identity.email, id) : await revokeKey(env, identity.email, id);
      if (!done) return json({ error: 'not_found', message: 'No such key.' }, 404, NO_STORE);
      return json({ ok: true, id, mode: hard ? 'deleted' : 'revoked' }, 200, NO_STORE);
    }

    return json({ error: 'method_not_allowed' }, 405, NO_STORE);
  }

  if (path === '/admin/api/usage' && method === 'GET') {
    const since = new Date(Date.now() - 29 * 86400_000).toISOString().slice(0, 10);

    const daily = await env.DB.prepare(
      `SELECT d.day,
              SUM(d.requests)          AS requests,
              SUM(d.prompt_tokens)     AS prompt_tokens,
              SUM(d.completion_tokens) AS completion_tokens
         FROM usage_daily d
         JOIN api_keys k ON k.id = d.key_id
        WHERE k.owner_email = ? AND d.day >= ?
        GROUP BY d.day
        ORDER BY d.day ASC`,
    )
      .bind(identity.email, since)
      .all();

    const byModel = await env.DB.prepare(
      `SELECT d.model,
              SUM(d.requests)                              AS requests,
              SUM(d.prompt_tokens + d.completion_tokens)   AS tokens
         FROM usage_daily d
         JOIN api_keys k ON k.id = d.key_id
        WHERE k.owner_email = ? AND d.day >= ?
        GROUP BY d.model
        ORDER BY requests DESC`,
    )
      .bind(identity.email, since)
      .all();

    const totals = await env.DB.prepare(
      `SELECT COALESCE(SUM(request_count), 0) AS requests,
              COALESCE(SUM(total_tokens), 0)  AS tokens,
              COUNT(*)                        AS keys
         FROM api_keys
        WHERE owner_email = ?`,
    )
      .bind(identity.email)
      .first<{ requests: number; tokens: number; keys: number }>();

    return json(
      { daily: daily.results ?? [], by_model: byModel.results ?? [], totals: totals ?? {} },
      200,
      NO_STORE,
    );
  }

  return json({ error: 'not_found' }, 404, NO_STORE);
}
