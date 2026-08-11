# Phase 10: Polish, Security Hardening & Deployment

## Objective
Harden auth + QR claim security (rate limiting, signed claim tokens, auth header hygiene), surface player-facing analytics, and ship a Docker Compose deployment for the whole stack. HTTPS and Kubernetes were explicitly **dropped** (deferred); auth stays Bearer-header based (REST + STOMP) — no cookies.

## Scope decisions (approved)
- **Auth stays Bearer `Authorization`** on REST and STOMP; login/register responses get `Cache-Control: no-store`; CORS `allowedHeaders` tightened. No cookies, no HTTPS.
- **Rate limiter = custom in-memory** (no new deps). Per-IP on `POST /api/v1/auth/login|register`; per-user+IP on `POST /api/v1/claim`. `429` + `Retry-After` + JSON body.
- **Signed QR tokens fully replace bare cores**: `V1.<CORE>.<SIG>` (HMAC-SHA256, constant-time compare). Legacy bare cores remain claimable defensively (resolved by `token_core`).
- **Analytics are player-facing** (`GET /api/v1/analytics/decks|buildings`, `buildingsVisited` on profile stats) + PWA UI (Campus Pulse, buildings chips).
- **Deployment = Docker Compose only.** Backend image packages the **host-built** jar (the `forge:forge-headless:2.0.14-SNAPSHOT` artifact only exists in the local Maven repo, so an in-container Maven build is impractical). Fresh DB is bootstrapped by Flyway V1–V14 + the backend's own idempotent catalog/format seeders; a one-shot `seed` container applies the demo seeds after the backend is healthy.
- **Healthchecks are TCP-based** — the backend has no actuator dependency.

## Implementation

### A1 — Secrets externalized (`backend/src/main/resources/application.properties`)
- `jwt.secret=${JWT_SECRET:…}`, `jwt.expiration=${JWT_EXPIRATION_MS:86400000}`, `campusforge.qr.signing-secret=${QR_SIGNING_SECRET:…}`. Dev defaults preserved; compose overrides via env.

### A2 — Rate limiting (`security/`)
- `TokenBucket` — bounded `ConcurrentHashMap`, token-bucket algorithm, `tryConsume()`.
- `RateLimitFilter` — per-IP burst 30 on auth endpoints, per-user+IP on claim; emits `429` + `Retry-After: <seconds>` + `{"error":"Rate limited"}`.
- Wired in `SecurityConfig` with `.addFilterAfter(rateLimitFilter, JwtAuthenticationFilter.class)`; `SC_TOO_MANY_REQUESTS` constant replaced by literal `429`.
- Tests: `TokenBucketTest`, `RateLimitFilterTest` (6, incl. `Retry-After` header).

### A3 — Signed QR claim tokens (`qr/`, migration V14)
- `QrCodeSigner` — `HmacSHA256`, `HexFormat`, constant-time `MessageDigest.isEqual`, version `V1`, core = 12 uppercase base32-ish chars, SIG = 64 uppercase hex. `sign(core)` / `verify(token)`.
- **V14** `V14__signed_claim_tokens.sql` — adds `claims.token_core varchar(64)` NOT NULL + `uk_claims_token_core` (backfills from `token`), widens `token` to `varchar(128)`. Never hand-edit; new migrations only.
- `Claim.tokenCore`; `ClaimRepository` queries renamed `findByTokenCore` / `findByTokenCoreForUpdate` / `existsByTokenCore`.
- `ClaimService.claim` — verifies `V1.<CORE>.<SIG>` (bare cores still accepted); forged/tampered → **400 before any DB lookup**; mint signs cores. `UNLIMITED` claims are reusable, `UNIQUE` one-shot (unchanged).
- Tests: `QrCodeSignerTest` (8), `ClaimServiceTest` updated (14).

### A4 — Auth hardening (`accounts/AuthController.java`, `security/SecurityConfig.java`)
- Login/register responses `CacheControl.noStore()`.
- CORS: `allowedHeaders` = `Authorization, Content-Type, Accept, X-Requested-With`; `exposedHeaders` = `Retry-After`.

### C1 — Player-facing analytics (`analytics/`)
- `AnalyticsService` — `popularDecks(limit)` (joins `matches × decks`), `activeBuildings(limit)` (claims grouped by building, attributed via `claimed_by`/`claimed_at`); limit clamped 1–100.
- `AnalyticsController` — `GET /api/v1/analytics/decks`, `GET /api/v1/analytics/buildings` (authenticated).
- `PlayerStatsService.myStats` — adds `buildingsVisited` (distinct, trimmed, sorted, from `ClaimRepository.findByClaimedById`). UNLOCK claim now sets `claimedBy`/`claimedAt` + saves, so building activity attributes to the player.
- Tests: `AnalyticsServiceTest`, updated `PlayerStatsServiceTest`.

### C2 — Analytics UI (web-client)
- `src/api/types.ts` / `endpoints.ts` — `PopularDeckDto`, `BuildingActivityDto`, `buildingsVisited` on `ProfileStatsDto`, `getPopularDecks`, `getActiveBuildings`.
- `src/lib/idb.ts` — `CACHE_KEYS.campusPulse`.
- `LeaderboardPage` — **Campus Pulse** panel (most-played decks + most active buildings) with offline IDB cache.
- `ProfilePage` — "Buildings visited" chips.
- Tests: `ProfilePage.test.tsx`, `LeaderboardPage.test.tsx` (2 + 8 = 10).

