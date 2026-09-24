# Campus Forge

A campus-wide collectible Magic: The Gathering game. Players find QR codes around
campus, scan them with their phone to unlock cards, build decks, trade unique cards
and battle each other with real Magic rules.

```
 phone (PWA, GitHub Pages, HTTPS)  ──►  Supabase  (Postgres + RLS + RPC, Auth, Storage,
        │                                         Edge Functions, Realtime)
        └──── REST + STOMP (optional) ──►  battle-engine  (Spring Boot + Forge rules engine)
                                                  └── service role ──► Supabase
```

| Path | What it is |
| --- | --- |
| `web-client/` | Vite + React 18 PWA. `src/api/*` is the only layer that talks to Supabase. Deployed to https://igdaiiitd.github.io/TheFury/ |
| `supabase/migrations/` | Schema source of truth (tables, RLS, RPCs, realtime publication). |
| `supabase/functions/` | Edge Functions: `claim` (scan a QR), `qr-catalog` (admin print export), `admin-spawn` (admin mints codes). |
| `supabase/tests/` | PGlite (Postgres-in-WASM) suite: RLS, privileges, game RPCs. `cd supabase/tests && npm ci && npm test` |
| `battle-engine/` | Optional battle server. See [battle-engine/README.md](battle-engine/README.md). |
| `admin-console/` | Admin UI (players, events, spawns). Not deployed; run locally with `npm run dev`. |
| `scripts/download-card-art.ps1` | Fetches card art from Scryfall and uploads it to the `card-art` bucket. |

`AGENTS.md` has the detailed conventions and gotchas; `THEPLAN.md` the original design.

## Game data lives in Supabase

- **Collection:** `player_unlocks` (UNLOCK cards), `unique_cards` (serialized one-offs with
  a `history` of owners), `discoveries` (scan counts), `favorites`.
- **Play:** `decks`/`deck_cards`, `matches` (written by the battle engine), `trades`/`trade_cards`.
- **History:** `game_log` is the durable, append-only record of every claim, trade,
  match result, starter grant and admin spawn (players read their own rows; admins all).
  `activity_feed` is the 50-row live ticker shown on the Events page.
- **Realtime:** `activity_feed`, `trades` and `app_config` (public runtime settings, e.g. the
  current battle engine URL) are published; RLS applies to subscribers.
- **Starter cards:** 5 red + 5 green attacking creatures are UNLIMITED like basic lands (everyone
  owns infinite copies; Standard still allows 4 per deck), and every new account gets a
  ready 60-card "Red-Green Starter" deck (4x each + 10 Mountain + 10 Forest).

All writes that matter go through `SECURITY DEFINER` functions or Edge Functions;
players can only edit their own presentation fields, decks and favorites directly.

## Local development

```powershell
cd web-client
npm ci
npm run dev            # http://localhost:17170 against the hosted Supabase project
npm run lint; npm test # tsc + vitest
```

## Production checklist

Apply these once per environment (the hosted DB was bootstrapped from
`SQL_EDITOR_SETUP.sql`, so `supabase db push` does not work there):

1. **Database.** In the SQL Editor, run each new migration in order. For the current
   hosted project that is
   `supabase/migrations/20260924000013_security_hardening.sql`, then
   `supabase/migrations/20260924000014_starter_pack.sql` (both idempotent).
   A brand-new project instead gets the whole `supabase/SQL_EDITOR_SETUP.sql`.
2. **QR signing secret.** Dashboard → Edge Functions → Secrets:
   `QR_SIGNING_SECRET` = 32+ random characters (`openssl rand -hex 32`). The functions
   refuse to run without it. Changing it invalidates every printed/spawned QR code.
3. **Edge Functions.**
   ```bash
   supabase functions deploy claim --project-ref prjsiywvhxqnsvsmfgxm
   supabase functions deploy qr-catalog --project-ref prjsiywvhxqnsvsmfgxm
   supabase functions deploy admin-spawn --project-ref prjsiywvhxqnsvsmfgxm
   ```
   (needs `SUPABASE_ACCESS_TOKEN`; no Docker required).
4. **Auth.** Authentication → URL Configuration: Site URL
   `https://igdaiiitd.github.io/TheFury/`. Consider enabling leaked-password
   protection and a CAPTCHA before a campus-wide launch.
5. **Admins.** `update public.profiles set role = 'ADMIN' where email = '<you>';`
6. **Print QR codes.** Signed in as an admin, `GET /functions/v1/qr-catalog` returns
   `[{ "cardName": "...", "qrContent": "V1.<CORE>.<SIG>" }]`; encode `qrContent` verbatim.
   (`?format=csv` for spreadsheets.) Admin-spawned codes from `admin-spawn` can also be
   typed in manually on the Scan page.
7. **Frontend.** Push to `main`; `.github/workflows/deploy-web.yml` lints, tests, builds
   and deploys to Pages.
8. **Battles (optional).** Build the engine once, then run
   `battle-engineattle-server.ps1 install` (as administrator) on the host PC; it runs the
   engine as a boot-time background service via `start-public.ps1`. It opens a Cloudflare quick tunnel and
   publishes the URL to Supabase `app_config`; the site picks it up without a rebuild.
   See [battle-engine/README.md](battle-engine/README.md).
