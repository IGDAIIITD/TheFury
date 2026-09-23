# Prompt for opencode: Migrate Campus Forge to Supabase + GitHub Pages

## Context

Campus Forge currently runs as:
- `backend/` — Spring Boot 3.3 (port 17172), owns all state, embeds the Forge headless engine in-process for battles, exposes REST + STOMP WebSocket
- `web-client/` — Vite + React 18 PWA, talks only through `src/api/*`, currently served by a Deno static server that proxies `/api`, `/card-art`, `/ws` to the backend
- `admin-console/` — separate Vite + React app, same proxy pattern
- PostgreSQL (Flyway-managed schema, V1–V14)

Goal: split this into (1) a **Supabase backend** (Postgres + Auth + Storage + Edge Functions + Realtime) and (2) a **static frontend on GitHub Pages**, so the client is served over GitHub's SSL (required for camera access during QR scanning) and talks to Supabase directly with no custom server in between.

## ⚠️ Architectural decision you must make before coding

Supabase Edge Functions run on Deno and cannot execute JVM code. The Forge headless engine (`forge-engine/forge-headless`, depended on by `battle/`) **cannot run inside Supabase**. Pick one:

- **Option A (recommended default — implement this unless told otherwise):** Extract `battle/` and the Forge engine bootstrap into a small standalone Java service (`battle-engine/`), deployed separately (Fly.io, Railway, Render, or a campus box) as a plain HTTPS + WebSocket service with no direct DB access. It validates the caller's Supabase JWT (via Supabase's JWKS/JWT secret) and calls back to Supabase (via `service_role` key, server-side only) to read/write match results, XP, and card unlocks through Postgres functions. Everything else (auth, collection, QR, trade, events, achievements, analytics, admin, feed) moves fully into Supabase.
- **Option B:** Descope live battles from this migration entirely for the event. Keep `backend/` + `forge-engine/` running as-is on a campus machine (battles only, on local network), and migrate every *other* domain (identity, collection, QR claims, trades, events, leaderboard, admin) to Supabase + GitHub Pages, since QR scanning/claiming is the piece that actually needs public HTTPS.

Implement **Option A**. State clearly in your plan/PR description which option you went with and why, so it can be swapped for Option B if the battle-engine deploy turns out to be too much for the event timeline.

## Target architecture

```
GitHub Pages (static, SSL)          Supabase (managed)              battle-engine (separate deploy, SSL)
┌────────────────────────┐          ┌───────────────────────┐        ┌───────────────────────────┐
│ web-client (dist/)      │◄───────►│ Postgres + RLS         │        │ Spring Boot (slim) or      │
│ admin-console (dist/)   │  HTTPS  │ Supabase Auth          │        │ plain Java HTTP/WS service │
│ no server, no proxy     │  WSS    │ Storage (card-art)     │◄──────►│ wraps forge-headless        │
│ talks to Supabase +     │         │ Edge Functions (Deno)  │ svc-key│ no DB, stateless per match  │
│ battle-engine directly  │         │ Realtime (feed/match)  │        │ validates Supabase JWT       │
└────────────────────────┘          └───────────────────────┘        └───────────────────────────┘
```

## Work breakdown

### Phase 0 — Inventory & setup
1. Read `THEPLAN.md`, `STEPS/`, `AGENTS.md`, and this repo's `TECHNICAL.md` in full before changing anything; keep them updated as you go.
2. Create a Supabase project (or scaffold `supabase/` locally with the Supabase CLI: `supabase init`). All schema/policy/function changes go through `supabase/migrations/*.sql` — no hand-edits via the dashboard, mirroring the existing "never hand-edit schema" rule.
3. Produce a mapping doc (`STEPS/supabase-migration-map.md`) listing every backend package (`accounts, collection, deck, battle, qr, events, trade, achievements, analytics, admin, security, config, common, notifications, starter`) and where its responsibility lands: Postgres table/RLS, Postgres function (RPC), Edge Function, or battle-engine.

