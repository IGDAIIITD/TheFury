# Campus Forge

## Technical Architecture Overview (v2)

---

# 1. Project Goal

The objective is **not** to create another Magic simulator.

The objective is to create a **persistent campus-wide collectible game**
inspired by Pokémon GO, where:

* players discover physical cards around campus
* scan QR codes
* permanently unlock cards
* build decks only from owned cards
* battle other players using Forge's MTG rules engine
* trade unique cards
* participate in events

Forge becomes only the combat engine.
Everything else is original.

**Client target:** a single installable, cross-platform **Progressive Web
App (PWA)** — no native APK. One codebase, one deployment, works on
Android and iOS.

---

# 2. Core Philosophy

Instead of

```
Forge
  ↓
Everything
```

it becomes

```
Campus Forge
│
├── Identity Service
├── Collection Service
├── Trading Service
├── QR Service
├── Event Service
├── Player Web App (PWA)
├── Admin Console
├── Database
└── Forge Battle Engine (headless)
```

Forge is just one module.
The backend owns the game.

---

# 3. Major Components

Five major systems.

```
Backend
```

```
Forge (headless engine)
```

```
Player Web App (PWA)
```

```
Database
```

```
Admin Console
```

Each is independent.

Note the change from the original plan: **Scanner App** and **Website**
are no longer two separate systems. They're merged into one Player Web
App — scanning, collecting, deck-building, battling, trading, and
browsing the leaderboard all live in the same installable PWA.

---

# 4. Backend

This is the heart of the project.

Prefer Spring Boot.

Example packages

```
campusforge-backend
  accounts/
  collection/
  deck/
  battle/
  qr/
  trade/
  events/
  admin/
  analytics/
  notifications/
```

Every other system communicates with this backend.
Never let Forge talk directly to PostgreSQL.
Forge should only call backend interfaces.

---

# 5. Identity

Players are persistent.

Player table

```
Player
  UUID
  email
  password hash
  display name
  created
  last login
  role
  avatar
  student id
  experience
  level
```

Authentication

```
Login
  ↓
JWT
  ↓
Backend
  ↓
Forge
```

Forge only knows

```
Player UUID
```

Nothing else.

---

# 6. Collection System

This replaces Forge's assumption that every card exists.

Every card belongs to one of three ownership models.

```
UNLIMITED
UNLOCK
UNIQUE
```

Example

```
Basic Plains       → Unlimited
Counterspell       → Unlock
Black Lotus #14    → Unique
```

Collection API

```
CollectionService
  getCollection()
  owns()
  quantity()
  discover()
  transfer()
  validateDeck()
```

Forge never queries ownership itself. Everything routes here.

---

# 7. Card Metadata

Metadata database, separate from Forge's card definitions.

```
Card
  oracle id
  forge name
  rarity
  ownership type
  set
  mana value
  types
  colors
  image
  discoverable
  spawn region
  weight
```

Forge already understands the gameplay.
The backend understands the economy.

---

# 8. Ownership

**Unlimited**

```
Always owned.
```

**Unlock**

```
PlayerUnlock
  player
  card
  date
```

**Unique**

```
UniqueOwnership
  physical uuid
  owner
  history
  serial
  claimed
```

Example

```
Black Lotus, Serial #22 → Owner: Alice
```

Only one owner exists. Ever.

---

# 9. QR Codes

Never encode card information directly.

```
QR → TOKEN → Backend lookup → Card
```

Example

```
QR: ABF92XK11
  ↓
ABF92XK11 → Counterspell → Unlock → Building B → Unused
```

This allows revoking codes.

---

# 10. Player Web App — Unified PWA

One installable app, one origin, works on Android and iOS. Built as a
standard responsive web app with a service worker and manifest — no
native shell, no app store.

Sections inside the same app:

```
Onboarding / Install prompt
Scan (camera QR reader)
Collection
Deck Builder
Battle
Trades
Map / Regions
Leaderboard
Events
Profile / Achievements
Friends
```

Because there's no separate "scanner app" anymore, scanning is just one
tab/route inside the main app, using the browser's camera via
`getUserMedia` and a client-side QR decode library (e.g. `jsQR` or
`zxing-js`). The decoded token is POSTed to `/claim` exactly as before —
nothing about the claim flow changes, only where the camera lives.

---

# 11. QR Scan & Claim Flow

```
Player
  ↓
Open PWA (already installed, or via browser)
  ↓
Camera tab → getUserMedia → decode QR client-side
  ↓
POST /claim { token }
  ↓
Backend validates token
  ↓
Already claimed? → discovery count++, no unlock
  ↓
Unlock card → award XP → return animation payload
```

Requires HTTPS (camera access is blocked on insecure origins in every
modern browser) — this needs to be true in dev too, not just prod.

---

# 12. Discovery

Discovery is separate from ownership.

```
Player scans Counterspell
  ↓
already owns
  ↓
No unlock
  ↓
Discovery count++
```

