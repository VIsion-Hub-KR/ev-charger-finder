/**
 * app.js — Task 11: Filter chips, 2D/상세 map toggle, address search,
 *                   refetch-on-move, 길찾기 directions
 *
 * Builds on Task 10. All previous functionality preserved.
 *
 * New in Task 11:
 *   1. Filter chips (전체/급속/완속/테슬라/빈자리) — show/hide existing markers
 *   2. 2D / 상세 map type toggle (NORMAL ↔ HYBRID)
 *   3. Address search via naver.maps.Service.geocode → map.setCenter + reload
 *   4. Refetch chargers on map idle (debounced 400 ms, min-distance guard, in-flight guard)
 *   5. 길찾기 button → Naver Map directions deep link (new tab)
 *
 * TODO (live verification): All Naver SDK service calls (geocode, reverseGeocode) require
 *   a valid NCP key with the appropriate plan. Replace __NAVER_MAP_CLIENT_ID__ in index.html
 *   before testing in browser.
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seoul City Hall — fallback when Geolocation is unavailable. */
const SEOUL_CITY_HALL = { lat: 37.5663, lng: 126.9779 };

const DEFAULT_ZOOM    = 14;
const CHARGER_RADIUS  = 5000; // metres, passed to /api/chargers

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

// ---------------------------------------------------------------------------
// Loading overlay
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let loadingOverlay = null;

function showLoading() {
  if (loadingOverlay) {
    loadingOverlay.hidden = false;
    return;
  }
  loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'loading-overlay';
  loadingOverlay.setAttribute('role', 'status');
  loadingOverlay.setAttribute('aria-live', 'polite');
  loadingOverlay.innerHTML = `
    <div class="loading-card">
      <div class="loading-spinner" aria-hidden="true"></div>
      <p class="loading-title">충전소 불러오는 중…</p>
      <p class="loading-sub">공공데이터가 조금 느려요</p>
    </div>`;
  document.body.appendChild(loadingOverlay);
}

function hideLoading() {
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
  const name       = station.stationName     || station.statNm || '충전소';
  const speedLabel = station.chargerType === '급속' ? '급속' : '완속';
  const speedClass = station.chargerType === '급속' ? 'badge-fast' : 'badge-slow';
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
    ? `<p class="sheet-update">마지막 갱신: ${lastUpdate}</p>`
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

  el.hidden = false;
}

/**
 * Open the detail sheet for a Tesla supercharger.
 * @param {object} station — { name, lat, lng, stalls }
 */
function openTeslaSheet(station) {
  const el = ensureSheet();
  const name   = station.name  || 'Tesla 슈퍼차저';
  const stalls = station.stalls ?? '—';
  const lat    = station.lat;
  const lng    = station.lng;

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
        <h2 class="sheet-name">${name}</h2>
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
    openNaverDirections({ lat, lng, name });
  });

  el.hidden = false;
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
// Filter application (Task 11)
// ---------------------------------------------------------------------------

/**
 * Determine whether a 환경부 station should be visible given the current filter.
 * @param {object} station
 * @returns {boolean}
 */
function chargerPassesFilter(station) {
  // Speed filter
  if (filter.speed === 'fast') {
    const type = station.chargerType || station.chargerTypeCd || '';
    // 급속: chargerType includes '급속' or DC-based type codes (01,02,03,04)
    if (!type.includes('급속') && !/^(01|02|03|04)/.test(type)) return false;
  }
  if (filter.speed === 'slow') {
    const type = station.chargerType || station.chargerTypeCd || '';
    // 완속: chargerType includes '완속' or AC-based type codes (05,06,07)
    if (!type.includes('완속') && !/^(05|06|07)/.test(type)) return false;
  }

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

  stations.forEach((station) => {
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
      title:     station.stationName || station.statNm || '',
      clickable: true,
      zIndex:    50,
    });

    naver.maps.Event.addListener(marker, 'click', () => {
      openChargerSheet(station);
    });

    chargerMarkers.push(marker);
    chargerData.push(station); // store for filter re-evaluation
  });
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
 * Fetch chargers for the given centre and render markers.
 * Shows a loading overlay while the (potentially slow) API call runs.
 *
 * Guards:
 *   - chargerLoadInFlight: prevents duplicate concurrent requests
 *   - lastLoadedCentre + MIN_MOVE_METRES: skips if centre barely moved
 *
 * @param {{ lat: number, lng: number }} centre
 * @param {{ force?: boolean }} [opts]  — force=true skips the min-distance guard
 */
