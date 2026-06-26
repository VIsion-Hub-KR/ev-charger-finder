/**
 * app.js — Task 11: Filter chips, 2D/상세 map toggle, address search,
 *                   refetch-on-move, 길찾기 directions
 *          Task 12 (UX improvements):
 *                   1. Search destination pin (persists across pan/zoom, clears on ×)
 *                   2. Nearby stations list (collapsible bottom panel, filter-aware)
 *                   3. Loading overlay: live elapsed-seconds counter
 *
 * Builds on Task 10. All previous functionality preserved.
 */

'use strict';

import { MODEL_X_TRIMS, DEFAULT_RESERVE_PCT, assessTrip } from './range.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seoul City Hall — fallback when Geolocation is unavailable. */
const SEOUL_CITY_HALL = { lat: 37.5663, lng: 126.9779 };

const DEFAULT_ZOOM    = 14;
const CHARGER_RADIUS  = 5000; // metres, passed to /api/chargers

/**
 * 화면에 동시에 그릴 충전소 마커 최대 개수. 서울처럼 밀집 지역은 충전소가
 * 수백 개라 전부 그리면 모바일에서 지도가 버벅인다. 지도 중심에서 가까운 순
 * 으로 이 개수만 그린다.
 */
const MAX_MARKERS = 150;

// ---------------------------------------------------------------------------
// Constants (Task 11 additions)
// ---------------------------------------------------------------------------

/**
 * Minimum distance (metres) the map centre must move before triggering a
 * charger reload on idle. Avoids unnecessary API calls for tiny pan adjustments.
 */
const MIN_MOVE_METRES = 300;

/**
 * Debounce delay (ms) for the map idle refetch.
 */
const IDLE_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** @type {naver.maps.Map|null} */
let map = null;

/** @type {naver.maps.Marker|null} */
let myLocationMarker = null;

/** @type {{ lat: number, lng: number }|null} — set once Geolocation resolves */
let myPosition = null;

/** @type {naver.maps.Marker[]} — 환경부 charger marker pool */
const chargerMarkers = [];

/** @type {naver.maps.Marker[]} — Tesla supercharger marker pool */
const teslaMarkers = [];

/**
 * Raw station data for each charger marker (parallel array to chargerMarkers).
 * Used by the filter system to re-evaluate visibility without an API reload.
 * @type {object[]}
 */
const chargerData = [];

// ---------------------------------------------------------------------------
// Filter state (Task 11)
// ---------------------------------------------------------------------------

/**
 * Active filter state.
 *
 * speed:  null = 전체, 'fast' = 급속 only, 'slow' = 완속 only
 * tesla:  true = show Tesla layer, false = hide
 * avail:  true = 빈자리 있는 충전소만
 */
const filter = {
  speed: null,  // null | 'fast' | 'slow'
  tesla: true,
  avail: false,
};

// ---------------------------------------------------------------------------
// Idle-refetch state (Task 11)
// ---------------------------------------------------------------------------

/** Centre coord of the LAST successful charger load. Used for min-distance check. */
let lastLoadedCentre = null;

/** True while a charger load is in-flight — prevents duplicate concurrent requests. */
let chargerLoadInFlight = false;

/** Timer handle for the debounced idle refetch. */
let idleDebounceTimer = null;

// ---------------------------------------------------------------------------
// Destination pin state (Task 12 — Feature 1)
// ---------------------------------------------------------------------------

/** @type {naver.maps.Marker|null} — Destination pin placed after a successful search. */
let destMarker = null;

// ---------------------------------------------------------------------------
// Route corridor state
// ---------------------------------------------------------------------------

/**
 * Last searched destination — set inside geocodeAndMove after a successful search.
 * @type {{ lat: number, lng: number, name: string }|null}
 */
let lastDestination = null;

/** Whether route corridor mode is currently active. */
let routeModeActive = false;

/** 경로 모드 진입 전 속도 필터 값(복원용). 경로 모드는 급속 강제. */
let routePrevSpeed = null;

/** @type {naver.maps.Polyline|null} — The route polyline drawn on the map. */
let routePolyline = null;

/** @type {HTMLElement|null} — "가는 길 충전소" pill button */
let btnRouteMode = null;

/** @type {HTMLElement|null} — Summary banner shown while route mode is on */
let routeBannerEl = null;

/** 경로 모드: 고속도로 휴게소 급속만 우선 표시(true) / 경로상 모든 급속(false). 기본 휴게소만. */
let routeHighwayOnly = true;

/** @type {object[]} — 현재 경로 코리도(±1km) 안의 급속 충전소 전체(휴게소+일반). 토글 시 재사용. */
let routeAllFast = [];

/** 현재 경로 총거리(km) — 배너 재렌더용. */
let routeDistanceKm = 0;

// ---------------------------------------------------------------------------
// 주행가능 거리(Model X) state
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} — "주행 가능?" 우상단 알약 버튼 */
let btnRangeCheck = null;

/** @type {HTMLElement|null} — 트림/배터리 입력 + 결과 모달 */
let rangeSheetEl = null;

/** 마지막으로 고른 트림 키(세션 내 편의 기억). */
let lastTrimKey = 'long-range';

/** 마지막으로 입력한 배터리(%). */
let lastBatteryPct = '';

/**
 * 출발지 캐시 — 출발지 검색칸 텍스트를 해석한 좌표. 비우거나 "내 위치"면 myPosition 사용.
 * @type {{ lat: number, lng: number, name: string, _q?: string }|null}
 */
let routeStart = null;

/** @type {naver.maps.Marker|null} — 출발지 핀(초록). */
let startMarker = null;

// ---------------------------------------------------------------------------
// Loading elapsed-time state (Task 12 — Feature 3)
// ---------------------------------------------------------------------------

/** Start time of the current loading operation (ms). */
let loadingStartTime = null;

/** Interval handle for the elapsed-time counter. */
let loadingTimerInterval = null;

// ---------------------------------------------------------------------------
// Freshness indicator + live refresh state
// ---------------------------------------------------------------------------

/**
 * Whether a background live-refresh (fresh=1) is currently in-flight.
 * Prevents concurrent live refreshes; does NOT block cached reads.
 */
let liveRefreshInFlight = false;

/**
 * Token incremented each time loadChargers is called.
 * The live-refresh closure captures this token; if it changes before the live
 * response arrives, the result is discarded (stale-while-revalidate race guard).
 */
let loadGeneration = 0;

/** @type {HTMLElement|null} — freshness chip shown below search bar */
let freshnessEl = null;

/** @type {HTMLElement|null} — the refresh FAB button */
let btnRefresh = null;

// ---------------------------------------------------------------------------
// DOM refs (populated after DOMContentLoaded / inline script)
// ---------------------------------------------------------------------------

const locationNoticeEl = document.getElementById('location-notice');
const btnMyLocation    = document.getElementById('btn-my-location');
const searchInput      = document.getElementById('search-input');
const searchClear      = document.getElementById('search-clear');
const btnMapType       = document.getElementById('btn-map-type');
const mapTypeLabelEl   = document.getElementById('map-type-label');
const mapTypeIconNormal = document.getElementById('map-type-icon-normal');
const mapTypeIconHybrid = document.getElementById('map-type-icon-hybrid');

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Clamp text to a max length for marker labels.
 * @param {string} str
 * @param {number} max
 */
