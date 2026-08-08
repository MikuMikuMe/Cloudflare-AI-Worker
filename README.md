# Cloudflare AI Worker

An OpenAI-compatible gateway backed by the existing Cloudflare Workers AI and D1 bindings.

## What it provides

- `GET /v1/models`
- `POST /v1/chat/completions`, including Server-Sent Events streaming with `stream: true`
- `POST /v1/embeddings`
- OpenAI-style API keys created and revoked from the authenticated dashboard
- Cloudflare Access SSO for `/admin`; an API key is not needed to sign in or use the dashboard playground
- SHA-256 key hashes and lightweight daily usage counters in the existing `cfai-db` D1 database

The Worker calls the existing Workers AI binding directly. It does not add an AI Gateway, Queue, Durable Object, Vectorize index, or another paid service. The official `openai` JavaScript SDK is used by `scripts/verify-openai-sdk.mjs` to test the public compatibility surface.

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
