// B안 사전 빌드: 시도(zcode) 단위로 전체 충전기를 받아 시군구(zscode)별로 나눠 KV에 저장.
// 앱은 KV에서 즉시 읽으므로 콜드 호출이 없다. 정기 실행(맥미니/깃허브)으로 신선도 유지.
// 실행: node --env-file=.env.local scripts/build-all.mjs [시도코드,콤마구분]  (기본 수도권 11,28,41)
import { fetchWithRetry } from '../lib/govapi.js';
import { parseItems, buildStations } from '../lib/chargers.js';
import { createKvStore } from '../lib/store.js';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 없음'); process.exit(1); }
const BASE = 'https://apis.data.go.kr/B552584/EvCharger';
const NUM = 9999;
const store = createKvStore();

const SIDOS = (process.argv[2] || '11,28,41').split(',').map((s) => s.trim()).filter(Boolean);

async function fetchSido(zcode) {
  const items = [];
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const url = `${BASE}/getChargerInfo?serviceKey=${encodeURIComponent(KEY)}&zcode=${zcode}&pageNo=${pageNo}&numOfRows=${NUM}&dataType=JSON`;
    const json = await fetchWithRetry(globalThis.fetch, url);
    const page = parseItems(json);
    items.push(...page);
    if (page.length < NUM) break;
  }
  return items;
}

let totalZs = 0;
for (const zcode of SIDOS) {
  const t = Date.now();
  let items;
  try { items = await fetchSido(zcode); }
  catch (e) { console.log(`시도 ${zcode}: 실패 ${String(e.message || e).slice(0, 60)}`); continue; }

  const byZs = {};
  for (const it of items) {
    const zs = String(it.zscode || '').trim();
    if (!/^\d{5}$/.test(zs)) continue;          // 유효한 시군구 코드만
    (byZs[zs] ??= []).push(it);
  }

  let stored = 0;
  for (const [zscode, group] of Object.entries(byZs)) {
    const stations = buildStations(group, group);
    await store.setSnapshot(zscode, { stations, updatedAt: Date.now() });
    stored++;
  }
  totalZs += stored;
  console.log(`시도 ${zcode}: ${items.length} chargers → ${stored} 시군구 저장 (${((Date.now() - t) / 1000).toFixed(0)}s)`);
}
console.log(`build done: ${totalZs} 시군구 in KV`);