function clamp(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

/**
 * Format a distance in metres to a readable Korean string.
 * @param {number} metres
 * @returns {string}
 */
function fmtDistance(metres) {
  if (metres == null || isNaN(metres)) return '';
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

/**
 * 공공 API의 상태 갱신시각(YYYYMMDDHHmmss, KST 벽시각)을 읽기 쉬운 문자열로.
 * 최근이면 "방금 전 / N분 전 / N시간 전", 그 외는 "MM.DD HH:mm".
 * @param {string} raw
 * @returns {string}
 */
function fmtUpdate(raw) {
  const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return String(raw);
  const [, Y, Mo, D, H, Mi, S] = m;
  const t = new Date(+Y, +Mo - 1, +D, +H, +Mi, +S).getTime();
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 0) return `${Mo}.${D} ${H}:${Mi}`;
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}시간 전`;
  return `${Mo}.${D} ${H}:${Mi}`;
}

/**
 * Haversine distance between two LatLng-like objects (metres).
 * @param {{ lat: number, lng: number }} a
 * @param {{ lat: number, lng: number }} b
 * @returns {number}
 */
function haversine(a, b) {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const s  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ---------------------------------------------------------------------------
// Reverse-geocode → zscode
// ---------------------------------------------------------------------------

/**
 * Reverse-geocode a LatLng to get the 시군구 zscode (first 5 digits of admcode).
 *
 * Uses naver.maps.Service.reverseGeocode with OrderType.ADM_CODE.
 * Resolves with the 5-digit zscode string, or rejects on error.
 *
 * TODO: Live verification pending Naver key injection. The API returns
 *       result.v2.address.admCode (e.g. '1168010100') → zscode = '11680'.
 *
 * @param {naver.maps.LatLng} latLng
 * @returns {Promise<string>}
 */
function getZscode(latLng) {
  return new Promise((resolve, reject) => {
    if (!window.naver?.maps?.Service) {
      reject(new Error('naver.maps.Service not available'));
      return;
    }

    naver.maps.Service.reverseGeocode(
      {
        coords: latLng,
        orders: naver.maps.Service.OrderType.ADM_CODE,
      },
      (status, response) => {
        if (status !== naver.maps.Service.Status.OK) {
          reject(new Error(`reverseGeocode failed: status=${status}`));
          return;
        }

        // Response structure (Naver Maps API v3):
        // response.v2.results[] — each result has .region.area1/.area2/etc.
        // and .code.id for ADM_CODE (e.g. '1168010100')
        const results = response?.v2?.results;
        if (!results || results.length === 0) {
          reject(new Error('reverseGeocode: no results'));
          return;
        }

        // Find the ADM_CODE result
        const admResult = results.find(
          (r) => r.name === 'admcode' || (r.code && r.code.type === 'A')
        ) || results[0];

        const admCode = admResult?.code?.id || admResult?.region?.area4?.coords?.center?.x;
        if (!admCode || admCode.length < 5) {
          reject(new Error(`reverseGeocode: unexpected admcode=${admCode}`));
          return;
        }

        resolve(String(admCode).slice(0, 5));
      }
    );
  });
}

/**
 * 역지오코딩 zscode를 충전소 조회용 후보 코드(콤마구분)로 확장한다.
 *
 * 환경공단 데이터는 "자치단체" 단위로 저장된다(코드 끝자리 0: 강남구 11680, 안성시 41550).
 * 그런데 수원·성남·고양처럼 행정구가 있는 시는 네이버 역지오코딩이 행정구 코드를
 * 돌려준다(영통구 41117, 끝자리≠0). 그 코드로 조회하면 데이터가 시 코드(41110)에
 * 있어 0개가 나온다. 그래서 끝자리가 0이 아니면 시 코드(끝자리 0)도 함께 조회한다.
 * (자치단체 코드는 모두 끝자리 0이라, 끝자리 0인 코드에는 영향이 없다.)
 *
 * @param {string} z — 5자리 zscode
 * @returns {string} — 콤마로 join된 후보 zscode 목록
 */
function expandZscode(z) {
  if (!z || z.length < 5) return z;
  const candidates = new Set([z]);
  if (z[4] !== '0') candidates.add(z.slice(0, 4) + '0'); // 행정구 → 시 코드
  return [...candidates].join(',');
}

// ---------------------------------------------------------------------------
// Freshness indicator
// ---------------------------------------------------------------------------

/**
 * Find the newest statUpdDt among a list of stations.
 * @param {object[]} stations
 * @returns {string|null}
 */
function newestStatUpdDt(stations) {
  let best = null;
  for (const s of stations) {
    const v = s.lastUpdate || s.statUpdDt || null;
    if (v && (!best || v > best)) best = v;
  }
  return best;
}

/**
 * Ensure the freshness indicator element exists and return it.
 * Positioned below the filter chips, above the route button.
 * @returns {HTMLElement}
 */
function ensureFreshnessEl() {
  if (freshnessEl) return freshnessEl;
  freshnessEl = document.createElement('div');
  freshnessEl.id = 'freshness-indicator';
  freshnessEl.className = 'freshness-indicator';
  freshnessEl.setAttribute('aria-live', 'polite');
  freshnessEl.hidden = true;
  document.body.appendChild(freshnessEl);
  return freshnessEl;
}

/**
 * Show the freshness chip with given text.
 * @param {string} text
 */
function showFreshness(text) {
  const el = ensureFreshnessEl();
  el.textContent = text;
  el.hidden = false;
}

/** Hide the freshness chip. */
function hideFreshness() {
  if (freshnessEl) freshnessEl.hidden = true;
}

/** 갱신 중 경과초 타이머 핸들 + 기준(베이스) 텍스트. */
let refreshElapsedTimer = null;
let refreshBaseText = '';

/**
 * 새로고침(라이브 갱신) 중 "갱신 중… (N초 / 최대 ~40초)"를 1초마다 갱신해
 * 멈춘 게 아니라 진행 중임을 보여준다.
 */
function startRefreshElapsed() {
  const el = ensureFreshnessEl();
  // 현재 텍스트에서 기존 "· 갱신 중…" 흔적 제거한 걸 베이스로
  refreshBaseText = (el.textContent || '').replace(/ · 갱신 중….*$/, '').trim()
    || '충전소 정보';
  el.hidden = false;
  const startMs = Date.now();
  const tick = () => {
    const sec = Math.floor((Date.now() - startMs) / 1000);
    el.textContent = `${refreshBaseText} · 갱신 중… (${sec}초 / 최대 ~40초)`;
  };
  tick();
  if (refreshElapsedTimer) clearInterval(refreshElapsedTimer);
  refreshElapsedTimer = setInterval(tick, 1000);
}

/** 경과초 타이머 정지(완료/실패 공통). */
function stopRefreshElapsed() {
  if (refreshElapsedTimer) {
    clearInterval(refreshElapsedTimer);
    refreshElapsedTimer = null;
  }
}

/**
 * Build the freshness string from a list of stations.
 * @param {object[]} stations
 * @param {boolean} [refreshing] — if true, append " · 갱신 중…"
 * @returns {string}
 */
function buildFreshnessText(stations, refreshing = false) {
  const raw = newestStatUpdDt(stations);
  const timeStr = raw ? `${fmtUpdate(raw)} 기준` : '시간 미상';
  return refreshing ? `충전소 정보 · ${timeStr} · 갱신 중…` : `충전소 정보 · ${timeStr}`;
}

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let loadingOverlay = null;

function showLoading() {
  // Record start time for elapsed counter
  loadingStartTime = Date.now();

  if (loadingOverlay) {
    loadingOverlay.hidden = false;
  } else {
    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.setAttribute('role', 'status');
    loadingOverlay.setAttribute('aria-live', 'polite');
    loadingOverlay.innerHTML = `
      <div class="loading-card">
        <div class="loading-spinner" aria-hidden="true"></div>
        <div>
          <p class="loading-title">충전소 불러오는 중…</p>
          <p class="loading-sub" id="loading-elapsed">0초 경과 / 보통 30~60초 소요</p>
        </div>
      </div>`;
    document.body.appendChild(loadingOverlay);
  }

  // Reset the elapsed text element
  const elapsedEl = document.getElementById('loading-elapsed');
  if (elapsedEl) elapsedEl.textContent = '0초 경과 / 보통 30~60초 소요';

  // Clear any previous interval
  if (loadingTimerInterval) clearInterval(loadingTimerInterval);

  loadingTimerInterval = setInterval(() => {
    const el = document.getElementById('loading-elapsed');
    if (!el) return;
    const elapsed = Math.floor((Date.now() - loadingStartTime) / 1000);
    el.textContent = `${elapsed}초 경과 / 보통 30~60초 소요`;
  }, 1000);
}

function hideLoading() {
  if (loadingTimerInterval) {
    clearInterval(loadingTimerInterval);
    loadingTimerInterval = null;
  }
  loadingStartTime = null;
  if (loadingOverlay) loadingOverlay.hidden = true;
}

// ---------------------------------------------------------------------------
// Retry toast
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof setTimeout>|null} */
let retryToastTimer = null;

/**
 * Show a small retry message at the bottom of the screen.
 * Auto-hides after 5 s.
 * @param {string} [msg]
 */
function showRetryToast(msg = '충전소 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') {
  let toast = document.getElementById('retry-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'retry-toast';
    toast.className = 'retry-toast';
    toast.setAttribute('role', 'alert');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.hidden = false;

  if (retryToastTimer) clearTimeout(retryToastTimer);
  retryToastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
}

// ---------------------------------------------------------------------------
// Detail bottom sheet
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let sheetEl = null;

function ensureSheet() {
  if (sheetEl) return sheetEl;
  sheetEl = document.createElement('div');
  sheetEl.id = 'detail-sheet';
  sheetEl.className = 'detail-sheet';
  sheetEl.setAttribute('role', 'dialog');
  sheetEl.setAttribute('aria-modal', 'true');
  sheetEl.setAttribute('aria-label', '충전소 상세 정보');
  sheetEl.hidden = true;
  document.body.appendChild(sheetEl);

  // Close on backdrop click (tapping outside the card itself)
  sheetEl.addEventListener('click', (e) => {
    if (e.target === sheetEl) closeSheet();
  });

  return sheetEl;
}

function closeSheet() {
  if (sheetEl) sheetEl.hidden = true;
}

/**
 * Open the detail sheet for a 환경부 charger station.
 * @param {object} station — raw API response item
 */
function openChargerSheet(station) {
  const el = ensureSheet();

  const available  = station.availableCount ?? 0;
  const total      = station.totalCount      ?? 0;
  const charging   = station.chargingCount   ?? 0;
  const name       = station.name || station.stationName || station.statNm || '충전소';
  const speed      = station.speed || station.chargerType;
  const speedLabel = speed === '급속' ? '급속' : '완속';
  const speedClass = speed === '급속' ? 'badge-fast' : 'badge-slow';
  const operator   = station.busiNm || station.operatorName || '';
  const connectors = station.connectorTypes || station.connectors || '';
  const lastUpdate = station.lastUpdate || station.statUpdDt || '';
  const lat        = station.lat ?? station.latitude;
  const lng        = station.lng ?? station.longitude;

  // Distance from my location
  let distHtml = '';
  if (myPosition && lat && lng) {
    const d = haversine(myPosition, { lat: Number(lat), lng: Number(lng) });
    distHtml = `<span class="sheet-meta-item">내 위치에서 ${fmtDistance(d)}</span>`;
  }

  // Availability copy
  const availHtml = `
    <div class="sheet-avail">
      <span class="avail-num ${available > 0 ? 'avail-green' : 'avail-grey'}">${available}</span>
      <span class="avail-label">/ ${total}대 사용 가능</span>
      ${charging > 0 ? `<span class="avail-charging">${charging}대 충전중</span>` : ''}
    </div>`;

  const lastUpdateHtml = lastUpdate
    ? `<p class="sheet-update">${fmtUpdate(lastUpdate)} 기준</p>`
    : '';

  el.innerHTML = `
    <div class="sheet-card" role="document">
      <button class="sheet-close" type="button" aria-label="닫기" onclick="document.getElementById('detail-sheet').hidden=true">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="sheet-header">
        <span class="badge ${speedClass}">${speedLabel}</span>
        <h2 class="sheet-name">${name}</h2>
      </div>
      ${availHtml}
      <div class="sheet-meta">
        ${distHtml}
        ${operator ? `<span class="sheet-meta-item">운영: ${operator}</span>` : ''}
        ${connectors ? `<span class="sheet-meta-item">커넥터: ${connectors}</span>` : ''}
      </div>
      ${lastUpdateHtml}
      <button class="btn-directions" type="button"
              data-lat="${lat}" data-lng="${lng}"
              aria-label="네이버지도로 길찾기 (Task 11에서 연결 예정)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
        네이버지도로 길찾기
      </button>
    </div>`;

  el.querySelector('.btn-directions').addEventListener('click', () => {
    openNaverDirections({ lat, lng, name });
  });

  // Collapse nearby sheet so it doesn't fight with the detail sheet (Feature 2)
  collapseNearbySheet();

  el.hidden = false;
}

/**
 * 좌표 → 한국어 장소명(건물명 우선, 없으면 도로명 주소)으로 역지오코딩.
 * supercharge.info의 영어 테슬라 이름을 한국어로 바꾸는 데 사용.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<string>} 한국어 라벨 (실패 시 빈 문자열)
 */
function koreanPlaceName(lat, lng) {
  return new Promise((resolve) => {
    if (!window.naver?.maps?.Service) { resolve(''); return; }
    naver.maps.Service.reverseGeocode(
      {
        coords: new naver.maps.LatLng(Number(lat), Number(lng)),
        orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(','),
      },
      (status, res) => {
        if (status !== naver.maps.Service.Status.OK) { resolve(''); return; }
        try {
          const results = res.v2?.results || [];
          const road = results.find((x) => x.name === 'roadaddr') || results[0];
          const area2 = road?.region?.area2?.name || '';
          const bld = road?.land?.addition0?.value || '';           // 건물명
          const roadName = road?.land?.name || '';
          const num = [road?.land?.number1, road?.land?.number2].filter(Boolean).join('-');
          if (bld) { resolve(`${area2} ${bld}`.trim()); return; }
          if (roadName) { resolve(`${area2} ${roadName} ${num}`.trim()); return; }
          resolve(area2.trim());
        } catch { resolve(''); }
      },
    );
  });
}

/**
 * Open the detail sheet for a Tesla supercharger.
 * @param {object} station — { name, lat, lng, stalls }
 */
function openTeslaSheet(station) {
  const el = ensureSheet();
  // supercharge.info 이름은 영어("Seoul, South Korea - Centerfield"). 마지막 구간(건물)만 추려
  // 즉시 표시하고, 곧바로 역지오코딩해 한국어 이름으로 교체한다.
  const rawName = station.name || 'Tesla 슈퍼차저';
  const engShort = (rawName.split(' - ').pop() || rawName).replace(/,?\s*South Korea\s*/i, '').trim() || rawName;
  let displayName = engShort;
  const lat    = station.lat;
  const lng    = station.lng;
  const stalls = station.stalls ?? '—';

  let distHtml = '';
  if (myPosition && lat && lng) {
    const d = haversine(myPosition, { lat: Number(lat), lng: Number(lng) });
    distHtml = `<span class="sheet-meta-item">내 위치에서 ${fmtDistance(d)}</span>`;
  }

  el.innerHTML = `
    <div class="sheet-card" role="document">
      <button class="sheet-close" type="button" aria-label="닫기" onclick="document.getElementById('detail-sheet').hidden=true">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="sheet-header">
        <span class="badge badge-tesla">테슬라 슈퍼차저</span>
        <h2 class="sheet-name" id="tesla-sheet-name">${engShort}</h2>
      </div>
      <div class="sheet-avail">
        <span class="avail-label">충전기 ${stalls}기</span>
      </div>
      <p class="sheet-tesla-notice">
        실시간 빈자리 정보는 제공되지 않습니다. Tesla 앱에서 확인하세요.
      </p>
      <div class="sheet-meta">
        ${distHtml}
      </div>
      <button class="btn-directions btn-directions-tesla" type="button"
              data-lat="${lat}" data-lng="${lng}"
              aria-label="네이버지도로 길찾기 (Task 11에서 연결 예정)">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="3 11 22 2 13 21 11 13 3 11"/>
        </svg>
        네이버지도로 길찾기
      </button>
    </div>`;

  el.querySelector('.btn-directions-tesla').addEventListener('click', () => {
    openNaverDirections({ lat, lng, name: displayName });
  });

  // Collapse nearby sheet so it doesn't fight with the detail sheet (Feature 2)
  collapseNearbySheet();

  el.hidden = false;

  // 영어 이름을 한국어 건물/주소명으로 교체 (역지오코딩, 비동기)
  koreanPlaceName(lat, lng).then((kr) => {
    if (!kr) return;
    displayName = kr;
    const nameEl = el.querySelector('#tesla-sheet-name');
    if (nameEl && !el.hidden) nameEl.textContent = kr;
  });
}

// ---------------------------------------------------------------------------
// SVG marker helpers
// ---------------------------------------------------------------------------

/**
 * Build an SVG pin content string for a 환경부 charger marker.
 * Green if available, grey otherwise. Shows available count.
 *
 * @param {number} available
 * @param {number} total
 * @returns {string} HTML string for naver.maps.Marker icon.content
 */
function chargerMarkerContent(available, total) {
  const isAvail = available > 0;
  const bg      = isAvail ? '#2ecc71' : '#b0b0b0';
  const label   = isAvail ? String(available) : '0';

  // Pill-shaped pin: rounded rect body + small triangle tip
  return `
<div class="cmarker ${isAvail ? 'cmarker--avail' : 'cmarker--full'}" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <!-- Pin body -->
    <rect x="2" y="2" width="32" height="30" rx="10" ry="10" fill="${bg}" />
    <!-- Pin tip -->
    <polygon points="14,32 22,32 18,42" fill="${bg}" />
    <!-- Count text -->
    <text x="18" y="21" text-anchor="middle" dominant-baseline="middle"
          font-family="'Apple SD Gothic Neo','Pretendard',-apple-system,sans-serif"
          font-size="13" font-weight="700" fill="#fff">${label}</text>
  </svg>
</div>`.trim();
}

/**
 * Build an SVG lightning-bolt pin for a Tesla supercharger marker.
 * Always red. No count (location-only data).
 *
 * @returns {string} HTML string for naver.maps.Marker icon.content
 */
function teslaMarkerContent() {
  return `
<div class="tmarker" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <!-- Pin body -->
    <rect x="2" y="2" width="32" height="30" rx="10" ry="10" fill="#e31937" />
    <!-- Pin tip -->
    <polygon points="14,32 22,32 18,42" fill="#e31937" />
    <!-- Lightning bolt SVG path centred in body -->
    <path d="M20 6 L13 19 L18 19 L16 30 L23 17 L18 17 Z"
          fill="#fff" />
  </svg>
</div>`.trim();
}

// ---------------------------------------------------------------------------
// Clear marker pools
// ---------------------------------------------------------------------------

function clearChargerMarkers() {
  chargerMarkers.forEach((m) => m.setMap(null));
  chargerMarkers.length = 0;
  chargerData.length = 0;
}

function clearTeslaMarkers() {
  teslaMarkers.forEach((m) => m.setMap(null));
  teslaMarkers.length = 0;
}

// ---------------------------------------------------------------------------
// Destination pin (Task 12 — Feature 1)
// ---------------------------------------------------------------------------

/**
 * SVG content for the destination pin.
 * A classic teardrop shape in #1c6ef2 (blue accent), with a white center dot.
 * Distinct from charger pins (pill shape) and Tesla pins (red bolt).
 *
 * @param {string} [label] — Optional short label (searched name) shown below the pin.
 * @returns {string}
 */
function destPinContent(label) {
  const safeLabel = label ? String(label).slice(0, 12) : '';
  const labelPart = safeLabel
    ? `<div class="dest-pin-label">${safeLabel}</div>`
    : '';
  return `
<div class="dest-pin-wrap" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44" class="dest-pin">
    <!-- Teardrop body: circle top + pointed bottom -->
    <path d="M16 2 C7.163 2 2 9.163 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 9.163 24.837 2 16 2 Z"
          fill="#1c6ef2" />
    <!-- White inner circle -->
    <circle cx="16" cy="16" r="6" fill="#ffffff" />
  </svg>
  ${labelPart}
</div>`.trim();
}

/**
 * Place (or replace) the destination pin at the given coordinates.
 * The pin persists across map pan/zoom and is only removed by clearDestPin().
 *
 * @param {{ lat: number, lng: number }} coords
 * @param {string} [label] — Searched name to show under the pin.
 */
function setDestPin(coords, label) {
  const latLng = new naver.maps.LatLng(coords.lat, coords.lng);

  if (destMarker) {
    // Reuse existing marker — update position and icon
    destMarker.setPosition(latLng);
    destMarker.setIcon({
      content: destPinContent(label),
      anchor:  new naver.maps.Point(16, 44), // tip of the teardrop
    });
    destMarker.setMap(map);
    return;
  }

  destMarker = new naver.maps.Marker({
    position: latLng,
    map,
    icon: {
      content: destPinContent(label),
      anchor:  new naver.maps.Point(16, 44),
    },
    title:     label || '검색 결과',
    clickable: false,
    zIndex:    150,
  });
}

/**
 * Remove the destination pin from the map.
 */
function clearDestPin() {
  if (destMarker) {
    destMarker.setMap(null);
    // Don't null it — reuse object next time
  }
}

// ---------------------------------------------------------------------------
// 출발지 핀 (초록 — 목적지 파랑과 구분)
// ---------------------------------------------------------------------------

/** 출발지 핀 SVG (초록 물방울 + 흰 점). */
function startPinContent(label) {
  const safeLabel = label ? String(label).slice(0, 12) : '';
  const labelPart = safeLabel ? `<div class="start-pin-label">${safeLabel}</div>` : '';
  return `
<div class="dest-pin-wrap start-pin-wrap" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44" class="dest-pin">
    <path d="M16 2 C7.163 2 2 9.163 2 16 C2 26 16 42 16 42 C16 42 30 26 30 16 C30 9.163 24.837 2 16 2 Z"
          fill="#1c9e52" />
    <circle cx="16" cy="16" r="6" fill="#ffffff" />
  </svg>
  ${labelPart}
</div>`.trim();
}

/** 출발지 핀을 좌표에 표시(있으면 위치/아이콘 갱신). */
function setStartPin(coords, label) {
  const latLng = new naver.maps.LatLng(coords.lat, coords.lng);
  if (startMarker) {
    startMarker.setPosition(latLng);
    startMarker.setIcon({ content: startPinContent(label), anchor: new naver.maps.Point(16, 44) });
    startMarker.setMap(map);
    return;
  }
  startMarker = new naver.maps.Marker({
    position: latLng,
    map,
    icon: { content: startPinContent(label), anchor: new naver.maps.Point(16, 44) },
    title: label || '출발지',
    clickable: false,
    zIndex: 149,
  });
}

/** 출발지 핀 숨김. */
function clearStartPin() {
  if (startMarker) startMarker.setMap(null);
}

// ---------------------------------------------------------------------------
// Filter application (Task 11)
// ---------------------------------------------------------------------------

/**
 * Determine whether a 환경부 station should be visible given the current filter.
 * @param {object} station
 * @returns {boolean}
 */
function chargerPassesFilter(station) {
  // Speed filter — API가 주는 station.speed('급속'|'완속') 기준으로 판별한다.
  // (예전 코드는 존재하지 않는 station.chargerType을 읽어 급속/완속 필터가
  //  모든 충전소를 숨겼다. 고속도로 충전기는 대부분 급속이라 안 보였던 원인.)
  const speed = station.speed || station.chargerType || '';
  if (filter.speed === 'fast' && speed !== '급속') return false;
  if (filter.speed === 'slow' && speed !== '완속') return false;

  // Availability filter
  if (filter.avail) {
    const available = station.availableCount ?? 0;
    if (available <= 0) return false;
  }

  return true;
}

/**
 * Apply the current filter state to all existing markers.
 * No API calls — just setMap(map) or setMap(null) on each marker.
 */
function applyFilter() {
  // 환경부 markers
  chargerMarkers.forEach((marker, i) => {
    const station = chargerData[i];
    const visible = station ? chargerPassesFilter(station) : false;
    marker.setMap(visible ? map : null);
  });

  // Tesla markers
  teslaMarkers.forEach((marker) => {
    marker.setMap(filter.tesla ? map : null);
  });

  // Refresh nearby list to reflect new filter state (Feature 2)
  if (nearbySheetEl) renderNearbyList();
}

// ---------------------------------------------------------------------------
// Render 환경부 charger markers
// ---------------------------------------------------------------------------

/**
 * Render 환경부 charger markers onto the map.
 * Stores raw station data in chargerData (parallel array) for filter reuse.
 * @param {object[]} stations
 */
function renderChargerMarkers(stations) {
  clearChargerMarkers();

  // 성능: 지도 중심에서 가까운 순으로 최대 MAX_MARKERS개만 그린다 (모바일 버벅임 방지)
  let list = stations;
  let ref = null;
  if (map && typeof map.getCenter === 'function') {
    const c = map.getCenter();
    ref = { lat: c.lat(), lng: c.lng() };
  } else if (myPosition) {
    ref = myPosition;
  }
  if (ref && stations.length > MAX_MARKERS) {
    const ll = (s) => ({ lat: Number(s.lat ?? s.latitude), lng: Number(s.lng ?? s.longitude) });
    list = [...stations].sort((a, b) => haversine(ref, ll(a)) - haversine(ref, ll(b))).slice(0, MAX_MARKERS);
  }

  list.forEach((station) => {
    const lat = station.lat ?? station.latitude;
    const lng = station.lng ?? station.longitude;
    if (!lat || !lng) return;

    const available = station.availableCount ?? 0;
    const total     = station.totalCount     ?? 0;
    const latLng    = new naver.maps.LatLng(Number(lat), Number(lng));

    // Determine initial visibility per current filter
    const visible = chargerPassesFilter(station);

    const marker = new naver.maps.Marker({
      position: latLng,
      map: visible ? map : null,
      icon: {
        content: chargerMarkerContent(available, total),
        anchor:  new naver.maps.Point(18, 42), // tip of pin
      },
      title:     station.name || station.stationName || station.statNm || '',
      clickable: true,
      zIndex:    50,
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      openChargerSheet(station);
    });

    chargerMarkers.push(marker);
    chargerData.push(station); // store for filter re-evaluation
  });

  // Refresh the nearby list after all markers are placed
  if (nearbySheetEl) renderNearbyList();
}

// ---------------------------------------------------------------------------
// Render Tesla supercharger markers
// ---------------------------------------------------------------------------

/**
 * Render Tesla supercharger markers onto the map.
 * @param {object[]} stations  — [{ name, lat, lng, stalls }, …]
 */
function renderTeslaMarkers(stations) {
  clearTeslaMarkers();

  stations.forEach((station) => {
    const lat = station.lat ?? station.latitude;
    const lng = station.lng ?? station.longitude;
    if (!lat || !lng) return;

    const latLng = new naver.maps.LatLng(Number(lat), Number(lng));

    const marker = new naver.maps.Marker({
      position: latLng,
      map: filter.tesla ? map : null, // respect initial filter state
      icon: {
        content: teslaMarkerContent(),
        anchor:  new naver.maps.Point(18, 42), // tip of pin
      },
      title:     station.name || 'Tesla 슈퍼차저',
      clickable: true,
      zIndex:    60,
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      openTeslaSheet(station);
    });

    teslaMarkers.push(marker);
  });
}

// ---------------------------------------------------------------------------
// Load Tesla superchargers (static JSON)
// ---------------------------------------------------------------------------

/**
 * Fetch the static Tesla supercharger list and render markers.
 * Errors are silently logged — Tesla layer is optional / non-critical.
 */
async function loadTeslaChargers() {
  try {
    const res = await fetch('/tesla-superchargers.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
      renderTeslaMarkers(data);
    }
  } catch (err) {
    console.warn('[Tesla] 슈퍼차저 목록을 불러오지 못했습니다:', err.message);
    // Non-fatal: user still gets 환경부 markers
  }
}

// ---------------------------------------------------------------------------
// Load 환경부 chargers from API
// ---------------------------------------------------------------------------

/**
 * Internal helper: fetch charger data from /api/chargers.
 * @param {{ lat: number, lng: number }} centre
 * @param {string} zscode
 * @param {boolean} fresh — pass fresh=1 to the API
 * @returns {Promise<object[]>}
 */
async function _fetchChargerData(centre, zscode, fresh) {
  const params = new URLSearchParams({
    lat:    String(centre.lat),
    lng:    String(centre.lng),
    radius: String(CHARGER_RADIUS),
  });
  if (zscode) params.set('zscode', zscode);
  if (fresh)  params.set('fresh', '1');

  const url = `/api/chargers?${params.toString()}`;
  // 공공 API가 40~80초까지 걸려 65초로는 폰에서 종종 타임아웃 → 90초로 여유
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.stations ?? data.items ?? []);
}

/**
 * Set the refresh button spinning state.
 * @param {boolean} spinning
 */
function setRefreshSpinning(spinning) {
  if (!btnRefresh) return;
  if (spinning) {
    btnRefresh.classList.add('btn-refresh--spinning');
    btnRefresh.setAttribute('aria-label', '충전소 정보 갱신 중…');
    btnRefresh.disabled = true;
  } else {
    btnRefresh.classList.remove('btn-refresh--spinning');
    btnRefresh.setAttribute('aria-label', '충전소 정보 새로고침');
    btnRefresh.disabled = false;
  }
}

/**
 * Fetch chargers for the given centre and render markers.
 * Implements stale-while-revalidate:
 *   1. Fast cached request → render immediately if data exists.
 *   2. Background live request (fresh=1) → re-render when done.
 * Shows a blocking overlay ONLY when the cache is empty (first load for area).
 *
 * Guards:
 *   - chargerLoadInFlight: prevents duplicate concurrent cached-read requests
 *   - lastLoadedCentre + MIN_MOVE_METRES: skips if centre barely moved
 *   - loadGeneration: race guard for the async live refresh
 *
 * @param {{ lat: number, lng: number }} centre
 * @param {{ force?: boolean, liveOnly?: boolean }} [opts]
 *   force=true   — skip the min-distance guard
 *   liveOnly=true — skip cached phase, go straight to live (refresh button)
 */
async function loadChargers(centre, { force = false, liveOnly = false } = {}) {
  // Min-distance guard (skip if centre hasn't moved enough)
  if (!force && !liveOnly && lastLoadedCentre) {
    const moved = haversine(lastLoadedCentre, centre);
    if (moved < MIN_MOVE_METRES) {
      console.debug(`[chargers] 중심 이동 ${Math.round(moved)}m < ${MIN_MOVE_METRES}m — 재조회 건너뜀`);
      return;
    }
  }

  // In-flight guard for the cached-read phase
  if (!liveOnly && chargerLoadInFlight) {
    console.debug('[chargers] 이미 요청 중 — 중복 요청 건너뜀');
    return;
  }

  // Advance generation token — any in-flight live refresh for a previous area is invalidated
  const myGeneration = ++loadGeneration;

  // Resolve zscode once (shared for both cached and live requests)
  let zscode = '';
  try {
    const latLng = new naver.maps.LatLng(centre.lat, centre.lng);
    zscode = expandZscode(await getZscode(latLng)); // 행정구 도시 보정(시 코드 함께 조회)
  } catch (err) {
    console.warn('[zscode] 역지오코딩 실패, zscode 없이 요청합니다:', err.message);
  }

  // ── Phase 1: cached (fast) read ────────────────────────────────────────────
  let cachedStations = null;

  if (!liveOnly) {
    chargerLoadInFlight = true;
    showLoading();

    try {
      cachedStations = await _fetchChargerData(centre, zscode, false);
    } catch (err) {
      console.warn('[chargers] 캐시 읽기 실패:', err.message);
    } finally {
      chargerLoadInFlight = false;
      hideLoading();
    }

    if (cachedStations && cachedStations.length > 0) {
      // Render immediately with cached data
      renderChargerMarkers(cachedStations);
      lastLoadedCentre = centre;

      // 자동 백그라운드 라이브 갱신은 하지 않는다(공공 API가 100초+라 "갱신 중"이
      // 계속 떠 있고 탭까지 막혀 못 쓰겠다는 피드백). 갱신은 새로고침 버튼으로만.
      showFreshness(buildFreshnessText(cachedStations, false));
      return;
    }
  }

  // ── Phase 2: live refresh (background, non-blocking) ──────────────────────
  // If liveOnly (refresh button), show spinning state immediately.
  if (liveOnly) {
    setRefreshSpinning(true);
    // "갱신 중… (N초 / 최대 ~40초)" 경과 표시 시작 (멈춘 게 아님을 알림)
    startRefreshElapsed();
  }

  // Guard: only one live refresh at a time
  if (liveRefreshInFlight && !liveOnly) {
    // A live refresh for a previous load is already running; it will be
    // invalidated by the generation check when it returns. Don't start another.
    console.debug('[chargers] live refresh already in-flight — skipping');
    return;
  }

  // Skip live refresh if cache was empty AND liveOnly is false —
  // in that case the cached phase already showed the blocking overlay and
  // we need to start a fresh load (fallback: no data yet, must block).
  if (!liveOnly && (!cachedStations || cachedStations.length === 0)) {
    // No cached data: show blocking overlay and do a live fetch as the primary load.
    chargerLoadInFlight = true;
    showLoading();
    try {
      const stations = await _fetchChargerData(centre, zscode, true);
      if (loadGeneration !== myGeneration) return; // stale — another load started
      renderChargerMarkers(stations);
      lastLoadedCentre = centre;
      const raw = newestStatUpdDt(stations);
      showFreshness(`충전소 정보 · ${raw ? '방금 전 기준' : '방금 기준'}`);
    } catch (err) {
      console.error('[chargers] live fetch 실패:', err.message);
      showRetryToast();
      hideFreshness();
    } finally {
      chargerLoadInFlight = false;
      hideLoading();
    }
    return;
  }

  // Background live refresh
  liveRefreshInFlight = true;
  try {
    const liveStations = await _fetchChargerData(centre, zscode, true);

    // Race guard: if the user moved before this returned, discard result
    if (loadGeneration !== myGeneration) {
      console.debug('[chargers] live refresh result is stale — discarding');
      return;
    }

    renderChargerMarkers(liveStations);
    lastLoadedCentre = centre;

    // Update freshness: "방금 전 기준"
    showFreshness(`충전소 정보 · 방금 전 기준`);
  } catch (err) {
    console.warn('[chargers] live refresh 실패:', err.message);
    // Don't show error toast — cached data is already shown
    // Just revert freshness text to remove "갱신 중…"
    if (cachedStations && cachedStations.length > 0) {
      showFreshness(buildFreshnessText(cachedStations, false));
    }
  } finally {
    liveRefreshInFlight = false;
    setRefreshSpinning(false);
    stopRefreshElapsed();
  }
}

// ---------------------------------------------------------------------------
// Map initialisation
// ---------------------------------------------------------------------------

/**
 * Initialise the Naver map centred on `centre`.
 * @param {{ lat: number, lng: number }} centre
 * @returns {naver.maps.Map}
 */
function initMap(centre) {
  const m = new naver.maps.Map('map', {
    center:     new naver.maps.LatLng(centre.lat, centre.lng),
    zoom:       DEFAULT_ZOOM,
    mapTypeId:  naver.maps.MapTypeId.NORMAL,
    scaleControl:   false,
    logoControl:    true,
    mapDataControl: false,
    zoomControl:    false,
    mapTypeControl: false,
    scrollWheel:    false, // 기본 휠 줌 끄고 아래 커스텀(민감도 절반) 사용
  });
  installHalfZoom(m);
  return m;
}

/**
 * 확대/축소 민감도를 절반으로. 네이버 기본 휠 줌은 끄고, 휠 입력을 누적해
 * 기본보다 약 2배 모여야 한 단계 줌이 바뀌도록 한다. (마우스 휠/트랙패드 기준.
 * 모바일 핀치 줌은 OS가 제어하므로 영향 없음.)
 * @param {naver.maps.Map} m
 */
function installHalfZoom(m) {
  const el = document.getElementById('map');
  if (!el) return;
  let acc = 0;
  const THRESHOLD = 240; // 클수록 둔감 (기본 대비 약 절반)
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    acc += e.deltaY;
    if (Math.abs(acc) >= THRESHOLD) {
      const dir = acc > 0 ? -1 : 1; // deltaY>0(아래로 스크롤)=축소
      m.setZoom(m.getZoom() + dir, true);
      acc = 0;
    }
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// My Location dot marker
// ---------------------------------------------------------------------------

/**
 * Draw (or move) the blue "my location" dot on the map.
 * @param {{ lat: number, lng: number }} position
 */
function setMyLocationMarker(position) {
  const latLng = new naver.maps.LatLng(position.lat, position.lng);

  if (myLocationMarker) {
    myLocationMarker.setPosition(latLng);
    return;
  }

  myLocationMarker = new naver.maps.Marker({
    position: latLng,
    map,
    icon: {
      content: '<div class="my-location-dot"></div>',
      anchor:  new naver.maps.Point(9, 9),
    },
    title:     '내 위치',
    clickable: false,
    zIndex:    200,
  });
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

/**
 * Show the non-blocking "location unavailable" notice. Auto-hides after 4 s.
 */
function showLocationNotice(msg) {
  const span = locationNoticeEl.querySelector('span');
  if (span && msg) span.textContent = msg;
  locationNoticeEl.hidden = false;
  setTimeout(() => { locationNoticeEl.hidden = true; }, 6000);
}

/**
 * Request the user's current position.
 * 1차 고정밀(GPS) → 실패 시 2차 저정밀(와이파이/셀, 실내에서도 잘 잡힘) → 그래도 실패면
 * 사유별 안내 + 서울시청 폴백.
 * @returns {Promise<{ lat: number, lng: number }>}
 */
function resolveUserPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      showLocationNotice('이 브라우저는 위치를 지원하지 않아 서울시청 기준으로 표시합니다.');
      resolve(SEOUL_CITY_HALL);
      return;
    }

    const ok = (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });

    const onFinalError = (err) => {
      let msg = '위치를 가져올 수 없어 서울시청 기준으로 표시합니다.';
      if (err && err.code === 1) {
        msg = '위치 권한이 꺼져 있어요. Safari 설정 → 위치 허용 후 📍 버튼을 누르세요.';
      } else if (err && err.code === 3) {
        msg = '위치 잡기가 지연돼요(실내일 수 있음). 📍 버튼을 다시 눌러보세요.';
      }
      showLocationNotice(msg);
      resolve(SEOUL_CITY_HALL);
    };

    // 1차: 고정밀(GPS) — 빠르게 8초만
    navigator.geolocation.getCurrentPosition(
      ok,
      () => {
        // 2차: 저정밀(와이파이/셀) — 실내·GPS 약할 때도 잘 잡힘
        navigator.geolocation.getCurrentPosition(
          ok,
          onFinalError,
          { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 }
        );
      },
      { enableHighAccuracy: true, timeout: 8_000, maximumAge: 300_000 }
    );
  });
}

// ---------------------------------------------------------------------------
// Naver Map directions (Task 11)
// ---------------------------------------------------------------------------

/**
 * Open Naver Map directions to the given destination in a new tab.
 *
 * URL format used (Naver Maps web URL scheme — directions endpoint):
 *   https://map.naver.com/p/directions/-/-/{dlng},{dlat},{dname}/-/walk?c={dlng},{dlat},15,0,0,0,dh
 *
 * This is the standard Naver Maps directions deep-link format (as of 2024–2025):
 *   - Base: https://map.naver.com/p/directions/
 *   - Origin: leave blank (uses current location on device) → represented as "-/-/"
 *   - Destination: {lng},{lat},{name}
 *   - Transport mode: walk (walking) — users can switch in the app
 *
 * Reference: Naver Maps URL scheme docs (https://navermaps.github.io/maps.js.ncp/docs/tutorial-8-Getting-Started-Maps-Service.html)
 *   and confirmed pattern from https://map.naver.com share links.
 *
 * TODO (live verification): confirm the URL opens and sets the correct destination
 *   once a valid NCP key is available. The coordinate order is lng,lat (not lat,lng).
 *
 * @param {{ lat: number|string, lng: number|string, name?: string }} dest
 */
function openNaverDirections({ lat, lng, name = '충전소' }) {
  const goal = `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)},${encodeURIComponent(name)}`;

  // 출발지 = 내 위치(있으면). 없으면 빈 출발지(-).
  let start = '-';
  if (myPosition && Number.isFinite(myPosition.lat) && Number.isFinite(myPosition.lng)) {
    start = `${Number(myPosition.lng).toFixed(7)},${Number(myPosition.lat).toFixed(7)},${encodeURIComponent('내 위치')}`;
  }

  // Naver Maps 길찾기 URL: /p/directions/{출발}/{목적}/{경유}/{이동수단}
  // 출발지를 채우면 "여기→거기" 경로·거리가 즉시 표시됨 (car: 자동차).
  const url = `https://map.naver.com/p/directions/${start}/${goal}/-/car`;

  window.open(url, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// Filter chips (Task 11)
// ---------------------------------------------------------------------------

/**
 * Wire filter chip click handlers.
 * Chips toggle filter.speed / filter.tesla / filter.avail and call applyFilter().
 * No API reload — visibility is toggled on existing markers.
 */
function wireFilterChips() {
  const chips = document.querySelectorAll('.chip[data-filter]');

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;

      if (f === 'all') {
        // 전체: reset all filters
        filter.speed = null;
        filter.tesla = true;
        filter.avail = false;
      } else if (f === 'fast') {
        // 급속: mutually exclusive with 완속
        filter.speed = filter.speed === 'fast' ? null : 'fast';
      } else if (f === 'slow') {
        // 완속: mutually exclusive with 급속
        filter.speed = filter.speed === 'slow' ? null : 'slow';
      } else if (f === 'tesla') {
        filter.tesla = !filter.tesla;
      } else if (f === 'avail') {
        filter.avail = !filter.avail;
      }

      updateChipUI(chips);
      applyFilter();
    });
  });
}

