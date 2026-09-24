# Operations runbook

Production = GitHub Pages (web app) + Supabase project `prjsiywvhxqnsvsmfgxm` + the battle engine service on
the campus PC.

## Credentials and where they live

| Secret | Where | Used by |
| --- | --- | --- |
| Publishable (anon) key | `web-client/.env.development`, `deploy-web.yml` | the browser. **Public by design.** |
| Service-role key | repo-root `.env` (gitignored), battle engine | engine, scripts. **Never ship it to a browser.** |
| `QR_SIGNING_SECRET` | Supabase → Edge Functions → Secrets | `claim`, `qr-catalog`, `admin-spawn` |
| Personal access token (`sbp_…`) | root `.env` as `SUPABASE_ACCESS_TOKEN`, only while needed | Management API, function deploys |

Create PATs at https://supabase.com/dashboard/account/tokens and revoke them when you're done.

## Deploy the web app

Push to `main`. `.github/workflows/deploy-web.yml` runs lint + tests, builds with `BASE_PATH=/TheFury/`,
and publishes to Pages (a few minutes). Check the run on the Actions tab or with
`gh run list --workflow deploy-web.yml`. Clients auto-update on their next load.

## Apply a migration

The hosted DB has no migration history table, so `supabase db push` doesn't work. Apply files one at a time,
in order, only the ones not yet applied. Migrations 11+ are idempotent (safe to re-run).

**SQL Editor:** paste the file's contents and run it.

**Management API** (scriptable):

```bash
set -a; . ./.env; set +a
node -e "process.stdout.write(JSON.stringify({query: require('fs').readFileSync('supabase/migrations/<file>.sql','utf8')}))" |
  curl -s -X POST "https://api.supabase.com/v1/projects/prjsiywvhxqnsvsmfgxm/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
```

Then verify from the outside (e.g. a new function isn't callable anonymously:
`curl -X POST <url>/rest/v1/rpc/<fn> -H "apikey: <publishable key>"` → `permission denied`).

**Brand-new project:** run the whole `supabase/SQL_EDITOR_SETUP.sql` once, then set the QR secret, deploy
the functions, and promote an admin.

## Deploy Edge Functions

```bash
set -a; . ./.env; set +a
supabase functions deploy claim qr-catalog admin-spawn --project-ref prjsiywvhxqnsvsmfgxm --use-api
```

Smoke test: `curl -i -X POST https://prjsiywvhxqnsvsmfgxm.supabase.co/functions/v1/claim -H "apikey: <publishable key>" -d '{}'`
→ `401` with `Access-Control-Allow-Origin: *`. A `500` means `QR_SIGNING_SECRET` is missing or shorter than 32
characters.

## Battle engine service

On the campus PC, from an **Administrator** PowerShell in the repo:

| Task | Command |
| --- | --- |
| First install | `powershell -ExecutionPolicy Bypass -File battle-engine\battle-server.ps1 install` |
| Is it up? | `battle-server.ps1 status` (the published URL should say **LIVE**) |
| Logs | `battle-server.ps1 logs` (files in `battle-engine\logs\`) |
| Deploy new engine code | `git pull`, then `battle-server.ps1 update` (stop → build + tests → start) |
| Forge patch / headless changed | `battle-engine\setup-forge.ps1 -Mvn <mvn.cmd>`, then `battle-server.ps1 update` |
| Take battles offline | `battle-server.ps1 stop` (the Battle tab hides; it comes back at the next boot) |
| Remove the service | `battle-server.ps1 uninstall` |

The PC must stay on and awake (`install` disables sleep on AC power). Restarting the engine drops games in
progress. Details: [battle-engine.md](battle-engine.md).

## Admin tasks

### Make someone an admin

```sql
update public.profiles set role = 'ADMIN' where email = 'someone@example.com';
```

(SQL Editor, or the admin console's Players tab once you're an admin.) Demote with `role = 'PLAYER'`.

### Ban / unban

Admin console → Players, or
`update public.profiles set banned = true, banned_at = now() where email = '…';`.
Banned players can't claim or trade and are hidden from search and leaderboards.

### Run an event

Admin console → Events: name, start/end, bonus multiplier (≥ 1.00), optional allowed sets. Spawn event codes
under Spawns with the event selected.

### QR codes

Print the catalog or spawn codes: [qr-codes.md](qr-codes.md).

## Inspecting data

- **Durable history:** `select * from game_log order by created_at desc limit 100;` (kinds: CLAIM, TRADE,
  MATCH, STARTER, SPAWN).
- **Matches:** `select status, battle_code, winner_id, created_at from matches order by created_at desc;`
- **Current engine URL:** `select * from app_config;`
- **Live feed (UI):** `activity_feed` (last 50 rows only).

## Backups

Automatic backups depend on the Supabase plan; check dashboard → Database → Backups. For a copy you control
(recommended before risky migrations), run `pg_dump` with the connection string from Project Settings →
Database.

## Incident checklist

| Symptom | Check |
| --- | --- |
| Site blank at `/TheFury/` | the latest deploy run; the router basename (see [frontend.md](frontend.md)) |
| Scans fail for everyone | `claim` smoke test above; the `QR_SIGNING_SECRET` secret still set |
| One code fails | its `claims` row: `status`, `expires_at`, card ownership type |
| No Battle tab | `battle-server.ps1 status`; `select value from app_config` |
| Battles 401 | player signed out or token expired (reload); engine JWKS load line in `engine.log` |
| Suspected abuse | `game_log` for the player; ban them; see [security.md](security.md) |