Useful for statistics.

---

# 13. Inventory

```
Collection → Cards → Copies → Source → Date
```

Example

```
Counterspell, 2, QR, Jan 18
```

---

# 14. Deck Builder

Vanilla Forge

```
All cards → Deck
```

Campus Forge

```
Collection → Filter → Deck
```

Search

```
Counter → Counterspell, Owned: 2
Cancel  → Owned: 0 (hidden or greyed out, per settings)
```

Deck builder should show

```
Owned
Missing
Recently Found
Favorites
Commander Eligible
Color Filters
Mana Curve
```

---

# 15. Deck Validation

Never trust the client.

```
Deck → Backend → Own cards? → Valid? → Forge match
```

Checks

```
copies
ownership
format
banned
event restrictions
```

---

# 16. Battle Flow — Forge Runs Headless

This is the part that changes most from the original plan, and it's
worth being explicit about it: **Forge's native interface is a Java
Swing desktop UI. It cannot run inside a browser.**

Since the player client is now a PWA, Forge cannot be "launched" for the
player the way a desktop app would launch it. Instead:

```
Create Match
  ↓
Player UUID + Deck UUID
  ↓
Backend validates
  ↓
Forge instance started headless, server-side
  ↓
Game state streamed to both players over WebSocket
  ↓
Winner reported
  ↓
Rewards granted
```

Forge runs as a **server-side process per match**, stripped of its own
UI layer, exposing game state and accepting player actions programmatically.
Forge never modifies ownership, and never talks to the database directly.

---

# 17. Battle Rendering — Web Battle Board

Because Forge's UI isn't usable, the PWA needs its **own battle board
UI** — hand, battlefield, stack, life totals, targeting, mana
tap/untap, priority passes — built from scratch in the web app, driven
entirely by state pushed from the headless Forge instance.

```
Forge engine (server)
  ↓ game state diff
WebSocket
  ↓
Player Web App
  ↓
Custom battle board renderer
  ↓
Player action (tap, cast, target, pass)
  ↓
WebSocket
  ↓
Forge engine (server)
```

**Flag this clearly as the highest-risk, highest-effort piece of the
project.** Rebuilding a legible, responsive Magic board on the web —
targeting, the stack, triggered abilities, replacement effects visible
to the player — is a much larger effort than every other system in this
document combined. Recommend treating it as its own sub-project with
its own milestones (see Phase 5 below), and prototyping it early rather
than assuming it falls out naturally once the adapter exists.

Two paths worth evaluating before committing engineering time:

* **Full custom renderer** — most control, most work, matches campus
  branding exactly.
* **Check whether Forge (or a fork of it) already exposes a
  network/headless game-state protocol** (some MTG engines do, for
  spectator or AI-vs-AI tooling) that could be adapted rather than
  reverse-engineered from scratch. Worth a spike before Phase 5 starts.

---

# 18. Battle Adapter

A layer between Forge and backend, unchanged in shape from the original
plan:

```
BattleAdapter
  startGame()
  finishGame()
  reportWinner()
  reportDisconnect()
  reportConcede()
```

Forge should never know achievements exist.

---

# 19. Events

Events belong to the backend.

```
Halloween → Only Innistrad → Bonus XP
```

Forge simply receives

```
Allowed Sets
```

---

# 20. Trading

Only unique cards.

```
Offer → Pending → Accept → Atomic transaction → Ownership swapped
```

```
BEGIN
lock cards
verify owners
swap
history
COMMIT
```

Never duplicate.

---

# 21. Marketplace

Potential future feature.

```
Browse → Offer → Counter → Accept
```

Backend only. Forge uninvolved.

---

# 22. Spawn System

Admin panel

```
Spawn → Choose Building → Choose Card → Generate QR → Print
```

Metadata

```
spawn date
expires
weight
event
owner
```

---

# 23. Regions

Cards can belong to regions.

```
Engineering → Blue
Library     → White
Gym         → Red
```

Promotes exploration.

---

# 24. Admin Console

Kept as a separate system from the player PWA — different audience
(staff, organizers), different priorities (density of information over
mobile ergonomics). Can be a plain responsive web app, no install
requirement.

```
Players
Cards
Trades
Claims
Spawns
Events
Bans
Logs
Statistics
```

Never edit the database manually.

---

# 25. Statistics

Track everything.

```
Cards found
Battles
Win rate
Favorite colors
Popular decks
Buildings visited
Unique trades
```

Useful for balancing.

---

# 26. PWA-Specific Considerations

Cross-platform PWA means designing around real constraints, not just
"it runs in a browser":

* **iOS installability** — no automatic install prompt like Android's
  `beforeinstallprompt`. Users add it manually via Safari's Share →
  "Add to Home Screen." Onboarding needs an explicit walkthrough for
  this, not just a passive banner.
