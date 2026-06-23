# 공공 API 실제 응답 필드 노트 (검증 완료)

출처: 한국환경공단_전기자동차 충전소 정보, 실제 호출(서울 zcode=11, numOfRows=50, dataType=JSON), 2026-06-23.
이 문서는 **실제 응답에서 그대로 확인한 사실**이다(추측 아님). 파서는 이 노트를 기준으로 작성한다.

## 엔드포인트
- 베이스: `https://apis.data.go.kr/B552584/EvCharger`
- `getChargerInfo` — 충전소·충전기 기본정보 (+ 상태 stat 포함)
- `getChargerStatus` — 충전기 실시간 상태(가벼움)
- 공통 쿼리: `serviceKey`(URL 인코딩), `numOfRows`, `pageNo`, `dataType=JSON`, `zcode`(시도코드, 서울=11)

## 응답 최상위 구조 (중요: 평평한 구조)
```
{
  "resultCode": "00" (없을 수도 있음 — resultMsg로 판별),
  "resultMsg": "NORMAL SERVICE.",
  "totalCount": 75044,
  "pageNo": 1,
  "numOfRows": 50,
  "items": { "item": [ ... ] }
}
```
- **item 배열 경로 = `raw.items.item`** (절대 `raw.response.body.items.item` 아님)
- 정상 판별: `resultMsg`가 `"NORMAL SERVICE."` 포함 (또는 `resultCode === "00"`)
- 전국 충전기 총 75,044건 (2026-06-23 기준, 서울만 numOfRows로 페이징)

## getChargerInfo item 필드 (실제)
`statNm, statId, chgerId, chgerType, addr, addrDetail, location, useTime, lat, lng, busiId, bnm, busiNm, busiCall, stat, statUpdDt, lastTsdt, lastTedt, nowTsdt, powerType, output, method, zcode, zscode, kind, kindDetail, parkingFree, note, limitYn, limitDetail, delYn, delDetail, trafficYn, year, floorNum, floorType, maker`

우리가 쓰는 필드:
| 용도 | 필드 |
|---|---|
| 충전소 이름 | `statNm` |
| 충전소 ID | `statId` |
| 충전기 ID | `chgerId` |
| 충전기 타입 | `chgerType` |
| 위도/경도 | `lat` / `lng` (문자열 → Number 변환 필요) |
| 주소 | `addr` |
| 운영기관 | `busiNm` |
| 충전용량(kW) | `output` |
| 상태 | `stat` |
| 상태 갱신시각 | `statUpdDt` (YYYYMMDDHHmmss 문자열) |
| 운영시간 | `useTime` |

비고: `getChargerInfo`가 이미 `stat`을 포함 → 상태 집계를 info 단독으로도 할 수 있다. 다만 별도 `getChargerStatus`가 더 가볍고 갱신이 잦으므로 실시간 새로고침에 유리.

## getChargerStatus item 필드 (실제)
`busiId, statId, chgerId, stat, statUpdDt, lastTsdt, lastTedt, nowTsdt`
- 충전소·충전기 식별: `statId` + `chgerId` 조합으로 info와 매칭

## chgerType 실제값 (서울 샘플)
- `04` = DC콤보 (급속)
- `06` = DC차데모 + AC3상 + DC콤보 (급속)
- (02 AC완속 등은 이 샘플엔 미등장하나 전국엔 존재 — classify.js 기본표 유지)

## stat 실제값 (서울 샘플)
- `2` = 충전대기(사용가능)
- `3` = 충전중
- `9` = 상태미확인
- (1 통신이상, 4 운영중지, 5 점검중은 미등장하나 표준코드 — classify.js 기본표 유지)

## classify.js 대조 결과
- `STATUS` 표: 실제값(2,3,9) 모두 매핑됨. **수정 불필요.**
- `CHARGER_TYPES`/`SLOW` 표: 실제값(04,06) 모두 급속으로 올바르게 분류됨. **수정 불필요.**
- **수정 필요한 것은 단 하나**: `lib/chargers.js`의 `parseItems` 경로를 `raw?.response?.body?.items?.item` → **`raw?.items?.item`** 으로 바꿔야 함 (Task 5에서 반영).

## 소형 fixture (Task 5/7 테스트용)
`test/fixtures/info-mini.json`, `test/fixtures/status-mini.json` — 아래 3개 충전소(각 1대):
| statId | 이름 | lat | lng |
|---|---|---|---|
| ME174013 | 낙성대동주민센터 | 37.476296 | 126.9583876 |
| ME174027 | 서울추모공원 | 37.4536062 | 127.0428005 |
| ME174029 | 롯데마트 송파점 | 37.4918392 | 127.1178931 |

테스트 origin 권장: `{ lat: 37.48, lng: 127.0 }`, radius 50km면 3곳 모두 포함.
