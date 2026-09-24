# Web app (PWA)

`web-client/`: Vite + React 18 + TypeScript, installable as a PWA, deployed to GitHub Pages at
**https://igdaiiitd.github.io/TheFury/**. HTTPS matters: browsers only allow the camera (QR scanning) on secure
origins.

## Pages

| Route | Page | Data |
| --- | --- | --- |
| `/login` | sign in / register (with cohort) | Supabase Auth |
| `/collection` | catalog + owned cards, filters, favorites, discovery counts. Opens on **Owned**, shows the first 25 matches with a **See all** button | tables (own rows) |
| `/collection/trades` | offer / accept / decline / cancel trades; live via Realtime | trade RPCs |
| `/collection/events` | active and upcoming events + live activity feed | `events`, `activity_feed` (Realtime) |
| `/decks` | deck builder with server-side validation | `decks`, `deck_cards`, `validate_deck_spec` |
| `/battle` | lobbies, join by code, the battle board | battle engine REST + WebSocket |
| `/scan` | camera QR scanner (jsQR) + manual 12-character entry | `claim` Edge Function |
| `/profile` | stats, badges, battle record | `my_profile_stats` |
| `/leaderboard` | level / collection / win-rate rankings with cohort filters | `leaderboard_full` |

Everything except `/login` requires a session (`RequireAuth` in `App.tsx`). First-time players see an
onboarding modal.

## Code layout

```
src/
  api/            the ONLY layer that talks to Supabase or the engine
    supabaseClient.ts        client + callEdgeFunction()
    endpoints.ts             catalog, collection, decks, stats, leaderboard, events, feed
    tradeEndpoints.ts        trade RPCs + subscribeToTrades() (Realtime)
    qrEndpoints.ts           claimToken() → claim Edge Function
    feedRealtime.ts          subscribeToFeed()
    battleConfig.ts          engine origin, REST base, WebSocket URL, token
    battleEngineDiscovery.ts runtime engine URL (app_config + Realtime)
    battleEndpoints.ts       engine REST (axios)
  auth/AuthContext.tsx       session, login/register, profile
  pages/                     one component per route; battleUi.ts = pure, tested battle logic
  components/                Layout (tabs), BattleCard, OnboardingModal
  lib/                       scryfall.tsx (card art URLs), idb.ts (offline cache), colors.ts
```

Tests `vi.mock` the `api/*` modules, so keep their exported names and signatures stable (and add new exports
to the mocks).

## Environment variables (build time)

| Variable | Dev (`.env.development`) | Pages build (`deploy-web.yml`) |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | hosted project URL | same |
| `VITE_SUPABASE_ANON_KEY` | publishable key (public) | same |
| `VITE_BATTLE_ENGINE_URL` | `http://localhost:17175` | empty → discovered at runtime |
| `BASE_PATH` | `/` | `/TheFury/` |

## How the Battle tab finds the engine

If `VITE_BATTLE_ENGINE_URL` is set, it wins. Otherwise `battleEngineDiscovery.ts`:

1. reads `app_config.battle_engine_url` (public row) on startup;
2. checks `GET <url>/api/v1/battle/features` answers (5 s timeout);
3. only then sets the engine origin and re-renders the app, which shows the Battle tab;
4. listens to Realtime changes on that row, so a restarted engine's new URL, or a cleared one, applies
   without a reload.

`battleEndpoints.ts` resolves its base URL per request for this reason. Battle live updates use
`@stomp/stompjs` over a **native WebSocket** (`brokerURL`, `wss://` in production). Don't use SockJS: it rejects
`ws(s)://` URLs, and its `unload` listener triggers a Permissions-Policy violation.

## GitHub Pages specifics

- **Router basename = Vite base.** `main.tsx` passes `import.meta.env.BASE_URL` to `BrowserRouter`. Without it,
  the `/TheFury/` subpath renders a blank page with no error.
- **Deep links.** Pages can't rewrite unknown paths to the app. The `staticRouteShells` plugin in
  `vite.config.ts` writes a copy of `index.html` to `<route>.html` and `<route>/index.html` for every static
  `<Route path>` in `App.tsx`, so `/TheFury/leaderboard` and friends return **200**. The workflow also copies
  `index.html` → `404.html` for anything else. Routes with parameters (`/x/:id`) would only work through the
  404 fallback; prefer query strings.
- **PWA.** `vite-plugin-pwa` with `registerType: 'autoUpdate'` precaches the app shell; new deploys are picked
  up on the next load.

## Card art

`lib/scryfall.tsx` builds `…/storage/v1/object/public/card-art/<slug>.jpg`. `<CardArt>` hides itself if the
image is missing. Grids use `loading="lazy"`; the battle board uses `loading="eager"`.

Card grids (`.card-grid`, with `.card-grid.compact` for the deck builder) are responsive. On phones
(≤ 600px) they always show **three cards per row**, with smaller tiles and the redundant "Ownership" line hidden.
Don't set grid columns inline, because an inline style overrides the mobile rule.

## Offline cache

`lib/idb.ts` caches the last collection, events, leaderboard and profile responses in IndexedDB, so those
pages render instantly and still work briefly offline. It no-ops when IndexedDB is unavailable (e.g. in tests).

## Commands

```powershell
npm run dev          # http://localhost:17170
npm run lint         # tsc --noEmit
npm test             # vitest (jsdom ^25 + vitest ^0.34 are pinned together)
BASE_PATH=/TheFury/ npm run build
```

## Deployment

Push to `main` → `.github/workflows/deploy-web.yml`: `npm ci`, lint, test, build with `BASE_PATH=/TheFury/`,
copy `404.html`, publish to Pages. Repository settings: Pages **Source = GitHub Actions**, and the
`github-pages` environment must allow `main`.
