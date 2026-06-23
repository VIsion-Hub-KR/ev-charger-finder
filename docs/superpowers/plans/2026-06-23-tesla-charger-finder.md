# 테슬라·전기차 충전소 찾기 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 네이버 지도 위에 내 주변 전기차 충전소를 표시하고 실시간 빈자리 수를 보여주는 모바일 우선 웹앱을 만든다. 테슬라 슈퍼차저는 강조한다.

**Architecture:** 정적 프론트엔드(HTML/CSS/바닐라 JS + 네이버 지도 Maps JS SDK)가 Vercel 서버리스 함수(`/api/chargers`)를 호출한다. 서버리스 함수는 한국환경공단 공공 API를 호출해 비밀키를 숨기고, 충전소 기본정보와 실시간 상태를 합쳐 위치 반경으로 걸러 응답한다(짧은 TTL 캐시로 1일 1,000건 제한 대응). 데이터 처리 로직은 순수 함수로 분리해 `node:test`로 단위 테스트한다. 지도 UI는 브라우저에서 수동 확인한다.

**Tech Stack:** Node.js(ESM, 서버리스), Vercel, 바닐라 HTML/CSS/JS, 네이버 지도 Maps JS v3 SDK, `node --test`(내장, 의존성 0), 한국환경공단 공공 API.

## Global Constraints

- 비밀키(공공 API 키)는 서버 환경변수에만 둔다. 프론트엔드에 절대 노출 금지. (네이버 지도 client 키는 프론트에 노출되는 게 정상이며 도메인 제한으로 보호)
- 새 의존성 추가는 최소화한다. 테스트는 내장 `node --test` 사용(런타임 의존성 0 목표).
- 한글 가독성: CSS에 `word-break:keep-all` 적용, 좁은 영역에 긴 문장 금지.
- 마커/아이콘은 이모지가 아니라 SVG로 구현한다.
- 개별 차량의 "충전 잔여시간"은 데이터가 없으므로 구현하지 않는다(실시간 "빈자리 수"만).
- 커밋은 각 Task 끝에서. 푸시/배포는 사용자 요청 시에만.
- API 필드명·코드표(chgerType, stat)는 Task 2에서 받은 실제 응답으로 확정한 뒤 사용한다(추측 금지).

---

### Task 1: 프로젝트 뼈대 + 테스트 러너

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.gitignore`
- Create: `test/smoke.test.js`

**Interfaces:**
- Produces: `npm test`가 `node --test`로 `test/**/*.test.js`를 실행하는 환경.

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "ev-charger-finder",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: vercel.json 작성** (정적 프론트는 public/, 함수는 api/)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": null,
  "outputDirectory": "public"
}
```

- [ ] **Step 3: .gitignore 작성**

```
node_modules/
.env.local
.vercel/
.superpowers/
.DS_Store
```

- [ ] **Step 4: 스모크 테스트 작성** `test/smoke.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 5: 테스트 실행해 통과 확인**

Run: `npm test`
Expected: PASS (1 test passed)

- [ ] **Step 6: 커밋**

```bash
git init && git add -A && git commit -m "chore: project scaffold + test runner"
```
(이미 git 저장소면 `git init` 생략. 새 저장소는 비공개 유지.)

---

### Task 2: (사용자 필요) 실제 API 응답 샘플을 fixture로 고정

> **이 Task는 디렉터가 공공데이터 인증키를 발급해 줘야 진행 가능하다.** 이후 모든 파서는 여기서 받은 "진짜 응답"을 기준으로 만든다(필드명·코드값 추측 금지).

**Files:**
- Create: `.env.local` (키 저장, gitignore됨)
- Create: `scripts/capture-fixtures.mjs`
- Create: `test/fixtures/charger-info-sample.json`
- Create: `test/fixtures/charger-status-sample.json`
- Create: `docs/api-field-notes.md`

**Interfaces:**
- Produces: 실제 응답 JSON 2개(fixture) + 확정된 필드명/코드표 메모(`docs/api-field-notes.md`).

- [ ] **Step 1: 디렉터에게 키 요청 후 .env.local에 저장**

```
DATA_GO_KR_KEY=발급받은_디코딩된_서비스키
```
(공공데이터포털 "한국환경공단_전기자동차 충전소 정보" 활용신청 → 일반 인증키. 단계는 빌드 시 안내.)

- [ ] **Step 2: 캡처 스크립트 작성** `scripts/capture-fixtures.mjs`

```js
// 서울(zcode 11) 1페이지 소량만 받아 fixture로 저장
import { writeFile } from 'node:fs/promises';