### Phase 1 — Database
1. Port the Flyway migrations (V1–V14) to idempotent Supabase SQL migrations, preserving all tables (`unique_cards`, `claims` incl. `uk_claims_token_core`, `trades`/`trade_cards`, `events` incl. `allowed_sets_json`/`bonus_multiplier` and V13 cascade, `player_achievements`, `favorites`, `discoveries`, `player_unlocks`), all constraints, and the V14 `token_core NOT NULL` change.
2. Replace the custom `players` identity table with a `profiles` table keyed by `auth.users.id` (1:1), holding cohort (`degree_level`, `specialization`, department mapping per `common/Cohort.java`), level/xp, role, onboarding flag.
3. Enable Row Level Security on every table. Write explicit policies replacing Spring Security's role checks: players can read/write only their own rows (collection, decks, favorites); `ADMIN` role (custom claim or `profiles.role`) required for admin tables/actions, matching the current `hasRole("ADMIN")` gate on `/api/v1/admin/**`.
4. Re-implement `LevelService`'s `level = 1 + xp/100` formula as a single Postgres function (e.g. `public.compute_level(xp int)`), called everywhere XP changes — do not inline it in multiple places, matching Key Architectural Rule #2.
5. Re-implement the trade accept flow (`trade/TradeService`) as a single Postgres function using `SELECT ... FOR UPDATE` on the trade row and all involved `unique_cards` rows **in sorted-UUID order**, re-verifying ownership, swapping owners, and appending the `"<ts>: <from> → <to> via trade <id>"` history line — preserving the existing deadlock-avoidance rule. Keep the 24h TTL/`410 Gone`-on-expired behavior (expire lazily on read, same as now).

### Phase 2 — Auth
1. Replace `accounts/AuthController`/`AuthService`/JWT issuance with Supabase Auth (email/password is fine for a campus event). On sign-up, create the matching `profiles` row (Postgres trigger on `auth.users` insert) and validate cohort fields (`degreeLevel`/`specialization` required, per `RegisterRequest`).
2. Frontend swaps `AuthContext.tsx` to use `@supabase/supabase-js`'s session management instead of manual `localStorage` `cf_token`/`cf_player`; let the Supabase client manage token refresh.
3. Leaderboard queries (`GET /api/v1/leaderboard` with `degreeLevel`/`specialization`/`department` filters) become a Postgres function or a view + `select` with filters, callable from the client under RLS (read-only, non-sensitive fields only).

### Phase 3 — QR claims (Edge Function)
1. Move `QrCodeSigner`/`ClaimService` logic to a Supabase Edge Function (`supabase/functions/claim`). Keep the exact token format `V1.<CORE>.<SIG>` (HMAC-SHA256, constant-time compare) and the rule that forged/tampered tokens return 400 **before any DB lookup**. Store the signing secret as an Edge Function secret, never in the frontend bundle.
2. Keep legacy bare-core resolution via `claims.token_core`.
3. Re-implement `QrCatalogExporter`: an Edge Function or scheduled Supabase Cron job that (re)generates `cards.json`/`cards.csv` with the same deterministic core derivation (`SHA-256("cf-print:" + cardId)`), and admin endpoints equivalent to `GET .../qr-catalog?format=json|csv` and `POST .../qr-catalog/regenerate`, gated to admins.
4. Re-implement the per-user+IP rate limit on claims (token bucket) inside the Edge Function (in-memory is fine for a single-region function, or use a small Postgres-backed counter table if you need it durable across cold starts) — same for `POST /auth/login|register`-equivalent flows if you keep any custom auth wrapper. Return `429` + `Retry-After` + JSON body to match current behavior.

### Phase 4 — Card art
1. Upload `card-art/*.jpg` to a public (or signed-URL) Supabase Storage bucket.
2. Update `src/lib/scryfall.tsx`'s `scryfallArtUrl(name)` to return the Supabase Storage public URL instead of `/card-art/{slug}.jpg`. Update `setup/download-card-art.ps1` to push into Storage (via the Supabase CLI or REST) instead of the local folder, keeping it idempotent.

### Phase 5 — Realtime (feed + match sync)
1. Replace the in-memory feed ring + STOMP `/topic/feed` with a Supabase Realtime channel (Broadcast, or Postgres Changes on an `activity_feed` table capped/pruned to the last 50 rows to match `CAPACITY=50`). Keep the REST history endpoint as a simple table read.
2. Per-seat match sync (`/topic/match/{matchId}/p0|p1`, action posts to `/app/match/{matchId}/action`) is owned by the **battle-engine** service (Option A), not Supabase — the frontend opens a WebSocket directly to battle-engine for the duration of a match, authenticated with the Supabase access token. Battle-engine writes final results back to Supabase via a service-role RPC (`record_match_result`) when a match ends, which updates XP/unlocks through the same `compute_level`/`CollectionService`-equivalent functions from Phase 1.

