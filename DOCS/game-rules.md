# Game rules

These rules are enforced in Postgres (see [database.md](database.md)) and the battle engine. The web app only
displays them. Change a rule in SQL, not in the UI.

## Cards and ownership

The catalog (`cards`) has **357 cards**: the 104-card base set in `supabase/seed.sql`, plus all of **Core Set 2019
(M19)** in `supabase/seed_sets/m19.sql` (253 new cards; basic lands and 7 cards already in the base set are
skipped). Every card has an **ownership type**:

| Type | Count | How you get it | Copies you own |
| --- | --- | --- | --- |
| `UNLIMITED` | 119 | **Base 15** (5 basic lands + 10 starter creatures): everyone owns them from the start. **The other 104** (M19 commons, `requires_unlock`): scan any of their codes once | unlimited |
| `UNLOCK` | 219 | Scan its QR codes (base cards, M19 uncommons and rares) | **one per different code you scan, up to 4** |
| `UNIQUE` | 19 | Be the first to scan its (single-use) QR code; the card is serialized (#1, #2, …) and can be traded (3 base cards + the 16 M19 mythics) | one per serialized copy you hold |

Imported sets map rarity to ownership: **common → UNLIMITED (scan once to unlock), uncommon/rare → UNLOCK,
mythic → UNIQUE**. Only the base 15 are owned without scanning.
Legendary creatures are commander-eligible. Adding another set: [operations.md](operations.md#add-a-card-set).

**Starter creatures** (UNLIMITED): Raging Goblin, Goblin Piker, Vulshok Berserker, Hill Giant, Fire Elemental
(red) and Grizzly Bears, Elvish Warrior, Trained Armodon, War Mammoth, Craw Wurm (green).

**Starter deck.** Every new account gets a legal 60-card Standard deck, **Red-Green Starter**: 4 of each
starter creature, 10 Mountain and 10 Forest. It is granted once per player (players who existed before this
feature were backfilled). Deleting it does not re-grant it.

## Scanning (claims)

A QR code encodes a claim token (format: [qr-codes.md](qr-codes.md)). Scanning it:

| Card type | Scanning a code | Nothing new happens when… |
| --- | --- | --- |
| UNLOCK | **one more copy** of the card (copy 1, 2, 3, 4), **+10 XP × event bonus** each | you already used *this* code, or you already have 4 copies; only the discovery count goes up |
| UNIQUE | you get the next serial number, **+10 XP × event bonus**; the code is used up | someone already claimed it ("already claimed"), or you already own a copy of that card; the code is **not** used up, so someone else can have it |
| UNLIMITED | locked cards (all but the base 15): the **first** scan of any of its codes unlocks **unlimited copies**, **+10 XP × event bonus** | the card is already unlocked (or is one of the free base 15); only the discovery count goes up |

- **Collecting copies:** a player needs **4 different codes** for the same card to own 4 copies (the Standard
  deck maximum). Scanning the same code again never adds a copy. The scan screen says which copy you got
  ("copy 2 of 4"), or why you didn't get one.
- Printed catalog codes are reusable by every player; each player gets at most one copy per code. Print up
  to 4 codes per card with `qr-catalog?copies=4` ([qr-codes.md](qr-codes.md)); admin-spawned codes are
  additional codes too.
- Admin-spawned codes can have a **building**, an **expiry** and an **event**. Expired or revoked codes are rejected.
- Banned players cannot claim.
- Scans are rate-limited (burst of 30, then 2 per second per player).

## XP and levels

- **Level = 1 + ⌊XP / 100⌋** (Postgres `compute_level`, the only place this formula exists).
- XP sources: each new copy of an UNLOCK card or claim of a unique (**10**), winning a battle (**50**). Both are multiplied
  by the active event's bonus (see Events).
- Players cannot edit their own XP, level, role or ban status.

## Achievements

Checked whenever a player opens their profile (`sweep_achievements`):

| Code | Name | Requirement |
| --- | --- | --- |
| FIRST_DISCOVERY | First Discovery | 1 discovery |
| EXPLORER | Explorer | 25 discoveries |
| COLLECTOR_I / II / III | Collector I–III | own 25% / 50% / 75% of the catalog |
| COMPLETIONIST | Completionist | own every card |
| BATTLE_VETERAN | Battle Veteran | win 1 battle |
| UNDEFEATED | Undefeated | win every battle you've finished (≥ 1) |
| RISING_STAR | Rising Star | reach level 5 |
| HALL_OF_FAME | Hall of Fame | reach level 10 |
| FIRST_TRADE | First Trade | complete 1 trade |
| MASTER_TRADER | Master Trader | complete 5 trades |

"Discoveries" counts every scan (including repeats). "Own" counts the free base 15 plus every card you've
unlocked, so a new player starts at 15/357 (4%) of the catalog.

## Decks

| Format | Deck size | Max copies | Commander |
| --- | --- | --- | --- |
| **STANDARD** | at least 60 | 4 per card (basic lands unlimited) | no |
| **COMMANDER** | exactly 99 + a commander | 1 per card (basic lands unlimited) | required; must be commander-eligible, owned, not banned; all cards within its color identity |

You can only include cards you own, up to the number of copies you own. For UNLOCK cards that means one copy
per different code you've scanned (so 4 codes → a full playset); an UNLIMITED card gives unlimited copies once
unlocked (the base 15 need no scanning). Per-format
legality: `BANNED` cards are rejected; `RESTRICTED` cards are limited to one copy.

The deck builder checks decks with `validate_deck_spec` when saving. The battle engine re-checks with
`validate_deck` when a match starts (event rules included), and any problem blocks the match.

## Battles

- Both players start at **20 life** (`HeadlessMatch.STARTING_LIFE`).
- 1v1 with real Magic rules (Forge). One player creates a **lobby** and gets a 6-character code; the other
  **joins** with the code and a deck. The game starts immediately.
- **Winning** awards 50 XP × the event bonus (if the match belongs to an active event), records the result and
  writes history for both players.
- **Concede** gives the opponent the win. **Disconnecting** for more than 60 seconds counts as a concede.
- Pressing Join again after a successful join just reopens the running match. A lobby can only be joined once.
- The engine keeps live games in memory: if it restarts, games in progress are lost (no XP is awarded for them).
- "vs AI" matches exist but are disabled by default (`BATTLE_AI_BATTLES_ENABLED`).

## Trading

- Only **UNIQUE** cards can be traded (UNLOCK/UNLIMITED cards aren't transferable).
- The sender offers some of their unique cards and requests some of the receiver's (up to 20 per side, no
  duplicates, a card can't be on both sides).
- The receiver can **accept** or **decline**; the sender can **cancel**. Offers expire after **24 hours**.
- On accept, ownership is re-checked (cards may have moved in another trade), the cards swap owners, and each
  card's `history` gets a line like `2026-09-24T12:00:00: Alice → Bob via trade <id>`.
- Banned players cannot create or accept trades (they can still decline or cancel).

## Events

Admins create events with a time window, a **bonus multiplier** (≥ 1.00) and optionally **allowed sets**.

- While an event is active, **claims** get its bonus. If several events overlap, the one that started first wins.
- A **match** created for an event gets that event's bonus. Its decks must only use cards from the allowed
  sets (basic lands exempt).

## Leaderboard and cohorts

- Players choose a cohort at signup: B.Tech (CSE, CSAI, CSAM, CSB, CSSS, CSD, CSECON, ECE, EVE) or M.Tech (CSE,
  ECE). Department roll-up: ECE and EVE → **ECE**, everything else → **CSE**.
- Leaderboards rank by **level** (ties by XP), **collection %** or **win rate**, filterable by degree,
  specialization or department. Banned players are excluded, and your own rank is shown even when you're
  outside the top list.

## Admins and bans

- Admin = `profiles.role = 'ADMIN'`. Admins manage events, spawn QR codes, export the print catalog, and ban,
  unban, promote or demote players (admin console or SQL).
- Banned players can't claim or trade, and are hidden from search and leaderboards.
- Known gap: the battle engine does not check bans yet.