async function loadChargers(centre, { force = false } = {}) {
  // Min-distance guard (skip if centre hasn't moved enough)
  if (!force && lastLoadedCentre) {
    const moved = haversine(lastLoadedCentre, centre);
    if (moved < MIN_MOVE_METRES) {
      console.debug(`[chargers] 중심 이동 ${Math.round(moved)}m < ${MIN_MOVE_METRES}m — 재조회 건너뜀`);
      return;
    }
  }

  // In-flight guard
  if (chargerLoadInFlight) {
    console.debug('[chargers] 이미 요청 중 — 중복 요청 건너뜀');
    return;
  }

  chargerLoadInFlight = true;
  showLoading();

  let zscode = '';
  try {
    const latLng = new naver.maps.LatLng(centre.lat, centre.lng);
    zscode = await getZscode(latLng);
  } catch (err) {
    // zscode is optional — the API can still return results by lat/lng
    console.warn('[zscode] 역지오코딩 실패, zscode 없이 요청합니다:', err.message);
  }

  const params = new URLSearchParams({
    lat:    String(centre.lat),
    lng:    String(centre.lng),
    radius: String(CHARGER_RADIUS),
  });
  if (zscode) params.set('zscode', zscode);

  const url = `/api/chargers?${params.toString()}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // API may return { stations: [...] } or a bare array
    const stations = Array.isArray(data) ? data : (data.stations ?? data.items ?? []);
    renderChargerMarkers(stations);
    lastLoadedCentre = centre; // update after successful load
  } catch (err) {
    console.error('[chargers] 불러오기 실패:', err.message);
    showRetryToast();
  } finally {
    chargerLoadInFlight = false;
    hideLoading();
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
  return new naver.maps.Map('map', {
    center:     new naver.maps.LatLng(centre.lat, centre.lng),
    zoom:       DEFAULT_ZOOM,
    mapTypeId:  naver.maps.MapTypeId.NORMAL,
    scaleControl:   false,
    logoControl:    true,
    mapDataControl: false,
    zoomControl:    false,
    mapTypeControl: false,
  });
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
function showLocationNotice() {
  locationNoticeEl.hidden = false;
  setTimeout(() => { locationNoticeEl.hidden = true; }, 4000);
}

/**
 * Request the user's current position.
 * Resolves with the position, or falls back to SEOUL_CITY_HALL.
 * @returns {Promise<{ lat: number, lng: number }>}
 */
function resolveUserPosition() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      showLocationNotice();
      resolve(SEOUL_CITY_HALL);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (_err) => {
        showLocationNotice();
        resolve(SEOUL_CITY_HALL);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
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
  const dLat  = Number(lat).toFixed(7);
  const dLng  = Number(lng).toFixed(7);
  const dName = encodeURIComponent(name);

  // Naver Maps directions URL (mode=car: 테슬라 차량용 경로):
  // https://map.naver.com/p/directions/-/-/{dLng},{dLat},{dName}/-/car
  const url = `https://map.naver.com/p/directions/-/-/${dLng},${dLat},${dName}/-/car`;

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
 * Geocode a query string via naver.maps.Service.geocode and move the map.
 *
 * Uses: naver.maps.Service.geocode({ query }, callback)
 * On success: take first result's coords → map.setCenter → loadChargers.
 * On no result or error: show "검색 결과 없음".
 *
 * TODO (live verification): naver.maps.Service.geocode requires the NCP key to have
 *   the "Geocoding" API enabled. Test once a valid key is injected.
 *
 * @param {string} query
 */
async function geocodeAndMove(query) {
  if (!query.trim()) return;

  if (!window.naver?.maps?.Service) {
    console.warn('[search] naver.maps.Service not available — key may be missing');
    showSearchNoResult();
    return;
  }

  naver.maps.Service.geocode({ query: query.trim() }, async (status, response) => {
    if (status !== naver.maps.Service.Status.OK) {
      console.warn('[search] geocode 실패 status:', status);
      showSearchNoResult();
      return;
    }

    const items = response?.v2?.addresses;
    if (!items || items.length === 0) {
      showSearchNoResult();
      return;
    }

    // Take first result
    const first = items[0];
    const lat = parseFloat(first.y);
    const lng = parseFloat(first.x);

    if (isNaN(lat) || isNaN(lng)) {
      showSearchNoResult();
      return;
    }

    const centre = { lat, lng };
    map.setCenter(new naver.maps.LatLng(lat, lng));
    await loadChargers(centre, { force: true }); // force reload for explicit search
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

  // Clear button
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.hidden = true;
    searchInput.focus();
  });

  // Submit on Enter
  searchInput.addEventListener('keydown', (e) => {
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

  // 6. Wire GPS button for subsequent taps
  wireGpsButton();

  // 7. Wire filter chips (Task 11)
  wireFilterChips();

  // 8. Wire 2D / 상세 map type toggle (Task 11)
  wireMapTypeToggle();

  // 9. Wire address search input (Task 11)
  wireSearch();

  // 10. Wire map idle → refetch on move (Task 11)
  wireIdleRefetch();
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
