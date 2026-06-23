import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchStations } from '../api/chargers.js';

const infoText = await readFile(new URL('./fixtures/info-mini.json', import.meta.url), 'utf8');

// getChargerInfo를 페이지 관계없이 동일한 info 응답으로 처리한다.
// info-mini.json은 3건(< 9999)이므로 페이지 루프는 1회에서 종료된다.
const fakeFetch = async (url) => ({
  ok: true,
  text: async () => infoText,
});

test('fetchStations: 반경 내 충전소를 거리 오름차순으로 반환', async () => {
  const stations = await fetchStations({
    lat: 37.5, lng: 127.0, radiusKm: 60, zscodes: ['11680'], fetchImpl: fakeFetch, key: 'test',
  });
  assert.ok(Array.isArray(stations), 'stations should be an array');
  assert.ok(stations.length > 0, 'should have at least one station');

  // 거리 오름차순 정렬 검증
  for (let i = 1; i < stations.length; i++) {
    assert.ok(
      stations[i].distanceKm >= stations[i - 1].distanceKm,
      `stations[${i}].distanceKm (${stations[i].distanceKm}) should be >= stations[${i - 1}].distanceKm (${stations[i - 1].distanceKm})`,
    );
  }
});

test('fetchStations: distanceKm이 radiusKm 이내인 것만 반환', async () => {
  const radiusKm = 10;
  const stations = await fetchStations({
    lat: 37.5, lng: 127.0, radiusKm, zscodes: ['11680'], fetchImpl: fakeFetch, key: 'test',
  });
  assert.ok(Array.isArray(stations));
  for (const s of stations) {
    assert.ok(s.distanceKm <= radiusKm, `${s.name}: ${s.distanceKm}km should be <= ${radiusKm}km`);
  }
});

test('fetchStations: availableCount는 숫자이며 totalCount 이하', async () => {
  const stations = await fetchStations({
    lat: 37.5, lng: 127.0, radiusKm: 60, zscodes: ['11680'], fetchImpl: fakeFetch, key: 'test',
  });
  assert.ok(stations.length > 0, 'should have stations');
  for (const s of stations) {
    assert.strictEqual(typeof s.availableCount, 'number', `${s.name}: availableCount should be a number`);
    assert.strictEqual(typeof s.totalCount, 'number', `${s.name}: totalCount should be a number`);
    assert.ok(
      s.availableCount <= s.totalCount,
      `${s.name}: availableCount (${s.availableCount}) should be <= totalCount (${s.totalCount})`,
    );
  }
});
