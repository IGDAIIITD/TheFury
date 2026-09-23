# Campus Forge — Technical Summary

Campus Forge is a campus-wide collectible MTG game. A Spring Boot backend owns the entire game economy (identity, collection, ownership, QR claims, trading, events, matches); the headless Forge fork is used purely as a battle rules engine; and a React PWA acts as the client. A separate admin console manages events, spawns, players, and audit.

This document is a structural/technical overview of the codebase. The architecture bible (per-phase plan) lives in `THEPLAN.md`; per-phase implementation plans live in `STEPS/`; day-to-day engineering notes live in `AGENTS.md`.

---

## 1. Top-Level Layout

```
repo root
├── backend/        Spring Boot 3.3 REST + WebSocket service (port 17172)
├── web-client/     Vite + React 18 + TypeScript PWA (port 17170)
├── admin-console/  Standalone Vite + React 18 + TS admin app (port 17173)
├── forge-engine/   Full Forge fork (separate git repo); forge-headless is embedded
├── setup/          Postgres dump + seed SQL + onboarding
├── docker/         Compose deployment (db, backend, web, one-shot seed)
├── qr-catalog/     Auto-generated print catalog (cards.json + cards.csv) written at startup
├── card-art/       Local card images served by the backend (/card-art/{slug}.jpg)
├── STEPS/          Phase execution plans (not code)
├── THEPLAN.md      Architecture bible
└── BOOT-INF/       Leftover exploded jar — ignore
```

Boundaries and responsibilities:

- **Backend** is the single source of truth for identity, collection/ownership, QR, trades, events, persistence.
- **Forge** only executes rules via `forge.headless` — it never touches PostgreSQL and knows nothing about the game economy.
- **Web client** talks to the backend exclusively through `web-client/src/api/*`.
- **Admin console** proxies `/api` to 17172 and stores its token in `localStorage` under `ac_token`.

---

## 2. Runtime Topology

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────────────────┐
│  web-client  │ HTTP │      backend     │ SQL  │       PostgreSQL         │
│  React PWA   │ WS   │   Spring Boot    │      │        campusforge       │
│  (Deno or    │◄────►│     17172        │─────►│  localhost:5432          │
│   Vite)      │      │                  │      │                          │
└──────────────┘      │   ┌───────────┐  │      └──────────────────────────┘
                      │   │ ForgeHead-│  │
                      │   │ less engine│ │
                      │   └───────────┘  │
