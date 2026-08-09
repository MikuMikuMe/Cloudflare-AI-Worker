# Persistent chat and memory architecture

The authenticated dashboard uses Cloudflare D1 as the canonical store for account-scoped conversations. A user who signs into the protected domain with the same Cloudflare Access identity can reload a conversation on another device without relying on browser storage.

## Current release: durable chat history

- Identity is the verified Access `(aud, sub)` pair. Email is only a display/audit snapshot.
- D1 stores conversation titles, selected models, ordered user/assistant messages, completion status, and bounded source metadata.
- The browser sends only the new message, model, expected conversation version, and an idempotency key. The Worker rebuilds model context from D1; browser-supplied history is never authoritative.
- Transcript reads are keyset-paginated and the model prompt is selected with a bounded SQL tail before applying the character budget, so long histories do not become unbounded Worker reads.
- A turn is created before inference and finalized once after inference. Tokens are not written individually.
- Provider adapters require a real terminal sentinel, propagate cancellation upstream, and the dashboard SSE `[DONE]` marker is withheld until the assistant message and conversation summary are atomically committed, so truncated or unsaved answers cannot appear complete.
- Client disconnects save partial output as interrupted; model failures save an error state; five-minute stale generations are recovered on the next turn.
- Conversation lists use keyset pagination. Renames and sends use optimistic versions, and duplicate turn retries are payload-bound.
- Deletes physically cascade to messages. Raw JWTs, API keys, fetched page bodies, tool payloads, and upstream error details are not stored.

The public OpenAI-compatible `/v1/chat/completions` and Anthropic-compatible `/v1/messages` APIs remain stateless. Persistence exists only on the Access-authenticated `/admin/api/conversations/*` surface.

## Why D1 first

D1 already exists in this deployment and is a good canonical relational store for cross-device history. The MVP does not need a Durable Object simply to reload completed conversations. The UI refreshes on page load and when the tab regains focus.

A Durable Object becomes useful when the product must coordinate multiple devices watching the same in-progress response. At that point, use one object per conversation for ordering and WebSocket fan-out while continuing to commit canonical events to D1. Clients must reconnect and resume from a D1 event cursor because Durable Object memory resets and deployments can disconnect sockets.

If D1 read replication is enabled later, start a new device session with `first-primary` and carry D1 session bookmarks for read-your-writes behavior; replicas may otherwise be stale.

## Keep history and memory separate

Chat history is an exact user-visible record. Long-term memory is a derived, compact set of preferences or facts selected for future prompts. They need different controls and retention rules.

A later memory release should add:

1. D1 `memories` and `memory_sources` tables with versions, status, provenance message IDs, and user-edit/delete controls.
2. A transactional D1 outbox and Cloudflare Queue for idempotent post-commit extraction, summarization, and deletion cleanup.
3. Vectorize only as a derived retrieval index, filtered by indexed `user_id` and hydrated from D1. Recent D1 memories must be considered directly because vector writes become query-visible asynchronously.
4. Clear UI disclosures showing which past chat or memory influenced an answer, plus independent history, memory, and retention settings.
5. R2 for future large attachments, with ownership and retention metadata remaining in D1.

Do not silently make every chat message permanent personal memory, and do not use Vectorize as the source of truth.

## Product and research basis

- [ChatGPT Memories](https://learn.chatgpt.com/docs/customization/memories) separates saved memory from chat history and provides user controls.
- [Gemini recent chats](https://support.google.com/gemini/answer/13666746?hl=en&co=GENIE.Platform%3DDesktop) provides search, pin, rename, branch, and delete; [past-chat memory](https://support.google.com/gemini/answer/16598469?hl=en&co=GENIE.Platform%3DDesktop) is a separate control with provenance.
- [Tencent WorkBuddy task management](https://www.workbuddy.ai/docs/workbuddy/Task-Management) groups resumable task history; its [memory UI](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory) makes derived entries viewable and editable.
- [Generative Agents](https://arxiv.org/abs/2304.03442) motivates separate raw events, retrieval, and reflection.
- [MemGPT](https://arxiv.org/abs/2310.08560) motivates bounded working context plus archival memory instead of replaying an unlimited transcript.
- [LoCoMo](https://arxiv.org/abs/2402.17753) supplies multi-session, temporal, knowledge-update, and abstention cases for future evaluations.
- [HippoRAG](https://arxiv.org/abs/2405.14831) suggests graph retrieval only when simpler semantic retrieval fails multi-hop evaluations.
- [Mem0](https://arxiv.org/abs/2504.19413) and [A-MEM](https://arxiv.org/abs/2502.12110) motivate compact, evolving, source-linked memories; both should be validated against this product's own evals before adoption.

Cloudflare references: [D1](https://developers.cloudflare.com/d1/), [read replication](https://developers.cloudflare.com/d1/best-practices/read-replication/), [Durable Objects](https://developers.cloudflare.com/durable-objects/), [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Vectorize metadata filtering](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/), and [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).
