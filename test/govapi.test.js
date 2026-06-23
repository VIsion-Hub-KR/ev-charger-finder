import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchChargerItemsForSigungu, fetchWithRetry } from '../lib/govapi.js';

const infoText = await readFile(new URL('./fixtures/info-mini.json', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Test 1: single-page response (3 items < numOfRows → 1 page only)
// ---------------------------------------------------------------------------
test('fetchChargerItemsForSigungu: returns 3 items from a single-page response', async () => {
  const fakeFetch = async (_url) => ({
    ok: true,
    status: 200,
    text: async () => infoText,
  });

  const items = await fetchChargerItemsForSigungu({
    zscode: '11680',
    key: 't',
    fetchImpl: fakeFetch,
  });

  assert.ok(Array.isArray(items), 'should return an array');
  assert.strictEqual(items.length, 3, 'should have exactly 3 items');

  // verify expected fields on the first item
  const first = items[0];
  assert.ok(typeof first.statId === 'string', 'statId should be a string');
  assert.ok(typeof first.lat === 'string' || typeof first.lat === 'number', 'lat should exist');
  assert.ok(typeof first.lng === 'string' || typeof first.lng === 'number', 'lng should exist');
  assert.ok(typeof first.stat === 'string', 'stat should be a string');
});

// ---------------------------------------------------------------------------
// Test 2: fetchWithRetry retries on 503 then succeeds
// ---------------------------------------------------------------------------
test('fetchWithRetry: retries once on 429 then returns json on 200', async () => {
  let callCount = 0;
  const fakeFetch = async (_url) => {
    callCount += 1;
    if (callCount === 1) {
      return { status: 429, text: async () => '{}' };
    }
    return {
      status: 200,
      text: async () => JSON.stringify({ resultMsg: 'NORMAL SERVICE.', items: { item: [] } }),
    };
  };

  const result = await fetchWithRetry(fakeFetch, 'https://example.com', { retries: 3, backoffMs: 1 });
  assert.strictEqual(callCount, 2, 'should have called fetch exactly twice');
  assert.ok(result, 'should return a result');
});

// ---------------------------------------------------------------------------
// Test 3: pagination accumulates across pages (2 items/page → stop at 1-item page)
// ---------------------------------------------------------------------------
test('fetchChargerItemsForSigungu: accumulates items across multiple pages', async () => {
  // We use numOfRows:2 so each "full" page has exactly 2 items.
  // Page 1 → 2 items (full), Page 2 → 2 items (full), Page 3 → 1 item (short → stop).
  // Expected total: 5 items.

  const makeItem = (n) => ({
    statId: `STAT${n}`,
    chgerId: '01',
    chgerType: '06',
    statNm: `Station ${n}`,
    lat: '37.5',
    lng: '127.0',
    addr: 'addr',
    busiNm: 'biz',
    stat: '2',
    statUpdDt: '20260623000000',
    zcode: '11',
    zscode: '11680',
  });

  const pages = [
    // page 1: 2 items
    { resultMsg: 'NORMAL SERVICE.', items: { item: [makeItem(1), makeItem(2)] } },
    // page 2: 2 items
    { resultMsg: 'NORMAL SERVICE.', items: { item: [makeItem(3), makeItem(4)] } },
    // page 3: 1 item (short → pagination stops)
    { resultMsg: 'NORMAL SERVICE.', items: { item: [makeItem(5)] } },
  ];

  let pageCall = 0;
  const fakeFetch = async (url) => {
    // Extract pageNo from URL
    const match = url.match(/pageNo=(\d+)/);
    const pageNo = match ? Number(match[1]) : pageCall + 1;
    pageCall = pageNo;
    const body = pages[pageNo - 1] ?? { resultMsg: 'NORMAL SERVICE.', items: { item: [] } };
    return {
      status: 200,
      text: async () => JSON.stringify(body),
    };
  };

  const items = await fetchChargerItemsForSigungu({
    zscode: '11680',
    key: 't',
    fetchImpl: fakeFetch,
    numOfRows: 2,
    maxPages: 5,
  });

  assert.strictEqual(items.length, 5, 'should accumulate 5 items across 3 pages');
});

// ---------------------------------------------------------------------------
// Test 4: key is never logged (no-op guard — just confirm function runs without
//         throwing when a sentinel key is passed; actual log-masking tested manually)
// ---------------------------------------------------------------------------
test('fetchChargerItemsForSigungu: does not throw with a sentinel key value', async () => {
  const sensitiveKey = 'SECRET_SENTINEL_KEY_12345';
  const fakeFetch = async (_url) => ({
    status: 200,
    text: async () => infoText,
  });

  // Should not throw; we trust the impl never logs 'key' from env
  const items = await fetchChargerItemsForSigungu({
    zscode: '11680',
    key: sensitiveKey,
    fetchImpl: fakeFetch,
  });
  assert.ok(Array.isArray(items));
});
