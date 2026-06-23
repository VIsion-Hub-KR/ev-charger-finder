/**
 * app.js — Task 9: Map shell + My Location
 *
 * Scope (YAGNI):
 *   - Initialise 네이버 지도 (naver.maps.Map)
 *   - Get user's position via Geolocation; centre map there + draw blue dot
 *   - On Geolocation denial/error: fall back to Seoul City Hall, show notice
 *
 * NOT in scope yet:
 *   - Charger markers / API calls  → Task 10–11
 *   - Search geocoding              → Task 11
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seoul City Hall — fallback when Geolocation is unavailable. */
const SEOUL_CITY_HALL = { lat: 37.5663, lng: 126.9779 };

const DEFAULT_ZOOM = 14;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const locationNoticeEl = document.getElementById('location-notice');
const btnMyLocation     = document.getElementById('btn-my-location');

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
    center: new naver.maps.LatLng(centre.lat, centre.lng),
    zoom:   DEFAULT_ZOOM,
    mapTypeId: naver.maps.MapTypeId.NORMAL,
    scaleControl:    false,
    logoControl:     true,
    mapDataControl:  false,
    zoomControl:     false,
    mapTypeControl:  false,
  });
}

// ---------------------------------------------------------------------------
// My Location dot marker
// ---------------------------------------------------------------------------

/** @type {naver.maps.Marker|null} */
let myLocationMarker = null;

/**
 * Draw (or move) the blue "my location" dot on the map.
 * @param {naver.maps.Map} map
 * @param {{ lat: number, lng: number }} position
 */
function setMyLocationMarker(map, position) {
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
      anchor:  new naver.maps.Point(9, 9), // centre of 18×18 dot
    },
    title: '내 위치',
    clickable: false,
    zIndex: 200,
  });
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

/**
 * Show the non-blocking "location unavailable" notice.
 * Auto-hides after 4 s.
 */
function showLocationNotice() {
  locationNoticeEl.hidden = false;
  setTimeout(() => {
    locationNoticeEl.hidden = true;
  }, 4000);
}

/**
 * Request the user's current position and centre the map.
 * Falls back to Seoul City Hall on any error.
 * @param {naver.maps.Map} map
 */
function locateUser(map) {
  if (!('geolocation' in navigator)) {
    // Environment doesn't support Geolocation (e.g. non-secure origin)
    showLocationNotice();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    // Success
    (pos) => {
      const userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setCenter(new naver.maps.LatLng(userPos.lat, userPos.lng));
      setMyLocationMarker(map, userPos);
    },

    // Error — permission denied, unavailable, or timed out
    (_err) => {
      showLocationNotice();
      // Map was already initialised at Seoul City Hall; no need to move.
    },

    {
      enableHighAccuracy: true,
      timeout:            8000,
      maximumAge:         60_000, // accept a cached fix up to 1 min old
    }
  );
}

// ---------------------------------------------------------------------------
// GPS button
// ---------------------------------------------------------------------------

/**
 * Wire the "내 위치" button to re-request location and pan the map.
 * @param {naver.maps.Map} map
 */
function wireGpsButton(map) {
  btnMyLocation.addEventListener('click', () => {
    locateUser(map);
  });
}

// ---------------------------------------------------------------------------
// Entry point — runs after naver maps SDK is loaded
// ---------------------------------------------------------------------------

/**
 * Main initialisation. Called once the Naver Maps SDK is ready.
 * The SDK fires window.initNaverMap if defined; otherwise we call it
 * ourselves after the script tag in index.html (synchronous load).
 */
function main() {
  // Start the map centred at Seoul City Hall; we'll move it if/when
  // Geolocation resolves.
  const map = initMap(SEOUL_CITY_HALL);

  // Attempt to get real user position
  locateUser(map);

  // GPS button re-triggers location
  wireGpsButton(map);

  /*
   * TODO (Task 10): Load charger markers from /api/chargers
   * TODO (Task 11): Wire search bar to Naver Geocoding API
   */
}

// ---------------------------------------------------------------------------
// SDK ready guard
// ---------------------------------------------------------------------------

// The Naver Maps JS SDK v3 loads synchronously when included via <script>.
// If the SDK isn't available yet (race condition), wait for load event.
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
