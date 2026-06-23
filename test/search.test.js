/**
 * test/search.test.js — TDD tests for parseLocalResults (pure, no network).
 *
 * Tests:
 *   1. Normal item: strips HTML tags, converts mapx/mapy ÷ 1e7 to lng/lat.
 *   2. Empty items array → [].
 *   3. Item with missing/NaN mapx is filtered out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalResults } from '../api/search.js';

// ---------------------------------------------------------------------------
// Test 1: Normal item — tag stripping + coordinate conversion
// ---------------------------------------------------------------------------

test('parseLocalResults: strips HTML tags and converts coords ÷ 1e7', () => {
  const input = {
    items: [
      {
        title:       '강남역 <b>2호선</b>',
        roadAddress: '서울특별시 강남구 강남대로 396',
        mapx:        '1270276242',
        mapy:        '374979526',
      },
    ],
  };

  const results = parseLocalResults(input);

  assert.equal(results.length, 1);

  const r = results[0];
  assert.equal(r.name, '강남역 2호선');
  assert.equal(r.roadAddress, '서울특별시 강남구 강남대로 396');

  // Coordinate conversion: mapx/mapy ÷ 1e7
  // mapx=1270276242 → lng=127.0276242
  // mapy=374979526  → lat=37.4979526
  assert.ok(
    Math.abs(r.lng - 127.0276242) < 1e-7,
    `lng expected ~127.0276242 got ${r.lng}`
  );
  assert.ok(
    Math.abs(r.lat - 37.4979526) < 1e-7,
    `lat expected ~37.4979526 got ${r.lat}`
  );
});

// ---------------------------------------------------------------------------
// Test 2: Empty items → []
// ---------------------------------------------------------------------------

test('parseLocalResults: empty items returns []', () => {
  const results = parseLocalResults({ items: [] });
  assert.deepEqual(results, []);
});

// ---------------------------------------------------------------------------
// Test 3: Missing/NaN mapx is filtered out
// ---------------------------------------------------------------------------

test('parseLocalResults: item with missing mapx is filtered out', () => {
  const input = {
    items: [
      {
        title:       '나쁜 데이터',
        roadAddress: '주소 없음',
        mapx:        '',       // empty string → NaN after Number()
        mapy:        '374979526',
      },
    ],
  };

  const results = parseLocalResults(input);
  assert.equal(results.length, 0);
});

test('parseLocalResults: item with undefined mapx is filtered out', () => {
  const input = {
    items: [
      {
        title:       '좌표 없음',
        roadAddress: '서울',
        // mapx missing entirely
        mapy:        '374979526',
      },
    ],
  };

  const results = parseLocalResults(input);
  assert.equal(results.length, 0);
});
