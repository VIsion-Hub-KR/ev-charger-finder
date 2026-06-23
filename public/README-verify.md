# Task 9 — Manual Browser Verification Steps

Run these checks once a valid NCP Web Dynamic Map client ID is available.

## 1. Replace the placeholder

In `public/index.html`, find:

```
https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=__NAVER_MAP_CLIENT_ID__
```

Replace `__NAVER_MAP_CLIENT_ID__` with the actual key issued from the
NCP console (Maps > Web Dynamic Map). Set the allowed domain to
`localhost` + your deployment domain.

## 2. Start a local server

```bash
vercel dev
```

Or any static server (e.g. `npx serve public`) if testing frontend only.

## 3. Open in a mobile-sized browser window

Open `http://localhost:3000` (or the vercel dev URL).  
Set DevTools to a mobile viewport (e.g. iPhone 14, 390 × 844).

## 4. Checklist — all must pass

- [ ] **Map renders** — Naver map tiles appear, no blank/white screen, no JS console errors about the SDK key.
- [ ] **Floating search bar** — Visible at the top, rounded, with magnifier SVG icon. Placeholder text "어디로 가시나요? 주소·지명 검색" is visible.
- [ ] **GPS button** — Visible at bottom-right, circular, icon is a location crosshair SVG (not an emoji).
- [ ] **No emoji** — Inspect the page visually and in DevTools: zero emoji characters anywhere.

### Scenario A — Location allowed

- Click "Allow" when the browser asks for location permission.
- Expected: map pans to your real position; a blue dot appears there; no notice toast is shown.
- Click the GPS button again — map pans back to your position.

### Scenario B — Location denied

- In DevTools > Application > Permissions, set location to "Block" (or click "Block" in the browser prompt).
- Reload the page.
- Expected:
  - Map is centred on Seoul City Hall (37.5663, 126.9779).
  - A small dark toast appears near the bottom: "위치를 가져올 수 없어 서울시청을 기준으로 표시합니다."
  - Toast disappears after ~4 seconds.
  - No blue dot marker is shown.

## 5. Accessibility spot-check

- Tab to the GPS button — should get a red focus ring (outline: 3px solid #e31937).
- Screen-reader announce: button label should read "내 위치로 이동".
