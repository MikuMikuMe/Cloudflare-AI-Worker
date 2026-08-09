# Cloudflare AI Worker

A Cloudflare-hosted chat app and OpenAI-compatible API. The Cloudflare Access-authenticated dashboard stores conversations in D1 so users can resume chats on another device, while `/v1/chat/completions` remains stateless.

- Production: [ai.lofuyu.com](https://ai.lofuyu.com/)
- Dashboard: [ai.lofuyu.com/admin](https://ai.lofuyu.com/admin)
- Health: [ai.lofuyu.com/health](https://ai.lofuyu.com/health)
- Current release: `2.4.0`

## Product surfaces

| Surface | Authentication | State |
| --- | --- | --- |
| `GET /health` | Public | Live configuration and health summary |
| `GET /v1/models` | Public | Current Workers AI and optional NVIDIA model catalog |
| `POST /v1/chat/completions` | API key or Cloudflare Access session | Stateless; buffered and SSE responses |
| `POST /v1/embeddings` | API key or Cloudflare Access session | Stateless |
| `/admin` | Cloudflare Access | Dashboard for Chats, API keys, and usage |
| `/admin/api/*` | Cloudflare Access; same-origin only | D1-backed dashboard data, including conversations |

The dashboard includes cross-device Chats, paginated transcripts, rename and delete controls, deep links, rich Markdown, compact linked citations and source cards, and recovery of interrupted generations. Users can also create and revoke OpenAI-style API keys. Full plaintext keys are never stored; D1 keeps a SHA-256 hash and a short display prefix.

## Persistent chats, privacy, and current limits

Dashboard Chats are scoped to the verified Cloudflare Access identity pair `(aud, sub)`, not an account or email address. The email is retained only as a display and audit snapshot. A user sees the same history after signing into the same Access application with the same identity on another device; changing the Access audience or identity subject creates a different history namespace.

D1 is the canonical store for conversation titles, selected models, ordered messages, completion states, and bounded source metadata. The Worker rebuilds model context from D1 instead of trusting browser-supplied history. Committed messages reload on page load and when the tab regains focus, and partial output is saved as interrupted if a stream disconnects.

Current limits:

- `/v1/chat/completions` is stateless. Persistence exists only for dashboard Chats under `/admin/api/conversations/*`.
- The current release does not live-mirror an in-progress stream between devices. Another device sees it after the turn is committed and refreshed.
- Long-term personal memory is not implemented. Chat history is an exact user-visible record, not an automatically derived profile.
- Chats remain until the user deletes them. Deleting a conversation cascades to its messages; there is no automatic retention policy today.
- System-managed Access JWTs, provider credentials, fetched page bodies, tool payloads, and upstream error details are not automatically stored as conversation data. User messages are stored verbatim, so never paste secrets into Chats.

The design, future memory boundary, and supporting research are documented in [Persistent chat and memory architecture](docs/persistent-chat-architecture.md).

## Current Cloudflare footprint

The deployment uses one Worker with:

- Workers AI for Cloudflare-hosted inference
- D1 for API-key hashes, usage counters, conversations, messages, and the NVIDIA model index
- Cloudflare Access for dashboard SSO and identity verification
- Cloudflare AI Search for opt-in indexed search over `ai.lofuyu.com`
- Cloudflare Web Search as a managed live-search option
- One daily cron trigger to refresh the optional NVIDIA free-endpoint catalog

It does not currently add AI Gateway, Queues, Durable Objects, Vectorize, or R2. Cloudflare bindings and external providers still have their own quotas, limits, and possible costs; review [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) and each provider's terms before changing traffic or configuration.

## Local development

Use Node.js 22 and npm.

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Local development can call Workers AI and the bindings marked `remote`, including Web Search and AI Search, so it can consume real account or provider quota. Put local-only secrets in `.dev.vars`, which is gitignored, and never commit credentials.

Run the same core checks used by CI:

```sh
npm run typecheck
npm test
npm audit --package-lock-only --audit-level=high
```

## Configuration

`wrangler.jsonc` targets the existing production deployment. It contains deployment-specific Worker, account, D1, Access, AI Search, and custom-domain identifiers. Replace those values before using this repository for another account or environment.

### Bindings

| Binding | Type | Purpose |
| --- | --- | --- |
| `AI` | Workers AI | Chat and embedding inference |
| `DB` | D1 database | Keys, usage, persistent Chats, and NVIDIA catalog |
| `AI_SEARCH` | AI Search instance | Indexed `site_search` over `ai.lofuyu.com` |
| `WEBSEARCH` | Web Search | Managed public-web discovery |

### Variables

| Variable | Purpose |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain used to validate JWTs |
| `ACCESS_AUD` | Access application audience; also part of the chat-history namespace |
| `CLOUDFLARE_ACCOUNT_ID` | Account queried for Workers AI usage; required with the usage token |
| `DEFAULT_MODEL` | Fallback model for unknown or OpenAI-style model names |
| `WEB_SEARCH_MODEL` | Compatibility fallback for helper calls without a selected model |

The Worker verifies the `Cf-Access-Jwt-Assertion` signature and audience against Cloudflare Access. If the team domain or audience is missing, `/admin` fails closed with setup instructions.

### Secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `TAVILY_API_KEY` | Optional | Preferred live public-web search provider |
| `SEARXNG_URL` | Optional | Approved SearXNG-compatible JSON endpoint; stored as a secret in production |
| `SEARXNG_API_KEY` | Optional | Credential for a protected SearXNG endpoint |
| `CLOUDFLARE_USAGE_API_TOKEN` | Optional | Read-only Workers AI analytics query |
| `NVIDIA_NIM_API_KEY` | Optional | NVIDIA NIM chat and model-catalog access |

Set production secrets through Wrangler's prompt so values do not appear in source control or shell history:

```sh
npx wrangler secret put TAVILY_API_KEY
npx wrangler secret put SEARXNG_URL
npx wrangler secret put SEARXNG_API_KEY
npx wrangler secret put CLOUDFLARE_USAGE_API_TOKEN
npx wrangler secret put NVIDIA_NIM_API_KEY
```

Only configure the secrets for providers you intend to use. The usage token needs account-level `Account Analytics: Read` permission; it does not need Billing access. Keep it narrowly scoped and pair it with `CLOUDFLARE_ACCOUNT_ID`.

## OpenAI SDK quickstart

Create an API key in the authenticated dashboard and provide it through your environment:

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.CFAI_API_KEY,
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

To run the repository's end-to-end OpenAI SDK check without typing a key into command history:

```sh
export BASE_URL=https://ai.lofuyu.com/v1
read -s API_KEY
export API_KEY
npm run test:openai
unset API_KEY
```

## Search behavior

Live web search is model-controlled. When a provider is configured, the selected chat model receives the Worker's read-only `web_search` and `web_fetch` tools and can answer directly or call them. Client-defined tool schemas are accepted for OpenAI-compatible tool calling, but the Worker executes only its two server-owned web tools.

Provider precedence is deliberate:

1. When `TAVILY_API_KEY` is configured, Tavily is the exclusive live-search provider. Tavily failures are returned to the caller and do not fall through to another provider.
2. Without Tavily, the Worker tries the `WEBSEARCH` binding. If that call fails and `SEARXNG_URL` is configured, it falls back to SearXNG.
3. Without Tavily or `WEBSEARCH`, an approved `SEARXNG_URL` is used directly.

The selected chat model is also the tool-using model; there is no hidden planner model. If the model or runtime rejects the optional server tool schema, the Worker retries without those tools and does not force a search. A direct answer has no `web_search` block. When search is performed, buffered responses include provider, query, and source metadata; streaming responses receive the same data in an additional empty-choice SSE chunk.

Request controls:

- `web_search_options.max_num_results`: integer from 1 to 50
- `web_search_options.max_fetch_chars`: integer from 2,000 to 40,000
- `site_search: true` or `web_search_options.scope: "site"`: use the configured `AI_SEARCH` site index instead of live public-web tools
- The legacy `web_search` field is accepted for compatibility but does not force search on or off; tool choice belongs to the model

Indexed `site_search` is available only with Cloudflare models. NVIDIA models return a clear validation error for that option but can use the live web tools.

## Usage and optional NVIDIA models

The Usage tab shows two different views:

- D1 counters for requests made with this gateway's API keys
- Account-level Workers AI Neurons read from Cloudflare's GraphQL analytics API

The Cloudflare credential stays server-side. If the account ID or analytics token is not configured, or analytics is temporarily unavailable, quota enforcement fails open: Cloudflare models remain usable instead of being disabled on missing data. The dashboard reports the configuration or upstream problem rather than presenting it as zero usage.

When analytics confirms that the Worker's current 10,000-Neuron daily threshold is exhausted, Cloudflare models are marked `disabled` in `/v1/models` and requests for them return `429` with `code: "cloudflare_neurons_exhausted"`.

With `NVIDIA_NIM_API_KEY` configured, the Worker refreshes NVIDIA's callable free-endpoint catalog daily and exposes matching entries from `/v1/models` with `provider: "nvidia"` and `free_endpoint: true`. NVIDIA is a user-selected alternative, not automatic model failover. Its credentials stay server-side, and its own availability, quota, and terms still apply.

## Testing and CI

GitHub Actions uses Node.js 22. For code changes it runs:

1. `npm ci --no-audit --no-fund`
2. TypeScript typechecking
3. The current 62-test suite
4. A lockfile dependency audit that fails on high or critical advisories

Markdown- and `LICENSE`-only pushes and pull requests are intentionally skipped by the GitHub workflow. Cloudflare Workers Builds is the default production deployment path and deploys pushes merged to `main` with `npx wrangler deploy`.

## Deployment and D1 migrations

> **Production warning:** this repository has no staging environment. Remote migration and deploy commands target the production Worker and D1 database.

Wrangler records applied D1 migrations and applies remaining files in order. Before any schema-dependent deployment, list and apply every pending remote migration. See Cloudflare's [D1 migration reference](https://developers.cloudflare.com/d1/reference/migrations/).

The default release flow is:

```sh
npm ci
npm run typecheck
npm test
npm audit --package-lock-only --audit-level=high
npx wrangler d1 migrations list cfai-db --remote
npm run db:migrate
npx wrangler deploy --dry-run
```

Then merge to `main`; [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) performs the production deployment. Migrations `0001` through `0003` are already applied in the current production database, but the pending-migration check remains required for future schema changes.

Two intentional alternatives exist:

- **Manual GitHub deployment:** dispatch the workflow with `deploy_with_wrangler`. This requires a `CLOUDFLARE_API_TOKEN` repository secret with permission to deploy the Worker and apply D1 migrations. The job migrates before deploying.
- **Direct Wrangler deployment:** run `npm run deploy` only as an explicit bypass or recovery path after the same verification and migration preflight.

The workflow's `skip_migrations` input is for emergencies only. Use it only after confirming there are no pending migrations; deploying schema-dependent code against an old schema can make dashboard operations fail.

## Architecture and license

- [Persistent chat and memory architecture](docs/persistent-chat-architecture.md)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)

Licensed under the [MIT License](LICENSE).
