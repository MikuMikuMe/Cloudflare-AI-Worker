/**
 * Cloudflare AI Worker — an OpenAI-compatible gateway over Workers AI.
 *
 * Routing map
 *   /                       public landing page + docs
 *   /health                 liveness probe
 *   /v1/models              OpenAI: list models
 *   /v1/chat/completions    OpenAI: chat, buffered or SSE-streamed
 *   /v1/embeddings          OpenAI: embeddings
 *   /admin                  dashboard, behind Cloudflare Access
 *   /admin/api/*            dashboard JSON API, behind Cloudflare Access
 *
 * Auth model
 *   - /v1/*     requires an API key you minted, or a live Access session
 *   - /admin/*  requires a Cloudflare Access session, verified locally
 *
 * The legacy /api/chat endpoint is kept as a redirect-style shim so anything
 * pointed at the old Worker gets a clear migration message instead of a 404.
 */

import { isAccessConfigured, verifyAccessJwt } from './lib/access';
import { API_CORS, apiError, html, json } from './lib/http';
import { handleAdminApi } from './routes/admin';
import { refreshNvidiaModelIndex } from './lib/nvidia';
import { handleChatCompletions, handleEmbeddings, handleModels } from './routes/v1';
import { dashboardPage } from './ui/dashboard';
import { landingPage } from './ui/landing';
import { setupPage } from './ui/setup';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // CORS preflight is intentionally limited to the public API surface.
    // The cookie-authenticated dashboard APIs are same-origin only.
    if (method === 'OPTIONS') {
      if (path.startsWith('/v1/')) return new Response(null, { status: 204, headers: API_CORS });
      return new Response(null, { status: 405, headers: { allow: 'GET, POST, PATCH, DELETE' } });
    }

    // ---- health ----------------------------------------------------------
    if (path === '/health' || path === '/api/health') {
      return json(
        {
          status: 'ok',
          service: 'cloudflare-ai-worker',
          version: '2.4.0',
          access_configured: isAccessConfigured(env),
          default_model: env.DEFAULT_MODEL,
          web_search_configured: Boolean(env.TAVILY_API_KEY?.trim() || env.WEBSEARCH || env.SEARXNG_URL),
          web_search_provider: env.TAVILY_API_KEY?.trim()
            ? 'tavily'
            : env.WEBSEARCH
              ? env.SEARXNG_URL
                ? 'cloudflare (SearXNG fallback)'
                : 'cloudflare'
              : env.SEARXNG_URL
                ? 'searxng'
                : null,
          tavily_configured: Boolean(env.TAVILY_API_KEY?.trim()),
          site_search_configured: Boolean(env.AI_SEARCH),
          nvidia_nim_configured: Boolean(env.NVIDIA_NIM_API_KEY),
        },
        200,
        API_CORS,
      );
    }

    // ---- OpenAI-compatible API -------------------------------------------
    if (path === '/v1/models' && method === 'GET') {
      return handleModels(env);
    }

    if (path === '/v1/chat/completions') {
      if (method !== 'POST') return apiError('Use POST for this endpoint.', 405, 'invalid_request_error');
      return handleChatCompletions(request, env, ctx);
    }

    if (path === '/v1/embeddings') {
      if (method !== 'POST') return apiError('Use POST for this endpoint.', 405, 'invalid_request_error');
      return handleEmbeddings(request, env, ctx);
    }

    if (path.startsWith('/v1/')) {
      return apiError(
        `Unknown endpoint ${path}. This gateway implements /v1/models, /v1/chat/completions and /v1/embeddings.`,
        404,
        'not_found_error',
      );
    }

    // ---- legacy shim -----------------------------------------------------
    if (path === '/api/chat') {
      return apiError(
        'This endpoint has moved. Use POST /v1/chat/completions with an "Authorization: Bearer sk-cfai-..." header — it now speaks the OpenAI API format.',
        410,
        'invalid_request_error',
        'endpoint_moved',
      );
    }

    // ---- dashboard -------------------------------------------------------
    if (path.startsWith('/admin/api/')) {
      return handleAdminApi(request, env, path, ctx);
    }

    if (path === '/admin') {
      if (!isAccessConfigured(env)) {
        return html(setupPage(url.host), 503);
      }
      const identity = await verifyAccessJwt(request, env);
      if (!identity) {
        // Access should have intercepted this. Reaching here means the request
        // arrived on a hostname the Access app does not cover (e.g. workers.dev).
        return html(
          `<!DOCTYPE html><meta charset="utf-8"><title>Sign in required</title>
           <body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0b0d12;color:#e6e9ef;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
           <div><h1 style="font-size:20px;margin-bottom:10px">Sign-in required</h1>
           <p style="color:#8b93a7;font-size:14px;max-width:44ch;line-height:1.6">
           This hostname isn't covered by the Cloudflare Access application. Open the dashboard on the protected custom domain to sign in.</p></div></body>`,
          401,
        );
      }
      return html(dashboardPage(identity.email, env.ACCESS_TEAM_DOMAIN), 200, { 'cache-control': 'no-store' });
    }

    // ---- landing ---------------------------------------------------------
    if (path === '/') {
      return html(landingPage(url.origin));
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshNvidiaModelIndex(env).then(() => undefined).catch(() => undefined));
  },
} satisfies ExportedHandler<Env>;
