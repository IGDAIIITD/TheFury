# Phase 10 — Polish, Security Hardening & Deployment — Work State

Updated: 2026-08-12

## Objective

Build Phase 10 end-to-end: auth + QR claim hardening (rate limiting, signed claim tokens, auth header hygiene), player-facing analytics, and a Docker Compose deployment for the whole stack. HTTPS and Kubernetes were dropped (deferred).

## Scope decisions (approved)

1. **Auth stays Bearer-header based** on REST and STOMP (no cookies); login/register get `Cache-Control: no-store`; CORS `allowedHeaders` tightened to `Authorization, Content-Type, Accept, X-Requested-With`.
2. **Rate limiter = custom in-memory** (`security/`, no deps): per-IP burst 30 on `POST /auth/login|register`, per-user+IP on `POST /claim`; `429` + `Retry-After` + JSON body.
3. **Signed QR tokens**: minted claims are `V1.<CORE>.<SIG>` (HMAC-SHA256, constant-time compare). Bare cores still resolve defensively via `claims.token_core`.
4. **Analytics player-facing**: `GET /api/v1/analytics/decks|buildings` + `buildingsVisited` on profile stats + PWA Campus Pulse UI.
5. **Deployment = Docker Compose only**: backend image packages the **host-built jar** (forge-headless SNAPSHOT exists only in the local Maven repo); fresh DB bootstrapped by Flyway + backend's idempotent seeders; one-shot `seed` container applies demo seeds. Healthchecks are TCP (no actuator).

## Work state

### Completed

#### A1 — Secrets externalized (`application.properties`)
- `jwt.secret=${JWT_SECRET:…}`, `jwt.expiration=${JWT_EXPIRATION_MS:86400000}`, `campusforge.qr.signing-secret=${QR_SIGNING_SECRET:…}`. Compose overrides via env.

#### A2 — Rate limiting (`security/`)
- `TokenBucket` (bounded `ConcurrentHashMap`, token-bucket, `tryConsume()`), `RateLimitFilter` (auth per-IP burst 30, claim per-user+IP; `429` + `Retry-After: <sec>` + `{"error":"Rate limited"}`), wired `addFilterAfter(rateLimitFilter, JwtAuthenticationFilter.class)`.
- Tests: `TokenBucketTest` + `RateLimitFilterTest` (incl. `Retry-After` header).

#### A3 — Signed QR claim tokens (`qr/`, migration V14)
- `QrCodeSigner` — `HmacSHA256` + `HexFormat`, constant-time `MessageDigest.isEqual`, version `V1`, core = 12 uppercase base32-ish chars, SIG = 64 hex. `sign(core)` / `verify(token)`.
- **V14** `V14__signed_claim_tokens.sql` — `claims.token_core varchar(64)` NOT NULL + `uk_claims_token_core` (backfilled from `token`), `token` widened to `varchar(128)`.
- `Claim.tokenCore`; repository queries → `findByTokenCore`/`findByTokenCoreForUpdate`/`existsByTokenCore`.
- `ClaimService.claim` verifies the signature first — forged/tampered → **400 before any DB lookup**; legacy bare cores resolve via `token_core`. Mint signs cores. UNLIMITED reusable / UNIQUE one-shot unchanged.
- Tests: `QrCodeSignerTest` (8), `ClaimServiceTest` updated (14).

#### A4 — Auth hardening
- `AuthController` login/register → `CacheControl.noStore()`. `SecurityConfig` CORS `allowedHeaders` tightened + `exposedHeaders: Retry-After`.

#### C1 — Analytics (`analytics/`)
- `AnalyticsService` (popular decks via matches×decks join; active buildings via claims grouped by building, attributed by `claimed_by`/`claimed_at`; limit clamped 1–100), `AnalyticsController` (`GET /api/v1/analytics/decks`, `/buildings`), `PopularDeckDto`, `BuildingActivityDto`.
- `PlayerStatsService.myStats` adds `buildingsVisited` (distinct/trimmed/sorted). UNLOCK claim sets `claimedBy`/`claimedAt` + saves so activity attributes to the player.
- Tests: `AnalyticsServiceTest` (3), `PlayerStatsServiceTest` extended.

#### C2 — Analytics UI (web-client)
- `src/api/types.ts` / `endpoints.ts`: `PopularDeckDto`, `BuildingActivityDto`, `ProfileStatsDto.buildingsVisited`, `getPopularDecks`, `getActiveBuildings`.
- `src/lib/idb.ts`: `CACHE_KEYS.campusPulse`. `LeaderboardPage` Campus Pulse panel (most-played decks + active buildings, offline cache); `ProfilePage` "Buildings visited" chips.
- Tests: `ProfilePage.test.tsx` + `LeaderboardPage.test.tsx` → **10/10**.

#### C3 — Ecosystem e2e (`web-client/scripts/ecosystem-e2e.cjs`) → **18/18**
- Anon analytics 401, player on `/admin/**` 403, garbage token 401, login no-store; mint→claim→echo of `V1.<CORE>.<SIG>`, tampered/forged → 400, bare core resolves to same claim 200, unknown bare core → 404; analytics arrays + `buildingsVisited`; auth burst → 429 + `Retry-After`. **Run last** (drains per-IP auth bucket). Env: `BASE`.

