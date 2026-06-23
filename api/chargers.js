// NOTE: cold miss triggers ~40s live fetch. Vercel function maxDuration must be
// >= ~50s (Pro plan) for cold-miss areas; warm areas served from KV are instant.

import { buildStations } from '../lib/chargers.js';
import { haversineKm } from '../lib/geo.js';
import { fetchChargerItemsForSigungu } from '../lib/govapi.js';
import { createKvStore, createMemoryStore } from '../lib/store.js';

// Vercel reads this to set the function timeout limit.
export const config = { maxDuration: 60 };

// 저장소는 모듈 단위 싱글톤으로 둔다. (요청마다 새로 만들면 메모리 캐시가 요청 간에
// 사라져 매번 콜드 페치가 된다. KV가 있으면 KV, 없으면 인메모리로 폴백.)
const store = process.env.KV_REST_API_URL ? createKvStore() : createMemoryStore();

/**
 * Cache-aside fetch: for each zscode check the store first (HIT = instant),
 * only fall back to the slow public API on a miss or stale entry, then write
 * through so the next caller gets a hit.
 *
 * @param {{
 *   lat: number,
 *   lng: number,
 *   radiusKm?: number,
 *   zscodes: string[],
 *   store: object,        — getSnapshot / setSnapshot
 *   key: string,          — DATA_GO_KR_KEY (never logged)
 *   fetchImpl?: Function,
 *   maxAgeMs?: number,    — snapshot TTL in ms (default 10 min)
 *   now?: () => number,   — injectable clock (default Date.now)
 * }} opts
 * @returns {Promise<Station[]>}
 */
export async function fetchStations({
  lat,
  lng,
  radiusKm = 10,
  zscodes,
  store,
  key,
  fetchImpl = globalThis.fetch,
  maxAgeMs = 600_000,
  now = Date.now,
  readOnly = false,
}) {
  const perZscodeStations = await Promise.all(
    zscodes.map(async (zscode) => {
      const snap = await store.getSnapshot(zscode);

      // 읽기 전용(프로덕션/KV): 사전 빌드된 KV만 사용. 미스여도 느린 공공 API를
      // 동기 호출하지 않는다(서버리스 타임아웃 방지). 신선도는 외부 워머가 유지.
      if (readOnly) {
        return snap ? snap.stations : [];
      }

      if (snap && now() - snap.updatedAt <= maxAgeMs) {
        // HIT — serve from store, no external call
        return snap.stations;
      }

      // MISS or STALE — fetch live and write through (로컬/개발 편의)
      const items = await fetchChargerItemsForSigungu({ zscode, key, fetchImpl });
      const stations = buildStations(items, items);
      await store.setSnapshot(zscode, { stations, updatedAt: now() });
      return stations;
    }),
  );

  // Union all stations across zscodes, dedupe by statId
  const seenIds = new Set();
  const allStations = [];
  for (const list of perZscodeStations) {
    for (const s of list) {
      if (!seenIds.has(s.statId)) {
        seenIds.add(s.statId);
        allStations.push(s);
      }
    }
  }

  // Compute distance, filter to radius, sort ascending
  const origin = { lat, lng };
  return allStations
    .map((s) => ({
      ...s,
      distanceKm: Number(haversineKm(origin, { lat: s.lat, lng: s.lng }).toFixed(1)),
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Vercel serverless handler.
 * GET /api/chargers?lat=&lng=&radius=&zscode=11680 (comma-separated for multiple)
 */
export default async function handler(req, res) {
  try {
    const { lat, lng, radius, zscode } = req.query;

    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng query parameters are required' });
      return;
    }

    if (!zscode) {
      res.status(400).json({ error: 'zscode query parameter is required' });
      return;
    }

    const zscodes = String(zscode).split(',').map((s) => s.trim()).filter(Boolean);
    const key = process.env.DATA_GO_KR_KEY;

    const stations = await fetchStations({
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: Number(radius) || 10,
      zscodes,
      store,
      key,
      // KV(프로덕션)면 읽기 전용 — 사전 빌드된 데이터만, 콜드 40초 호출 금지(타임아웃 방지)
      readOnly: !!process.env.KV_REST_API_URL,
    });

    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ stations });
  } catch (e) {
    // Never leak the API key in error details
    res.status(502).json({ error: 'upstream failed', detail: String(e.message ?? e) });
  }
}
