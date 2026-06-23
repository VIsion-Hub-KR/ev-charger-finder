import { parseItems, buildStations } from '../lib/chargers.js';
import { haversineKm } from '../lib/geo.js';
import { createCache } from '../lib/cache.js';

const BASE = 'https://apis.data.go.kr/B552584/EvCharger';
const NUM_OF_ROWS = 9999;
const MAX_PAGES = 5; // 시군구 단위는 작으므로 5페이지면 충분

// 모듈 수준 캐시: zscode → Station[] (2분 TTL)
// 캐시 키는 s:${zscode}이므로 같은 시군구 내 다른 좌표도 동일 캐시를 재사용.
// 거리/반경 필터는 캐시 조회 이후 요청별로 수행.
const cache = createCache({ ttlMs: 120_000 });

// getChargerInfo carries its own stat field; we use getChargerInfo exclusively
// and pass its items as both infoItems and statusItems to buildStations so every
// charger's own stat field is picked up correctly.

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
 * getChargerInfo 페이지네이션 (시군구 단위).
 * numOfRows=9999로 반환 수가 numOfRows 미만이 될 때까지 페이지를 순회한다.
 * 최대 MAX_PAGES(5)까지만 조회하고, 도달 시 경고한다.
 */
async function fetchAllInfoItemsByZscode(fetchImpl, key, zscode) {
  const encoded = encodeURIComponent(key);
  const zcode = String(zscode).slice(0, 2); // 시군구 앞 2자리 = 시도코드
  const allItems = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const url =
      `${BASE}/getChargerInfo` +
      `?serviceKey=${encoded}&zcode=${zcode}&zscode=${zscode}&pageNo=${pageNo}` +
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
        `[chargers] zscode=${zscode}: MAX_PAGES(${MAX_PAGES}) 도달. 데이터가 더 있을 수 있음.`,
      );
    }
  }

  return allItems;
}

/**
 * 주어진 좌표 반경 내 충전소 목록을 거리 오름차순으로 반환한다.
 *
 * @param {{ lat: number, lng: number, radiusKm?: number, zscodes: string[], fetchImpl?: Function, key: string }} opts
 * @returns {Promise<Station[]>}
 */
export async function fetchStations({
  lat,
  lng,
  radiusKm = 10,
  zscodes,
  fetchImpl = globalThis.fetch,
  key,
}) {
  // 각 시군구별로 캐시 조회 → 미스 시 API 호출 → Station[] 빌드 후 캐시 저장
  const perZscodeStations = await Promise.all(
    zscodes.map(async (zscode) => {
      const cacheKey = `s:${zscode}`;
      let stations = cache.get(cacheKey);

      if (!stations) {
        const infoItems = await fetchAllInfoItemsByZscode(fetchImpl, key, zscode);
        // infoItems를 info와 status 양쪽에 전달해 stat 필드를 자기 자신에서 읽도록 한다.
        stations = buildStations(infoItems, infoItems);
        cache.set(cacheKey, stations);
      }

      return stations;
    }),
  );

  // 여러 시군구 결과를 합치고 statId 기준으로 중복 제거
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

  // 거리 계산 및 필터/정렬은 캐시 이후 요청별로 수행 (origin이 요청마다 다를 수 있음)
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
 * Vercel 서버리스 핸들러.
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

    // zscode는 단일값 또는 콤마 구분 복수값
    const zscodes = String(zscode).split(',').map((s) => s.trim()).filter(Boolean);

    const stations = await fetchStations({
      lat: Number(lat),
      lng: Number(lng),
      radiusKm: Number(radius) || 10,
      zscodes,
      key: process.env.DATA_GO_KR_KEY,
    });

    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ stations });
  } catch (e) {
    // key가 error message에 포함되지 않도록 detail은 string화만
    res.status(502).json({ error: 'upstream failed', detail: String(e.message ?? e) });
  }
}
