# Campus Forge documentation

Campus Forge is a campus-wide collectible Magic: The Gathering game. Players find QR codes around campus,
scan them with their phone to unlock cards, build decks, trade unique cards and battle each other with real
Magic rules.

| I want to… | Read |
| --- | --- |
| understand how the pieces fit together | [architecture.md](architecture.md) |
| run the project on my machine | [local-development.md](local-development.md) |
| know the game rules (ownership, XP, decks, trades, events) | [game-rules.md](game-rules.md) |
| work on the database (tables, RLS, RPCs, migrations) | [database.md](database.md) |
| work on the Edge Functions (claim, QR catalog, spawns) | [edge-functions.md](edge-functions.md) |
| print or spawn QR codes | [qr-codes.md](qr-codes.md) |
| work on the web app (PWA) | [frontend.md](frontend.md) |
| build, run or host the battle engine | [battle-engine.md](battle-engine.md) |
| deploy, run production, or do admin tasks | [operations.md](operations.md) |
| understand the security model | [security.md](security.md) |
| run or extend the tests / CI | [testing.md](testing.md) |
| read the original product vision | [design/original-plan.md](design/original-plan.md) (historical) |

Conventions for coding agents working in this repo live in [`../AGENTS.md`](../AGENTS.md).

## At a glance

| Piece | Tech | Where it runs |
| --- | --- | --- |
| Web app (PWA) | Vite + React 18 + TypeScript | GitHub Pages: https://igdaiiitd.github.io/TheFury/ |
| Backend | Supabase: Postgres + RLS + RPC, Auth, Storage, Edge Functions (Deno), Realtime | Hosted project `prjsiywvhxqnsvsmfgxm` |
| Battle engine | Spring Boot 3.3 + the [Forge](https://github.com/Card-Forge/forge) rules engine (Java 17+) | A campus PC, exposed through a Cloudflare quick tunnel |
| Admin console | Vite + React | Run locally (not deployed) |

## Repository map

```
web-client/            the PWA
supabase/
  migrations/          schema source of truth (tables, RLS, RPCs)
  functions/           Edge Functions: claim, qr-catalog, admin-spawn (+ _shared)
  seed.sql             card catalog (104 cards)
  SQL_EDITOR_SETUP.sql generated one-paste bootstrap for a fresh project
  tests/               PGlite schema test suite + the SQL_EDITOR_SETUP generator
battle-engine/
  src/                 Spring Boot service
  forge/               vendored forge-headless module + patch against upstream Forge
  *.ps1                setup-forge, run-engine, start-public, battle-server
admin-console/         admin UI (events, spawns, players, audit)
scripts/               download-card-art.ps1 (Scryfall → Storage)
DOCS/                  this documentation
```