#### B1–B4 — Docker Compose deployment (validated)
- `docker/backend/Dockerfile` — `eclipse-temurin:17-jre`, copies host-built jar + `forge-engine/forge-gui/res` → `/app/forge-res`, `-Dforge.res.dir=/app/forge-res`, `EXPOSE 17172`.
- `docker/web/Dockerfile` — node:20 `npm ci` + `npm run build` → `nginx:1.27-alpine`; `docker/web/nginx.conf` — SPA fallback, `/api`+`/ws` proxy to `backend:17172`, strips `Origin`.
- `docker-compose.yml` (project `campusforge`) — `db` (postgres:17-alpine, volume `pgdata`, `pg_isready`), `backend` (env secrets, TCP healthcheck, 17172), `web` (17170→80), one-shot `seed` (postgres container; `nc -z -w 2 backend 17172` wait, then psql `docker/seeds/seed_demo_accounts.sql` + `setup/seed_*.sql`).
- `docker/seeds/seed_demo_accounts.sql` — `testbattle`/`opponent` with the fixed UUIDs (`ac3cc775-…`, `4d4fb548-…`) referenced by `seed_rg_combat_decks.sql` / `seed_cohorts.sql`.
- Root `.dockerignore` (keeps `docker/`, excludes `docker/seeds` + `setup` from context); `setup/seed_claims.sql` updated to insert `token_core` (V14 NOT NULL).

#### Bug found by fresh-DB compose validation (fixed)
- `CardCatalogSeeder` skipped everything when `count() > 0`, but `StarterCardSeeder` (`@Order(1)`) seeds 15 creatures first → fresh DB had only 15 cards, no basics/spells/uniques; RG decks + claims silently empty. Fixed: per-card `existsByOracleId(card.getOracleId())` guard (order-independent, idempotent). Fresh DB now yields the full 31-card catalog.

### Verification — ALL GREEN
- Backend full suite: **132 tests / 0 failures / 5 skipped**, BUILD SUCCESS.
- PWA: `npm run lint` clean; vitest 10/10 (Profile + Leaderboard suites).
- Dev backend e2e: ecosystem **18/18**, admin **18/18**, trade **15/15** (after re-applying `setup/seed_unique_cards.sql`), battle PASS, offline PASS.
- Compose: `docker compose config` clean; both images built; fresh `up` seeded a clean DB (31 cards, 2× RG Combat, 6 unique cards, 5 claims with cores, 3 events, 3 players).
- **Through nginx (`http://localhost:17170`)**: ecosystem **18/18**, battle PASS (real STOMP game over WS proxy), trade **15/15**.
- Dev backend restored afterwards (17172 up, login 200, `Cache-Control: no-store`).

### Blocked
- (none)

## Environment quirks (reminder)
- Maven not on PATH → `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd` (prepend to `$env:Path`). Run from `backend/`.
- Node not on PATH → `C:\Users\student\AppData\Local\Temp\opencode\node-v20.18.0-win-x64` (prepend to `$env:Path`).
- **Docker**: launch `Docker Desktop.exe` first (engine runs under WSL — user installed WSL to unblock this); binary `C:\Users\student\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`. Verify with `docker info`.
- Kill all java before backend rebuild (`restart-backend.ps1`); `start-backend.cmd` lives at the **repo root**.
- Ports: backend 17172, web-client 17170, admin-console 17173, compose web→17170 + backend→17172.
- Compose backend image needs the jar rebuilt on the host first: stop backend → `mvn clean package -DskipTests` → `docker compose build backend`.

## Future work / next moves (in order)

1. **Docs done** — `STEPS/phase-10-polish-offline.md` written; `AGENTS.md` updated (docker layout, V14 migrations note, `seed_claims` token_core, QR signed-token semantics, rate limiting, analytics endpoints, ecosystem-e2e, Docker deployment section, `CardCatalogSeeder` fresh-DB ordering); `state.md` refreshed.
2. **Optional follow-ups** — HTTPS/TLS termination (reverse-proxy concern), Kubernetes manifests, distributed rate limiting (shared store) if the backend ever scales out, "replay protection" for claim tokens, admin-console vitest suite.
3. If the dev DB is ever restored from `campusforge_dump.sql`, re-apply `seed_admin.sql`, `seed_events.sql`, `seed_cohorts.sql`, `seed_unique_cards.sql` after the backend has started once. For compose: `docker compose rm -sf seed` (or `down -v`) before `up` to re-seed.

## Key files (Phase 10)
- `backend/src/main/java/com/campusforge/backend/{security,qr,analytics}/` — `TokenBucket`, `RateLimitFilter`, `QrCodeSigner`, `AnalyticsService/Controller`, `PopularDeckDto`, `BuildingActivityDto`; updated `ClaimService`, `ClaimRepository`, `PlayerStatsService`, `AuthController`, `SecurityConfig`, `application.properties`.
- `backend/src/main/resources/db/migration/V14__signed_claim_tokens.sql`.
- `backend/src/main/java/com/campusforge/backend/config/CardCatalogSeeder.java` — per-oracleId idempotent seeding (fresh-DB fix).
- `backend/src/test/java/com/campusforge/backend/{security,qr}/` — new suites.
- `web-client/src/pages/{LeaderboardPage,ProfilePage}.tsx`, `src/api/{types,endpoints}.ts`, `src/lib/idb.ts` (`campusPulse`), `src/pages/{LeaderboardPage,ProfilePage}.test.tsx`.
- `web-client/scripts/ecosystem-e2e.cjs` — Phase 10 driver (18/18 pass).
- `docker-compose.yml`, `docker/backend/Dockerfile`, `docker/web/{Dockerfile,nginx.conf}`, `docker/seeds/{run-seeds.sh,seed_demo_accounts.sql}`, `.dockerignore`.
- `setup/seed_claims.sql` — now inserts `token_core`.
- `STEPS/phase-10-polish-offline.md` — plan/verification record.
