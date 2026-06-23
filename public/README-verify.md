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
- [ ] "네이버지도로 길찾기" button is present but does not navigate (Task 11 TODO).
- [ ] Sheet closes when tapping the X button or the backdrop.

### Detail bottom sheet — Tesla supercharger

- [ ] Tap a Tesla red marker → sheet slides up.
- [ ] Sheet shows: station name, red "테슬라 슈퍼차저" badge, stall count ("충전기 N기"),
  a note line "실시간 빈자리 정보는 제공되지 않습니다. Tesla 앱에서 확인하세요.",
  distance from my location.
- [ ] No availability numbers (no fake data).
- [ ] "네이버지도로 길찾기" red button is present but does not navigate (Task 11 TODO).

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

## NOT verified in this task (Task 11)

- Filter chips interaction
- Address search bar wiring (currently `readonly`)
- 길찾기 button URL (button exists but handler is a console.info stub)
- Refetch on map drag/zoom
- 2D map toggle
