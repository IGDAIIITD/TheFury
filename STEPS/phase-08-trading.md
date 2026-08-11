# Phase 8: Trading System & Unique Ownership

## Objective
Implement unique card trading, atomic database transactions, trade offers, and ownership history logging. User-scoped to **multi-card trade bundles** (not 1:1), all cards UNIQUE only.

## Scope decisions (baked-in, no WS/admin/XP)
- Trades are **bundles**: offered × requested sets of unique cards, `@NotEmpty` both sides, no overlap.
- No XP/rewards for trading; no WebSocket push (poll incoming ~15s from the PWA); no admin trade-review UI.
- Decks referencing a traded-away unique fail validation until edited (no auto-cleanup).
- Ownership history appended to the existing `unique_cards.history` text column — no new history table.

## Implementation

### Database (V11, snake_case, FK to `unique_cards.physical_uuid`)
- `trades` — `id`, `sender_id`, `receiver_id`, `status` (PENDING/ACCEPTED/DECLINED/CANCELLED/EXPIRED), `created_at`, `resolved_at`, `expires_at` (24h TTL).
- `trade_cards` — `id`, `trade_id` (FK, `ON DELETE CASCADE`), `side` (OFFERED/REQUESTED), `physical_uuid` (FK → `unique_cards`), `UNIQUE(trade_id, side, physical_uuid)`.
- Indexes: `(sender_id, status)`, `(receiver_id, status)`, `(trade_id)`, `(physical_uuid)`.

### Backend (`com.campusforge.backend.trade.*`, new package)
- Entities: `Trade`, `TradeCard`, enums `TradeStatus`, `TradeSide`; DTOs `CreateTradeRequest`, `TradeDto`, `TradeCardDto`.
- `TradeRepository` — `findByIdForUpdate` (`@Lock(PESSIMISTIC_WRITE)`), `findBySenderIdAndStatus`, `findByReceiverIdAndStatus`, `findByStatus`.
- `UniqueCardRepository` — added `findByIdForUpdate` and `findAllByIdForUpdate(...)` which locks cards **in `ORDER BY physical_uuid`** (consistent lock order → no deadlock).
- `TradeService`:
  - `create` — validates receiver exists, bundles non-empty/deduplicated/no overlap, sender owns offered, receiver owns requested.
  - `accept` — `@Transactional`; locks the trade row then all involved cards in sorted-UUID order; re-verifies ownership (conflict → 409 "Ownership changed"); swaps owners; appends `"<ts>: <from> → <to> via trade <id>"` to `history`; sets ACCEPTED.
  - `decline` (receiver) / `cancel` (sender) — role-checked (403 otherwise); only on PENDING (409 otherwise).
  - Expiry — trades TTL 24h; read paths lazily persist EXPIRED; accept/decline/cancel on an expired trade → 410.
- `TradeController` — `POST /api/v1/trades`, `GET /trades/incoming`, `GET /trades/outgoing`, `GET /trades/{id}`, `POST /trades/{id}/accept|decline|cancel`; `@ExceptionHandler(TradeException)` → status/message.
- `CollectionController` — added `GET /api/v1/collection/unique` (my uniques → `UniqueCardDto`).
- `PlayerController` (new) — `GET /api/v1/players/search?q=` (name/email, returns `PlayerSummaryDto`, excludes full collections) and `GET /api/v1/players/{id}/unique-cards` (partner's uniques to build the requested bundle).

### Concurrency proof
- `TradeServiceTest` (Mockito, strict) — 20 unit tests: create validation, accept/decline/cancel role rules, conflict/expired handling, ownership re-check, history append, lazy expiry.
- `TradeConcurrencyTest` — **gated** `@SpringBootTest` on the dev Postgres DB; skipped unless run with `-Ddb.integration=true`:
  - `concurrentAcceptsTransferOwnershipExactlyOnce` — 8 threads race `accept` on one trade → exactly 1 ACCEPTED + 7 CONFLICT, ownership swapped once, history appended once.
  - `concurrentOffersOfSameCardFailOnOwnershipRecheck` — two parallel create+accept of the same card → exactly one completes, card never duplicated/lost.
  - Creates its own throwaway card/players; cleans up in tearDown (trades → unique_cards → players → card).

### Seeding
- `setup/seed_unique_cards.sql` — gives `testbattle@campus.edu` and `opponent@campus.edu` the three catalog UNIQUE cards (Black Lotus, Ancestral Recall, Mox Sapphire; serials 9001-9003 / 9101-9103) with deterministic physical uuids (idempotent). Run after the backend has started once (catalog exists).

### PWA (`/collection/trades`, sub-route of Collection)
- `src/api/tradeEndpoints.ts` — `createTrade`, `getIncomingTrades`, `getOutgoingTrades`, `getTrade`, `acceptTrade`, `declineTrade`, `cancelTrade`, `getMyUniqueCards`, `getPlayerUniqueCards`, `searchPlayers`; `TradeApiError` carries HTTP status/message.
- `src/api/types.ts` — `TradeDto`, `TradeCardDto`, `TradePlayerDto`, `TradeStatus`, `TradeSide`, `UniqueCardDto`, `PlayerSummaryDto`, `CreateTradeRequest`.
- `src/pages/TradePage.tsx` — incoming (Accept/Decline) + outgoing (Cancel) lists, 15s polling, and a composer: search partner → view their uniques → pick your offered bundle and their requested bundle → "Offer N for M". Self filtered out of search results.
- `App.tsx` route `/collection/trades`; `CollectionPage.tsx` header gains an "↔ Trades" link (nav tab bar stays at 6).

### E2E
- `web-client/scripts/trade-e2e.cjs` (state-agnostic; `BASE` env, default `http://localhost:17172`): login both users → create → B sees incoming → accept → ownership + history verified → decline path → **double-offer race** (two PENDING trades for the same card, concurrent accepts → exactly one ACCEPTED + one 409, history appended exactly once). 15 checks.

## Verification (all green)
- `mvn test` — 78 tests, 0 failures (TradeConcurrencyTest shows as 2 skipped without `-Ddb.integration=true`).
- `mvn test -Dtest=TradeConcurrencyTest -Ddb.integration=true` — 2/2 pass on live Postgres (Flyway V11 applied).
- `web-client` — `npm run lint` (tsc) clean; `npm test` 39/39; `npm run build` emits SW + `manifest.webmanifest` (PWA intact).
- `node scripts/trade-e2e.cjs` — 15/15 PASS against the running backend.
- Live curl spot-checks: create 201 → incoming PENDING → accept 200 → swap + history; double-accept 409; unowned offer 400; decline 200; search + `/players/{id}/unique-cards` OK.
