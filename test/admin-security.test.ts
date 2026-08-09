import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';
import { isCrossSiteMutation } from '../src/routes/admin';

test('dashboard mutations reject cross-site browser requests', () => {
  assert.equal(
    isCrossSiteMutation(new Request('https://app.example/admin/api/conversations', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    })),
    true,
  );
  assert.equal(
    isCrossSiteMutation(new Request('https://app.example/admin/api/conversations', {
      method: 'POST',
      headers: { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    })),
    false,
  );
  assert.equal(
    isCrossSiteMutation(new Request('https://app.example/admin/api/conversations')),
    false,
  );
});

test('wildcard preflight headers are limited to the public v1 API', async () => {
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const publicResponse = await worker.fetch(
    new Request('https://app.example/v1/chat/completions', { method: 'OPTIONS' }),
    {} as any,
    ctx,
  );
  assert.equal(publicResponse.status, 204);
  assert.equal(publicResponse.headers.get('access-control-allow-origin'), '*');

  const dashboardResponse = await worker.fetch(
    new Request('https://app.example/admin/api/conversations', { method: 'OPTIONS' }),
    {} as any,
    ctx,
  );
  assert.equal(dashboardResponse.status, 405);
  assert.equal(dashboardResponse.headers.get('access-control-allow-origin'), null);
});
