import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseItems, buildStations } from '../lib/chargers.js';

const info = JSON.parse(await readFile(new URL('./fixtures/info-mini.json', import.meta.url)));
const status = JSON.parse(await readFile(new URL('./fixtures/status-mini.json', import.meta.url)));

test('parseItems: item 배열을 추출한다', () => {
  const items = parseItems(info);
  assert.ok(Array.isArray(items) && items.length > 0);
});

test('buildStations: 충전소 단위로 묶고 사용가능 대수를 센다', () => {
  const stations = buildStations(parseItems(info), parseItems(status));
  assert.ok(stations.length > 0);
  const s = stations[0];
  assert.ok(typeof s.totalCount === 'number' && s.totalCount >= 1);
  assert.ok(s.availableCount <= s.totalCount);
  assert.ok(s.lat && s.lng && s.name);
});

test('buildStations: origin 주면 거리 계산', () => {
  const stations = buildStations(parseItems(info), parseItems(status), { lat: 37.5, lng: 127 });
  assert.ok(stations.every((s) => typeof s.distanceKm === 'number'));
});
