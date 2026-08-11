# Phase 7: Remaining PWA Surfaces & Offline Support

## Objective
Build out the remaining PWA views (Collection browsing, Profile/Achievements, Leaderboard, Map/Regions) and configure IndexedDB offline caching.

## Detailed Tasks
1. **PWA UI Views**
   - **Collection Browser:** Grid view of owned/unowned cards, filterable by set, color, and rarity.
   - **Profile & Achievements:** Display player stats, XP, level, student ID, and unlocked badges.
   - **Leaderboard:** Global and campus rankings based on level, collection completion, and win rate.
   - **Cohort leaderboard filters (user follow-up):** filter by degree level (B.Tech / M.Tech), specialization (CSE, CSAI, CSAM, CSB, CSSS, CSD, CSECON, ECE, EVE for B.Tech; CSE, ECE for M.Tech), or department roll-up (CSE vs ECE).
   - **Map / Regions:** Campus map view highlighting discovery regions (Engineering, Library, Gym).
2. **PWA Shell & Offline Capabilities**
   - Configure Web App Manifest and Service Worker for offline shell caching.
   - Implement IndexedDB storage for offline collection browsing and cached player data.
3. **Onboarding & iOS Install Guide**
   - Add explicit onboarding instructions for iOS Safari ("Add to Home Screen" walkthrough) and push notification fallback options.

## Implementation Notes & Deviations
- **Map / Regions deferred by user decision.** No `/regions` endpoint or Map page was built this phase; the plan's later view will use `public/campus-map-template.png` (generated placeholder) as a starting asset.
- **Badges are lightweight/derived** (level, discovery count, battle count) per user decision; full achievements system stays in Phase 9.
- **Offline = `vite-plugin-pwa@0.20.5` (generateSW) + hand-rolled IndexedDB kv cache.**
  - `vite.config.ts`: `VitePWA` plugin, `registerType: 'autoUpdate'`, manifest (name, theme `#0f1220`, start_url `/collection`, 192/512 icons), workbox precaches `**/*.{js,css,html,svg,png,ico}` and NetworkFirst for `/api/*` GETs (24h, max 100 entries). `devOptions.enabled = false`.
  - `index.html`: `manifest.webmanifest` link, `theme-color`, `apple-mobile-web-app-*` metas, `apple-touch-icon`.
  - `src/main.tsx`: `registerSW({ immediate: true })` from `virtual:pwa-register`.
  - `src/vite-env.d.ts` (new): references `vite/client` + `vite-plugin-pwa/client` for the virtual module type.
  - Icons `public/icons/icon-{192,512}.png` generated via PowerShell/System.Drawing (dark bg, purple disc, "CF").
- **`src/lib/idb.ts` (new):** `cacheGet`/`cacheSet`/`CACHE_KEYS` (cards, collection, stats, leaderboard(metric, scope)); falls back to no-op `null` when IndexedDB is absent (jsdom tests).
- **Cohort model (user-defined, IIIT-D style):** B.Tech specializations = `CSE, CSAI, CSAM, CSB, CSSS, CSD, CSECON, ECE, EVE`; M.Tech = `CSE, ECE`; department roll-up = CSE (CSE/CSAI/CSAM/CSB/CSSS/CSD/CSECON) vs ECE (ECE/EVE). Source of truth: `common/Cohort.java` (`isValid(degreeLevel, specialization)` case-insensitive, `departmentOf(spec)`).
- **Backend (Phase 7 API):**
  - `common/LevelService` is the single level source (`level = 1 + xp/100`); applied in `MatchManager.rewardWinner` and fixed `CollectionService.discover` to recompute level after +10 XP.
  - New `analytics` package: `PlayerStatsService` / `LeaderboardService` / `AnalyticsController` → `GET /api/v1/players/me/stats`, `GET /api/v1/leaderboard?metric=level|collection|winrate&limit=50` (returns ranked rows + `myRank`). Optional filters `degreeLevel`, `specialization`, `department` (CSE|ECE) apply to rows and to `myRank`.
  - Cohort on accounts: migration `V10__add_player_cohort.sql` (`degree_level`, `specialization` on `players`); `Player` fields + `AuthService.register` validates via `Cohort.isValid` (400 on invalid); `RegisterRequest` requires both; `AuthResponse.PlayerResponse` carries them. `setup/seed_cohorts.sql` backfills test accounts (testbattle=BTECH/CSAI, opponent=MTECH/CSE, Dave=BTECH/CSD, firewall=BTECH/ECE, FireBall=MTECH/ECE, Tcent=BTECH/CSE).
  - Fixed pre-existing `DeckServiceTest.updateExistingDeckPersistsChanges` (20 → 60 islands, STANDARD 60-card minimum). Backend suite: 56 tests pass.
