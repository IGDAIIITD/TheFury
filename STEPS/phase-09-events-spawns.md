# Phase 9: Events & Spawn Management, Achievements & Feed, Admin Console

## Objective
Implement campus-wide events (set restrictions + bonus XP), physical QR spawn generation tied to events, an achievements system with a real-time discovery feed, and a standalone admin console.

## Scope decisions (approved)
- **Achievements = stored.** New `player_achievements` table; Profile badges read stored achievements. `AchievementCatalog` is the single source of truth. Metrics: `DISCOVERIES`, `BATTLES_WON`, `UNIQUE_TRADES`, `LEVEL`, `COLLECTION_PCT`, `UNDEFEATED`; new achievements `FIRST_TRADE`, `MASTER_TRADER`.
- **Feed = STOMP `/topic/feed`** (in-memory ring buffer, NO feed DB table) + REST `GET /api/v1/feed` history. UI = live feed panel on the new PWA **Events page** (`/collection/events`, sub-link beside Trades in the Collection header).
- **Admin console = separate standalone app** `admin-console/` (Vite + React + TS, dev port **17173**, proxy `/api` → 17172, Deno `serve.mjs` for LAN). Tabs: Events CRUD · Spawns · Players (search/ban/role) · Audit.
- **Event rules = strict + double bonus.** Match creation under an active event rejects non-basic `setCode ∉ allowed_sets` (`NOT_IN_EVENT` problem). Basics (UNLIMITED) exempt. Bonus XP on discovery (10×mult) and match wins (50×mult).

## Implementation

### Database (V12, then V13 cascade)
- **V12** `backend/src/main/resources/db/migration/V12__create_events_and_achievements.sql`:
  - `events` — `id`, `name`, `allowed_sets_json` (text), `bonus_multiplier numeric(5,2) DEFAULT 1.00`, `start_time`/`end_time` (CHECK `end > start`), `active`, `created_at`; window index.
  - `player_achievements` — `UNIQUE(player_id, code)`, FK to players.
  - `ALTER claims ADD event_id + spawned_by` (FKs to events / players) — event-tagged spawns.
  - `ALTER matches ADD event_id` (FK to events) — event battles.
  - `ALTER players ADD banned + banned_at`.
- **V13** `V13__cascade_event_deletes.sql` — converts `fk_claims_event` and `fk_matches_event` to `ON DELETE CASCADE` so deleting an event also removes its spawned claims and event matches (the service delete stays a plain `eventRepository.delete`).

