# Database (Supabase Postgres)

The schema lives in `supabase/migrations/*.sql`, which is the only source of truth. Never change the schema in
the dashboard. The hosted project is `prjsiywvhxqnsvsmfgxm`.

## Security model in one paragraph

Every table has **row-level security (RLS)** enabled. Players can **read** their own rows (plus public data like
the catalog), and can **write** only presentation data: their profile fields, decks and favorites. Everything
that changes game state (unlocks, XP, trades, matches, achievements, history) goes through `SECURITY DEFINER`
functions that enforce the rules and take the acting player from `auth.uid()`, never from a parameter.
**Function execution is deny-by-default**: only an explicit allow-list is callable by signed-in players, and the
rest is callable only by the service role (Edge Functions, battle engine). See [security.md](security.md).

## Tables

| Table | Purpose | Players can | Written by |
| --- | --- | --- | --- |
| `profiles` | 1:1 with `auth.users`: display name, email, cohort, role, XP, level, ban | read & update **own** presentation fields* | signup trigger, game functions, admins |
| `cards` | card catalog (name, rarity, ownership type, `requires_unlock`, set, colors, types, …): `seed.sql` + `seed_sets/*.sql` | read (anyone) | admins / seed files |
| `formats`, `card_legalities` | STANDARD / COMMANDER rules; per-card legality | read (anyone) | admins / seed |
| `player_unlocks` | copies of UNLOCK cards a player owns (one row per copy, at most 4 per card) and unlocked scan-once UNLIMITED cards (one row = unlimited). `claim_id` = the code that granted it (unique per player × code) | read own | `apply_claim` |
| `unique_cards` | serialized UNIQUE copies (`serial_number`, `history`, owner) | read own (+ cards in their pending trades) | `apply_claim`, `accept_trade`, admins |
| `discoveries` | scan counts per player × card | read own | `apply_claim` |
| `favorites` | favorited cards | read/insert/delete own | player |
| `decks`, `deck_cards` | decks and their cards (qty 1–250) | full CRUD on own | player (validated by `validate_deck_spec` in the app) |
| `matches` | battle rows: players, decks, status, winner, code, event | read matches they played | battle engine (service role), admins |
| `trades`, `trade_cards` | trade offers and their cards | read trades they're part of | trade RPCs |
| `claims` | QR tokens: core, signed token, card, building, expiry, status, event, spawned_by | read claims they claimed | Edge Functions (service role), admins |
| `events` | time window, bonus multiplier, allowed sets | read (anyone) | admins |
| `player_achievements` | unlocked achievement codes | read own | `sweep_achievements` |
| `activity_feed` | last 50 public activity lines (UI ticker) | read (signed in) | game functions |
| `game_log` | **durable, append-only history**: CLAIM, TRADE, MATCH, STARTER, SPAWN rows with XP and JSON detail | read own | game functions, `admin-spawn` |
| `app_config` | public key/value runtime settings (`battle_engine_url`) | read (anyone) | service role, admins |

\* `profiles`: players may change `display_name` (1–40 chars), `avatar`, `student_id`, `degree_level` +
`specialization` (must be a valid cohort), `onboarding_seen` and `last_login`. The `trg_profiles_guard` trigger
rejects changes to `role`, `experience`, `banned`, `banned_at`, `email`, `id` or `created` unless the caller is
an admin or a trusted server path. `level` is always recomputed from XP.

Admins (`profiles.role = 'ADMIN'`, checked by `is_admin()`) can read everything, and can write the catalog,
events, claims, matches, unique cards and profiles.

## Functions

### Callable by signed-in players (`authenticated`)

| Function | What it does |
| --- | --- |
| `create_trade(receiver, offered[], requested[])` | validate bundles + ownership, create a PENDING trade |
| `accept_trade(trade)` | receiver accepts: locks rows in sorted-UUID order, re-checks ownership, swaps owners, appends history, logs |
| `resolve_trade(trade, 'DECLINED' \| 'CANCELLED')` | receiver declines / sender cancels |
| `list_my_trades(direction)` | `INCOMING` / `OUTGOING` (also expires stale offers) / `ALL`, as full trade JSON |
| `player_unique_cards(player)` | a player's unique cards (to browse a trade partner) |
| `search_players(query)` | find players by name or email (never returns email) |
| `validate_deck_spec(format, commander, cards)` | deck-builder validation → `{ valid, problems[] }` |
| `my_profile_stats()` | own profile stats + badges (sweeps achievements first) |
| `leaderboard_full(metric, degree, spec, dept, limit)` | ranked rows + your rank |
| `popular_decks(limit)`, `active_buildings(limit)` | global analytics |
| `achievement_catalog()` | the 12 achievements |

`is_admin()`, `compute_level()`, `is_cohort_valid()` and `department_of()` are also callable by everyone, because
RLS policies and check constraints use them.

### Service role only

