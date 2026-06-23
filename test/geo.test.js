import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, boundingBox } from '../lib/geo.js';

test('haversineKm: 서울시청→강남역 약 9~11km', () => {
  const d = haversineKm({ lat: 37.5663, lng: 126.9779 }, { lat: 37.4979, lng: 127.0276 });
  assert.ok(d > 8 && d < 12, `got ${d}`);
});

test('haversineKm: 같은 점은 0', () => {
  const d = haversineKm({ lat: 37.5, lng: 127 }, { lat: 37.5, lng: 127 });
  assert.ok(d < 0.001, `got ${d}`);
});

test('boundingBox: 반경만큼 위경도 범위를 만든다', () => {
  const box = boundingBox({ lat: 37.5, lng: 127 }, 5);
  assert.ok(box.minLat < 37.5 && box.maxLat > 37.5);
  assert.ok(box.minLng < 127 && box.maxLng > 127);
});