### Backend (`com.campusforge.backend.*`, new packages)
- **`common.events`** — 6 domain-event records: `CardDiscoveredEvent`, `MatchWonEvent`, `TradeAcceptedEvent`, `AchievementUnlockedEvent` (+ nested item), `EventLifecycleEvent`, `SpawnEvent`. Published in-transaction; consumers use `@TransactionalEventListener(fallbackExecution = true)`.
- **`events/`** — `Event`, `EventRepository` (`findActive(now)`, `findAllByOrderByStartTimeDesc`), `EventService` (list/get/require/requireActive/activeEvent/create/update/delete; publishes `EventLifecycleEvent` when an event goes live), `EventException`, `EventController` (`GET /api/v1/events`, `/active`, `/{id}`), `AdminEventController` (`/api/v1/admin/events` CRUD), DTOs (`EventDto.from`, `@Valid CreateEventRequest`/`UpdateEventRequest`).
- **`achievements/`** — `AchievementMetric`, `AchievementDefinition`, `AchievementCatalog` (12 definitions, single source of truth), `PlayerAchievement`, `PlayerAchievementRepository`, `AchievementService` (AFTER_COMMIT listeners on discovery/match-win/trade-accepted; `unlockFor(playerId)` computes metrics exactly once). Ranked defs: `BATTLE_VETERAN` (win your first battle), `UNDEFEATED` (played≥1 && wins==played), `RISING_STAR`/`HALL_OF_FAME` (levels 5/10), `COLLECTOR_I/II/III` (25/50/75%), `COMPLETIONIST` (100%). `PlayerStatsService.myStats` sweeps stored state before `badgesFor`.
- **`feed/`** — `FeedType` (DISCOVERY, ACHIEVEMENT, EVENT, SPAWN, TRADE), `FeedEntryDto`, `FeedService` (ring buffer CAPACITY=50, STOMP `/topic/feed`, 6 AFTER_COMMIT listeners), `FeedController`, `AdminAuditController` (`GET /api/v1/admin/audit` = feed history).
- **Event enforcement** — `DeckValidationService.validate(player, request, Event)` overload (basics exempt; non-basic `setCode ∉ allowed_sets` ⇒ `NOT_IN_EVENT`); `MatchManager.createMatch/createLobbyMatch(..., eventId)` resolve via `EventService.requireActive`, validate, persist. `BattleController` wired.
- **XP bonus** — `CollectionService.discover` applies `10×mult` and publishes `CardDiscoveredEvent`; `MatchManager.rewardWinner` applies `50×mult` and publishes `MatchWonEvent`.
- **Trade event** — `TradeService` publishes `TradeAcceptedEvent`; `TradeRepository.countByStatusAndPlayer` for the `UNIQUE_TRADES` metric.
- **Spawns** — `Claim` event/spawnedBy fields, `MintClaimRequest.eventId`, `ClaimService.mint(request, admin)` resolves event + sets metadata + publishes `SpawnEvent`, `ClaimDto` gains eventId/eventName/spawnedBy, `AdminClaimController` uses `@AuthenticationPrincipal PlayerPrincipal`.
- **Bans & admin players** — `Player.banned/bannedAt`; `AuthService.login` throws `AccountBannedException`; `PlayerUserDetailsService` throws `DisabledException("Account is banned")`; `PlayerPrincipal.isEnabled()`; `JwtAuthenticationFilter` catches `AuthenticationException`; `GlobalExceptionHandler` maps banned/disabled → 403. `admin/` package: `AdminPlayerDto`, `AdminPlayerService`, `AdminPlayerController` (GET q-list, POST ban/unban/role with `{ "role": "…" }`).
- **Security fixes (found in live e2e)** — `SecurityConfig`:
  - Added `"/error"` to `permitAll()`. Previously any `sendError` (e.g. the default `AccessDeniedHandler`'s 403, or a 404 for an unknown path) triggered an `/error` dispatch that re-entered the security chain as anonymous and got rewritten to **401** by the entry point — so a valid ROLE_PLAYER on `/api/v1/admin/**` came back 401 instead of 403, and unknown paths came back 401 instead of 404.
  - Added an explicit `accessDeniedHandler` writing **403** `{"error":"Forbidden"}` directly (authenticated-but-forbidden must be 403, not 401). Unauthenticated requests still get 401 from the entry point.
- **CORS** — origins extended to `http://localhost:17173` and `http://192.168.194.106:17173`.

### Admin console (`admin-console/`, port 17173)
- Vite + React 18 + TS. `vite.config.ts` proxies `/api` → 17172; `serve.mjs` (Deno static + `/api` + `/ws` proxy) for LAN.
- `src/api.ts` — fetch wrapper, `ac_token` localStorage, `setUnauthorizedHandler` on 401.
- `src/App.tsx` — login gate + tab nav (Events · Spawns · Players · Audit); `src/Login.tsx`; `src/tabs/{EventsTab,SpawnsTab,PlayersTab,AuditTab}.tsx`.
- Types in `src/types.ts` (auth, EventDto/CreateEventInput, CardDto, ClaimDto/MintClaimInput, AdminPlayerDto, FeedEntryDto).

### PWA (web-client)
- `src/api/types.ts` — `EventDto`, `FeedEntryDto`, `FeedType`; `src/api/endpoints.ts` — `listEvents`, `getActiveEvents`, `getFeedHistory`.
- `src/pages/EventsPage.tsx` — live event banners (allowed sets + bonus), upcoming/past events, live feed panel (STOMP `/topic/feed` via SockJS, `Authorization` connect header, reconnectDelay 5000, connected/offline indicator, 50-entry dedupe ring), REST history on mount with IndexedDB fallback. Route `/collection/events`, "📅 Events" sub-link in the Collection header, `CACHE_KEYS.feed`.

### Seeds (`setup/`)
- `seed_admin.sql` — `admin@campus.edu` / `password123`, bcrypt hash `$2a$10$WlrEGv8MF/30L/ucaDiRUeiUaemzJb0vfB.aiazTZzweWvpr.6qCK`, `ROLE_ADMIN`, fixed id `11111111-2222-3333-4444-555555555555`, `ON CONFLICT` promotes. Applied to dev DB.
- `seed_events.sql` — Race Week (M19+UNLIMITED ×2, live), Commander Clash (LEA ×3, upcoming), Rookie Rumble (M19 ×1.5, ended). Fixed UUIDs, idempotent. Applied to dev DB.

## Verification

- Backend unit tests: **108 tests, 0 failures, 5 skipped** (3 gated `EventMatchIntegrationTest`, 2 gated `TradeConcurrencyTest`), BUILD SUCCESS.
- Gated live-Postgres **`EventMatchIntegrationTest`**: `mvn test -Dtest=EventMatchIntegrationTest "-Ddb.integration=true"` → **3/3 green** (on-set deck persists event on match; off-set deck rejected; expired event rejected). Cleanup scoped to the test's own entities.
- PWA: `npm run lint` clean; `npm test` → **10 files / 42 tests pass**.
- **`web-client/scripts/admin-e2e.cjs`** → **18/18 pass** (admin login/role gate 403, event create/update/delete + cascade cleanup, live `/events/active`, spawn mint tagged with event, audit entries, player search/ban/unban/promote/demote, banned login 403, player feed). State-agnostic; creates and deletes its own throwaway event. Requires `setup/seed_admin.sql` applied.

## Known limitations
- Event deletion removes its spawned claims and event matches via DB cascade (no soft-delete / archive).
- The feed ring buffer is in-memory (no persistence) — audit is a view of the same ring.
- Admin console has no automated test suite (manual + e2e driver only).
