import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../lib/store.js';

test('set then get returns the same snapshot', async () => {
  const store = createMemoryStore();
  const snapshot = { stations: [{ id: 'A' }, { id: 'B' }], updatedAt: 1700000000 };
  await store.setSnapshot('11680', snapshot);
  const result = await store.getSnapshot('11680');
  assert.deepEqual(result, snapshot);
});

test('get on missing zscode returns null', async () => {
  const store = createMemoryStore();
  const result = await store.getSnapshot('99999');
  assert.equal(result, null);
});

test('listZscodes returns all bare zscode strings', async () => {
  const store = createMemoryStore();
  await store.setSnapshot('11680', { stations: [], updatedAt: 1 });
  await store.setSnapshot('26440', { stations: [], updatedAt: 2 });
  const codes = await store.listZscodes();
  assert.equal(codes.length, 2);
  assert.ok(codes.includes('11680'));
  assert.ok(codes.includes('26440'));
});

test('overwriting the same zscode replaces the snapshot', async () => {
  const store = createMemoryStore();
  await store.setSnapshot('11680', { stations: [{ id: 'old' }], updatedAt: 1 });
  await store.setSnapshot('11680', { stations: [{ id: 'new' }], updatedAt: 2 });
  const result = await store.getSnapshot('11680');
  assert.deepEqual(result, { stations: [{ id: 'new' }], updatedAt: 2 });
});