- **Frontend surfaces:**
  - `ProfilePage` (`/profile`): initials avatar, level ring, XP bar, stat cards, favorite colors, badge grid, refresh (calls `/auth/me` + stats), **cohort line** (e.g. `B.Tech · CSAI`).
  - `LeaderboardPage` (`/leaderboard`): metric tabs (Level/Collection/Win Rate), `myRank` banner, medal colors, "you" highlight, cache-first **with per-filter scope keys** (`leaderboard:level:BTECH:CSAI` etc.), **cohort filter chips** (All / CSE dept / ECE dept / B.Tech / M.Tech → specialization chips when a degree is active); dept clears level+spec, level change resets spec.
  - `LoginPage`: registration now requires Degree + Specialization selects (options depend on degree); `AuthContext.register` passes `degreeLevel`/`specialization` in the POST body.
  - `CollectionPage`: cache-first load + **Set** and **Rarity** filter chips added.
  - `AuthContext.refreshPlayer()` refreshes `/auth/me` into state + `localStorage.cf_player`.
  - `Layout`: desktop navbar + **mobile bottom tab bar** (`@media max-width: 899px`, safe-area inset); `OnboardingModal` (900 ms first-run delay, `localStorage.cf_onboard_seen`, iOS A2HS + Android install steps).
- **Offline navigation:** workbox `navigateFallback: '/index.html'` (denylist `/api/*`, `/ws/*`) added so deep SPA routes reload fully offline via the SW precache. `serve.mjs` now strips the browser `Origin` header when proxying `/api` — the backend CORS filter would otherwise 403 any origin not in `SecurityConfig` (e.g. the offline test's `:17171`).
- **Offline verification (new):** `scripts/offline-e2e.cjs` (requires `playwright-core` devDep + system Chrome at `CHROME_PATH`). Builds already-served `dist/` via Deno `serve.mjs`, logs in through the UI, warms Collection/Profile/Leaderboard caches, then flips the browser **offline via CDP** (`Network.emulateNetworkConditions`), reloads a deep route and asserts SW-served shell + cached rows/cards/stats still render with no error banners. `vite.config.ts` + `serve.mjs` edits verified end-to-end: **11 PASS / 0 FAIL**.
- **Verification:** `npm run lint` clean; `npm test` 33/33 green (ProfilePage, LeaderboardPage cohort filters, LoginPage register cohort, CollectionPage cache-fallback, Layout logout, `lib/idb.test.ts`); `npm run build` emits `dist/manifest.webmanifest`, `dist/sw.js`, `dist/workbox-*.js`, icons, map placeholder. Live smoke via Deno `serve.mjs`: manifest/sw/icons/map 200; proxied `/api/v1/players/me/stats` (Lv 13, 84%) and `/api/v1/leaderboard` (with `degreeLevel`, `department`, `specialization` filters) verified.
- **Backend build note:** Maven is not on PATH; use portable `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd` from `backend/`. Restart = stop java, `mvn clean package -DskipTests`, `start-backend.cmd`.
