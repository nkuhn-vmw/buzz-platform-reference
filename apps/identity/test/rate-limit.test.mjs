import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowLimiter } from '../src/rate-limit.mjs';

test('window limiter enforces a bounded per-key fixed window and resets after expiry', () => {
  let time = 1000;
  const limit = createWindowLimiter({ maxHits: 2, windowMs: 60_000, maxKeys: 2, now: () => time });
  assert.deepEqual(limit('client-a'), { allowed: true, retryAfter: 0 });
  assert.deepEqual(limit('client-a'), { allowed: true, retryAfter: 0 });
  assert.deepEqual(limit('client-a'), { allowed: false, retryAfter: 60 });
  assert.deepEqual(limit('client-b'), { allowed: true, retryAfter: 0 });
  assert.deepEqual(limit('client-c'), { allowed: true, retryAfter: 0 });
  assert.deepEqual(limit('client-a'), { allowed: true, retryAfter: 0 });
  time += 60_000;
  assert.deepEqual(limit('client-b'), { allowed: true, retryAfter: 0 });
});
