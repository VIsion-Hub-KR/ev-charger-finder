import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_X_TRIMS,
  DEFAULT_RESERVE_PCT,
  consumePct,
  usableRangeKm,
  assessTrip,
} from '../public/range.js';

test('트림 프리셋: Long Range / Plaid 만충거리(km) 존재', () => {
  assert.equal(MODEL_X_TRIMS['long-range'].fullRangeKm, 539);
  assert.equal(MODEL_X_TRIMS.plaid.fullRangeKm, 525);
});

test('consumePct: 거리/만충거리 비율(%)', () => {
  // 100km / 500km = 20%
  assert.equal(consumePct(100, 500), 20);
});

test('usableRangeKm: 80%에서 15% 마진 남기면 65% 분량', () => {
  // 500 × (80−15)/100 = 325
  assert.equal(usableRangeKm(500, 80, 15), 325);
});

test('usableRangeKm: 배터리가 마진 이하면 0', () => {
  assert.equal(usableRangeKm(500, 10, 15), 0);
});

test('usableRangeKm: 기본 마진은 15%', () => {
  assert.equal(DEFAULT_RESERVE_PCT, 15);
  assert.equal(usableRangeKm(500, 50), 500 * 0.35);
});

test('assessTrip: 충분 → 편도·왕복 모두 가능', () => {
  // 만충 500, 배터리 90%, 편도 50km → 편도소모 10%, 도착 80%, 복귀 70%
  const r = assessTrip({ fullRangeKm: 500, batteryPct: 90, distanceKm: 50 });
  assert.equal(r.oneWay, true);
  assert.equal(r.roundTrip, true);
  assert.equal(Math.round(r.arrivalPct), 80);
  assert.equal(Math.round(r.returnPct), 70);
});

test('assessTrip: 편도는 되지만 왕복은 불가', () => {
  // 만충 500, 배터리 50%, 편도 150km → 편도소모 30%, 도착 20%(≥15 OK), 복귀 -10%(<15 X)
  const r = assessTrip({ fullRangeKm: 500, batteryPct: 50, distanceKm: 150 });
  assert.equal(r.oneWay, true);
  assert.equal(r.roundTrip, false);
});

test('assessTrip: 편도도 불가', () => {
  // 만충 500, 배터리 30%, 편도 100km → 소모 20%, 도착 10%(<15) → 편도 불가
  const r = assessTrip({ fullRangeKm: 500, batteryPct: 30, distanceKm: 100 });
  assert.equal(r.oneWay, false);
  assert.equal(r.roundTrip, false);
});

test('assessTrip: 배터리 100% 초과 입력은 100으로 클램프', () => {
  const r = assessTrip({ fullRangeKm: 500, batteryPct: 120, distanceKm: 50 });
  assert.equal(Math.round(r.arrivalPct), 90); // 100 − 10
});

test('assessTrip: 경계 — 도착이 정확히 15%면 편도 가능', () => {
  // 만충 500, 배터리 25%, 편도 50km → 소모 10%, 도착 15% → oneWay true
  const r = assessTrip({ fullRangeKm: 500, batteryPct: 25, distanceKm: 50 });
  assert.equal(r.oneWay, true);
});
