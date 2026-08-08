#!/usr/bin/env node
/**
 * Compatibility check using the REAL OpenAI SDK.
 *
 * The point is not to test our own code with our own assumptions — it is to
 * prove that the unmodified `openai` npm client can talk to this Worker. If
 * this passes, Cursor, LangChain, LlamaIndex, n8n and friends will work too.
 *
 *   BASE_URL=https://ai.lofuyu.com/v1 API_KEY=sk-cfai-... node scripts/verify-openai-sdk.mjs
 */

import OpenAI from 'openai';

const BASE_URL = process.env.BASE_URL ?? 'https://lucky-salad-6e38.islantay.workers.dev/v1';
const API_KEY = process.env.API_KEY ?? '';
const MODEL = process.env.MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8';

if (!API_KEY) {
  console.error('Set API_KEY to a key minted in the dashboard.');
  process.exit(2);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

let passed = 0;
let failed = 0;

async function check(name, fn) {
  process.stdout.write(`• ${name} … `);
  try {
    const detail = await fn();
    console.log(`PASS${detail ? ` (${detail})` : ''}`);
    passed++;
  } catch (err) {
    console.log(`FAIL\n    ${err?.message ?? err}`);
    failed++;
  }
}

await check('GET /v1/models', async () => {
  const list = await client.models.list();
  const n = list.data?.length ?? 0;
  if (!n) throw new Error('empty model list');
  return `${n} models`;
});

await check('chat.completions (buffered)', async () => {
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    max_tokens: 20,
  });
  const text = res.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.length) throw new Error('no assistant content');
  if (res.object !== 'chat.completion') throw new Error(`wrong object: ${res.object}`);
  if (!res.usage) throw new Error('missing usage block');
  return `${res.usage.total_tokens} tokens`;
});

await check('chat.completions (streaming)', async () => {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
    stream: true,
  });

  let chunks = 0;
  let text = '';
  let sawRole = false;
  let sawFinish = false;

  for await (const chunk of stream) {
    chunks++;
    if (chunk.object !== 'chat.completion.chunk') throw new Error(`wrong chunk object: ${chunk.object}`);
    const choice = chunk.choices?.[0];
    if (choice?.delta?.role === 'assistant') sawRole = true;
    if (choice?.delta?.content) text += choice.delta.content;
    if (choice?.finish_reason) sawFinish = true;
  }

  if (chunks < 2) throw new Error(`only ${chunks} chunk(s) — not really streaming`);
  if (!sawRole) throw new Error('no initial role delta');
  if (!sawFinish) throw new Error('no finish_reason on final chunk');
  if (!text.trim()) throw new Error('stream produced no text');

  return `${chunks} chunks, ${text.length} chars`;
});

await check('streaming with usage', async () => {
  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: 'Say hi.' }],
    stream: true,
    stream_options: { include_usage: true },
  });

  let usage = null;
  for await (const chunk of stream) if (chunk.usage) usage = chunk.usage;
  if (!usage) throw new Error('include_usage requested but no usage chunk arrived');
  return `${usage.total_tokens} tokens`;
});

await check('embeddings', async () => {
  const res = await client.embeddings.create({
    model: '@cf/baai/bge-base-en-v1.5',
    input: ['hello world', 'second string'],
  });
  if (res.data?.length !== 2) throw new Error(`expected 2 vectors, got ${res.data?.length}`);
  const dims = res.data[0].embedding?.length ?? 0;
  if (!dims) throw new Error('empty embedding vector');
  return `2 vectors, ${dims} dims`;
});

await check('rejects a bad key with 401', async () => {
  const rogue = new OpenAI({ apiKey: 'sk-cfai-totally-invalid', baseURL: BASE_URL });
  try {
    await rogue.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: 'hi' }],
    });
  } catch (err) {
    if (err?.status === 401) return 'correctly refused';
    throw new Error(`expected 401, got ${err?.status}`);
  }
  throw new Error('invalid key was accepted');
});

await check('rejects unknown model with 404', async () => {
  try {
    await client.chat.completions.create({
      model: 'definitely-not-a-real-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
  } catch (err) {
    if (err?.status === 404) return 'correctly refused';
    throw new Error(`expected 404, got ${err?.status}`);
  }
  throw new Error('unknown model was accepted');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
