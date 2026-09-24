# Game rules

These rules are enforced in Postgres (see [database.md](database.md)) and the battle engine. The web app only
displays them. Change a rule in SQL, not in the UI.

## Cards and ownership

The catalog (`cards`, seeded by `supabase/seed.sql`) has 104 cards. Every card has an **ownership type**:

| Type | Count | How you get it | Copies you own |
| --- | --- | --- | --- |
| `UNLIMITED` | 15 | Everyone owns it from the start: 5 basic lands + the 10 starter creatures | unlimited |
| `UNLOCK` | 86 | Scan its QR code once | **1** |
| `UNIQUE` | 3 | Be the first to scan its (single-use) QR code; the card is serialized (#1, #2, …) and can be traded | one per serialized copy you hold |

**Starter creatures** (UNLIMITED): Raging Goblin, Goblin Piker, Vulshok Berserker, Hill Giant, Fire Elemental
(red) and Grizzly Bears, Elvish Warrior, Trained Armodon, War Mammoth, Craw Wurm (green).

**Starter deck.** Every new account gets a legal 60-card Standard deck, **Red-Green Starter**: 4 of each
starter creature, 10 Mountain and 10 Forest. It is granted once per player (players who existed before this
feature were backfilled). Deleting it does not re-grant it.

## Scanning (claims)

A QR code encodes a claim token (format: [qr-codes.md](qr-codes.md)). Scanning it:

| Card type | First scan by you | Later scans by you |
| --- | --- | --- |
| UNLOCK | card unlocked, **+10 XP × event bonus** | discovery count +1, no XP |
| UNIQUE | you get the next serial number, **+10 XP × event bonus**; the code is used up | — (anyone else: "already claimed") |
| UNLIMITED | discovery count +1, no XP | same |

- Printed catalog codes for UNLOCK cards are reusable by every player; each player benefits once.
- Admin-spawned codes can have a **building**, an **expiry** and an **event**. Expired or revoked codes are rejected.
- Banned players cannot claim.
- Scans are rate-limited (burst of 30, then 2 per second per player).

## XP and levels

- **Level = 1 + ⌊XP / 100⌋** (Postgres `compute_level`, the only place this formula exists).
- XP sources: first unlock of a card or claim of a unique (**10**), winning a battle (**50**). Both are multiplied
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

"Discoveries" counts every scan (including repeats). "Own" counts UNLIMITED cards, so every player starts at
15/104 of the catalog.

## Decks

| Format | Deck size | Max copies | Commander |
| --- | --- | --- | --- |
| **STANDARD** | at least 60 | 4 per card (basic lands unlimited) | no |
| **COMMANDER** | exactly 99 + a commander | 1 per card (basic lands unlimited) | required; must be commander-eligible, owned, not banned; all cards within its color identity |

You can only include cards you own, up to the number of copies you own. UNLOCK cards give **one** copy, so a
scanned card appears at most once in a deck. Starter creatures and basic lands are unlimited. Per-format
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