### Phase 6 — Battle engine extraction
1. Extract `battle/` + `forge-engine/`, `forge-headless` wiring into a standalone deployable app (`battle-engine/`). Keep `MatchManager`/`ForgeMatchSession`/`ForgeEngineBootstrap` logic; drop all Spring Data/JPA/Postgres dependencies — it should hold match state in memory only, per the existing "Forge never talks to PostgreSQL" rule (rule #1), which now also means *this service* has no DB connection at all.
2. Auth: verify the Supabase-issued JWT on WebSocket CONNECT (validate signature against the Supabase JWT secret/JWKS) instead of the old custom `Authorization: Bearer` check.
3. Preserve exactly: `saLabel()` output format (`{CardName} - {ManaCost} {RulesText}`, no type line), `GameStateSerializer`'s separate `entry.type` field, the instant-speed filtering behavior in `matchOptionsToCards`/ActionBar (demote `Instant` outside `COMBAT_*`, auto-skip when only mana abilities + filtered instants remain, Flash/sorceries stay castable), the action bar's "only show confirm row when ≥1 selected" UI contract (frontend-side, unchanged), and the mana-affordability TODO note (`CostPartMana.canPay()` always `true`; real filtering stays in `HumanPlayerController.getPlayableSAs()`).
4. Preserve build order: `forge-headless` built first (`mvn -pl forge-headless -am install -DskipTests`), then `battle-engine`.
5. Deploy target: containerize it (Dockerfile) for Fly.io/Railway/Render with HTTPS/WSS termination — it must be reachable over SSL from GitHub Pages, same as Supabase.

### Phase 6.5 — Expose the locally-hosted battle-engine over HTTPS (Cloudflare Tunnel)

Context: `battle-engine` will run on a machine on the campus network (a laptop, a lab PC, whatever). Because `web-client` is served over `https://` from GitHub Pages, browsers block any `fetch()`/`WebSocket()` call from that page to a plain `http://` address — including private IPs like `192.168.x.x` — this is mixed-content blocking, not a network-reachability issue. The fix is to front the local Java service with **Cloudflare Tunnel**, which gives it a real, publicly-trusted HTTPS/WSS URL without opening any inbound ports on the campus network or managing certificates.

1. **Install `cloudflared` on the machine running `battle-engine`.**
   - Windows (PowerShell, matches the existing dev-env setup in §8): download the latest `cloudflared-windows-amd64.exe` from `https://github.com/cloudflare/cloudflared/releases/latest`, rename it `cloudflared.exe`, and place it alongside the other portable tools (e.g. `C:\Users\student\AppData\Local\Temp\opencode\cloudflared\`). Add that folder to `PATH` the same way Maven/Node are added.
   - macOS: `brew install cloudflare/cloudflare/cloudflared`
   - Linux: `curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared`
   - Verify: `cloudflared --version`

2. **Choose quick tunnel vs. named tunnel.**
   - **Quick tunnel** (fastest, no Cloudflare account needed, good enough for a one-off event): the URL is randomly generated per run (`https://random-words-1234.trycloudflare.com`) and changes every time you restart `cloudflared` unless you keep the same process alive. Use this if you can start the tunnel once, well before the event, and leave it running for the whole event.
   - **Named tunnel** (recommended if you want a stable URL you can bake into the build ahead of time, e.g. if a Cloudflare account/domain is available): gives you a fixed hostname like `https://battle.yourevent.com` that survives restarts. Slightly more setup (steps 2a below); skip to step 3 if you're doing the quick-tunnel route.

   **2a. Named tunnel setup (optional, do this if you have/can get a domain on Cloudflare):**
   ```bash
   cloudflared tunnel login                     # opens browser, pick the zone/domain
   cloudflared tunnel create campus-forge-battle # creates a tunnel + credentials JSON
   cloudflared tunnel route dns campus-forge-battle battle.yourevent.com
   ```
   Create `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: campus-forge-battle
   credentials-file: /path/to/<tunnel-id>.json
   ingress:
     - hostname: battle.yourevent.com
       service: http://localhost:17172
     - service: http_status:404
   ```
   Run it with `cloudflared tunnel run campus-forge-battle`.

3. **Run the quick tunnel (simplest path — start here):**
   ```bash
   cloudflared tunnel --url http://localhost:17172
   ```
   `cloudflared` will print a line like:
   ```
   +--------------------------------------------------------------------------------------+
   |  Your quick Tunnel has been created! Visit it at (it may take a few minutes to be     |
   |  reachable): https://some-random-words.trycloudflare.com                              |
   +--------------------------------------------------------------------------------------+
   ```
   That URL proxies straight through to the Java service on `localhost:17172` (or whatever port `battle-engine` listens on), including WebSocket upgrades for the `/ws/match`-equivalent endpoint — Cloudflare Tunnel passes WSS through transparently, no extra config needed for that.

4. **Keep it running for the duration of the event.** A tunnel that dies drops connectivity for everyone. Don't just leave a terminal window open — wrap it so it survives crashes/reboots/logouts:
   - **Windows:** create a small wrapper script `run-tunnel.ps1`:
     ```powershell
     while ($true) {
       & "C:\...\cloudflared.exe" tunnel --url http://localhost:17172
       Start-Sleep -Seconds 5   # restart loop if it ever exits
     }
     ```
     Run it via `Start-Process -WindowStyle Hidden powershell -ArgumentList "-File run-tunnel.ps1"` or register it as a Scheduled Task set to run at logon, so it survives you closing the terminal.
   - **macOS/Linux:** run `cloudflared` as a systemd/launchd service, or install it as a service directly: `sudo cloudflared service install` (named tunnel only), or use a process supervisor (`pm2`, `supervisord`, or a simple `nohup ... &` plus a `while true; do ...; done` restart loop for the quick-tunnel case).
   - Either way, log output to a file (`cloudflared ... 2>&1 | tee tunnel.log`) so you can debug on the day if something drops.

5. **Wire the URL into the frontend build.**
   - HTTP calls use `https://<tunnel-hostname>`; WebSocket calls use `wss://<tunnel-hostname>` (same host, scheme swapped) — Cloudflare terminates TLS and upgrades the connection to the local `ws://localhost:17172` service behind it.
   - Set `VITE_BATTLE_ENGINE_URL=https://<tunnel-hostname>` (the frontend code derives the `wss://` variant from it, or set a second `VITE_BATTLE_ENGINE_WS_URL` if you'd rather be explicit — either is fine, just be consistent with what `src/api/battleEndpoints.ts` expects).
   - If you went with the **quick tunnel**, the hostname is only known once `cloudflared` starts — so run the tunnel *first*, grab the printed URL, put it in `web-client/.env.production`, then build and deploy the frontend. Do this well ahead of the event, not last-minute, since a rebuild is needed if the URL ever changes.
   - If you went with the **named tunnel**, the hostname is fixed ahead of time, so you can set the env var once and never touch it again even across restarts.

6. **CORS on the Java service.** `battle-engine` (and `backend/` if any part of it is still reachable this way) must allow the GitHub Pages origin in its CORS config — e.g. `https://<your-github-username>.github.io` — since the browser will now see this as a genuine cross-origin request (different scheme/host from the tunnel URL). Update the Spring Security CORS config accordingly (mirrors the existing rule that CORS only allows specific origins, mentioned in §3.3).

7. **Test before the event, from an actual phone on campus wifi (not just the dev machine):**
   - Open the deployed GitHub Pages site on a phone.
   - Confirm the browser console shows no mixed-content or CORS errors when a match starts.
   - Kill and restart `cloudflared` once during a test to confirm your restart-loop/service setup actually recovers and (for quick tunnels) that you've re-propagated the new URL if it changed.
   - Have a fallback plan documented (e.g. Option B from earlier — running `backend/` + Forge locally and only using it over campus wifi with self-signed trust manually installed on a couple of staff phones) in case the tunnel has issues on event day.

8. **Don't forget the QR-scanning motivation still applies independently.** This tunnel step is only for `battle-engine` reachability. `web-client`'s QR camera access works because GitHub Pages itself is HTTPS — that part doesn't need a tunnel at all, only the piece that calls back into the locally-hosted Java service does.

### Phase 7 — Frontend → static hosting
1. Remove `serve.mjs` (Deno proxy) and Vite dev-server proxy config for `/api`, `/card-art`, `/ws` — there is no backend to proxy to anymore. All calls go straight to absolute Supabase/battle-engine URLs, driven by environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BATTLE_ENGINE_URL`) baked in at build time.
2. Rewrite `src/api/*` (client.ts + `battleEndpoints.ts`, `qrEndpoints.ts`, `tradeEndpoints.ts`) to use `@supabase/supabase-js` for everything that's now Postgres/RLS/RPC/Edge-Function-backed, and plain `fetch`/`WebSocket` to `VITE_BATTLE_ENGINE_URL` for battle. Keep this as the **only** layer that talks to the backend — rule #8 still applies, it just now points at two services instead of one.
3. Configure Vite `base` for GitHub Pages project-page hosting (`/<repo-name>/`) and add a `vite-plugin-pwa` config check — service worker scope must match the Pages base path.
4. Add SPA fallback for GitHub Pages (no server-side rewrites): standard `404.html`-redirects-to-`index.html` trick, since Pages can't do the `navigateFallback` server proxying `serve.mjs` used to provide — confirm the existing workbox `navigateFallback` still covers offline deep-link reloads once GH Pages' native routing quirk is worked around.
5. `admin-console/` gets the same treatment: same Supabase client, RLS/role check enforces `ADMIN` (no more separate `hasRole` server check — it's now policy-enforced at the DB), deployed as its own static bundle (either a second GitHub Pages project or a subpath of the same one).

### Phase 8 — CI/CD
1. GitHub Actions workflow: on push to main, build `web-client` and `admin-console`, deploy both to GitHub Pages (`actions/deploy-pages` or `peaceiris/actions-gh-pages`).
2. Separate workflow (or step) to run `supabase db push` / apply migrations against the Supabase project on merge, plus deploy Edge Functions (`supabase functions deploy`).
3. Store `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BATTLE_ENGINE_URL`, and all server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, QR signing secret, battle-engine's JWT verification key) as GitHub/Supabase/host secrets — never in the frontend bundle or repo.

### Phase 9 — Docker / dev environment cleanup
1. `docker-compose.yml`: drop the `db` and `web` services (Postgres and nginx are no longer self-hosted); keep or replace `backend` with `battle-engine`; keep the seed step but point it at Supabase (via `psql` against the Supabase connection string, or `supabase db seed`) instead of the local Postgres container.
2. Update `restart-all.ps1`/`restart-backend.ps1` and the Windows dev-env notes in section 8 of `TECHNICAL.md` to reflect the new services (Supabase CLI local dev via `supabase start`, battle-engine run locally, `npm run dev` for web-client against local Supabase + local battle-engine).

### Phase 10 — Testing
1. Update backend test suites (`deck, collection, qr, analytics, security, common, cohort, trade`) to target Postgres functions/RLS via `supabase-js` or `pgTAP`, whichever fits; keep `TradeConcurrencyTest`-equivalent coverage for the sorted-UUID locking function against a live local Supabase Postgres instance.
2. Update `web-client/scripts/*-e2e.cjs` to hit the deployed (or locally running `supabase start`) Supabase instance + battle-engine instead of the old backend/Deno proxy; `battle-e2e.cjs` and `battle-ui-smoke.cjs` need the battle-engine reachable, `trade-e2e.cjs`/`admin-e2e.cjs`/`ecosystem-e2e.cjs` need Supabase auth rate limits accounted for (per-IP burst behavior now lives in the Edge Function, not Spring).
3. Run `npm run lint`, `npm test`, `npm run build` for both frontend apps as before.

## Non-negotiables (carry over from `TECHNICAL.md` §9)
Keep these true post-migration, just re-homed:
1. All state lives in Supabase Postgres; the battle-engine touches nothing outside the rules engine and holds no persistent state of its own.
2. Level/xp formula lives in exactly one place (`compute_level` Postgres function).
3. Cohort validation stays centralized (one Postgres function/constraint, not duplicated in the frontend).
4. Schema changes are always Supabase SQL migrations — never edited by hand via dashboard.
5. QR codes stay signed; forged tokens rejected before any DB work.
6. Card art is proxied via Supabase Storage; no external art API at runtime.
7. Trades still lock rows in sorted-UUID order inside a single Postgres function.
8. The web client only talks to the backend through `src/api/*` (now targeting Supabase + battle-engine).

## Deliverables
- Updated `THEPLAN.md`/`TECHNICAL.md` describing the new two-(or three-)service architecture.
- `supabase/` directory with migrations, RLS policies, functions, and Edge Functions, deployable via Supabase CLI.
- `battle-engine/` standalone service with its own Dockerfile and README covering local run + deploy, plus the Cloudflare Tunnel setup (`run-tunnel.ps1`/service config, CORS update, and the resulting `VITE_BATTLE_ENGINE_URL`) documented for event day.
- `web-client/` and `admin-console/` building to static `dist/` with zero server dependency, deployable to GitHub Pages via CI.
- GitHub Actions workflows for frontend deploy + Supabase migration/function deploy.
- A short migration-map doc plus a "what changed / what to verify before the event" checklist, given this is going live for a university event with real QR scanning.
