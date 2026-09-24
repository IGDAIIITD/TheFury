# Local development

## Prerequisites

| Tool | Version | Used for |
| --- | --- | --- |
| Node.js | 20 | web-client, admin-console, Supabase schema tests |
| Deno | 2.x | Edge Function tests / type checks |
| Supabase CLI | 2.x | deploying Edge Functions |
| JDK | 17+ (21 tested) | battle engine |
| Maven | 3.9+ | battle engine (on the lab PC: `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd`) |
| cloudflared | any recent | exposing the battle engine (`choco install cloudflared -y`) |

Docker is **not** required for anything.

## Secrets and config

- `web-client/.env.development` holds the Supabase URL and **publishable** key. They're public by design:
  RLS is the security boundary. It also sets `VITE_BATTLE_ENGINE_URL=http://localhost:17175` for local battles.
- The repo-root `.env` is **gitignored** and never committed. It holds:
  ```
  SUPABASE_URL=https://prjsiywvhxqnsvsmfgxm.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...      # battle engine + scripts (server-side only!)
  SUPABASE_ACCESS_TOKEN=sbp_...      # optional: Management API / function deploys
  ```

## Web app

```powershell
cd web-client
npm ci
npm run dev        # http://localhost:17170, against the hosted Supabase project
npm run lint       # tsc --noEmit (there is no ESLint)
npm test           # vitest
npm run build      # production build into dist/
```

Local dev uses the **hosted** Supabase project (there is no local database), so sign up with a test email.
New accounts get the starter deck automatically.

## Battle engine (optional)

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 -Mvn "<path to mvn.cmd>"   # once
cd battle-engine; mvn clean package; cd ..
powershell -ExecutionPolicy Bypass -File battle-engine/run-engine.ps1                           # port 17175
```

With the engine running, `npm run dev` shows the Battle tab. Open two browsers (or a private window) with two
accounts: one creates a lobby, the other joins with the code. Full details: [battle-engine.md](battle-engine.md).

## Admin console (optional)

```powershell
cd admin-console
npm ci
npm run dev        # http://localhost:17173 — sign in with an ADMIN account
```

Tabs: **Events** (create/edit/delete events and XP bonuses), **Spawns** (mint QR codes via `admin-spawn`, list
claims), **Players** (search, ban/unban, promote/demote), **Audit** (latest activity feed).

## Tests

See [testing.md](testing.md). The short version:

```powershell
cd web-client; npm run lint; npm test                     # frontend
cd supabase/tests; npm ci; npm test                       # schema, RLS, RPCs (PGlite, no Docker)
deno test --allow-env supabase/functions/_shared/qr.test.ts
cd battle-engine; mvn test
```
