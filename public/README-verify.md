# Manual Browser Verification Checklist

Run all checks once a valid NCP Web Dynamic Map client ID is injected.

---

## Setup

### 1. Replace the Naver Maps key placeholder

In `public/index.html`:

```
https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=__NAVER_MAP_CLIENT_ID__
```

Replace `__NAVER_MAP_CLIENT_ID__` with the actual key from the NCP console
(Maps → Web Dynamic Map). Set the allowed domain to `localhost` + your deployment domain.

### 2. Start a local dev server

```bash
vercel dev
```

Or: `npx serve public` for frontend-only testing (API calls will fail — that is expected).

### 3. Open in a mobile-sized window

`http://localhost:3000` in DevTools mobile viewport (e.g. iPhone 14, 390 × 844).

---

## Task 9 Checks (map shell + my location)

- [ ] **Map renders** — Naver map tiles appear; no blank screen; no SDK-key JS errors.
- [ ] **Search bar** — Visible at top, rounded, magnifier SVG icon, placeholder text present.
- [ ] **GPS button** — Bottom-right, circular, crosshair SVG (not an emoji).
- [ ] **No emoji anywhere** — Visual inspection + DevTools Elements panel.

### Scenario A — Location allowed
- Allow browser location prompt.
- Map pans to real GPS position; blue dot appears; no notice toast.
- GPS button tap → re-centres to current position.

### Scenario B — Location denied
- Block location in DevTools → Application → Permissions (or browser prompt).
- Reload: map stays at Seoul City Hall (37.5663, 126.9779).
- Dark toast appears: "위치를 가져올 수 없어 서울시청을 기준으로 표시합니다." (disappears ~4 s).
- No blue dot.

---

## Task 10 Checks (charger + Tesla markers, detail sheet, loading state)

### Loading overlay

- [ ] **Loading overlay appears** immediately after map + location resolve, before the
  `/api/chargers` response arrives.
- [ ] Overlay shows spinner + "충전소 불러오는 중…" + "공공데이터가 조금 느려요".
- [ ] Overlay **disappears** once chargers are rendered (success) or after API error (failure).
- [ ] Overlay does NOT block map pan/zoom (pointer-events: none).

### 환경부 charger markers (green/grey pill pins)

- [ ] **Green markers** appear for stations with `availableCount > 0`; the number inside the pin
  matches `availableCount`.
- [ ] **Grey markers** appear for stations with `availableCount === 0` (만차/점검/대기).
- [ ] Pin shape: rounded rectangle body + triangular tip pointing down. No emoji.
- [ ] Markers are distinct from the blue "my location" dot and Tesla markers.

### Tesla supercharger markers (red lightning pins)

- [ ] **Red pins** with a lightning-bolt SVG appear for Tesla supercharger locations.
- [ ] Tesla markers are visually distinct from 환경부 markers (red body vs. green/grey).
- [ ] No availability count number on Tesla pins (location-only data).
- [ ] Tesla layer loads independently — even if `/api/chargers` fails, Tesla markers should appear.

### Detail bottom sheet — 환경부 charger

- [ ] Tap a green or grey marker → bottom sheet slides up with backdrop.
- [ ] Sheet shows: station name, speed badge (급속/완속), availability row
  ("N / M대 사용 가능", charging count if > 0), operator name, connector types, distance
  from my location, last-updated timestamp (if present in API response).
- [ ] Speed badge colour: 급속 = orange tint, 완속 = green tint.
- [ ] "네이버지도로 길찾기" button navigates to Naver Map directions (Task 11 ✓).
- [ ] Sheet closes when tapping the X button or the backdrop.

### Detail bottom sheet — Tesla supercharger

- [ ] Tap a Tesla red marker → sheet slides up.
- [ ] Sheet shows: station name, red "테슬라 슈퍼차저" badge, stall count ("충전기 N기"),
  a note line "실시간 빈자리 정보는 제공되지 않습니다. Tesla 앱에서 확인하세요.",
  distance from my location.
- [ ] No availability numbers (no fake data).
- [ ] "네이버지도로 길찾기" red button opens Naver Map directions (Task 11 ✓).

### Retry / error state

- [ ] Kill the API server (or disable network in DevTools) and reload.
- [ ] Loading overlay appears, then disappears after ~45 s timeout.
- [ ] A dark toast appears: "충전소 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
- [ ] Toast disappears after ~5 s. Tesla markers still appear (independent fetch).

### Reverse-geocode (zscode)

- [ ] Open DevTools Network tab. After location resolves, confirm `/api/chargers?...` request
  includes a `zscode=` query param (5-digit number, e.g. `zscode=11680`).
- [ ] If Naver Maps Service is unavailable or key lacks reverse-geocode permission,
  the charger fetch still proceeds (zscode omitted — check console warning).

### Design self-check

- [ ] Zero emoji in the rendered page (use browser "Find" for common emoji codepoints).
- [ ] All icons are inline SVG.
- [ ] Two distinct marker layers: 환경부 (green/grey) and Tesla (red) — no colour confusion.
- [ ] Marker pins have a legible drop-shadow on map tiles.
- [ ] Bottom sheet has smooth slide-up animation; backdrop dims correctly.
- [ ] Korean text uses `word-break: keep-all`; no mid-word line breaks.
- [ ] All interactive elements have touch targets ≥ 44 px.

