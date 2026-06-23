// 한국 테슬라 슈퍼차저(운영중) 좌표를 supercharge.info 공개 데이터에서 받아
// public/tesla-superchargers.json 으로 저장한다. (테슬라 위치는 자주 안 바뀌므로 가끔 수동 실행)
import { writeFile } from 'node:fs/promises';

const API_URL = 'https://supercharge.info/service/supercharge/allSites';
const res = await fetch(API_URL, { headers: { accept: 'application/json' } });
if (!res.ok) throw new Error(`supercharge.info ${res.status}`);
const all = await res.json();

const kr = all
  .filter((s) => s.address?.country === 'South Korea' && s.status === 'OPEN' && s.gps)
  .map((s) => ({
    name: s.name,
    lat: s.gps.latitude,
    lng: s.gps.longitude,
    stalls: s.stallCount ?? null,
  }))
  .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');

await writeFile(
  new URL('../public/tesla-superchargers.json', import.meta.url),
  JSON.stringify(kr, null, 2),
);
console.log(`saved ${kr.length} OPEN Korea superchargers -> public/tesla-superchargers.json`);
console.log('sample:', JSON.stringify(kr.slice(0, 3)));