* **Push notifications on iOS** — only supported from iOS 16.4+, and
  only for apps added to the home screen (not from Safari tabs
  directly). Plan a fallback (in-app notification center, email digest)
  for anything time-sensitive like event start or trade offers, since
  you can't assume push will land.
* **Camera access** — `getUserMedia` works well on both platforms over
  HTTPS, no concerns there.
* **Background behavior** — iOS aggressively suspends backgrounded web
  apps; don't rely on background sync or long-lived WebSocket
  connections surviving app-switch. Reconnect-on-resume needs to be a
  first-class flow, not an edge case, especially for the battle board
  in section 17.
* **Storage** — use IndexedDB for offline collection browsing, not
  localStorage, given the data volume.

---

# 27. Security

Never trust the client.

* Every request authenticated
* Every claim signed
* Every trade verified
* Decks validated server-side
* QR codes randomized
* Rate limiting
* Replay protection
* Audit logs
* HTTPS everywhere (required anyway for camera access and service
  workers — no exceptions, including local dev)
* JWT storage in the PWA should use an httpOnly cookie where possible
  rather than localStorage, to reduce XSS exposure to the auth token

---

# 28. Persistence

Use PostgreSQL.

Likely tables

```
players
cards
player_unlocks
unique_cards
ownership
decks
matches
claims
events
trades
achievements
notifications
friends
sessions
logs
```

---

# 29. API

Example REST endpoints

```
POST /login
POST /register
GET  /collection
POST /claim
POST /trade
GET  /leaderboard
GET  /decks
POST /deck
POST /battle/create
POST /battle/result
GET  /events
POST /admin/spawn
```

Real-time / long-lived features use WebSockets or SSE instead of
polling:

```
Battle state streaming (section 17) — WebSocket, required, not optional
Match invitations
Discovery feed
Trade offer updates
```

The backend exposes a versioned API (`/api/v1/...`) so the Player Web
App and Admin Console share the same contracts.

---

# 30. Development Phases

### Phase 1

Fork Forge. Strip Swing UI. Confirm it can run headless. This is a
go/no-go check for the whole battle-rendering approach — do this early.

### Phase 2

Backend. Authentication. Players. JWT.

### Phase 3

Collection system. Ownership database. Inventory.

### Phase 4

Deck builder (web). Only owned cards. Server-side validation.

### Phase 5

Battle adapter + web battle board prototype. Treat as its own
milestone — start with a minimal 1v1 combat-only prototype (no stack,
no triggers) before building out full rules coverage in the UI.

### Phase 6

QR claim flow inside the PWA. Camera scan tab. Claim API.

### Phase 7

Remaining PWA surfaces: collection browsing, profile, leaderboard, map.

### Phase 8

Trading. Unique ownership. Atomic transfers.

### Phase 9

Events. Spawn rotation. Achievements. Discovery feed.

### Phase 10

Polish. Offline mode. Push notification fallback. Analytics. Seasonal
events.

---

# 31. Code Organization

```
campusforge/
├── backend/                 # Spring Boot
├── forge-engine/            # Headless fork of Forge
├── web-client/              # Unified PWA (player-facing)
├── admin-console/           # Admin UI
├── shared-api/              # OpenAPI spec / shared DTOs
├── deployment/
│   ├── docker/
│   ├── kubernetes/
│   └── scripts/
└── docs/
    ├── architecture.md
    ├── database.md
    ├── api.md
    ├── gameplay.md
    ├── battle-rendering.md   # spec for the web battle board (section 17)
    └── event-design.md
```

`scanner-pwa/` from the original plan is gone — its one job (camera →
claim) is now a route inside `web-client/`.

---

# 32. One Architectural Principle Above All Others

The single biggest mistake would be embedding all of the campus-game
logic inside Forge.

Define a narrow interface that Forge consumes:

```java
public interface GamePlatform {
    PlayerProfile authenticate(String token);
    Collection getCollection(UUID playerId);
    DeckValidation validateDeck(UUID playerId, Deck deck);
    MatchToken createMatch(UUID playerId, Deck deck);
    void reportMatchResult(MatchResult result);
    RewardResult claimQRCode(UUID playerId, String qrToken);
    TradeResult transferUniqueCard(
        UUID fromPlayer,
        UUID toPlayer,
        UUID uniqueCardId
    );
}
```

Forge should never know:

* how authentication works,
* where collections are stored,
* how QR codes are generated,
* how trades are implemented,
* how achievements are awarded,
* or how events rotate.

It should ask the platform for permission to start a game, execute
Magic rules, and report the outcome — nothing else. It also shouldn't
need to know that its output is being rendered by a custom web battle
board rather than its own Swing UI; that's the Battle Adapter's problem
(section 18), not Forge's.

The backend remains the authoritative source for **identity,
progression, ownership, events, and persistence**, allowing the battle
engine — or its rendering layer — to be upgraded or replaced later
without redesigning the rest of the game.
