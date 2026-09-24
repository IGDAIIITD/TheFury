# Campus Forge

A campus-wide collectible Magic: The Gathering game. Players find QR codes around campus, scan them with their
phone to unlock cards, build decks, trade unique cards and battle each other with real Magic rules.

**Play:** https://igdaiiitd.github.io/TheFury/

```
 phone (PWA on GitHub Pages) ──► Supabase (Postgres + RLS + RPC, Auth, Storage, Edge Functions, Realtime)
            │
            └── HTTPS + WSS ──► Cloudflare quick tunnel ──► battle-engine (Spring Boot + Forge) on a campus PC
```

## Documentation

Everything is in **[DOCS/](DOCS/README.md)**:

- [Architecture](DOCS/architecture.md) · [Game rules](DOCS/game-rules.md) · [Security](DOCS/security.md)
- [Local development](DOCS/local-development.md) · [Testing & CI](DOCS/testing.md)
- [Database](DOCS/database.md) · [Edge Functions](DOCS/edge-functions.md) · [QR codes](DOCS/qr-codes.md)
- [Web app](DOCS/frontend.md) · [Battle engine](DOCS/battle-engine.md)
- [Operations runbook](DOCS/operations.md) (deploys, migrations, the battle service, admin tasks)

Conventions for coding agents: [AGENTS.md](AGENTS.md).

## Quick start

```powershell
cd web-client
npm ci
npm run dev            # http://localhost:17170 against the hosted Supabase project
npm run lint; npm test
```

## Repository

| Path | What |
| --- | --- |
| `web-client/` | the PWA (Vite + React 18 + TypeScript) |
| `supabase/` | migrations, Edge Functions, seed, schema tests |
| `battle-engine/` | battle server + Forge build + run/service scripts |
| `admin-console/` | admin UI (local only) |
| `scripts/` | card-art download/upload |
| `DOCS/` | documentation |

Licensed under GPL-3.0 (see `LICENSE`); Forge is GPL-3.0.
