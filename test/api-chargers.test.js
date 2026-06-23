import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchStations } from '../api/chargers.js';

const infoText = await readFile(new URL('./fixtures/info-mini.json', import.meta.url), 'utf8');
const statusText = await readFile(new URL('./fixtures/status-mini.json', import.meta.url), 'utf8');

// getChargerInfo / getChargerStatus를 구분해 가짜 응답을 주는 fetch
const fakeFetch = async (url) => ({
  ok: true,
  text: async () => (url.includes('getChargerStatus') ? statusText : infoText),
});

test('fetchStations: 반경 내 충전소를 거리순으로 반환', async () => {
  const stations = await fetchStations({
    lat: 37.48, lng: 127.0, radiusKm: 60, fetchImpl: fakeFetch, key: 'test',
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

test('fetchStations: distanceKm이 radiusKm 이내인 것만 반환', async () => {
  const radiusKm = 10;
  const stations = await fetchStations({
    lat: 37.48, lng: 127.0, radiusKm, fetchImpl: fakeFetch, key: 'test',
  });
  assert.ok(Array.isArray(stations));
  for (const s of stations) {
    assert.ok(s.distanceKm <= radiusKm, `${s.name}: ${s.distanceKm}km should be <= ${radiusKm}km`);
  }
});