```

- Matches run **in-process** — `MatchManager` wraps a `ForgeMatchSession` around `forge.headless`. No separate match server process.
- STOMP endpoint `/ws/match` (raw WS + SockJS); auth via `Authorization: Bearer <jwt>` on the STOMP CONNECT frame.
- Card art is proxied locally: frontends ask the backend for `/card-art/{slug}.jpg`, served from `card-art/` at repo root (not the Scryfall API).

---

## 3. Backend (`backend/`)

Spring Boot 3.3, Maven multi-config, target JDK 17 (dev box runs 21). Package root `com.campusforge.backend.*`.

### 3.1 Packages

| Package | Responsibility |
|---|---|
| `accounts/` | Players, auth (login/register), JWTs, player profile endpoints. `AuthController`, `AuthService`, `PlayerController`. |
| `collection/` | Card catalog, ownership (`PlayerUnlock`, `UniqueCard`), favorites, build/collection endpoints. `CollectionService`, `Disclosure` via `Discovery`. |
| `deck/` | Decks + deck cards, format legality, validation (incl. event `allowed_sets` gating), deck builder endpoints. |
| `battle/` | Match lifecycle, Forge engine bootstrap (`ForgeEngineBootstrap`), `ForgeMatchSession`, `MatchManager`, WebSocket controllers, PvP matchmaking. |
| `qr/` | Signed QR claim tokens, claim mint/verify/lookup, print catalog export. `QrCodeSigner`, `ClaimService`, `QrCatalogExporter`. |
| `events/` | Event CRUD (live/upcoming/past), `allowed_sets_json` + `bonus_multiplier`, event-bonus XP, admin events. |
| `trade/` | Multi-card UNIQUE-only trading: `Trade`, `TradeCard`, `TradeService`, `TradeController`. PESSIMISTIC_WRITE locking, sorted-UUID lock order, 24h TTL. |
| `achievements/` | Achievement definitions/catalog (`AchievementCatalog` is source of truth), badge sweep, `player_achievements` table. |
| `analytics/` | Popular decks, active buildings, player stats (`buildingsVisited`, level/xp), leaderboard w/ cohort filters. |
| `feed/` | In-memory feed ring (CAPACITY=50), STOMP `/topic/feed` broadcast + REST history, admin audit. |
| `admin/` | `AdminPlayerController` (query/ban/unban/role), `AdminClaimController` (mint). All under `/api/v1/admin/**` → `hasRole("ADMIN")`. |
| `security/` | `JwtAuthenticationFilter`, `JwtService`, `RateLimitFilter` + `TokenBucket`, `SecurityConfig`, `StompAuthChannelInterceptor`. |
| `config/` | `CardArtConfig` (static `file:../card-art/`), seeders: `StarterCardSeeder` (@Order(1)), `CardCatalogSeeder`, `FormatLegalSeeder`. |
| `common/` | `LevelService` (single source for level/xp), `Cohort` (degree_level/specialization validation, department mapping), domain events, `GlobalExceptionHandler`. |
| `notifications/` | (User/player notification support.) |
| `starter/` | `StarterDeckService` — seeds the 15 combat-creature starter deck. |

### 3.2 Persistence

- PostgreSQL `campusforge` on `localhost:5432`, user `postgres`/`postgres` (in `src/main/resources/application.properties`).
- `ddl-auto=validate` + Flyway migrations **V1–V14** in `src/main/resources/db/migration`. Never hand-edit schema — always add a migration.
- Notable schema pieces:
  - `unique_cards` (UNIQUE collectible cards, `history` audit string).
  - `claims` (QR claims; `token_core` NOT NULL since V14, unique index `uk_claims_token_core`).
  - `trades` + `trade_cards` (V11, bundle trades).
  - `events` (V12, `allowed_sets_json` + `bonus_multiplier`) with V13 `ON DELETE CASCADE` to claims/matches.
  - `player_achievements`, `favorites`, `discoveries`, `player_unlocks`.
- Immutable rule: **Forge never talks to PostgreSQL**; the backend owns all state.

### 3.3 Auth & Security Semantics

- JWT Bearer tokens; endpoints live under `/api/v1`.
- **Missing/invalid credentials → 401** (entry point). **Validly-authenticated user on a forbidden path → 403** (explicit `accessDeniedHandler`).
- `"/error"` is `permitAll()` so `sendError`-based responses aren’t rewritten to 401 when `/error` re-enters the chain.
- Login/register responses are `Cache-Control: no-store`; CORS allows only `Authorization, Content-Type, Accept, X-Requested-With`.
- Rate limiting via in-memory token buckets (no deps): `POST /auth/login|register` per-IP burst 30; `POST /claim` per-user+IP. Returns `429` + `Retry-After` + JSON body.
- Secrets via env: `jwt.secret`, `jwt.expiration`, `campusforge.qr.signing-secret` (dev defaults embedded).
- Cohorts (`common/Cohort.java`): B.Tech specs — CSE/CSAI/CSAM/CSB/CSSS/CSD/CSECON/ECE/EVE; M.Tech — CSE/ECE. `departmentOf()` maps CSE dept (CSE/CSAI/CSAM/CSB/CSSS/CSD/CSECON) vs ECE dept (ECE/EVE). `RegisterRequest` requires both fields; `GET /api/v1/leaderboard` accepts `degreeLevel`/`specialization`/`department` filters.

### 3.4 QR Claims

- Minted tokens are **signed**: `V1.<CORE>.<SIG>` — HMAC-SHA256 via `qr/QrCodeSigner`, constant-time compare. CORE = 12 base32-ish chars.
- `ClaimService.claim` verifies the signature; forged/tampered tokens → **400 before any DB lookup**. Legacy bare cores still resolve via `claims.token_core`.
- UNLIMITED claims are reusable; UNIQUE claims are one-shot (row lock).
- `QrCatalogExporter` (`@ApplicationRunner`) auto-writes `qr-catalog/cards.json` + `cards.csv` at startup using deterministic cores (`SHA-256("cf-print:" + cardId)` → 12 chars), so re-runs reproduce identical codes and new cards auto-appear. Idempotent claim creation for cards without a claim.
- Admin endpoints: `GET /api/v1/admin/qr-catalog?format=json|csv` (live, no file I/O) and `POST .../qr-catalog/regenerate`.

### 3.5 Events & Bonus XP

- `events/events` table with `allowed_sets_json` + `bonus_multiplier`.
- Active events gate matches via `DeckValidationService.validate(player, request, Event)` — non-basic `setCode ∉ allowed_sets` → `NOT_IN_EVENT`; UNLIMITED basics are exempt.
- Bonus XP: discovery `10 × mult`, match win `50 × mult` (recomputed through `CollectionService.discover` / `MatchManager.rewardWinner`, both routed through `LevelService` — the formula `level = 1 + xp/100` is never inlined elsewhere).
- Deleting an event cascades to its claims/matches (V13).

### 3.6 Trading

- Bundles of **UNIQUE cards only**. Accept is `@Transactional`: locks the trade row (`findByIdForUpdate` PESSIMISTIC_WRITE), locks all cards in **sorted-UUID order** (`findAllByIdForUpdate`) to avoid deadlocks, re-verifies ownership, swaps owners, appends `"<ts>: <from> → <to> via trade <id>"` to `unique_cards.history`.
- 24h TTL; read paths lazily persist EXPIRED; accept/decline/cancel on expired → `410`.
- Roles: receiver accepts/declines; sender cancels.

---

## 4. Forge Engine Integration (`forge-engine/`)

- Full Forge fork (its own separate git repo; root repo has zero commits).
- `forge-headless` module is the engine embedded by the backend; it depends on `forge-ai` (so `ComputerUtilMana` is available for affordability checks).
- Card data lives in `forge-engine/forge-gui/res`.
- The backend resolves card data relative to its working directory (`forge-gui/res` → `../forge-gui/res` → `../forge-engine/forge-gui/res`); run the jar from `backend/` or set `-Dforge.res.dir`.
- **Build order matters:** build `forge-headless` first (`mvn -pl forge-headless -am install -DskipTests` from `forge-engine/`), then the backend (resolves `forge:forge-headless:2.0.14-SNAPSHOT` from the local Maven repo).

### 4.1 How battle labels work

- Option labels are produced by `HumanPlayerController.saLabel()` in the format `{CardName} - {ManaCost} {RulesText}` (e.g. `Giant Growth - G Target creature gets +3/+3 until end of turn.`). The card **type line is not included** in the label.
- The card type is however serialized separately per card by `GameStateSerializer` (`entry.type`), so the frontend can determine instant-speed vs sorcery from card data, not label text.

### 4.2 Mana affordability (engine TODO)

- `CostPartMana.canPay()` always returns `true`.
- Playability filtering happens in `HumanPlayerController.getPlayableSAs()` using `ComputerUtilMana.canPayManaCost()`.

---

## 5. Web Client (`web-client/`)

Vite + React 18 + TypeScript PWA on port 17170. Vite dev server proxies `/api`, `/card-art`, and `/ws` to 17172.

### 5.1 Frontend layering

```
src/
├── api/         the ONLY layer that talks to the backend (client.ts, axios/wrapper, endpoints, types)
│                + feature endpoint modules: battleEndpoints.ts, qrEndpoints.ts, tradeEndpoints.ts
├── auth/        AuthContext.tsx (JWT, player object, onboarding flag)
├── components/  Layout.tsx (nav tab bar), BattleCard.tsx, OnboardingModal.tsx, colors.ts
├── lib/         idb.ts (IndexedDB cache), scryfall.tsx (CardArt component, local art URLs)
├── pages/       feature pages (Login, Collection, DeckBuilder, Battle, Trades, Events, Leaderboard, Profile, Scan)
└── types/       shared frontend types
```

Client state:

- Auth token → `localStorage` `cf_token`; player object → `cf_player`; onboarding flag → `cf_onboard_seen`.
- Offline cache → `src/lib/idb.ts` (`cacheGet`/`cacheSet`, keys in `CACHE_KEYS`; leaderboard keys are per-metric plus per-cohort-filter scope). No-ops to `null` when IndexedDB is absent, so jsdom tests need no IDB mocks.

### 5.2 PWA / Offline

- `vite-plugin-pwa` (generateSW). Build emits `dist/manifest.webmanifest`, `dist/sw.js`, `dist/workbox-*.js`.
- SW registered in `src/main.tsx`; manifest in `vite.config.ts`; icons in `public/icons/`.
- Offline e2e relies on the workbox `navigateFallback` (deep SPA reloads offline) — keep it.
- `serve.mjs` (Deno static server) serves `dist/` and proxies `/api`, `/card-art`, `/ws` to the backend. It reads `dist/` per request (rebuild auto-picks-up) and strips the browser `Origin` header (Spring CORS only allows specific origins).

### 5.3 Card art

- `src/lib/scryfall.tsx` → `scryfallArtUrl(name)` returns `/card-art/{slug}.jpg` (local backend, not Scryfall).
- Images in `card-art/` at repo root, served by Spring `CardArtConfig` (`file:../card-art/`), permitted in `SecurityConfig` for `/card-art/**`.
- `setup/download-card-art.ps1` fetches images idempotently.

### 5.4 Battle UI details

- Board uses per-seat STOMP topics (`/topic/match/{matchId}/p0|p1`); choices posted to `/app/match/{matchId}/action` with `{ actionType: 'CHOICE', payload: { requestId, selectedIndices } }`.
- `src/pages/battleUi.ts` is the pure logic layer (`matchOptionsToCards`, `interactiveZones`, `instructionFor`, `friendlyPhase`, `phaseStrip`, `isInCombatPhase`, mana helpers), tested in `battleUi.test.ts`.
- `BattlePage.tsx` renders the board: vertical HP bars, per-color mana bars, phase strip, instruction banner, tap-to-select hand/battlefield, action bar with Pass Priority, attack confirm, concede.
- **Action bar confirm row:** the Attack/Block/Confirm button only appears when ≥1 card is selected (`selected.size > 0`); with 0 selections only the hint "Tap cards to select them." is shown.
- **Instant-speed filtering:** `matchOptionsToCards` and the ActionBar’s text-option filter both look up the card’s serialized `type` from the hand/battlefield pools. Cards whose `type` is `Instant` are demoted outside `COMBAT_*` phases (not tappable, hidden from text buttons), and the auto-skip effect passes automatically when the only remaining plays are mana abilities + filtered instants. Flash creatures and sorceries stay castable.

---

## 6. Admin Console (`admin-console/`)

Standalone Vite + React 18 + TS app (port 17173) proxying `/api` to 17172. Tabs: **Events CRUD · Spawns · Players (search/ban/role) · Audit**. Token in `localStorage` under `ac_token`. Same security contract as the main client (player → 403 on `/admin/**`).

---

## 7. Deployment (Docker)

- Compose project `campusforge`; `docker-compose.yml` at repo root.
- Stack: `db` (postgres:17-alpine, named volume `pgdata`) → `backend` (tcp healthcheck on 17172; env `JWT_SECRET`/`QR_SIGNING_SECRET`/`SPRING_DATASOURCE_URL`) → `web` (nginx, 17170→80, proxies `/api`, `/card-art`, `/ws` to `backend:17172`, strips `Origin`) → one-shot `seed` container (waits on backend TCP, then `psql` seeds demo accounts + `setup/seed_*.sql`).
- Backend image packages the **host-built jar** (`backend/target/campusforge-backend-*.jar` + `forge-engine/forge-gui/res`) — rebuild the jar on the host first, then `docker compose build backend`.
- Fresh-DB seeding order matters: `StarterCardSeeder` (@Order(1)) seeds 15 combat creatures, then `CardCatalogSeeder` inserts 80 cards individually (`existsByOracleId`) so the full 95-card catalog + UNIQUE cards always land regardless of prior state (idempotent).
- Demo accounts are **not** auto-created by the backend; `docker/seeds/seed_demo_accounts.sql` creates `testbattle` / `opponent` at fixed UUIDs referenced by `seed_rg_combat_decks.sql`.
- `seed` only runs on container creation — `docker compose rm -sf seed` or `down -v` before `up` to re-seed.

---

## 8. Dev Environment & Verification

- Windows/PowerShell dev box. **Node and Maven are not on PATH** — prepend the portable installs:
  - Maven: `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin`
  - Node: `C:\Users\student\AppData\Local\Temp\opencode\node-v20.18.0-win-x64`
- Backend build: `mvn clean package -DskipTests` from `backend/` (jar file-locks itself — stop java first via `restart-backend.ps1`).
- Full rebuild + restart (kills java+deno, builds forge→backend→frontend, starts both, health-checks): `powershell -ExecutionPolicy Bypass -File restart-all.ps1`.
- Frontend checks: `npm run lint` (`tsc --noEmit`), `npm test` (`vitest run`), `npm run build` (`tsc -b && vite build`). Edit frontend → run all three; rebuild `dist/` whenever serving via `serve.mjs` or e2e (they read `dist/`).
- Backend tests: `mvn test`; single suite via `-Dtest=…` (deck, collection, qr, analytics, security, common, cohort, trade). Live Postgres concurrency proof: `mvn test -Dtest=TradeConcurrencyTest -Ddb.integration=true`.
- E2E drivers in `web-client/scripts/`:
  - `battle-e2e.cjs` (backend + seeded DB + `RG Combat` decks)
  - `battle-ui-smoke.cjs` (headless Chrome against the Deno proxy; needs `dist/` rebuilt, `serve.mjs` running, Deno up)
  - `offline-e2e.cjs` (playwright-core + system Chrome, CDP offline emulation)
  - `trade-e2e.cjs`, `admin-e2e.cjs`, `ecosystem-e2e.cjs` (run last — drains the per-IP auth bucket)

---

## 9. Key Architectural Rules (recap)

1. Backend owns everything; Forge touches nothing outside the rules engine.
2. Level/xp formula lives in exactly one place: `common/LevelService`.
3. Cohorts are validated centrally via `common/Cohort.java`.
4. DB schema changes are always Flyway migrations — never hand-edited.
5. QR codes are signed; forged tokens rejected before any DB work.
6. Card-art is proxied locally; no external art API at runtime.
7. Trades lock rows in sorted-UUID order to avoid deadlock.
8. The web client only talks to the backend through `src/api/*`.