| Function | Caller | What it does |
| --- | --- | --- |
| `apply_claim(core, player)` | `claim` Edge Function | the whole scan: status/expiry/ban checks, discovery, unlock or serial, XP × bonus, feed, `game_log` |
| `ensure_print_claim(card, core, token)` | `qr-catalog` Edge Function | idempotently create the printed claim row for a card |
| `record_match_result(match, winner, condition)` | battle engine | finish a match (idempotent), XP × bonus, feed, `game_log` rows |
| `validate_deck(deck, event)` | battle engine | match-time deck check (ownership, copies, bans, size, event sets) |
| `grant_starter_pack(player)` | signup trigger | build the starter deck once |
| `owned_copies(player, card)` | internal | **the ownership rule**, used by `apply_claim` and both deck validators: UNLIMITED → unlimited if free or unlocked (else 0); UNLOCK → copies (rows); UNIQUE → serials owned |
| `add_feed_entry(...)`, `sweep_achievements(player)`, `card_print_core(card)`, `unique_physical_uuid(core)`, `assert_active_player(player)` | internal | helpers |

Errors raised by game functions use SQLSTATE `CF` + HTTP status, e.g. `CF404`, `CF409` or `CF410`. The app and
the Edge Functions map these to HTTP statuses.

### Triggers

- `on_auth_user_created` → `handle_new_user`: creates the profile (display name from signup metadata or the
  email, a valid cohort if one was given) and calls `grant_starter_pack`. Failures in the pack never block signup.
- `trg_profiles_guard`, `trg_profiles_sync_level`: protect profile fields; derive the level.
- `trg_feed_prune`: keeps `activity_feed` at 50 rows.

## Realtime

The `supabase_realtime` publication includes `activity_feed` (Events page ticker), `trades` (live offers on the
Trade page) and `app_config` (battle engine URL). RLS applies to subscribers, so players only receive rows
they can read.

## Storage

Public bucket `card-art` holds `{slug}.jpg` card images (for example `grizzly-bears.jpg`). Uploads use the
service role (`scripts/download-card-art.ps1`).

## Migrations

| # | File | Contents |
| --- | --- | --- |
| 00 | `profiles_auth` | profiles, level/cohort functions, signup trigger, `is_admin` |
| 01 | `card_catalog` | cards, formats, legalities |
| 02 | `collection` | unlocks, unique cards, discoveries, favorites |
| 03 | `decks_matches` | decks, deck cards, matches |
| 04 | `trades` | trades, trade cards |
| 05 | `claims_events_achievements` | claims, events, achievements |
| 06 | `game_functions` | feed, `apply_claim`, trade RPCs, `record_match_result` |
| 07 | `analytics_feed` | first analytics functions |
| 08 | `deck_validation` | `validate_deck` |
| 09 | `print_catalog_helper` | `ensure_print_claim` |
| 10 | `card_art_storage` | `card-art` bucket |
| 11 | `client_read_rpcs` | profile stats, leaderboard, search, trades list, `validate_deck_spec`, achievements |
| 12 | `analytics_rpc_alignment` | `popular_decks`, `active_buildings` |
| 13 | `security_hardening` | privilege allow-list, profile guard, write-policy cleanup, `game_log`, trade/claim guards |
| 14 | `starter_pack` | UNLIMITED starter creatures, `grant_starter_pack`, signup hook, backfill |
| 15 | `app_config` | public runtime settings + realtime |
| 16 | `multi_copy_unlocks` | up to 4 copies of an UNLOCK card, one per distinct code; one unique serial per player via scanning |
| 17 | `scan_to_unlock_unlimited` | `cards.requires_unlock`: UNLIMITED cards other than the base 15 unlock (unlimited copies) on the first scan; `owned_copies()`; ownership-aware stats/leaderboard |

**Rules for new migrations**

1. New file `supabase/migrations/<yyyymmddhhmmss>_<name>.sql`. Migrations 00–10 are not re-runnable;
   **every new migration must be idempotent** (`create or replace`, `if not exists`, `drop policy if exists`, …),
   because the tests re-run 11+.
2. **Every new function** must end with explicit grants: Supabase grants `EXECUTE` to `anon`/`authenticated`
   directly on new functions, so `revoke … from public` alone does nothing.
   ```sql
   revoke execute on function public.my_fn(uuid) from public, anon, authenticated;
   grant execute on function public.my_fn(uuid) to authenticated;   -- or service_role
   ```
   Player-callable functions must take the actor from `auth.uid()` and reject NULL.
3. Add checks to `supabase/tests/schema.test.mjs`, run `npm test`, then regenerate the bootstrap file with
   `npm run build:setup-sql` (in `supabase/tests/`).
4. Apply to the hosted project (see [operations.md](operations.md#apply-a-migration)).

**The hosted DB has no migration history table** (it was bootstrapped by pasting `SQL_EDITOR_SETUP.sql`), so
`supabase db push` does not work. Apply migration files with the SQL Editor or the Management API.
