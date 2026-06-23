import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchStations } from '../api/chargers.js';
import { createMemoryStore } from '../lib/store.js';

const infoText = await readFile(new URL('./fixtures/info-mini.json', import.meta.url), 'utf8');

// fakeFetch returns the fixture for any URL
const fakeFetch = async (_url) => ({
  ok: true,
  status: 200,
  text: async () => infoText,
});

// ── HIT TEST ─────────────────────────────────────────────────────────────────
test('fetchStations HIT: returns pre-populated snapshot without calling fetch', async () => {
  const store = createMemoryStore();
  const freshAt = Date.now();

  const preStation = {
    statId: 'X',
    name: 'pre',
    lat: 37.5,
    lng: 127.0,
    availableCount: 1,
    totalCount: 1,
    connectors: [],
    speed: '급속',
    isTesla: false,
    statusLabel: '사용가능',
    addr: '',
    busiNm: '',
    lastUpdate: null,
  };

  await store.setSnapshot('11680', { stations: [preStation], updatedAt: freshAt });

  const throwingFetch = () => { throw new Error('should not fetch on hit'); };

  const stations = await fetchStations({
    lat: 37.5,
    lng: 127.0,
    radiusKm: 5,
    zscodes: ['11680'],
    store,
    key: 't',
    fetchImpl: throwingFetch,
    now: () => freshAt + 1000, // 1s later → still fresh (maxAgeMs default 600_000)
  });

  assert.ok(Array.isArray(stations), 'result should be an array');
  assert.ok(stations.length > 0, 'should return the pre-populated station');
  assert.strictEqual(stations[0].statId, 'X', 'should be the pre-populated station (not from fixture)');
});

// ── MISS TEST ─────────────────────────────────────────────────────────────────
test('fetchStations MISS: fetches live and writes through to store', async () => {
  const store = createMemoryStore();

  const stations = await fetchStations({
    lat: 37.48,
    lng: 127.0,
    radiusKm: 60,
    zscodes: ['11680'],
    store,
    key: 't',
    fetchImpl: fakeFetch,
  });

  assert.ok(Array.isArray(stations), 'result should be an array');
  assert.ok(stations.length > 0, 'should have stations built from fixture');

  // write-through: store should now have the snapshot
  const snap = await store.getSnapshot('11680');
  assert.ok(snap !== null, 'store should be populated after a miss');
  assert.ok(Array.isArray(snap.stations), 'snap.stations should be an array');
  assert.ok(snap.stations.length > 0, 'snap.stations should have data');
  assert.ok(typeof snap.updatedAt === 'number', 'snap.updatedAt should be a number');
});

// ── STALE TEST ────────────────────────────────────────────────────────────────
test('fetchStations STALE: re-fetches and advances store updatedAt', async () => {
  const store = createMemoryStore();
  const oldAt = 1000; // far in the past

  const oldStation = {
    statId: 'OLD',
    name: 'old',
    lat: 37.5,
    lng: 127.0,
    availableCount: 0,
    totalCount: 1,
    connectors: [],
    speed: '완속',
    isTesla: false,
    statusLabel: '만차/점검',
    addr: '',
    busiNm: '',
    lastUpdate: null,
  };

  await store.setSnapshot('11680', { stations: [oldStation], updatedAt: oldAt });

  const nowTs = Date.now(); // current time, far ahead of oldAt

  const stations = await fetchStations({
    lat: 37.48,
    lng: 127.0,
    radiusKm: 60,
    zscodes: ['11680'],
    store,
    key: 't',
    fetchImpl: fakeFetch,
    maxAgeMs: 600_000,
    now: () => nowTs, // nowTs - oldAt >> 600_000 → stale
  });

  assert.ok(Array.isArray(stations), 'result should be an array');

  // After stale re-fetch, store should have a fresh updatedAt
  const snap = await store.getSnapshot('11680');
  assert.ok(snap !== null, 'store should still be populated');
  assert.ok(snap.updatedAt > oldAt, 'updatedAt should have advanced after stale re-fetch');
  assert.strictEqual(snap.updatedAt, nowTs, 'updatedAt should equal now()');
});

// ── SORT + RADIUS TEST (existing behaviour) ──────────────────────────────────
test('fetchStations: returns stations sorted ascending by distanceKm', async () => {
  const store = createMemoryStore();

  const stations = await fetchStations({
    lat: 37.5,
    lng: 127.0,
    radiusKm: 60,
    zscodes: ['11680'],
    store,
    key: 'test',
    fetchImpl: fakeFetch,
  });

  assert.ok(Array.isArray(stations), 'stations should be an array');
  assert.ok(stations.length > 0, 'should have at least one station');

  for (let i = 1; i < stations.length; i++) {
    assert.ok(
      stations[i].distanceKm >= stations[i - 1].distanceKm,
      `stations[${i}].distanceKm (${stations[i].distanceKm}) should be >= stations[${i - 1}].distanceKm (${stations[i - 1].distanceKm})`,
    );
  }
});

test('fetchStations: only returns stations within radiusKm', async () => {
  const store = createMemoryStore();
  const radiusKm = 10;

  const stations = await fetchStations({
    lat: 37.5,
    lng: 127.0,
    radiusKm,
    zscodes: ['11680'],
    store,
    key: 'test',
    fetchImpl: fakeFetch,
  });

  for (const s of stations) {
    assert.ok(s.distanceKm <= radiusKm, `${s.name}: ${s.distanceKm}km should be <= ${radiusKm}km`);
  }
});
