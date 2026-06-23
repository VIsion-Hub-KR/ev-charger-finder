import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionFor } from '../lib/region.js';

test('regionFor: 서울 좌표 → 11', () => {
  assert.equal(regionFor(37.5665, 126.9780), '11');
});

test('regionFor: 부산 좌표 → 26', () => {
  assert.equal(regionFor(35.18, 129.07), '26');
});

test('regionFor: 제주 좌표 → 50', () => {
  assert.equal(regionFor(33.49, 126.53), '50');
});