const KEY = process.env.DATA_GO_KR_KEY;
const BASE = 'http://apis.data.go.kr/B552584/EvCharger';
const common = `serviceKey=${encodeURIComponent(KEY)}&numOfRows=50&pageNo=1&dataType=JSON&zcode=11`;

async function grab(path, out) {
  const res = await fetch(`${BASE}/${path}?${common}`);
  const text = await res.text();
  await writeFile(out, text);
  console.log(`saved ${out} (${text.length} bytes)`);
}

await grab('getChargerInfo', 'test/fixtures/charger-info-sample.json');
await grab('getChargerStatus', 'test/fixtures/charger-status-sample.json');
```

- [ ] **Step 3: 캡처 실행**

Run: `node --env-file=.env.local scripts/capture-fixtures.mjs`
Expected: 두 파일 저장됨. 각 파일을 열어 실제 필드명 확인.

- [ ] **Step 4: 필드명·코드표 확정 메모 작성** `docs/api-field-notes.md`

fixture를 보고 다음을 적는다(빈칸 없이 실제 값으로):
- 응답 경로: 예) `response.body.items.item[]`
- 위경도 필드명: 예) `lat`, `lng`
- 충전기 타입 필드: `chgerType` + 실제로 등장한 코드값 목록
- 상태 필드: `stat` + 실제 코드값 목록, 상태갱신시각 필드
- 충전소/충전기 식별자: `statId`(충전소), `chgerId`(충전기) 등
- 운영기관/주소/충전용량 필드명

- [ ] **Step 5: 커밋**

```bash
git add scripts/capture-fixtures.mjs test/fixtures docs/api-field-notes.md
git commit -m "test: capture real public API fixtures + field notes"
```
(`.env.local`은 커밋되지 않음을 확인)

---

### Task 3: 거리 계산 (geo.js)

**Files:**
- Create: `lib/geo.js`
- Test: `test/geo.test.js`

**Interfaces:**
- Produces: `haversineKm(a, b)` — `{lat, lng}` 두 점 사이 거리(km, number). `boundingBox(center, radiusKm)` — `{minLat, maxLat, minLng, maxLng}`.

- [ ] **Step 1: 실패 테스트 작성** `test/geo.test.js`

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL (Cannot find module '../lib/geo.js')

- [ ] **Step 3: 구현** `lib/geo.js`

```js
const R = 6371; // km
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function boundingBox(center, radiusKm) {
  const dLat = radiusKm / 111; // 위도 1도 ≈ 111km
  const dLng = radiusKm / (111 * Math.cos(toRad(center.lat)));
  return {
    minLat: center.lat - dLat, maxLat: center.lat + dLat,
    minLng: center.lng - dLng, maxLng: center.lng + dLng,
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/geo.js test/geo.test.js
git commit -m "feat: haversine distance + bounding box"
```

---

### Task 4: 분류 (classify.js) — 충전기 타입·상태

> Task 2의 `docs/api-field-notes.md`에서 확인한 **실제 코드값**으로 표를 채운다. 아래 표는 일반적으로 알려진 기본값이며, fixture와 다르면 fixture를 따른다.

**Files:**
- Create: `lib/classify.js`
- Test: `test/classify.test.js`

**Interfaces:**
- Produces:
  - `classifyCharger(chgerType)` → `{ speed: '급속'|'완속', connectors: string[] }`
  - `classifyStatus(stat)` → `{ available: boolean, label: string }`

- [ ] **Step 1: 실패 테스트 작성** `test/classify.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCharger, classifyStatus } from '../lib/classify.js';

test('classifyCharger: DC콤보(04)는 급속', () => {
  const r = classifyCharger('04');
  assert.equal(r.speed, '급속');
  assert.ok(r.connectors.includes('DC콤보'));
});

test('classifyCharger: AC완속(02)은 완속', () => {
  assert.equal(classifyCharger('02').speed, '완속');
});

test('classifyCharger: 알 수 없는 코드는 급속+기타로 안전 처리', () => {
  const r = classifyCharger('99');
  assert.equal(r.connectors[0], '기타');
});

test('classifyStatus: 2=충전대기는 사용가능', () => {
  const r = classifyStatus('2');
  assert.equal(r.available, true);
});

test('classifyStatus: 3=충전중은 사용불가', () => {
  assert.equal(classifyStatus('3').available, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL (module not found)

- [ ] **Step 3: 구현** `lib/classify.js`

```js
// chgerType 코드표 (Task 2 fixture로 확정). 키=코드, 값=커넥터 목록.
const CHARGER_TYPES = {
  '01': ['DC차데모'],
  '02': ['AC완속'],
  '03': ['DC차데모', 'AC3상'],
  '04': ['DC콤보'],
  '05': ['DC차데모', 'DC콤보'],
  '06': ['DC차데모', 'AC3상', 'DC콤보'],
  '07': ['AC3상'],
};
const SLOW = new Set(['02']); // 완속으로 분류할 코드 (fixture로 확정)

export function classifyCharger(chgerType) {
  const connectors = CHARGER_TYPES[chgerType] ?? ['기타'];
  const speed = SLOW.has(chgerType) ? '완속' : '급속';
  return { speed, connectors };
}

const STATUS = {
  '1': { available: false, label: '통신이상' },
  '2': { available: true, label: '사용가능' },
  '3': { available: false, label: '충전중' },
  '4': { available: false, label: '운영중지' },
  '5': { available: false, label: '점검중' },
  '9': { available: false, label: '상태미확인' },
};

export function classifyStatus(stat) {
  return STATUS[String(stat)] ?? { available: false, label: '알수없음' };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/classify.js test/classify.test.js
git commit -m "feat: charger type + status classification"
```

---

### Task 5: 파싱·병합·집계 (chargers.js)

**Files:**
- Create: `lib/chargers.js`
- Test: `test/chargers.test.js`
- Test: `test/fixtures/info-mini.json`, `test/fixtures/status-mini.json` (Task 2 실제 응답에서 2~3개 충전소만 추려 만든 소형 fixture)

**Interfaces:**
- Consumes: `classifyCharger`, `classifyStatus` (Task 4), `haversineKm` (Task 3).
- Produces:
  - `parseItems(rawJson)` → `Array<rawItem>` (응답 경로에서 item 배열 추출)
  - `buildStations(infoItems, statusItems, origin?)` → `Array<Station>`
    - `Station = { statId, name, lat, lng, addr, busiNm, speed, connectors:string[], totalCount, availableCount, statusLabel, lastUpdate, distanceKm|null, isTesla:false }`

- [ ] **Step 1: 소형 fixture 만들기** — Task 2의 실제 응답에서 충전소 2~3곳(각 충전기 여러 대 포함)만 잘라 `info-mini.json`, `status-mini.json`로 저장. (실제 필드명 그대로 유지)

- [ ] **Step 2: 실패 테스트 작성** `test/chargers.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseItems, buildStations } from '../lib/chargers.js';

const info = JSON.parse(await readFile(new URL('./fixtures/info-mini.json', import.meta.url)));
const status = JSON.parse(await readFile(new URL('./fixtures/status-mini.json', import.meta.url)));

test('parseItems: item 배열을 추출한다', () => {
  const items = parseItems(info);
  assert.ok(Array.isArray(items) && items.length > 0);
});

test('buildStations: 충전소 단위로 묶고 사용가능 대수를 센다', () => {
  const stations = buildStations(parseItems(info), parseItems(status));
  assert.ok(stations.length > 0);
  const s = stations[0];
  assert.ok(typeof s.totalCount === 'number' && s.totalCount >= 1);
  assert.ok(s.availableCount <= s.totalCount);
  assert.ok(s.lat && s.lng && s.name);
});

test('buildStations: origin 주면 거리 계산', () => {
  const stations = buildStations(parseItems(info), parseItems(status), { lat: 37.5, lng: 127 });
  assert.ok(stations.every((s) => typeof s.distanceKm === 'number'));
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm test`
Expected: FAIL (module not found)

- [ ] **Step 4: 구현** `lib/chargers.js` — **필드명은 Task 2에서 확정한 실제 이름으로 바꿔 넣는다.** 아래는 표준 필드명 기준 초안.

```js
import { classifyCharger, classifyStatus } from './classify.js';
import { haversineKm } from './geo.js';

export function parseItems(raw) {
  const item = raw?.response?.body?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

export function buildStations(infoItems, statusItems, origin) {
  const statusByCharger = new Map();
  for (const s of statusItems) statusByCharger.set(`${s.statId}:${s.chgerId}`, s);

  const byStation = new Map();
  for (const it of infoItems) {
    const key = it.statId;
    if (!byStation.has(key)) {
      byStation.set(key, {
        statId: it.statId,
        name: it.statNm,
        lat: Number(it.lat),
        lng: Number(it.lng),
        addr: it.addr,
        busiNm: it.busiNm,
        connectors: new Set(),
        speeds: new Set(),
        totalCount: 0,
        availableCount: 0,
        lastUpdate: null,
      });
    }
    const st = byStation.get(key);
    const cls = classifyCharger(it.chgerType);
    cls.connectors.forEach((c) => st.connectors.add(c));
    st.speeds.add(cls.speed);
    st.totalCount += 1;

    const status = statusByCharger.get(`${it.statId}:${it.chgerId}`);
    if (status) {
      if (classifyStatus(status.stat).available) st.availableCount += 1;
      if (status.statUpdDt && (!st.lastUpdate || status.statUpdDt > st.lastUpdate)) {
        st.lastUpdate = status.statUpdDt;
      }
    }
  }

  return [...byStation.values()].map((st) => ({
    statId: st.statId,
    name: st.name,
    lat: st.lat,
    lng: st.lng,
    addr: st.addr,
    busiNm: st.busiNm,
    speed: st.speeds.has('급속') ? '급속' : '완속',
    connectors: [...st.connectors],
    totalCount: st.totalCount,
    availableCount: st.availableCount,
    statusLabel: st.availableCount > 0 ? '사용가능' : '만차/점검',
    lastUpdate: st.lastUpdate,
    distanceKm: origin ? Number(haversineKm(origin, { lat: st.lat, lng: st.lng }).toFixed(1)) : null,
    isTesla: false,
  }));
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/chargers.js test/chargers.test.js test/fixtures/info-mini.json test/fixtures/status-mini.json
git commit -m "feat: parse + merge info/status into stations with availability"
```

---

### Task 6: TTL 캐시 (cache.js)

**Files:**
- Create: `lib/cache.js`
- Test: `test/cache.test.js`

**Interfaces:**
- Produces: `createCache({ ttlMs, now })` → `{ get(key), set(key, value) }`. 만료 시 `get`은 `undefined`.

- [ ] **Step 1: 실패 테스트 작성** `test/cache.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../lib/cache.js';

test('TTL 안에서는 값을 돌려준다', () => {
  let t = 1000;
  const c = createCache({ ttlMs: 100, now: () => t });
  c.set('k', 'v');
  t = 1050;
  assert.equal(c.get('k'), 'v');
});

test('TTL 지나면 만료', () => {
  let t = 1000;
  const c = createCache({ ttlMs: 100, now: () => t });
  c.set('k', 'v');
  t = 1200;
  assert.equal(c.get('k'), undefined);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 구현** `lib/cache.js`

```js
export function createCache({ ttlMs, now = () => Date.now() }) {
  const store = new Map();
  return {
    get(key) {
      const e = store.get(key);
      if (!e) return undefined;
      if (now() - e.t > ttlMs) { store.delete(key); return undefined; }
      return e.v;
    },
    set(key, value) { store.set(key, { v: value, t: now() }); },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/cache.js test/cache.test.js
git commit -m "feat: simple TTL cache"
```

---

### Task 7: 서버리스 핸들러 (api/chargers.js)

**Files:**
- Create: `api/chargers.js`
- Test: `test/api-chargers.test.js`

**Interfaces:**
- Consumes: `buildStations`, `parseItems` (Task 5), `boundingBox`/`haversineKm` (Task 3), `createCache` (Task 6).
- Produces: 기본 export `handler(req, res)` (Vercel Node 함수). 핵심 로직은 테스트를 위해 `fetchStations({ lat, lng, radiusKm, fetchImpl, key })`로 분리해 export.
- 응답: `{ stations: Station[] }` (반경 내, 거리 오름차순).

- [ ] **Step 1: 실패 테스트 작성** `test/api-chargers.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchStations } from '../api/chargers.js';

const infoText = await readFile(new URL('./fixtures/info-mini.json', import.meta.url), 'utf8');
const statusText = await readFile(new URL('./fixtures/status-mini.json', import.meta.url), 'utf8');

// getChargerInfo / getChargerStatus를 구분해 가짜 응답을 주는 fetch
const fakeFetch = async (url) => ({
  ok: true,
  text: async () => (url.includes('getChargerStatus') ? statusText : infoText),
});

test('fetchStations: 반경 내 충전소를 거리순으로 반환', async () => {
  const origin = { lat: 37.5, lng: 127.0 }; // fixture 좌표에 맞춰 조정
  const stations = await fetchStations({
    ...origin, radiusKm: 50, fetchImpl: fakeFetch, key: 'test',
  });
  assert.ok(Array.isArray(stations));
  for (let i = 1; i < stations.length; i++) {
    assert.ok(stations[i].distanceKm >= stations[i - 1].distanceKm);
  }
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: 구현** `api/chargers.js`

```js
import { parseItems, buildStations } from '../lib/chargers.js';
import { haversineKm } from '../lib/geo.js';
import { createCache } from '../lib/cache.js';

const BASE = 'http://apis.data.go.kr/B552584/EvCharger';
const cache = createCache({ ttlMs: 120000 }); // 2분

// zcode(시도)는 좌표→코드 매핑이 필요. 초기엔 넓게 전국 대신 좌표 근처 시도코드 사용.
// 빌드 시 좌표→zcode 매핑 테이블을 lib/region.js로 추가(아래 Step 참고).
function regionFor(lat, lng) {
  // 임시: 수도권 기본. region.js 도입 후 교체.
  return '11';
}

export async function fetchStations({ lat, lng, radiusKm = 10, fetchImpl = fetch, key }) {
  const zcode = regionFor(lat, lng);
  const cacheKey = `z:${zcode}`;
  let stations = cache.get(cacheKey);
  if (!stations) {
    const common = `serviceKey=${encodeURIComponent(key)}&numOfRows=9999&pageNo=1&dataType=JSON&zcode=${zcode}`;
    const [infoRes, statusRes] = await Promise.all([
      fetchImpl(`${BASE}/getChargerInfo?${common}`),
      fetchImpl(`${BASE}/getChargerStatus?${common}`),
    ]);
    const info = parseItems(JSON.parse(await infoRes.text()));
    const status = parseItems(JSON.parse(await statusRes.text()));
    stations = buildStations(info, status);
    cache.set(cacheKey, stations);
  }
  const origin = { lat, lng };
  return stations
    .map((s) => ({ ...s, distanceKm: Number(haversineKm(origin, { lat: s.lat, lng: s.lng }).toFixed(1)) }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export default async function handler(req, res) {
  try {
    const { lat, lng, radius } = req.query;
    if (!lat || !lng) { res.status(400).json({ error: 'lat,lng required' }); return; }
    const stations = await fetchStations({
      lat: Number(lat), lng: Number(lng), radiusKm: Number(radius) || 10,
      key: process.env.DATA_GO_KR_KEY,
    });
    res.setHeader('Cache-Control', 's-maxage=120');
    res.status(200).json({ stations });
  } catch (e) {
    res.status(502).json({ error: 'upstream failed', detail: String(e) });
  }
}
```

- [ ] **Step 4: 통과 확인** (테스트의 origin/radius는 mini fixture 좌표에 맞게 조정)

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 좌표→시도코드 매핑 추가** `lib/region.js` — 16개 시도 대략 중심 좌표로 가장 가까운 zcode 선택. `regionFor`를 이걸로 교체하고 간단 테스트 1개 추가(서울 좌표→'11'). 통과 확인 후 함께 커밋.

- [ ] **Step 6: 커밋**

```bash
git add api/chargers.js lib/region.js test/api-chargers.test.js
git commit -m "feat: /api/chargers serverless handler with cache + region mapping"
```

---

### Task 8: 테슬라 슈퍼차저 강조 데이터

**Files:**
- Create: `data/tesla-superchargers.json`
- Modify: `lib/chargers.js` (테슬라 표시 함수 추가)
- Test: `test/tesla.test.js`

**Interfaces:**
- Produces: `markTesla(stations, teslaList)` → 각 station의 `isTesla`를 좌표 근접(예: 200m 이내) 또는 이름 매칭으로 true 설정. `teslaList = [{name, lat, lng}]`.

- [ ] **Step 1: 테슬라 좌표 데이터 준비** — 디렉터의 네이버 즐겨찾기(테슬라 슈퍼차저) 목록에서 이름·좌표를 추출해 `data/tesla-superchargers.json`로 저장. (추출 방법은 빌드 시 디렉터와 확정: 공유 링크 파싱 또는 수기 입력)

```json
[
  { "name": "예시 슈퍼차저", "lat": 37.5, "lng": 127.0 }
]
```

- [ ] **Step 2: 실패 테스트 작성** `test/tesla.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markTesla } from '../lib/chargers.js';

test('markTesla: 200m 이내 충전소를 테슬라로 표시', () => {
  const stations = [{ name: 'A', lat: 37.5000, lng: 127.0000, isTesla: false }];
  const out = markTesla(stations, [{ name: 'T', lat: 37.5001, lng: 127.0001 }]);
  assert.equal(out[0].isTesla, true);
});

test('markTesla: 멀면 그대로', () => {
  const stations = [{ name: 'A', lat: 37.5, lng: 127.0, isTesla: false }];
  const out = markTesla(stations, [{ name: 'T', lat: 38.0, lng: 128.0 }]);
  assert.equal(out[0].isTesla, false);
});
```

- [ ] **Step 3: 실패 확인** → `npm test` FAIL

- [ ] **Step 4: 구현** — `lib/chargers.js`에 추가:

```js
import { haversineKm } from './geo.js'; // 이미 import되어 있으면 생략

export function markTesla(stations, teslaList) {
  return stations.map((s) => {
    const near = teslaList.some((t) => haversineKm(s, { lat: t.lat, lng: t.lng }) <= 0.2);
    return near ? { ...s, isTesla: true } : s;
  });
}
```

- [ ] **Step 5: 핸들러에 연결** — `api/chargers.js`에서 데이터 로드 후 `markTesla(stations, teslaList)` 적용. 통과 확인.

- [ ] **Step 6: 커밋**

```bash
git add data/tesla-superchargers.json lib/chargers.js api/chargers.js test/tesla.test.js
git commit -m "feat: highlight Tesla superchargers"
```

---

### Task 9: 프론트 — 지도 + 내 위치 (수동 확인)

> UI는 단위 테스트 대신 **브라우저 실제 확인**으로 검증한다(정직한 검증).

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: 네이버 지도 Maps JS SDK, `/api/chargers`.
- Produces: 지도 렌더 + 내 위치 표시.

- [ ] **Step 1: 네이버 지도 키·SDK 로딩 방식 확정** — context7/공식 문서로 현재 스크립트 URL 파라미터명(`ncpKeyId` 등) 확인 후 `index.html`에 반영. 키는 도메인 제한 설정.

- [ ] **Step 2: index.html 작성** (검색바·필터칩·지도 컨테이너·바텀시트 골격, 모바일 뷰포트, word-break:keep-all). 마커/아이콘은 SVG.

- [ ] **Step 3: app.js — 지도 초기화 + Geolocation으로 내 위치 중심 이동**, 권한 거부 시 서울시청 기본 위치 + 안내.

- [ ] **Step 4: 로컬에서 브라우저 확인**

Run: `vercel dev` (또는 정적 서버 + 함수). 브라우저에서 지도 표시·내 위치 파란 점 확인.
Expected: 지도가 뜨고 내 위치가 표시됨.

- [ ] **Step 5: 커밋**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: map view + my location"
```

---

### Task 10: 프론트 — 충전소 마커 + 상세 카드 (수동 확인)

**Files:**
- Modify: `public/app.js`, `public/styles.css`

**Interfaces:**
- Consumes: `/api/chargers?lat&lng&radius` 응답 `{ stations }`.
- Produces: 마커(색 규칙) + 클릭 시 바텀시트 상세.

- [ ] **Step 1: 지도 중심 기준 `/api/chargers` 호출 → 마커 렌더.** 색 규칙: 초록=빈자리(availableCount>0), 빨강=isTesla, 회색=만차/점검. 마커 안 숫자=availableCount.

- [ ] **Step 2: 마커 클릭 → 바텀시트**에 이름/실시간 빈자리("급속 N대 중 M대 사용가능")/커넥터·속도/운영기관/거리/"마지막 갱신 시각"/네이버 길찾기 버튼 표시.

- [ ] **Step 3: 브라우저 확인** — 마커 색·숫자·카드 내용이 응답과 일치하는지 눈으로 확인. (실데이터로 빈자리 수가 합리적인지 점검)

- [ ] **Step 4: 커밋**

```bash
git add public/app.js public/styles.css
git commit -m "feat: charger markers + detail bottom sheet"
```

---

### Task 11: 프론트 — 필터 + 2D 지도 토글 + 주소검색 + 길찾기 (수동 확인)

**Files:**
- Modify: `public/app.js`, `public/index.html`, `public/styles.css`

- [ ] **Step 1: 필터 칩** (전체/급속/완속/테슬라/빈자리만) — 켜면 마커 필터링.
- [ ] **Step 2: 간단 2D 지도 토글 버튼** — 네이버 지도 mapType 전환(일반↔간략). 빌드 시 가장 단순한 뷰 옵션 확인.
- [ ] **Step 3: 주소·지명 검색** — 입력 시 네이버 지오코딩으로 좌표 이동 후 그 주변 재조회.
- [ ] **Step 4: 지도 이동(드래그/줌) 시 디바운스 후 재조회** (300~500ms).
- [ ] **Step 5: 네이버 길찾기 버튼** — 카드의 좌표로 네이버 지도 길찾기 URL/SDK 호출.
- [ ] **Step 6: 브라우저 확인** — 각 필터·토글·검색·길찾기 동작 확인.
- [ ] **Step 7: 커밋**

```bash
git add public/app.js public/index.html public/styles.css
git commit -m "feat: filters + 2D toggle + address search + directions"
```

---

### Task 12: Vercel 배포 (사용자 요청 시)

**Files:**
- Modify: (없음 — 환경변수·배포만)

- [ ] **Step 1: Vercel 프로젝트에 환경변수 `DATA_GO_KR_KEY` 설정** (서버 전용).
- [ ] **Step 2: 네이버 지도 키 도메인 허용목록에 배포 도메인 추가.**
- [ ] **Step 3: 배포** — 디렉터가 "배포해"라고 하면 `vercel deploy --prod --yes` 실행.
- [ ] **Step 4: 배포 URL에서 모바일로 동작 확인** — 위치 권한, 충전소 표시, 실시간 빈자리, 길찾기.
- [ ] **Step 5: 커밋/마무리 보고.**

---

## Self-Review (작성자 점검 결과)

- **스펙 커버리지**: 내위치(T9)·주소검색(T11)·마커/색(T10)·실시간 빈자리(T5,T7,T10)·상세카드(T10)·필터(T11)·테슬라 강조(T8)·2D 토글(T11)·길찾기(T11)·데이터/캐시/키보안(T6,T7,T2)·배포(T12) 모두 매핑됨.
- **불가능 항목**(충전 잔여시간)은 Global Constraints에 "구현 안 함"으로 명시 — 누락 아님.
- **플레이스홀더**: API 필드명/코드표는 의도적으로 Task 2의 실제 fixture로 확정하도록 설계(추측 방지). UI Task는 단위테스트 대신 브라우저 수동확인으로 정직하게 검증.
- **타입 일관성**: `Station` 형태(statId,name,lat,lng,addr,busiNm,speed,connectors,totalCount,availableCount,statusLabel,lastUpdate,distanceKm,isTesla)를 T5에서 정의하고 T7/T8/T10에서 동일하게 사용. `parseItems`/`buildStations`/`fetchStations`/`markTesla`/`classifyCharger`/`classifyStatus`/`createCache`/`haversineKm`/`boundingBox` 이름 일치 확인.
- **미해결(빌드 중 확정)**: 좌표→zcode 매핑 정밀도, 네이버 SDK 스크립트 파라미터명, chgerType/stat 실제 코드값, 테슬라 즐겨찾기 추출 방법 — 각 Task 안에 확정 단계로 포함됨.
