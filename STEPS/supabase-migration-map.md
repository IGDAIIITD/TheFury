# Supabase Migration Map — Campus Forge

Where every backend package's responsibility lands after the migration.
Decision: **Option A** (recommended default) — `battle/` + Forge headless are
extracted into a standalone `battle-engine/` Java service; everything else moves
into Supabase (Postgres + RLS + Functions + Edge Functions + Realtime + Storage).

Can be reversed to **Option B** (descope battles, keep `backend/` locally) if the
battle-engine deploy is too much for the event timeline — the Supabase half is
identical either way.

## Column key

- **PG** = Postgres table/RLS policy
- **PG fn** = Postgres function (RPC) or trigger
- **EF** = Supabase Edge Function (Deno)
- **BE** = `battle-engine/` standalone Java service
- **Diff** = dropped or replaced by Supabase Auth

| Backend package | Current surface | Lands as |
|---|---|---|
| `accounts/` | `Player`, `AuthController`, `AuthService`, `PlayerController` | **Diff** → `profiles` keyed by `auth.users.id` (PG); onboarding trigger (PG fn); Supabase Auth for login/register |
| `collection/` | `Card` catalog, `PlayerUnlock`, `UniqueCard`, `Discovery`, `Favorite`, `CollectionService` | **PG** (`cards`, `player_unlocks`, `unique_cards`, `discoveries`, `favorites`) + RLS; `discover_card` insert + XP (PG fn); `unique_cards` owned by `owner_id` |
| `deck/` | `Deck`, `DeckCard`, `Format`, `CardLegality`, `DeckValidationService` | **PG** (`decks`, `deck_cards`, `formats`, `card_legalities`); `validate_deck` (PG fn) incl. event `allowed_sets` gate + ownership/copies checks |
| `battle/` | `MatchManager`, `ForgeMatchSession`, `ForgeEngineBootstrap`, `MatchWebSocketController`, `Match` | **BE** (in-memory match state, no DB); `matches` row lifecycle via `record_match_result` (PG fn, service-role) |
| `qr/` | `QrCodeSigner`, `ClaimService`, `QrCatalogExporter` | **EF** (`claim`, `qr-catalog`); `claims` + `token_core` (PG); signing secret as Edge Function secret; per-user+IP token bucket in EF |
| `events/` | `Event`, `EventService`, admin CRUD | **PG** (`events` + `allowed_sets_json`/`bonus_multiplier`, V13 cascade) + RLS needing `ADMIN`; event bonus XP inside `discover_card`/`record_match_result` |
| `trade/` | `TradeService`, `TradeController` | **PG fn** `accept_trade(...)` — `SELECT ... FOR UPDATE` sorted-UUID, ownership re-verify, owner swap, history append; `trades`/`trade_cards` (PG) |
| `achievements/` | `AchievementCatalog`, `AchievementService` | **PG** (`player_achievements`, codes as data); unlock logic in a PG function swept before feed/leaderboard reads |
| `analytics/` | `AnalyticsService`, `LeaderboardService`, `PlayerStatsService` | **PG** views/functions: `leaderboard(...)`, `popular_decks`, `active_buildings`, `profile_stats`; read-only RLS on public columns |
| `feed/` | in-memory ring CAPACITY=50, STOMP `/topic/feed` | **PG** `activity_feed` capped to 50 rows + Supabase Realtime Broadcast; REST history = table read |
| `admin/` | `AdminPlayerController`, `AdminClaimController` | **PG** RLS policies gated on `profiles.role = 'ADMIN'`; EF endpoints for admin-only actions (spawn, catalog regen) |
| `security/` | JWTs, `SecurityConfig`, `RateLimitFilter`, `StompAuthChannelInterceptor` | **Diff** → Supabase Auth JWTs; RLS replaces role checks; rate limiting in EF (token bucket); battle WS auth = Supabase JWT check in BE |
| `config/` | `CardArtConfig`, seeders (`StarterCardSeeder`, `CardCatalogSeeder`, `FormatLegalSeeder`) | **PG** seed migrations (`supabase/seed.sql`, idempotent); card images → **PG/Storage** (Supabase Storage bucket `card-art`) |
| `common/` | `LevelService`, `Cohort`, domain events, `GlobalExceptionHandler` | **PG fn** `compute_level(xp)` single source; cohort validation = one PG function/constraint; domain events → DB triggers/Realtime |
| `notifications/` | (notification support) | deferred — Realtime `notifications` table on `auth.users` broadcast later |