/**
 * Sync chip visual state (chip--active class) to current filter.
 * @param {NodeList} chips
 */
function updateChipUI(chips) {
  // Determine if "전체" state (no active sub-filter):
  const isAll = filter.speed === null && filter.tesla === true && filter.avail === false;

  chips.forEach((chip) => {
    const f = chip.dataset.filter;
    let active = false;

    if (f === 'all')   active = isAll;
    if (f === 'fast')  active = filter.speed === 'fast';
    if (f === 'slow')  active = filter.speed === 'slow';
    if (f === 'tesla') active = filter.tesla;  // Tesla chip stays active while visible
    if (f === 'avail') active = filter.avail;

    chip.classList.toggle('chip--active', active);
  });
}

// ---------------------------------------------------------------------------
// 2D / 상세 map type toggle (Task 11)
// ---------------------------------------------------------------------------

/**
 * Wire the map type toggle button.
 * Switches between NORMAL (2D) and HYBRID (satellite + labels).
 */
function wireMapTypeToggle() {
  btnMapType.addEventListener('click', () => {
    const currentMode = btnMapType.dataset.mode;

    if (currentMode === 'normal') {
      // Switch to HYBRID (상세/satellite)
      map.setMapTypeId(naver.maps.MapTypeId.HYBRID);
      btnMapType.dataset.mode = 'hybrid';
      btnMapType.setAttribute('aria-label', '지도 유형 전환: 위성 지도 (상세)');
      mapTypeLabelEl.textContent = '상세';
      mapTypeIconNormal.hidden = true;
      mapTypeIconHybrid.hidden = false;
    } else {
      // Switch back to NORMAL (2D)
      map.setMapTypeId(naver.maps.MapTypeId.NORMAL);
      btnMapType.dataset.mode = 'normal';
      btnMapType.setAttribute('aria-label', '지도 유형 전환: 2D 지도');
      mapTypeLabelEl.textContent = '2D';
      mapTypeIconNormal.hidden = false;
      mapTypeIconHybrid.hidden = true;
    }
  });
}