### C3 — Ecosystem e2e driver (`web-client/scripts/ecosystem-e2e.cjs`)
- Security gates: anon analytics → 401, player on `/admin/**` → 403, garbage token → 401, login `Cache-Control: no-store`.
- Signed QR: admin mint → `V1.*` shape, claim 200 + echo, tamper → 400, forged → 400, bare core resolves to same claim 200, unknown bare core → 404.
- Analytics arrays + `buildingsVisited`; auth burst → 429s with `Retry-After`. Run last (drains the per-IP auth bucket).
- Env `BASE` (default `http://localhost:17172`).

### B1–B4 — Docker Compose deployment
- **`docker/backend/Dockerfile`** — `eclipse-temurin:17-jre`, copies the host-built `backend/target/campusforge-backend-0.0.1-SNAPSHOT.jar` + `forge-engine/forge-gui/res` → `/app/forge-res`, runs with `-Dforge.res.dir=/app/forge-res`, `EXPOSE 17172`.
- **`docker/web/Dockerfile`** — node:20 build stage (`npm ci` + `npm run build`) → `nginx:1.27-alpine` serving `dist/`.
- **`docker/web/nginx.conf`** — SPA fallback; proxies `/api/` and `/ws/` (WebSocket upgrade) to `backend:17172`; strips the browser `Origin` header (mirrors `serve.mjs` so Spring CORS never 403s).
- **`docker-compose.yml`** — `db` (postgres:17-alpine, named volume `pgdata`, `pg_isready`), `backend` (env `JWT_SECRET`/`QR_SIGNING_SECRET`/`SPRING_DATASOURCE_URL=…db…`, TCP healthcheck, ports `17172:17172`), `web` (ports `17170:80`, depends on backend healthy), `seed` (one-shot postgres:17-alpine that waits for backend TCP via `nc` then psql's `docker/seeds/seed_demo_accounts.sql` + `setup/seed_*.sql`). Top-level `name: campusforge`.
- **`docker/seeds/seed_demo_accounts.sql`** — creates `testbattle@campus.edu` (UUID `ac3cc775-…`, BTECH/CSAI) and `opponent@campus.edu` (UUID `4d4fb548-…`, MTECH/CSE) with the `password123` bcrypt hashes. These UUIDs are hard-referenced by `seed_rg_combat_decks.sql` and `seed_cohorts.sql`, so a fresh DB needs the accounts inserted first.
- **`.dockerignore`** — keeps the build context slim (node_modules, dist, the whole forge-engine fork except `forge-gui/res`, `admin-console`, etc.); `docker/seeds` + `setup` are runtime mounts, not build context.
- **`setup/seed_claims.sql` updated for V14** — demo tokens now also write `token_core` (bare-core form; the ClaimService still accepts bare cores). Without this the seed INSERT violates the new NOT NULL.

### Bug found by compose fresh-DB validation (fixed)
- `CardCatalogSeeder` guarded on `cardRepository.count() > 0`, but `StarterCardSeeder` (`@Order(1)`) seeds its 15 combat creatures first — so on a **fresh** DB the catalog ended up as only those 15 cards: no basics, no spells, no UNIQUE cards; `seed_claims.sql`/`seed_unique_cards.sql` silently inserted nothing and RG Combat decks were missing lands. The dev DB never hit this because it predates `StarterCardSeeder`.
- Fix: `CardCatalogSeeder` now inserts each of its 16 cards individually when `existsByOracleId` is false (order-independent, idempotent). Fresh DB now yields the full 31-card catalog.

## Verification

- Backend: **132 tests / 0 failures / 5 skipped** (gated `TradeConcurrencyTest` + `EventMatchIntegrationTest`), BUILD SUCCESS.
- PWA: `npm run lint` clean; vitest `ProfilePage.test.tsx` + `LeaderboardPage.test.tsx` = **10/10**.
- e2e vs the dev backend (17172): `ecosystem-e2e.cjs` **18/18**, `admin-e2e.cjs` **18/18**, `trade-e2e.cjs` **15/15** (after re-applying `setup/seed_unique_cards.sql`), `battle-e2e.cjs` PASS, `offline-e2e.cjs` PASS.
- Docker: `docker compose config` clean; `campusforge-backend` + `campusforge-web` images built; fresh `docker compose up` seeded a clean DB (31 cards, 2× RG Combat 60-card decks, 6 unique cards, 5 claims with cores, 3 events, 3 players).
- e2e **through the compose stack** (via nginx on `http://localhost:17170`): `ecosystem-e2e.cjs` **18/18**, `battle-e2e.cjs` PASS (real STOMP game over the WS proxy), `trade-e2e.cjs` **15/15**.
- Flyway V14 verified applied; `claims.token_core` + `uk_claims_token_core` present.

## Known limitations / deferred
- Rate limiter is per-instance in-memory (fine for a single backend; needs a shared store if scaled out).
- No HTTPS (TLS termination is a reverse-proxy concern), no Kubernetes manifests.
- "Replay protection" for claim tokens deferred as agreed — a tampered/forged token already returns 400, and UNIQUE claims are one-shot via row lock.
- Backend image packages the host-built jar (not source-reproducible); the forge-headless SNAPSHOT isn't published anywhere.
- `seed` is a one-shot container — `docker compose up` only re-runs it on a fresh container (e.g. `docker compose rm -sf seed`), matching the AGENTS.md rule that admin/event seeds run after the backend starts once.
