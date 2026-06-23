import { parseItems, buildStations } from '../lib/chargers.js';
import { haversineKm } from '../lib/geo.js';
import { createCache } from '../lib/cache.js';
import { regionFor } from '../lib/region.js';

const BASE = 'https://apis.data.go.kr/B552584/EvCharger';

// 모듈 수준 캐시: zcode → Station[] (2분 TTL)
// 캐시 키는 zcode이므로 같은 시도 내 다른 좌표도 동일 캐시를 재사용.
// 거리/반경 필터는 캐시 조회 이후 요청별로 수행.
const cache = createCache({ ttlMs: 120_000 });

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
    // key는 절대 로그에 노출하지 않음
    const encoded = encodeURIComponent(key);
    const common = `serviceKey=${encoded}&numOfRows=9999&pageNo=1&dataType=JSON&zcode=${zcode}`;

    const [infoRes, statusRes] = await Promise.all([
      fetchImpl(`${BASE}/getChargerInfo?${common}`),
      fetchImpl(`${BASE}/getChargerStatus?${common}`),
    ]);

    const infoRaw = JSON.parse(await infoRes.text());
    const statusRaw = JSON.parse(await statusRes.text());

    const infoItems = parseItems(infoRaw);
    const statusItems = parseItems(statusRaw);

    // buildStations without origin → distanceKm = null (계산은 아래에서 수행)
    stations = buildStations(infoItems, statusItems);
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
