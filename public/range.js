/**
 * lib/range.js — 테슬라 Model X 주행가능 거리 계산 (순수 함수, 네트워크 없음)
 *
 * 입력: 트림 만충 주행거리(km), 현재 배터리(%), 목적지까지 도로 거리(km)
 * 출력: 사용 가능 거리, 편도/왕복 가능 여부, 도착·복귀 시 예상 배터리 잔량
 *
 * 거리 출처: 도로 경로 거리는 /api/route 가 반환하는 distanceKm 를 그대로 사용.
 * 트림 만충거리 출처: 2024 Tesla Model X EPA 공인 주행거리(mile→km, ×1.60934, 반올림).
 *   - Long Range AWD(20"): 335 mi → 539 km
 *   - Plaid(20"):          326 mi → 525 km
 *   ※ EPA 기준값이라 한국 겨울·고속 실주행은 더 짧을 수 있음 → 안전 마진(기본 15%)으로 보수적 처리.
 */

/** Model X 트림 프리셋 — 만충(100%) 기준 주행거리(km). */
export const MODEL_X_TRIMS = {
  'long-range': { label: 'Long Range', fullRangeKm: 539 },
  plaid: { label: 'Plaid', fullRangeKm: 525 },
};

/** 도착 시 남겨둘 기본 안전 여유 배터리(%). */
export const DEFAULT_RESERVE_PCT = 15;

/** 값을 [min, max] 범위로 자른다. */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * 주어진 거리를 가는 데 소모되는 배터리 비율(%).
 * @param {number} distanceKm
 * @param {number} fullRangeKm 만충 시 주행거리(km)
 * @returns {number} 소모 %
 */
export function consumePct(distanceKm, fullRangeKm) {
  if (!(fullRangeKm > 0)) return Infinity;
  return (Math.max(0, distanceKm) / fullRangeKm) * 100;
}

/**
 * 현재 배터리에서 안전 마진을 남기고 실제로 갈 수 있는 거리(km).
 * usableKm = fullRangeKm × max(0, batteryPct − reservePct) / 100
 * @param {number} fullRangeKm
 * @param {number} batteryPct 0–100
 * @param {number} [reservePct=DEFAULT_RESERVE_PCT]
 * @returns {number} 사용 가능 거리(km)
 */
export function usableRangeKm(fullRangeKm, batteryPct, reservePct = DEFAULT_RESERVE_PCT) {
  const b = clamp(batteryPct, 0, 100);
  const usablePct = Math.max(0, b - reservePct);
  return (fullRangeKm * usablePct) / 100;
}

/**
 * 한 번의 운행을 평가한다.
 * @param {object} p
 * @param {number} p.fullRangeKm 만충 주행거리(km)
 * @param {number} p.batteryPct  현재 배터리(%) 0–100
 * @param {number} p.distanceKm  목적지까지 편도 도로 거리(km)
 * @param {number} [p.reservePct=DEFAULT_RESERVE_PCT] 도착 시 남길 여유(%)
 * @returns {{
 *   usableKm: number,      // 안전 마진 남기고 갈 수 있는 거리
 *   oneWay: boolean,       // 편도 도착 가능(도착 시 reserve 이상 남음)
 *   roundTrip: boolean,    // 왕복 가능(복귀 시 reserve 이상 남음)
 *   arrivalPct: number,    // 편도 도착 시 예상 배터리(%) — 음수면 도중 방전
 *   returnPct: number,     // 왕복 복귀 시 예상 배터리(%)
 * }}
 */
export function assessTrip({ fullRangeKm, batteryPct, distanceKm, reservePct = DEFAULT_RESERVE_PCT }) {
  const b = clamp(batteryPct, 0, 100);
  const oneWayConsume = consumePct(distanceKm, fullRangeKm);
  const arrivalPct = b - oneWayConsume;
  const returnPct = b - oneWayConsume * 2;
  return {
    usableKm: usableRangeKm(fullRangeKm, b, reservePct),
    oneWay: arrivalPct >= reservePct,
    roundTrip: returnPct >= reservePct,
    arrivalPct,
    returnPct,
  };
}
