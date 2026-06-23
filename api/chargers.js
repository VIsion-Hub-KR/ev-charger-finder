import { parseItems, buildStations } from '../lib/chargers.js';
import { haversineKm } from '../lib/geo.js';
import { createCache } from '../lib/cache.js';
import { regionFor } from '../lib/region.js';

const BASE = 'https://apis.data.go.kr/B552584/EvCharger';
const NUM_OF_ROWS = 9999;
const MAX_PAGES = 12;

// 모듈 수준 캐시: zcode → Station[] (2분 TTL)
// 캐시 키는 zcode이므로 같은 시도 내 다른 좌표도 동일 캐시를 재사용.
// 거리/반경 필터는 캐시 조회 이후 요청별로 수행.
const cache = createCache({ ttlMs: 120_000 });

// getChargerInfo carries its own stat field; the separate getChargerStatus
// endpoint returns only ~1378 rows for Seoul vs ~9000+ from getChargerInfo,
// so merging would leave most chargers showing 0 available (false 만차).
// We therefore use getChargerInfo exclusively and pass its items as both
// infoItems and statusItems to buildStations so every charger's own stat
// field is picked up correctly.

/**
 * HTTP fetch with retry. Retries on 429/502/504 or non-NORMAL resultMsg.
 * @param {Function} fetchImpl
 * @param {string} url
 * @param {{ retries?: number, backoffMs?: number }} opts
 */
async function fetchWithRetry(fetchImpl, url, { retries = 3, backoffMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url);
      if ([429, 502, 504].includes(res.status)) {
        lastErr = new Error(`HTTP ${res.status}`);
        if (attempt < retries) await sleep(backoffMs);
        continue;
      }
      const text = await res.text();
      const json = JSON.parse(text);
      if (typeof json?.resultMsg === 'string' && !json.resultMsg.includes('NORMAL')) {
        lastErr = new Error(`API error: ${json.resultMsg}`);
        if (attempt < retries) await sleep(backoffMs);
        continue;
      }
      return json;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(backoffMs);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * getChargerInfo 페이지네이션: numOfRows=9999로 반환 수가 numOfRows 미만이 될 때까지
 * 페이지를 순회한다. 최대 MAX_PAGES 페이지까지만 조회한다.
 * 실측 결과 서울(zcode=11) 기준 페이지2도 9999개의 중복 없는 행을 반환하므로
 * 단일 페이지로는 전체 데이터를 얻을 수 없다.
 */
async function fetchAllInfoItems(fetchImpl, key, zcode) {
  const encoded = encodeURIComponent(key);
  const allItems = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url =
      `${BASE}/getChargerInfo` +
      `?serviceKey=${encoded}&zcode=${zcode}&pageNo=${pageNo}` +
      `&numOfRows=${NUM_OF_ROWS}&dataType=JSON`;

    const json = await fetchWithRetry(fetchImpl, url);
    const items = parseItems(json);
    allItems.push(...items);

    if (items.length < NUM_OF_ROWS) {
      // 마지막 페이지 도달
      break;
    }
    if (pageNo === MAX_PAGES) {
      console.warn(
        `[chargers] zcode=${zcode}: MAX_PAGES(${MAX_PAGES}) 도달. 데이터가 더 있을 수 있음.`,
      );
    }
  }

  return allItems;
}

/**
 * 주어진 좌표 반경 내 충전소 목록을 거리 오름차순으로 반환한다.
 *
 * @param {{ lat: number, lng: number, radiusKm?: number, fetchImpl?: Function, key: string }} opts
 * @returns {Promise<Station[]>}
 */
export async function fetchStations({
  lat,
  lng,
  radiusKm = 10,
  fetchImpl = globalThis.fetch,
  key,
}) {
  const zcode = regionFor(lat, lng);
  const cacheKey = `z:${zcode}`;

  let stations = cache.get(cacheKey);

  if (!stations) {
    const infoItems = await fetchAllInfoItems(fetchImpl, key, zcode);

    // infoItems를 info와 status 양쪽에 전달해 stat 필드를 자기 자신에서 읽도록 한다.
    stations = buildStations(infoItems, infoItems);
    cache.set(cacheKey, stations);
  }

  // 거리 계산 및 필터/정렬은 캐시 이후 요청별로 수행 (origin이 요청마다 다를 수 있음)
  const origin = { lat, lng };
  return stations
    .map((s) => ({
      ...s,
      distanceKm: Number(haversineKm(origin, { lat: s.lat, lng: s.lng }).toFixed(1)),
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Vercel 서버리스 핸들러.
 * GET /api/chargers?lat=&lng=&radius=
 */
export default async function handler(req, res) {
  try {
    const { lat, lng, radius } = req.query;

    if (!lat || !lng) {
      res.status(400).json({ error: 'lat and lng query parameters are required' });
      return;
    }

    const stations = await fetchStations({
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: Number(radius) || 10,
      key: process.env.DATA_GO_KR_KEY,
    });

    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ stations });
  } catch (e) {
    // key가 error message에 포함되지 않도록 detail은 string화만
    res.status(502).json({ error: 'upstream failed', detail: String(e.message ?? e) });
  }
}
