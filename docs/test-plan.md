# WalkDraw test plan

- **Build tested:** `main` @ `acc3583` (local `npm run dev`, `npm run build` passes: `tsc --noEmit` clean, one bundle-size warning, 517 kB JS).
- **Date:** 2026-11-17
- **Tool:** Playwright 1.65 + Chromium, geolocation not granted, so the app starts in **simulation mode** (no GPS).
- **Viewports:** phone 390×844 (touch on), desktop 1440×900.
- **Network:** live OSRM foot routing and Nominatim search (the app's normal calls).
- **Not covered:** real GPS on a device, iOS Safari, voice prompts (TTS can't be heard headless), `navigator.share` on mobile, `build:single`.

Result key: ✅ pass · ❌ fail (issue linked) · ⚠️ pass with a note · ⏭ not run

## 1. Start and global UI

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 1.1 | First load, no GPS | Open app and deny location | Toast says simulation mode; `시뮬 ON` shown; no console errors | ✅ |
| 1.2 | No horizontal scroll | Load at 390px and 1440px | `scrollWidth == innerWidth` | ✅ |
| 1.3 | Bottom tabs | Tap 산책하기 / 나의 기록 / 파트너 | Each view opens; map hidden when you're not on the walk tab | ✅ |
| 1.4 | Bottom sheet snap | Tap handle, `지도 넓게` | Peek / half / full states switch | ✅ |
| 1.5 | Dark / light map | Tap 🗺 / 🌙 | Tiles switch between the dark filter and the light map | ✅ |
| 1.6 | Zoom +/− | Tap + and − | Map zooms | ✅ |

## 2. Course mode ① 그림/도안 (sketch)

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 2.1 | Pick a guide | `도안 10종` → 하트 | Heart on map, auto-sized to the goal (20 min walk = 1.6 km) | ❌ route is 2.53 km (issue A) |
| 2.2 | Size / rotate sliders | Move the sliders | Shape and estimated distance update | ✅ |
| 2.3 | 3 candidates | `확인` → `🔍 코스 3개 찾기` | 3 walkable courses with similarity % | ⚠️ button clipped off-screen at 390px (issue D) |
| 2.4 | Candidate sort | Look at the list | Best match first | ⚠️ "추천" 87% shown before "대안 1" 89% (sorted by distance, not similarity) |
| 2.5 | Canvas sketch | `캔버스 그리기` → draw a circle → `완료` | Drawing goes onto the map, sized to the goal | ❌ 3.20 km for a 1.6 km goal (issue A) |
| 2.6 | Draw on map | `지도 위 그리기` | Freehand stroke becomes a shape | ⏭ |
| 2.7 | Drag / rotate handles | `✥` / `↻` on the map | Shape moves / rotates, then reroutes | ⏭ (needs precise drag) |
| 2.8 | Desktop guide editor | 1440px → `도안 10종` | Shape stays visible while you edit | ❌ sheet covers the shape (issue E) |

## 3. Course mode ② AI 추천

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 3.1 | Place search | Type `평촌역` → 검색 | Nominatim results listed | ✅ |
| 3.2 | Round trip with waypoint | Pick result → `AI 코스 3개 추천` | 3 courses close to the 1.6 km goal | ❌ 643 / 516 / 515 m (issue A) |
| 3.3 | Map-tap waypoint | Tap the map in AI mode | "지정한 경유지" set | ✅ (toast) |
| 3.4 | One-way | `편도` | One-way courses | ⏭ |

## 4. Course mode ③ 점 찍기 (pin)

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 4.1 | Pins connect | Tap the map 3 times | Numbered pins joined by a walking route | ✅ |
| 4.2 | Undo / clear | `되돌리기`, `지우기` | Last pin / all pins removed | ✅ buttons present |
| 4.3 | Bookmark | `🔖 찜` | Saved to 찜한 코스 | ⏭ |

## 5. Free mode, walking and the navigation HUD

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 5.1 | Free walk by map taps | `자유` → `산책 시작` → tap 5 points → `완료` | Track drawn; finish modal | ✅ |
| 5.2 | Turn-by-turn HUD | Walk a sketch route with `자동 걷기` | Next turn, distance, remaining time, progress bar | ✅ |
| 5.3 | Pause → resume → auto-walk | Pause mid-route, `재개`, `자동 걷기` | Continue from the current point | ❌ restarts at the route start, adds phantom distance (issue C) |
| 5.4 | Screen lock | 🔒 during a walk | Taps ignored; big unlock control | ⚠️ one tap unlocks (issue F) |
| 5.5 | Draft restore | Walk, pause, reload, `이어서` | Distance, time and course restored | ❌ time drops 00:09 → 00:04; course lost (issue B) |
| 5.6 | Cancel walk | `기록 취소` | Record discarded | ✅ (no confirmation asked) |
| 5.7 | Voice prompts | 🔇 → 🔊 | Turn and 1 km announcements | ⏭ (headless) |

## 6. Finish, partners

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 6.1 | Finish modal | `완료` | Distance/time, reward partner, rating + tags | ✅ |
| 6.2 | Partner book | 파트너 tab | 20 slots, grade filter, locked silhouettes | ✅ |
| 6.3 | Starter gift | `받기` before the first walk | Corgi joins and becomes the companion | ⚠️ if a walk finishes first, the reward partner becomes active; claiming the corgi later still says "함께 걸어요" but doesn't switch (from code, `App.tsx` claimStarterPartner) |

## 7. Records and calendar

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 7.1 | Calendar | 나의 기록 | Walk shown on today with a mini route | ✅ |
| 7.2 | Stats / badges | `통계·배지` | Totals, 7-day bars, 20-week heatmap, badges | ✅ |
| 7.3 | Monthly poster | `✨ 월말정산` → `PNG 저장` | 1080×1350 calendar poster | ✅ (render checked; save not run) |
| 7.4 | Replay / delete | `▶ 재생`, 🗑 | Replays route; deletes the record | ⏭ |
| 7.5 | Bookmarked courses | `찜한 코스` → `따라뛰기` | Loads the saved route | ⏭ |

## 8. Card studio and video

| # | Flow | Steps | Expected | Result |
|---|------|-------|----------|--------|
| 8.1 | Poster card | `카드 스튜디오 열기` | Title, distance, route art | ✅ |
| 8.2 | Background / stickers | `배경·스티커` | 7 colours, photo, stickers | ✅ |
| 8.3 | Timelapse | `타임랩스` → 재생, speeds | Route animates | ✅ |
| 8.4 | PNG save | `PNG 저장` | PNG download | ✅ 1.28 MB |
| 8.5 | Video save | `🎬 영상 저장` | Video download | ✅ MP4, 808 kB |
| 8.6 | Share | `공유` (no Web Share API) | Falls back to PNG download with a toast | ✅ |

## Issues found (ranked by severity)

| ID | Severity | Title |
|----|----------|-------|
| A | High | Course length ignores the time/distance goal (sketch about 1.6–2× too long; AI with a waypoint about 0.4×) |
| B | Medium | Draft restore loses elapsed time and the planned course |
| C | Medium | Resuming auto-walk after a pause restarts at the route start and adds phantom distance |
| D | Medium | `🔍 코스 3개 찾기` is cut off past the right edge at 390px |
| E | Low | Desktop: the guide editor sheet covers the shape being edited |
| F | Low | Eyes-free screen lock unlocks with a single tap |

Screenshots: `docs/qa-screenshots/`.
