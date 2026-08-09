#!/usr/bin/env node
/**
 * Live compatibility check using the official, unmodified Anthropic SDK.
 *
 *   BASE_URL=https://ai.lofuyu.com API_KEY=sk-cfai-... npm run test:anthropic
 */

import Anthropic from '@anthropic-ai/sdk';

const BASE_URL = process.env.BASE_URL ?? 'https://ai.lofuyu.com';
const API_KEY = process.env.API_KEY ?? '';
const MODEL = process.env.MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8';

if (!API_KEY) {
  console.error('Set API_KEY to a key minted in the dashboard.');
  process.exit(2);
}

const client = new Anthropic({ apiKey: API_KEY, baseURL: BASE_URL });
let passed = 0;
let failed = 0;

async function check(name, fn) {
  process.stdout.write(`• ${name} … `);
  try {
    const detail = await fn();
    console.log(`PASS${detail ? ` (${detail})` : ''}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL\n    ${error?.message ?? error}`);
    failed += 1;
  }
}

await check('messages.create (buffered)', async () => {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 32,
    messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
  });
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text) throw new Error('no assistant text');
  if (message.type !== 'message') throw new Error(`wrong type: ${message.type}`);
  return `${message.usage.input_tokens + message.usage.output_tokens} tokens`;
});

await check('messages.stream (SSE)', async () => {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 128,
    messages: [{ role: 'user', content: 'Count from 1 to 5.' }],
  });
  let deltas = 0;
  stream.on('text', () => { deltas += 1; });
  const message = await stream.finalMessage();
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  if (!text.trim()) throw new Error('stream produced no text');
  if (!deltas) throw new Error('stream produced no incremental text events');
  return `${deltas} deltas, ${text.length} chars`;
});

await check('messages.countTokens', async () => {
  const result = await client.messages.countTokens({
    model: MODEL,
    messages: [{ role: 'user', content: 'Count this input.' }],
  });
  if (!Number.isInteger(result.input_tokens) || result.input_tokens <= 0) {
    throw new Error(`invalid input_tokens: ${result.input_tokens}`);
  }
  return `${result.input_tokens} estimated tokens`;
});

await check('rejects a bad key with 401', async () => {
  const rogue = new Anthropic({ apiKey: 'sk-cfai-totally-invalid', baseURL: BASE_URL });
  try {
    await rogue.messages.create({
      model: MODEL,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
  } catch (error) {
    if (error?.status === 401) return 'correctly refused';
    throw new Error(`expected 401, got ${error?.status}`);
  }
  throw new Error('invalid key was accepted');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