// ---------------------------------------------------------------------------
// Address search (Task 11)
// ---------------------------------------------------------------------------

/**
 * Show the "검색 결과 없음" notice below the search bar.
 * Auto-hides after 3 s.
 */
function showSearchNoResult() {
  let el = document.getElementById('search-no-result');
  if (!el) {
    el = document.createElement('div');
    el.id = 'search-no-result';
    el.className = 'search-no-result';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '검색 결과를 찾을 수 없습니다.';
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3000);
}

/**
 * 장소검색(지역검색)에서 결과가 없을 때 도로명/지번 주소를 네이버 지오코더로 보조 검색.
 * 지도 SDK의 geocoder 서브모듈(naver.maps.Service.geocode)을 쓰므로 서버/비밀키 불필요.
 *
 * @param {string} query
 * @returns {Promise<{ lat: number, lng: number, name: string }|null>}
 */
function geocodeAddress(query) {
  return new Promise((resolve) => {
    const ok = window.naver && naver.maps && naver.maps.Service
      && typeof naver.maps.Service.geocode === 'function';
    if (!ok) { resolve(null); return; }

    naver.maps.Service.geocode({ query }, (status, response) => {
      if (status !== naver.maps.Service.Status.OK) { resolve(null); return; }
      const addr = response?.v2?.addresses?.[0];
      if (!addr) { resolve(null); return; }
      const lng = Number(addr.x);
      const lat = Number(addr.y);
      if (!isFinite(lat) || !isFinite(lng)) { resolve(null); return; }
      resolve({ lat, lng, name: addr.roadAddress || addr.jibunAddress || query });
    });
  });
}

