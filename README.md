# Cloudflare AI Worker

An OpenAI-compatible gateway backed by the existing Cloudflare Workers AI and D1 bindings.

## What it provides

- `GET /v1/models`
- `POST /v1/chat/completions`, including Server-Sent Events streaming with `stream: true`
- Optional per-request live web search with `web_search: true` through Cloudflare Web Search, with an optional SearXNG-compatible fallback
- Optional per-request search over the indexed `ai.lofuyu.com` website with `site_search: true`
- `POST /v1/embeddings`
- OpenAI-style API keys created and revoked from the authenticated dashboard
- Cloudflare Access SSO for `/admin`; an API key is not needed to sign in or use the dashboard playground
- SHA-256 key hashes and lightweight daily usage counters in the existing `cfai-db` D1 database
- A Usage tab with a live account-level Workers AI Neurons metric from Cloudflare's account usage API

The Worker calls the existing Workers AI binding directly. It does not add an AI Gateway, Queue, Durable Object, Vectorize index, or another paid service. The official `openai` JavaScript SDK is used by `scripts/verify-openai-sdk.mjs` to test the public compatibility surface.

## Opt-in live search

`web_search: true` runs a server-owned tool loop:

1. An existing Workers AI function-calling model requests `web_search` and, when needed, `web_fetch`.
2. The Worker uses the managed Cloudflare Web Search binding when available, or the explicitly configured SearXNG-compatible fallback, then fetches selected public pages.
3. The requested chat model receives the tool results and streams the final answer.

The managed binding is zero-setup and discovery-only: it returns public URLs and catalog metadata, while the Worker fetches page content itself. It does not create an AI Search instance, container, database, or other service. This account currently returns `account_disabled` when the experimental Cloudflare Web Search API is queried, so the deployed code reports a clear provider error until Cloudflare enables it. The Worker never accepts client-defined executable functions; it only executes the two read-only web tools. Search source URLs are returned in a `web_search.sources` extension field/chunk.

```sh
# Optional fallback only; this does not create a Cloudflare service.
npx wrangler secret put SEARXNG_API_KEY   # only if your endpoint requires one
# Set SEARXNG_URL as a Worker variable through your approved deployment path.
```

Example request:

```json
{
  "model": "@cf/meta/llama-3.1-8b-instruct-fp8",
  "messages": [{ "role": "user", "content": "What changed in web standards this week?" }],
  "web_search": true,
  "stream": true
}
```

Use `site_search: true` (or `web_search_options: { "scope": "site" }`) to use the existing `lofuyu-web-search` AI Search crawler over `ai.lofuyu.com`. That crawler is a site index, not unrestricted internet search.

`web_search_options.max_num_results` accepts 1-50 (Cloudflare Web Search returns at most 20; the fallback returns at most 10), and `max_fetch_chars` accepts 2,000-40,000.

The default `WEB_SEARCH_MODEL` is the existing `@cf/openai/gpt-oss-20b`, which Cloudflare lists as supporting function calling. Web-search requests therefore use one additional Workers AI planning inference before the requested model's final inference; normal requests are unchanged.

## Live Workers AI usage

The Usage tab keeps the existing D1 counters for requests made with this gateway's API keys, and separately reads the account-level Workers AI Neurons metric from Cloudflare. The browser never receives the Cloudflare credential.

Cloudflare's account usage endpoint currently requires a token with account-level `Billing: Read` permission. Add it as a Worker secret (never commit it and never paste it into the frontend):

```sh
npx wrangler secret put CLOUDFLARE_USAGE_API_TOKEN
```

This only enables a read-only API request to an existing Cloudflare account metric. It does not create AI Gateway, Analytics Engine, Queues, or any other paid service. Until the secret is configured, the Usage tab intentionally shows `Setup required` rather than an incorrect `0`.

## Local checks

```sh
npm ci
npm run typecheck
```

To run the end-to-end SDK check, first create a key in `/admin` and pass it without committing it:

```sh
BASE_URL=https://ai.lofuyu.com/v1 API_KEY=sk-cfai-... npm run test:openai
```

## Authentication

The existing Zero Trust application protects the dashboard. Its Access JWT values are configured as non-secret Worker vars:

- `ACCESS_TEAM_DOMAIN`
- `ACCESS_AUD`

The Worker still verifies the `Cf-Access-Jwt-Assertion` signature against the Access certificate endpoint. API clients use keys in the normal OpenAI form:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-cfai-...",
  baseURL: "https://ai.lofuyu.com/v1",
});

const stream = await client.chat.completions.create({
  model: "@cf/meta/llama-3.1-8b-instruct-fp8",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

## Deployment / CI/CD

Cloudflare Workers Git integration is already connected to `MikuMikuMe/Cloudflare-AI-Worker` and is the default CD path: pushes to `main` are built with `npx wrangler deploy`. The repository also contains a GitHub Actions workflow that always runs `npm ci` and `npm run typecheck`.

The workflow has an optional Wrangler deployment job that runs only when `deploy_with_wrangler` is explicitly enabled in a manual workflow dispatch. Normal pushes do not require a Cloudflare token. If you choose GitHub-owned deployment instead of the already-connected Cloudflare Git integration, create a narrowly scoped Cloudflare API token with permission to deploy this Worker and add it as the `CLOUDFLARE_API_TOKEN` repository secret. Never commit the token or put it in the frontend.

D1 migrations are idempotent and the existing `cfai-db` database already contains migration `0001_init.sql`.
