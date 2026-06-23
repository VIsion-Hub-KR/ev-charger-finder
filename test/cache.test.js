import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';

test('TTL 안에서는 값을 돌려준다', () => {
  let t = 1000;
  const c = createCache({ ttlMs: 100, now: () => t });
  c.set('k', 'v');
  t = 1050;
  assert.equal(c.get('k'), 'v');
});

test('TTL 지나면 만료', () => {
  let t = 1000;
  const c = createCache({ ttlMs: 100, now: () => t });
  c.set('k', 'v');
  t = 1200;
  assert.equal(c.get('k'), undefined);
});