/**
 * 입력 문자열(장소명 또는 도로명/지번 주소)을 좌표로 해석한다.
 * 장소검색(/api/search) → 결과 없으면 주소 지오코더(geocodeAddress) 순서.
 * "주행 가능?"의 출발지 입력 등에서 재사용.
 *
 * @param {string} query
 * @returns {Promise<{ lat: number, lng: number, name: string }|null>}
 */
async function resolvePlaceOrAddress(query) {
  const q = (query || '').trim();
  if (!q) return null;
  try {
    const res = await fetch(`/api/search?query=${encodeURIComponent(q)}`);
    if (res.ok) {
      const first = (await res.json()).results?.[0];
      if (first) return { lat: first.lat, lng: first.lng, name: first.name || q };
    }
  } catch (_err) {
    // 네트워크 실패 시에도 주소 지오코더로 폴백 시도
  }
  return geocodeAddress(q);
}

/**
 * 출발지 검색칸의 현재 텍스트를 좌표로 해석한다.
 * 비었거나 "내 위치"면 myPosition을 쓰고 출발지 핀을 숨긴다.
 * 그 외 텍스트는 주소/장소로 해석해 출발지 핀을 찍고 캐시한다.
 * "주행 가능?"·"가는 길 충전소"가 공통으로 호출 → 출발지는 한 곳(검색칸)에서만 관리.
 *
 * @returns {Promise<{ lat: number, lng: number, name: string }|null>}
 */
async function resolveRouteStart() {
  const input = document.getElementById('start-input');
  const q = input ? input.value.trim() : '';

  if (!q || q === '내 위치') {
    clearStartPin();
    routeStart = null;
    if (myPosition) return { lat: myPosition.lat, lng: myPosition.lng, name: '내 위치' };
    return null;
  }

  // 같은 텍스트면 캐시 재사용 (불필요한 재조회 방지)
  if (routeStart && routeStart._q === q) return routeStart;

  const r = await resolvePlaceOrAddress(q);
  if (!r) return null;
  r._q = q;
  routeStart = r;
  setStartPin({ lat: r.lat, lng: r.lng }, r.name);
  return r;
}

/**
 * Search for a place by keyword via the server-side /api/search proxy
 * (Naver 지역검색 Open API) and move the map to the first result.
 * 장소검색 결과가 없으면 주소 지오코더(geocodeAddress)로 보조 검색한다.
 *
 * On success:  take first result → map.setCenter → loadChargers (force reload).
 * On no result or error: show "검색 결과 없음".
 *
 * @param {string} query
 */
