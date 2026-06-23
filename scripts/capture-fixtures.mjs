// 실제 공공 API 응답을 fixture로 고정한다 (서울 zcode=11, 소량).
// 공공 API가 가끔 401(활성화 직후)/502/504를 내므로 재시도한다.
import { writeFile, mkdir } from 'node:fs/promises';

const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) { console.error('DATA_GO_KR_KEY 없음 (.env.local 확인)'); process.exit(1); }

const BASE = 'https://apis.data.go.kr/B552584/EvCharger';
const common = `serviceKey=${encodeURIComponent(KEY)}&numOfRows=50&pageNo=1&dataType=JSON&zcode=11`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(path, out) {
  for (let i = 1; i <= 8; i++) {
    try {
      const res = await fetch(`${BASE}/${path}?${common}`);
      const text = await res.text();
      let ok = false;
      try { ok = JSON.parse(text)?.resultMsg?.includes('NORMAL'); } catch {}
      if (res.status === 200 && ok) {
        await writeFile(out, text);
        const n = JSON.parse(text)?.items?.item?.length ?? 0;
        console.log(`saved ${out} (${text.length} bytes, ${n} items)`);
        return;
      }
      console.log(`${path} attempt ${i}: status=${res.status}, retrying...`);
    } catch (e) {
      console.log(`${path} attempt ${i}: error ${String(e).slice(0, 50)}`);
    }
    await sleep(3000);
  }
  throw new Error(`${path}: failed after retries`);
}

await mkdir('test/fixtures', { recursive: true });
await grab('getChargerInfo', 'test/fixtures/charger-info-sample.json');
await grab('getChargerStatus', 'test/fixtures/charger-status-sample.json');
console.log('done');