---

## Accessibility spot-checks

- [ ] GPS button: Tab focus → red focus ring (outline: 3px solid #e31937).
- [ ] Screen reader announces GPS button as "내 위치로 이동".
- [ ] Detail sheet has `role="dialog"` + `aria-modal="true"`.
- [ ] Loading overlay has `role="status"` + `aria-live="polite"`.
- [ ] Retry toast has `role="alert"`.

---

## Task 11 Checks (filters, map toggle, search, move-refetch, directions)

### Filter chips

- [ ] **전체 chip** — default active (dark filled). All 환경부 + Tesla markers visible.
- [ ] **급속 chip** — tap activates (dark filled); only 환경부 markers with `chargerType` = 급속 visible. 완속 markers hidden.
- [ ] **완속 chip** — tap activates; only 완속 환경부 markers visible. Mutually exclusive: activating 완속 deactivates 급속.
- [ ] **테슬라 chip** — toggles Tesla red markers on/off. Initial state: on (active). Tap to hide red markers; tap again to show.
- [ ] **빈자리 chip** — toggles availability filter. Only 환경부 stations with `availableCount > 0` visible. Combines with 급속/완속 (e.g. 급속 + 빈자리 = 빈자리 있는 급속).
- [ ] **전체 chip auto-resets** — if all sub-filters are off/default (speed=none, tesla=on, avail=off), 전체 chip becomes active.
- [ ] Filter changes do NOT reload the page or call `/api/chargers` — only show/hide existing markers.
- [ ] Chips scroll horizontally if they overflow viewport width.
- [ ] Chip touch target ≥ 34px tall; visual distinction between active/inactive is clear.

### 2D / 상세 지도 토글

- [ ] **Toggle button** visible above the GPS button (bottom-right), circular, with a map SVG icon and "2D" label.
- [ ] Tap: switches to HYBRID (satellite + labels). Button turns dark background, label changes to "상세", globe SVG appears.
- [ ] Tap again: returns to NORMAL (2D). Button returns to white, label "2D", map SVG appears.
- [ ] No emoji — all icons are inline SVG.
- [ ] Focus ring visible on keyboard navigation.

### Address search

- [ ] Search input is now **interactive** (not readonly) — tap to focus, mobile keyboard opens.
- [ ] Type an address or place name (e.g. "강남구청", "서울시청") → press Enter.
- [ ] Map moves to the geocoded location; charger markers reload for new centre.
- [ ] A clear (×) button appears inside the search bar when text is present; tapping clears and refocuses.
- [ ] If the query returns no results: a small notice "검색 결과를 찾을 수 없습니다." appears below the search bar (auto-hides ~3 s).
- [ ] TODO (requires NCP key with Geocoding API enabled): confirm `naver.maps.Service.geocode` fires and `response.v2.addresses[0]` contains `x` (lng) and `y` (lat) fields.

### Refetch on map move

- [ ] **Pan** the map to a new area (~500 m+ away) → ~400 ms after panning stops, `/api/chargers` request fires for the new centre (check DevTools Network tab).
- [ ] **Small pan** (< 300 m) → no new request (check console: "중심 이동 Xm < 300m — 재조회 건너뜀").
- [ ] **While a request is in-flight**: pan again → second request is skipped (check console: "이미 요청 중 — 중복 요청 건너뜀").
- [ ] Loading overlay appears / disappears correctly during move-refetch.

### 길찾기 directions button

- [ ] Tap "네이버지도로 길찾기" on any 환경부 charger sheet → new tab opens with Naver Map directions.
- [ ] Tap "네이버지도로 길찾기" on any Tesla sheet → new tab opens with Naver Map directions.
- [ ] URL format: `https://map.naver.com/p/directions/-/-/{lng},{lat},{name}/-/walk`
  - Destination coordinates are in **lng,lat** order (not lat,lng).
  - Station name is URL-encoded.
  - Opens in new tab (`_blank`), no referrer leaking (`noopener,noreferrer`).
- [ ] TODO (live): confirm the URL sets the correct pin on the Naver Map destination.

---

## Accessibility additions (Task 11)

- [ ] Filter chips have `role="group"` container, individual chips are `<button>` elements.
- [ ] Map type toggle has descriptive `aria-label` that updates on toggle ("2D 지도" / "위성 지도 (상세)").
- [ ] Search clear button has `aria-label="검색어 지우기"`.
- [ ] "검색 결과 없음" notice has `role="status"` + `aria-live="polite"`.

---

## NOT verified in this task (live browser deferred — no NCP key)

- Actual map rendering with real tiles
- Geolocation (GPS) in browser
- Real charger data from `/api/chargers`
- `naver.maps.Service.geocode` (address search) — requires NCP Geocoding API permission
- `naver.maps.Service.reverseGeocode` (zscode) — requires NCP reverse-geocode permission
- Filter visual appearance on real map data
- 길찾기 URL confirmed correct destination on Naver Map (coordinate order)