async function geocodeAndMove(query) {
  if (!query.trim()) return;

  let results;
  try {
    const res = await fetch(`/api/search?query=${encodeURIComponent(query.trim())}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    results = body.results ?? [];
  } catch (err) {
    console.warn('[search] /api/search 실패:', err.message);
    showSearchNoResult();
    return;
  }

  let r = results[0];

  // 장소검색 결과가 없으면 도로명/지번 주소 지오코딩으로 보조 검색
  if (!r) {
    r = await geocodeAddress(query.trim());
  }

  if (!r) {
    showSearchNoResult();
    return;
  }

  const centre = { lat: r.lat, lng: r.lng };

  // Feature 1: drop/move destination pin at the search result coordinate
  setDestPin(centre, r.name || query.trim());

  // Store destination for route corridor mode
  lastDestination = { lat: r.lat, lng: r.lng, name: r.name || query.trim() };

  // Exit route mode if a new destination was searched while route mode was on
  if (routeModeActive) {
    routeModeActive = false;
    clearRoutePolyline();
    hideRouteBanner();
  }
  updateRouteModeButton();
  updateRangeButton();

  map.setCenter(new naver.maps.LatLng(r.lat, r.lng));
  map.setZoom(DEFAULT_ZOOM);
  await loadChargers(centre, { force: true }); // force reload for explicit search

  // Update nearby list after new chargers load
  renderNearbyList();
}

/**
 * 출발지 검색칸 연결 — 입력(주소·장소) / "내 위치" 버튼 / 지우기.
 * 출발지는 routeStart 캐시 + 검색칸 텍스트로만 관리되고, resolveRouteStart로 해석된다.
 */
function wireStartSearch() {
  const input = document.getElementById('start-input');
  const clearBtn = document.getElementById('start-clear');
  const useLocBtn = document.getElementById('start-use-loc');
  if (!input) return;

  input.removeAttribute('readonly');

  input.addEventListener('input', () => {
    clearBtn.hidden = input.value.trim().length === 0;
  });

  // Enter / blur 시 출발지 해석 + 핀 갱신 (한글 IME 조합 중 Enter 무시)
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); resolveRouteStart(); }
  });
  input.addEventListener('change', () => { resolveRouteStart(); });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.hidden = true;
    routeStart = null;
    clearStartPin();
    input.focus();
  });

  // "현재 위치를 출발지로" — 내 위치로 고정
  useLocBtn.addEventListener('click', async () => {
    let pos = myPosition;
    if (!pos) {
      useLocBtn.disabled = true;
      try {
        pos = await resolveUserPosition();
        myPosition = pos;
        if (map) setMyLocationMarker(pos);
      } finally {
        useLocBtn.disabled = false;
      }
    }
    input.value = '내 위치';
    clearBtn.hidden = false;
    routeStart = null;     // "내 위치" → resolveRouteStart가 myPosition 사용
    clearStartPin();       // 파란 점이 이미 내 위치를 표시
  });
}

/**
 * Wire the search input (Enter key + clear button).
 */
function wireSearch() {
  // Remove readonly attribute (was placeholder until Task 11)
  searchInput.removeAttribute('readonly');

  // Show/hide clear button as user types
  searchInput.addEventListener('input', () => {
    searchClear.hidden = searchInput.value.length === 0;
  });

  // Clear button — also removes destination pin (Feature 1) and exits route mode
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
    clearDestPin();
    lastDestination = null;
    if (routeModeActive) {
      exitRouteMode();
    }
    updateRouteModeButton();
    updateRangeButton();
    closeRangeSheet();
  });

  // Submit on Enter
  searchInput.addEventListener('keydown', (e) => {
    // 한글 IME 조합 중(isComposing/keyCode 229)에는 Enter를 무시한다.
    // 조합 중 Enter를 처리하면 마지막 글자가 중복된다("부산역역" 버그).
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      searchInput.blur(); // dismiss mobile keyboard
      geocodeAndMove(searchInput.value);
    }
  });
}

// ---------------------------------------------------------------------------
// Refetch on map move (Task 11)
// ---------------------------------------------------------------------------

/**
 * Wire the map 'idle' event for auto-refetch after pan/zoom.
 *
 * Logic:
 *   - Debounce: wait IDLE_DEBOUNCE_MS after idle fires before acting.
 *   - In-flight guard: skip if a request is already running.
 *   - Min-distance guard: skip if centre moved < MIN_MOVE_METRES from last load.
 */
function wireIdleRefetch() {
  naver.maps.Event.addListener(map, 'idle', () => {
    // Clear any pending debounce
    if (idleDebounceTimer) clearTimeout(idleDebounceTimer);

    idleDebounceTimer = setTimeout(() => {
      const centre = map.getCenter();
      loadChargers({ lat: centre.lat(), lng: centre.lng() });
    }, IDLE_DEBOUNCE_MS);
  });
}

// ---------------------------------------------------------------------------
// Nearby stations list (Task 12 — Feature 2)
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let nearbySheetEl = null;

/** Whether the nearby sheet is expanded or in peek state. */
let nearbyExpanded = false;

/**
 * Ensure the nearby stations panel exists in the DOM.
 * Structure:
 *   .nearby-sheet
 *     .nearby-handle  ← tap/drag to toggle expand
 *       .nearby-handle-bar
 *       .nearby-handle-label (text: "주변 충전소 N곳")
 *     .nearby-list    ← scrollable list of stations
 * @returns {HTMLElement}
 */
function ensureNearbySheet() {
  if (nearbySheetEl) return nearbySheetEl;

  nearbySheetEl = document.createElement('div');
  nearbySheetEl.id = 'nearby-sheet';
  nearbySheetEl.className = 'nearby-sheet nearby-sheet--peek';
  nearbySheetEl.setAttribute('aria-label', '주변 충전소 목록');

  nearbySheetEl.innerHTML = `
    <div class="nearby-handle" id="nearby-handle" role="button" aria-label="주변 충전소 목록 펼치기" tabindex="0">
      <div class="nearby-handle-bar" aria-hidden="true"></div>
      <span class="nearby-handle-label" id="nearby-handle-label">주변 충전소</span>
    </div>
    <div class="nearby-list" id="nearby-list" role="list"></div>`;

  document.body.appendChild(nearbySheetEl);

  const handle = nearbySheetEl.querySelector('#nearby-handle');

  function toggleNearby() {
    nearbyExpanded = !nearbyExpanded;
    nearbySheetEl.classList.toggle('nearby-sheet--expanded', nearbyExpanded);
    nearbySheetEl.classList.toggle('nearby-sheet--peek', !nearbyExpanded);
    handle.setAttribute('aria-label', nearbyExpanded ? '주변 충전소 목록 닫기' : '주변 충전소 목록 펼치기');
  }

  handle.addEventListener('click', toggleNearby);
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNearby(); }
  });

  return nearbySheetEl;
}

/**
 * Collapse the nearby sheet to its peek state.
 * Called when the detail sheet opens, so the two panels don't fight for space.
 */
function collapseNearbySheet() {
  if (!nearbySheetEl) return;
  nearbyExpanded = false;
  nearbySheetEl.classList.remove('nearby-sheet--expanded');
  nearbySheetEl.classList.add('nearby-sheet--peek');
  const handle = nearbySheetEl.querySelector('#nearby-handle');
  if (handle) handle.setAttribute('aria-label', '주변 충전소 목록 펼치기');
}

/**
 * Build the row HTML for one 환경부 station in the nearby list.
 * @param {object} station
 * @param {number} dist — distance in metres from myPosition
 * @returns {string}
 */
function nearbyRowHtml(station, dist) {
  const name        = station.name || station.stationName || station.statNm || '충전소';
  const available   = station.availableCount ?? 0;
  const total       = station.totalCount     ?? 0;
  const isFast      = (station.speed || station.chargerType) === '급속';
  const speedLabel  = isFast ? '급속' : '완속';
  const availColor  = available > 0 ? '#1c9e52' : '#b0b0b0';
  const distLabel   = fmtDistance(dist);

  // Plug icon SVG (inline, no emoji)
  const plugIconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
         fill="none" stroke="${availColor}" stroke-width="2.5"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 2v6"/>
      <path d="M19 2v6"/>
      <path d="M5 8a7 7 0 0 0 14 0"/>
      <line x1="12" y1="15" x2="12" y2="22"/>
    </svg>`.trim();

  // Distance icon
  const distIconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
         fill="none" stroke="#aaa" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <line x1="12" y1="2"  x2="12" y2="6"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="2"  y1="12" x2="6"  y2="12"/>
      <line x1="18" y1="12" x2="22" y2="12"/>
    </svg>`.trim();

  return `
    <div class="nearby-row" role="listitem" data-lat="${station.lat ?? station.latitude}" data-lng="${station.lng ?? station.longitude}">
      <div class="nearby-row-main">
        <span class="nearby-row-name">${name}</span>
        <span class="nearby-row-avail" style="color:${availColor}">
          ${plugIconSvg}
          ${speedLabel} ${available}/${total}
        </span>
      </div>
      <div class="nearby-row-dist">
        ${distIconSvg}
        <span>${distLabel}</span>
      </div>
    </div>`.trim();
}

/**
 * Render (or re-render) the nearby stations list.
 * Reads from chargerData, applies the current filter, sorts by distance from myPosition.
 * If myPosition is null, falls back to the current map centre.
 */
function renderNearbyList() {
  const sheet   = ensureNearbySheet();
  const listEl  = document.getElementById('nearby-list');
  const labelEl = document.getElementById('nearby-handle-label');
  if (!listEl || !labelEl) return;

  // Use myPosition or current map centre as origin
  const origin = myPosition || (() => {
    const c = map.getCenter();
    return { lat: c.lat(), lng: c.lng() };
  })();

  // Filter + compute distance for each station
  const rows = chargerData
    .map((station, i) => {
      // Respect current visibility (filter) by checking marker state
      const marker = chargerMarkers[i];
      if (!marker || marker.getMap() === null) return null;

      const lat = station.lat ?? station.latitude;
      const lng = station.lng ?? station.longitude;
      if (!lat || !lng) return null;

      const dist = haversine(origin, { lat: Number(lat), lng: Number(lng) });
      return { station, dist, idx: i };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist);

  labelEl.textContent = `주변 충전소 ${rows.length}곳`;

  if (rows.length === 0) {
    listEl.innerHTML = `<div class="nearby-empty">현재 필터에 맞는 충전소가 없습니다.</div>`;
    return;
  }

  listEl.innerHTML = rows.map(({ station, dist }) => nearbyRowHtml(station, dist)).join('');

  // Wire tap on each row → focus marker + open detail sheet
  listEl.querySelectorAll('.nearby-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      const { station } = rows[i];
      const lat = Number(station.lat ?? station.latitude);
      const lng = Number(station.lng ?? station.longitude);
      if (lat && lng) {
        map.setCenter(new naver.maps.LatLng(lat, lng));
      }
      collapseNearbySheet();
      openChargerSheet(station);
    });
  });
}

// ---------------------------------------------------------------------------
// Route corridor mode
// ---------------------------------------------------------------------------

/**
 * Remove the route polyline from the map.
 */
function clearRoutePolyline() {
  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
}

/**
 * Show or hide the "가는 길 충전소" button.
 * Visible only when there is a destination and we're not yet in route mode.
 * When routeModeActive the button changes to "경로 모드 종료" style.
 */
function updateRouteModeButton() {
  if (!btnRouteMode) return;
  if (!lastDestination) {
    btnRouteMode.hidden = true;
    return;
  }
  btnRouteMode.hidden = false;
  if (routeModeActive) {
    btnRouteMode.classList.add('btn-route--active');
    btnRouteMode.setAttribute('aria-label', '경로 모드 종료');
    btnRouteMode.setAttribute('aria-pressed', 'true');
  } else {
    btnRouteMode.classList.remove('btn-route--active');
    btnRouteMode.setAttribute('aria-label', '가는 길 충전소 보기');
    btnRouteMode.setAttribute('aria-pressed', 'false');
  }
}

/**
 * Show the route summary banner.
 * @param {number} distanceKm
 * @param {number} count — number of corridor stations found
 */
/**
 * 고속도로(휴게소) 충전소 판별 — 이름에 "휴게소" 포함 여부.
 * 공식 플래그가 없어 이름 기반 추정이다(예: "안성휴게소 (부산방향) E-pit").
 * @param {object} st
 * @returns {boolean}
 */
function isHighwayStation(st) {
  return (st.name || st.stationName || st.statNm || '').includes('휴게소');
}

/**
 * 경로 모드 충전소 표시 — routeHighwayOnly에 따라 휴게소만/전체 급속을 그린다.
 * 휴게소가 0곳이면(짧은 도심 경로 등) 빈 화면 방지로 전체 급속을 보여주고 배너에 안내.
 */
function renderRouteChargers() {
  const highway = routeAllFast.filter(isHighwayStation);
  const hasMix = highway.length > 0 && routeAllFast.length > highway.length;

  let shown, label, toggle = null;
  if (routeHighwayOnly && highway.length === 0) {
    // 휴게소 없음 → 전체 급속으로 폴백(빈 화면 방지)
    shown = routeAllFast;
    label = `휴게소 없음 · 경로 급속 <strong>${routeAllFast.length}곳</strong>`;
  } else if (routeHighwayOnly) {
    shown = highway;
    label = `경로 휴게소 급속 <strong>${highway.length}곳</strong>`;
    if (hasMix) toggle = { highwayOnly: true };
  } else {
    shown = routeAllFast;
    label = `경로 급속 <strong>${routeAllFast.length}곳</strong> (휴게소 포함)`;
    if (hasMix) toggle = { highwayOnly: false };
  }

  renderChargerMarkers(shown);
  renderNearbyList();
  showRouteBanner(routeDistanceKm, label, toggle);
}

function showRouteBanner(distanceKm, label, toggle) {
  if (!routeBannerEl) {
    routeBannerEl = document.createElement('div');
    routeBannerEl.id = 'route-banner';
    routeBannerEl.className = 'route-banner';
    routeBannerEl.setAttribute('role', 'status');
    routeBannerEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(routeBannerEl);
  }

  const toggleHtml = toggle
    ? `<button class="route-banner-toggle" type="button">${
        toggle.highwayOnly ? '휴게소 외 급속도 보기' : '휴게소만 보기'
      }</button>`
    : '';

  routeBannerEl.innerHTML = `
    <span class="route-banner-text">경로 <strong>${distanceKm}km</strong> · ${label}</span>
    ${toggleHtml}
    <button class="route-banner-close" type="button" aria-label="경로 모드 종료">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>`;

  const toggleBtn = routeBannerEl.querySelector('.route-banner-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      routeHighwayOnly = !routeHighwayOnly;
      renderRouteChargers();
    });
  }

  routeBannerEl.querySelector('.route-banner-close').addEventListener('click', () => {
    exitRouteMode();
  });

  routeBannerEl.hidden = false;
}

/**
 * Hide the route summary banner.
 */
function hideRouteBanner() {
  if (routeBannerEl) routeBannerEl.hidden = true;
}

/**
 * Exit route corridor mode: remove polyline, clear route results,
 * restore normal nearby chargers for current map centre.
 */
async function exitRouteMode() {
  routeModeActive = false;
  routeHighwayOnly = true; // 다음 경로를 위해 기본값(휴게소만) 복원
  routeAllFast = [];
  clearRoutePolyline();
  hideRouteBanner();
  updateRouteModeButton();

  // 경로 모드에서 강제했던 급속 필터를 원래대로 복원
  filter.speed = routePrevSpeed;
  updateChipUI(document.querySelectorAll('.chip[data-filter]'));

  // 경로 모드에서 숨겼던 테슬라 마커 전체 복원 (필터 상태에 맞게)
  teslaMarkers.forEach((m) => m.setMap(filter.tesla ? map : null));

  // Reload normal chargers for current map centre
  const centre = map.getCenter();
  await loadChargers({ lat: centre.lat(), lng: centre.lng() }, { force: true });
  renderNearbyList();
}

/**
 * Sample the route path at roughly every ~12 km of cumulative distance.
 * Always includes first and last point.
 * Caps at 30 samples (logs if capped).
 *
 * @param {{ lat: number, lng: number }[]} path
 * @returns {{ lat: number, lng: number }[]}
 */
function sampleRoutePath(path) {
  if (path.length === 0) return [];
  if (path.length === 1) return [path[0]];

  const STEP_M  = 12_000; // ~12 km between samples
  const MAX_SAMPLES = 30;

  const samples = [path[0]];
  let cumDist = 0;
  let nextThreshold = STEP_M;

  for (let i = 1; i < path.length; i++) {
    cumDist += haversine(path[i - 1], path[i]);
    if (cumDist >= nextThreshold) {
      samples.push(path[i]);
      nextThreshold += STEP_M;
      if (samples.length >= MAX_SAMPLES - 1) {
        // Cap reached — always add last point below, then stop
        console.log(`[route] 샘플 30개 한도 도달 (경로 총 ${path.length}포인트)`);
        break;
      }
    }
  }

  // Always include the last point if not already included
  const last = path[path.length - 1];
  if (samples[samples.length - 1] !== last) {
    samples.push(last);
  }

  return samples;
}

/**
 * Minimum distance in metres from a point to any segment of the route polyline.
 * Uses nearest-point-on-segment approximation.
 *
 * @param {{ lat: number, lng: number }} point
 * @param {{ lat: number, lng: number }[]} path
 * @returns {number} metres
 */
function distToPolyline(point, path) {
  let minDist = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversine(point, path[i]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Enter route corridor mode.
 * Fetches the OSRM driving route, draws it, then loads chargers
 * for all 시군구 along the route and filters to the 3 km corridor.
 */
async function enterRouteMode() {
  if (!lastDestination) return;

  // 출발지: 검색칸(주소/장소) 또는 내 위치
  const start = await resolveRouteStart();
  if (!start) {
    showRetryToast('출발지를 확인해 주세요 (출발지 입력 또는 "현재 위치" 버튼)');
    return;
  }

  showLoading();

  // 1. Fetch route from OSRM
  let routeData;
  try {
    const url = `/api/route?slat=${start.lat}&slng=${start.lng}&glat=${lastDestination.lat}&glng=${lastDestination.lng}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    routeData = await res.json();
  } catch (err) {
    console.error('[route] 경로 요청 실패:', err.message);
    showRetryToast('경로를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    hideLoading();
    return;
  }

  const { path, distanceKm, durationMin } = routeData;
  if (!path || path.length === 0) {
    showRetryToast('경로 데이터가 없습니다.');
    hideLoading();
    return;
  }

  // 2. Draw route polyline
  clearRoutePolyline();
  const pathLatLngs = path.map((p) => new naver.maps.LatLng(p.lat, p.lng));
  routePolyline = new naver.maps.Polyline({
    map,
    path: pathLatLngs,
    strokeColor: '#1c6ef2',
    strokeWeight: 5,
    strokeOpacity: 0.8,
    strokeStyle: 'solid',
    clickable: false,
    zIndex: 30,
  });

  // 3. Fit map bounds to the route
  const bounds = new naver.maps.LatLngBounds();
  pathLatLngs.forEach((ll) => bounds.extend(ll));
  map.fitBounds(bounds, { top: 80, right: 20, bottom: 120, left: 20 });

  // 4. Sample route → unique zscodes
  const samples = sampleRoutePath(path);
  const zscodeMap = new Map(); // zscode → sample {lat,lng}

  await Promise.allSettled(
    samples.map(async (sample) => {
      try {
        const zs = await getZscode(new naver.maps.LatLng(sample.lat, sample.lng));
        if (zs && !zscodeMap.has(zs)) {
          zscodeMap.set(zs, sample);
        }
      } catch (_) {
        // Ignore individual reverse-geocode failures
      }
    })
  );

  // 5. For each unique zscode, fetch chargers
  const stationMap = new Map(); // statId → station

  await Promise.allSettled(
    Array.from(zscodeMap.entries()).map(async ([zscode, sample]) => {
      try {
        const url = `/api/chargers?lat=${sample.lat}&lng=${sample.lng}&radius=999&zscode=${expandZscode(zscode)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const stations = Array.isArray(data) ? data : (data.stations ?? data.items ?? []);
        for (const st of stations) {
          const id = st.statId || st.stationId || `${st.lat ?? st.latitude}_${st.lng ?? st.longitude}`;
          if (!stationMap.has(id)) stationMap.set(id, st);
        }
      } catch (err) {
        console.warn(`[route] zscode=${zscode} 충전소 요청 실패:`, err.message);
      }
    })
  );

  // 경로(여행)에는 급속만 — 속도 필터를 급속으로 강제하고 칩 UI도 반영 (종료 시 복원)
  routePrevSpeed = filter.speed;
  filter.speed = 'fast';
  updateChipUI(document.querySelectorAll('.chip[data-filter]'));

  // 6. Filter to stations within 3 km of the route polyline
  const CORRIDOR_M = 1000; // 경로에 바짝 붙은(±1km) 급속 충전기만
  const corridorStations = Array.from(stationMap.values()).filter((st) => {
    const lat = Number(st.lat ?? st.latitude);
    const lng = Number(st.lng ?? st.longitude);
    if (!lat || !lng) return false;
    const dist = distToPolyline({ lat, lng }, path);
    return dist <= CORRIDOR_M;
  });

  // 7. 급속만 + 빈자리 토글 등 기존 필터 적용 (filter.speed='fast'로 강제됨)
  const filteredStations = corridorStations.filter(chargerPassesFilter);

  // 8. 경로 코리도 급속 전체를 저장하고, 기본은 휴게소(고속도로)만 표시.
  //    (토글 시 재페치 없이 routeAllFast에서 다시 거른다.)
  routeAllFast = filteredStations;
  routeDistanceKm = distanceKm;
  routeHighwayOnly = true;
  renderRouteChargers();

  // 테슬라 슈퍼차저도 경로 ±1km 안에 있는 것만 표시 (전국 전체 X — 이게 "다 보이던" 버그였음)
  teslaMarkers.forEach((m) => {
    const p = m.getPosition();
    const onRoute = filter.tesla && distToPolyline({ lat: p.lat(), lng: p.lng() }, path) <= CORRIDOR_M;
    m.setMap(onRoute ? map : null);
  });

  routeModeActive = true;
  updateRouteModeButton();

  hideLoading();
}

/**
 * Toggle route corridor mode on/off.
 */
async function toggleRouteMode() {
  if (routeModeActive) {
    await exitRouteMode();
  } else {
    await enterRouteMode();
  }
}

/**
 * Create the "가는 길 충전소" pill button and insert it after the filter chips row.
 * Hidden until a destination is set.
 */
function createRouteModeButton() {
  btnRouteMode = document.createElement('button');
  btnRouteMode.id = 'btn-route-mode';
  btnRouteMode.className = 'btn-route-mode';
  btnRouteMode.type = 'button';
  btnRouteMode.hidden = true;
  btnRouteMode.setAttribute('aria-pressed', 'false');
  btnRouteMode.setAttribute('aria-label', '가는 길 충전소 보기');

  // SVG route icon (branching path / route symbol)
  btnRouteMode.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="5" cy="6" r="2"/>
      <circle cx="19" cy="6" r="2"/>
      <circle cx="12" cy="18" r="2"/>
      <path d="M5 8c0 4 7 6 7 6s7-2 7-6"/>
    </svg>
    <span>가는 길 충전소</span>`;

  btnRouteMode.addEventListener('click', () => toggleRouteMode());

  // Insert after filter-chips row
  const filterChips = document.querySelector('.filter-chips');
  if (filterChips && filterChips.parentNode) {
    filterChips.parentNode.insertBefore(btnRouteMode, filterChips.nextSibling);
  } else {
    document.body.appendChild(btnRouteMode);
  }
}

// ---------------------------------------------------------------------------
// 주행가능 거리(Model X) — 배터리%로 목적지 도달/왕복 판단
// ---------------------------------------------------------------------------

/** 우상단 "주행 가능?" 알약 버튼 생성. 목적지가 있을 때만 보인다. */
function createRangeCheckButton() {
  btnRangeCheck = document.createElement('button');
  btnRangeCheck.id = 'btn-range-check';
  btnRangeCheck.className = 'btn-range-check';
  btnRangeCheck.type = 'button';
  btnRangeCheck.hidden = true;
  btnRangeCheck.setAttribute('aria-label', '배터리로 목적지까지 갈 수 있는지 확인');
  btnRangeCheck.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="16" height="10" rx="2"/>
      <line x1="22" y1="11" x2="22" y2="13"/>
    </svg>
    <span>주행 가능?</span>`;
  btnRangeCheck.addEventListener('click', () => openRangeSheet());
  document.body.appendChild(btnRangeCheck);
}

/** 목적지 유무에 따라 버튼 표시. */
function updateRangeButton() {
  if (!btnRangeCheck) return;
  btnRangeCheck.hidden = !lastDestination;
}

/** 트림/배터리 입력 + 결과 모달을 (한 번만) 만든다. */
function ensureRangeSheet() {
  if (rangeSheetEl) return rangeSheetEl;
  rangeSheetEl = document.createElement('div');
  rangeSheetEl.id = 'range-sheet';
  rangeSheetEl.className = 'detail-sheet'; // 음영+블러 backdrop 재사용
  rangeSheetEl.hidden = true;

  const trimsHtml = Object.entries(MODEL_X_TRIMS)
    .map(([k, v]) =>
      `<button type="button" class="range-trim" data-trim="${k}" role="radio" aria-checked="false">
         ${v.label}<small>${v.fullRangeKm}km</small>
       </button>`)
    .join('');

  rangeSheetEl.innerHTML = `
    <div class="sheet-card range-card" role="dialog" aria-modal="true" aria-label="주행 가능 거리 확인">
      <button class="sheet-close" id="range-close" type="button" aria-label="닫기">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
             fill="none" stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <div class="range-title">목적지까지 갈 수 있을까?</div>
      <div class="range-dest" id="range-dest"></div>

      <div class="range-field">
        <div class="range-label">차량 (Tesla Model X)</div>
        <div class="range-trims" id="range-trims" role="radiogroup" aria-label="트림 선택">${trimsHtml}</div>
      </div>

      <div class="range-field">
        <label class="range-label" for="range-battery">현재 배터리 (%)</label>
        <input id="range-battery" class="range-input" type="number" inputmode="numeric"
               min="0" max="100" step="1" placeholder="예: 80" aria-label="현재 배터리 퍼센트" />
      </div>

      <button class="range-go" id="range-go" type="button">확인</button>
      <div class="range-result" id="range-result" role="status" aria-live="polite" hidden></div>
      <div class="range-note">EPA 공인 주행거리 기준 · 도착 시 ${DEFAULT_RESERVE_PCT}% 여유를 남기는 보수적 계산이에요. 겨울·고속 실주행은 더 짧을 수 있어요.</div>
    </div>`;
  document.body.appendChild(rangeSheetEl);

  rangeSheetEl.querySelector('#range-close').addEventListener('click', closeRangeSheet);
  rangeSheetEl.addEventListener('click', (e) => {
    if (e.target === rangeSheetEl) closeRangeSheet(); // backdrop 탭 → 닫기
  });

  rangeSheetEl.querySelectorAll('.range-trim').forEach((btn) => {
    btn.addEventListener('click', () => { lastTrimKey = btn.dataset.trim; updateTrimUI(); });
  });

  const batt = rangeSheetEl.querySelector('#range-battery');
  batt.addEventListener('input', () => { lastBatteryPct = batt.value; });
  batt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runRangeCheck(); }
  });
  rangeSheetEl.querySelector('#range-go').addEventListener('click', () => runRangeCheck());

  return rangeSheetEl;
}

/** 선택된 트림 버튼 강조. */
function updateTrimUI() {
  if (!rangeSheetEl) return;
  rangeSheetEl.querySelectorAll('.range-trim').forEach((b) => {
    const on = b.dataset.trim === lastTrimKey;
    b.classList.toggle('range-trim--active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

/** 모달 열기 — 목적지 이름 채우고 직전 입력 복원. */
function openRangeSheet() {
  if (!lastDestination) return;
  ensureRangeSheet();
  rangeSheetEl.querySelector('#range-dest').textContent = `목적지: ${lastDestination.name}`;
  updateTrimUI();
  rangeSheetEl.querySelector('#range-battery').value = lastBatteryPct;
  rangeSheetEl.querySelector('#range-result').hidden = true;
  rangeSheetEl.hidden = false;
}

function closeRangeSheet() {
  if (rangeSheetEl) rangeSheetEl.hidden = true;
}

/** 도로 거리 가져와 assessTrip 계산 후 결과 렌더. */
async function runRangeCheck() {
  if (!lastDestination || !rangeSheetEl) return;
  const resultEl = rangeSheetEl.querySelector('#range-result');
  const batt = rangeSheetEl.querySelector('#range-battery');
  const batteryPct = Number(batt.value);

  const warn = (msg) => {
    resultEl.hidden = false;
    resultEl.className = 'range-result range-result--warn';
    resultEl.textContent = msg;
  };

  if (batt.value === '' || !Number.isFinite(batteryPct) || batteryPct < 0 || batteryPct > 100) {
    warn('배터리를 0~100 사이 숫자로 입력해 주세요.');
    return;
  }

  const trim = MODEL_X_TRIMS[lastTrimKey];

  resultEl.hidden = false;
  resultEl.className = 'range-result range-result--loading';
  resultEl.textContent = '경로 거리를 계산하는 중…';

  // 출발지: 메인 화면 출발지 검색칸(주소/장소) 또는 내 위치
  const start = await resolveRouteStart();
  if (!start) {
    warn('출발지를 확인할 수 없어요. 상단 출발지 칸에 입력하거나 "현재 위치" 버튼을 눌러주세요.');
    return;
  }

  let routeData;
  try {
    const url = `/api/route?slat=${start.lat}&slng=${start.lng}&glat=${lastDestination.lat}&glng=${lastDestination.lng}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    routeData = await res.json();
  } catch (err) {
    console.error('[range] 경로 요청 실패:', err.message);
    warn('경로를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    return;
  }

  const distanceKm = routeData && Number(routeData.distanceKm);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    warn('경로 거리를 계산할 수 없어요.');
    return;
  }

  const a = assessTrip({ fullRangeKm: trim.fullRangeKm, batteryPct, distanceKm });
  renderRangeResult(resultEl, { a, distanceKm, batteryPct, trim, startName: start.name });
}

/** 결과 카드 렌더. */
function renderRangeResult(el, { a, distanceKm, batteryPct, trim, startName }) {
  const arrival = Math.round(a.arrivalPct);
  const ret = Math.round(a.returnPct);
  const verdict = a.roundTrip
    ? { cls: 'ok',   icon: '✓', headline: '왕복까지 가능해요' }
    : a.oneWay
      ? { cls: 'warn', icon: '!', headline: '편도는 가능, 왕복은 어려워요' }
      : { cls: 'no',   icon: '×', headline: '편도도 빠듯해요 — 가는 길에 충전 필요' };

  const pct = (n) => (n <= 0 ? '도중 방전' : `${n}%`);

  el.className = `range-result range-result--${verdict.cls}`;
  el.innerHTML = `
    <div class="range-verdict"><span class="range-verdict-icon">${verdict.icon}</span>${verdict.headline}</div>
    <div class="range-stat"><span>출발</span><strong>${startName}</strong></div>
    <div class="range-stat"><span>편도 거리</span><strong>${distanceKm}km</strong></div>
    <div class="range-stat"><span>도착 시 예상 배터리</span><strong>${pct(arrival)}</strong></div>
    <div class="range-stat"><span>왕복 후 예상 배터리</span><strong>${pct(ret)}</strong></div>
    <div class="range-stat range-stat--sub"><span>${trim.label} · 현재 ${batteryPct}%</span><strong>안전 주행 ${Math.round(a.usableKm)}km</strong></div>`;
}

// ---------------------------------------------------------------------------
// GPS button
// ---------------------------------------------------------------------------

function wireGpsButton() {
  btnMyLocation.addEventListener('click', async () => {
    const pos = await resolveUserPosition();
    myPosition = pos;
    map.setCenter(new naver.maps.LatLng(pos.lat, pos.lng));
    setMyLocationMarker(pos);
  });
}

// ---------------------------------------------------------------------------
// Refresh button (live data, stale-while-revalidate)
// ---------------------------------------------------------------------------

/**
 * Create the floating refresh button above the GPS button.
 * On click: fires a live (fresh=1) reload for the current map centre.
 * Shows spin animation while in-flight, then updates freshness text.
 */
function createRefreshButton() {
  btnRefresh = document.createElement('button');
  btnRefresh.id = 'btn-refresh';
  btnRefresh.className = 'btn-refresh';
  btnRefresh.type = 'button';
  btnRefresh.setAttribute('aria-label', '충전소 정보 새로고침');
  btnRefresh.title = '충전소 정보 새로고침';

  // Circular-arrows SVG (no emoji)
  btnRefresh.innerHTML = `
    <svg id="refresh-icon" xmlns="http://www.w3.org/2000/svg" width="22" height="22"
         viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
         aria-hidden="true">
      <polyline points="23 4 23 10 17 10"/>
      <polyline points="1 20 1 14 7 14"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>`;

  btnRefresh.addEventListener('click', () => {
    if (liveRefreshInFlight) return; // already refreshing

    const centre = map
      ? (() => { const c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; })()
      : lastLoadedCentre;

    if (!centre) return;

    // Fire a live-only reload (skip cached phase)
    loadChargers(centre, { force: true, liveOnly: true });
  });

  document.body.appendChild(btnRefresh);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  // 1. Start map at Seoul City Hall; Geolocation will move it
  map = initMap(SEOUL_CITY_HALL);

  // 2. Resolve user position (may take up to 8 s)
  const pos = await resolveUserPosition();
  myPosition = pos;

  // 3. Pan map to actual position & draw blue dot
  map.setCenter(new naver.maps.LatLng(pos.lat, pos.lng));
  setMyLocationMarker(pos);

  // 4. Load Tesla layer first (fast, static JSON) — non-blocking
  loadTeslaChargers();

  // 5. Load 환경부 chargers for this centre (may be slow, shows overlay)
  await loadChargers(pos, { force: true });

  // 5b. Init nearby sheet (Feature 2) — renders after chargers are loaded
  ensureNearbySheet();
  renderNearbyList();

  // 6. Wire GPS button for subsequent taps
  wireGpsButton();

  // 6b. Create refresh button (live data reload)
  createRefreshButton();

  // 7. Wire filter chips (Task 11)
  wireFilterChips();

  // 8. Wire 2D / 상세 map type toggle (Task 11)
  wireMapTypeToggle();

  // 9. Wire address search input (Task 11)
  wireSearch();
  wireStartSearch(); // 출발지 검색칸

  // 9b. 출발지 기본값은 내 위치 — 초기엔 검색칸 비움(placeholder "비우면 내 위치")

  // 10. Wire map idle → refetch on move (Task 11)
  wireIdleRefetch();

  // 11. Create "가는 길 충전소" route corridor button (hidden until destination set)
  createRouteModeButton();

  // 12. Create "주행 가능?" button (Model X 배터리→도달/왕복 판단, hidden until destination)
  createRangeCheckButton();
}

// ---------------------------------------------------------------------------
// SDK ready guard
// ---------------------------------------------------------------------------

if (window.naver && window.naver.maps) {
  main();
} else {
  window.addEventListener('load', () => {
    if (window.naver && window.naver.maps) {
      main();
    } else {
      console.error(
        '[app.js] 네이버 지도 SDK를 불러오지 못했습니다. ' +
        'index.html의 ncpKeyId 플레이스홀더를 실제 키로 교체해 주세요.'
      );
    }
  });
}