## Table inventory (port order)

1. `profiles` (replaces `players`; `degree_level`, `specialization`, `experience`, `level`, `role`, `banned`, `banned_at`, onboarding flag)
2. `cards` (catalog, idempotent seed in migration)
3. `formats` + `card_legalities` (fixed codes)
4. `cards.commander_eligible`
5. `player_unlocks`, `unique_cards`, `discoveries`
6. `favorites`
7. `decks` + `deck_cards`
8. `claims` + `token_core` (+ `uk_claims_token_core`, `token_type` UNLIMITED/UNIQUE per `claims.status`)
9. `events` + `player_achievements` + `claims.event_id`/`spawned_by`/`matches.event_id` (+ cascade fks)
10. `trades` + `trade_cards`
11. `matches` (row written only by `battle-engine` via service role; keep `battle_code` unique, `win_condition`)
12. `activity_feed` (feed ring, pruned to 50)

## Function inventory

- `public.compute_level(xp int) → int`  (`level = 1 + xp/100`)
- `public.is_cohort_valid(degree_level text, specialization text) → boolean` + `public.department_of(spec)` (per `Cohort.java`)
- `public.handle_new_user()` — trigger on `auth.users` insert → create `profiles`, validate cohort
- `public.discover_card(p_user uuid, p_card uuid, p_event uuid, uniques...)` — unlock/unique/claim + XP + achievements + feed row
- `public.accept_trade(trade uuid)` — sorted-UUID row locks, ownership swap, history append, TTL/410 semantics
- `public.record_match_result(...)` — service-role RPC from battle-engine → match row, XP, unlocks
- `public.leaderboard(filters...)` / `public.popular_decks(...)` / `public.active_buildings(...)` / `public.profile_stats(uuid)`

## Edge Functions (BUILT)

- `claim` (`supabase/functions/claim/index.ts`) — `V1.<CORE>.<SIG>` verify (HMAC-SHA256 constant-time via WebCrypto), unsigned 12-char codes only for admin-spawned claims (migration 13 era), per-user token bucket rate limit (`429`+`Retry-After`, capacity 30 / 2.0 per sec matching `RateLimitFilter`), then calls service-role `apply_claim` RPC (clients can't bypass signature check). Error mapping: errcode `CF400`→400, `CF403`→403, `CF404`→404, `CF409`→409, `CF410`→410.
- `qr-catalog` (`supabase/functions/qr-catalog/index.ts`) — admin-gated, GET json|csv + POST regenerate. Deterministic cores via `_shared/qr.ts` `SHA-256("cf-print:" + cardId)`→12 chars; tokens signed in EF (required secret `QR_SIGNING_SECRET`, no default); JSON export is `[{cardName, qrContent}]`; idempotent claim rows via PG fn `ensure_print_claim`.
- Shared crypto (`supabase/functions/_shared/qr.ts`): `deterministicCore`, `sign`, `verifyToken` — ports of `ClaimService.deterministicCore`/`QrCodeSigner` (incl. 31-char alphabet, big-endian 6-byte long, repeated `% 31`).
- Local serve: `supabase functions serve claim qr-catalog` (needs `supabase start` state); the runtime boots from `supabase/functions/` per-worker; Kong proxies `/functions/v1/<name>`.

## Storage (PENDING)

- Bucket `card-art` (public read) — `{slug}.jpg`; `setup/download-card-art.ps1` pushes via Supabase REST/CLI

## Realtime (PENDING)

- `activity_feed` POSTGRES_CHANGES → `/topic/feed` equivalent (client subscribes via `@supabase/supabase-js` channel)
- Match sync: **NOT Supabase** — BE owns per-seat WS (`wss://<battle-engine>/ws/match/{matchId}`), auth = Supabase access token JWT

## Web client (PENDING)

- `web-client/src/api/supabaseClient.ts` (from `@supabase/supabase-js`) replaces `src/api/*` fetch layer; AuthContext → `supabase.auth`; claim POST → `functions/v1/claim`; storage URL for card art; `REACT_APP_*`/`VITE_SUPABASE_*` env keys