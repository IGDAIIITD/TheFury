# Campus Forge battle engine

A Spring Boot 3.3 service (port **17175**) that runs real Magic rules by embedding
the [Forge](https://github.com/Card-Forge/forge) engine headlessly. The PWA talks to it
over REST (`/api/v1/battle/*`) and STOMP/SockJS (`/ws/match`).

- **Stateless w.r.t. the database.** Live match state is in memory; a restart drops
  in-progress games. Decks, match rows and results live in Supabase.
- **Auth.** Every REST call and STOMP `CONNECT` carries the player's Supabase access
  token. It is verified against the project's JWKS (`/auth/v1/.well-known/jwks.json`).
- **Writes.** Uses the service-role key to insert/activate `matches` rows and to call
  the service-only RPCs `validate_deck` (at match start) and `record_match_result`
  (awards the winner 50 XP × event bonus and writes `game_log`).

The GitHub Pages build has no engine URL baked in. It discovers the engine at runtime
from Supabase `app_config.battle_engine_url` (section 6), and the Battle tab only shows
while an engine is published and answering.

## 1. Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| JDK | 17+ (21 tested) | `java -version` |
| Maven | 3.9+ | On the lab machine: `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd` |
| Git | any | Needs network access to github.com for the first Forge clone |

## 2. Build Forge (once, and whenever `forge/` changes)

battle-engine depends on `forge:forge-headless:2.0.14-SNAPSHOT` from your local Maven
repo. It is built from upstream Forge pinned to commit `fd8196a8` plus the files in
[`forge/`](forge):

- `forge/forge-headless/` - the headless driver (`HeadlessMatch`, remote/human player
  controllers, state serializer, bootstrap).
- `forge/campusforge-forge.patch` - trims the Maven reactor to core/game/ai/headless,
  adds `GameRules.startingPlayerChooserIndex` (the lobby host picks play/draw), a
  `ForgeDebug` trace switch (`-Dforge.debug.traces=true`), and a Cudgel Troll fix.

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 -Mvn "C:\path\to\mvn.cmd"
```

The script clones Forge into `<repo>/forge-engine` (blobless + sparse, ~5 min the
first time; gitignored), applies the patch, copies `forge-headless` in and runs
`mvn -pl forge-headless -am install -DskipTests`. It is idempotent: re-run it after
editing anything under `forge/`. Pass `-SkipBuild` to only prepare the checkout.

On macOS/Linux the same steps by hand:

```bash
git clone --filter=blob:none --no-checkout https://github.com/Card-Forge/forge.git forge-engine
cd forge-engine
git config core.autocrlf false && git config core.eol lf
git sparse-checkout set --cone forge-core forge-game forge-ai forge-gui/res
git checkout fd8196a88a8173bd88c745de7578a41eac8cb2e1
git apply ../battle-engine/forge/campusforge-forge.patch
cp -r ../battle-engine/forge/forge-headless .
mvn -q -pl forge-headless -am install -DskipTests
```

## 3. Build and test the engine

```powershell
cd battle-engine
mvn clean package          # runs the unit tests; add -DskipTests to skip
```

Output: `target/campusforge-battle-engine-0.0.1-SNAPSHOT.jar`.

## 4. Configure

| Env var | Required | Value |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://prjsiywvhxqnsvsmfgxm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Dashboard → Project Settings → API keys → secret/service_role. **Server only, never ship to the browser.** The repo-root `.env` (gitignored) holds it. |
| `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` | yes in prod | Comma-separated origins, e.g. `https://igdaiiitd.github.io,http://localhost:17170` (origin only, no `/TheFury/` path) |
| `SUPABASE_JWT_SECRET` | no | Only for projects still signing with the legacy HS256 secret, or the local CLI stack. Leave unset for the hosted project (it uses JWKS); when unset, shared-secret tokens are rejected. |
| `BATTLE_AI_BATTLES_ENABLED` | no | `true` to allow "vs AI" matches (Forge AI with a built-in test deck). Default `false`. |

JVM flags: `-Dforge.res.dir=<path>/forge-gui/res` if the card database is not at
`../forge-engine/forge-gui/res` relative to the working directory;
`-Dforge.debug.traces=true` for verbose engine logs.

## 5. Run locally

```powershell
cd battle-engine
$env:SUPABASE_URL = "https://prjsiywvhxqnsvsmfgxm.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
java -jar target/campusforge-battle-engine-0.0.1-SNAPSHOT.jar
# or, from the repo root, with values read from .env:
#   powershell -ExecutionPolicy Bypass -File battle-engine/run-engine.ps1
```

Healthy startup logs `Loaded 1 JWKS keys`, `Forge engine ready in ~3500 ms` and
`Started BattleEngineApplication`. `GET http://localhost:17175/api/v1/battle/matches`
without a token must return **401**.

Then run the PWA against it (`web-client/.env.development` already points
`VITE_BATTLE_ENGINE_URL` at `http://localhost:17175`):

```powershell
cd web-client
npm run dev        # http://localhost:17170, Battle tab visible
```

Every new account has a legal 60-card **Red-Green Starter** deck (migration 14), so two
freshly registered players can battle each other right away: one creates a lobby, the
other joins with the battle code.

## 6. Production: battles on the GitHub Pages site (Cloudflare quick tunnel)

### Why a tunnel, and not this PC's "static IP"

This PC's fixed address, `192.168.194.106`, is a **private campus LAN address**. The
internet sees it as `103.25.231.106`, the campus NAT address shared with other
machines, so nothing off campus can reach port 17175. The Pages site is also HTTPS,
so browsers refuse a plain `http://` engine (mixed content).

A Cloudflare **quick tunnel** fixes both, with **no account and no domain**.
`cloudflared` makes an outbound connection (TCP 7844, verified open from this
network), and Cloudflare serves `https://<random-words>.trycloudflare.com` with a
valid certificate, forwarding requests and WebSockets to `localhost:17175`.

The random URL changes every time the tunnel starts, so the site doesn't bake it in.
`start-public.ps1` publishes the current URL to the Supabase table
`app_config.battle_engine_url`. The PWA reads it on load, checks the engine answers,
and follows live updates. The Battle tab appears when the engine is up and
disappears when it stops. **The website never needs a rebuild.**

### Step 1: install cloudflared (once)

```powershell
choco install cloudflared -y      # or: winget install --id Cloudflare.cloudflared
```

### Step 2: build the engine (once, and after code changes)

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 -Mvn "C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd"
cd battle-engine; mvn clean package; cd ..
```

### Step 3: go live (foreground, for a quick run)

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/start-public.ps1
```

It starts the engine (settings from the repo `.env`), starts the tunnel, waits until
the engine answers through the public URL, publishes the URL, and keeps watching:

```
[14:02:10] Starting battle engine on http://localhost:17175 (log: ...\logs\engine.log)
[14:02:19] Engine is up
[14:02:19] Starting Cloudflare quick tunnel (log: ...\logs\cloudflared.log)
[14:02:24] Tunnel URL: https://example-words-here.trycloudflare.com
[14:02:31] Published to Supabase app_config.battle_engine_url
[14:02:31] Battles are live on the Pages site. Press Ctrl+C to stop.
```

**Ctrl+C** (or either process dying, or the tunnel being unreachable for a minute)
clears the URL, which hides the Battle tab, and stops both processes. Open tabs pick
up a new URL within seconds; others get it on their next page load.

### Step 4: run it as a background service (recommended)

Right-click PowerShell → **Run as administrator**, then:

```powershell
cd "C:\Users\student\Desktop\thingamamagicthegathering\2026-08-02 mtgoffline"
powershell -ExecutionPolicy Bypass -File battle-engine\battle-server.ps1 install
```

`install` checks the prerequisites (java, cloudflared, engine jar, Forge card data,
`.env`), stops anything already running, and registers the **CampusForge Battles**
scheduled task. The task runs as SYSTEM at boot with no login needed. It also disables
sleep on AC power, starts everything, and waits until it prints
`Battles are LIVE at https://….trycloudflare.com`.

The task runs a supervisor. If the engine or tunnel dies, it clears the URL and
brings both back up with a fresh URL about 2 minutes later.

| Command (`battle-engine\battle-server.ps1 <action>`) | What it does |
| --- | --- |
| `status` | task state, processes, published URL and whether it answers |
| `logs` | last lines of `supervisor.log`, `start-public.log`, `engine.log`, `cloudflared.log` |
| `restart` | stop + start (e.g. after rebuilding the jar) |
| `stop` | stop everything and hide the Battle tab (starts again at next boot) |
| `start` | start again without rebooting |
| `uninstall` | stop and remove the task |

`status` and `logs` work without admin rights. The other actions re-launch themselves
elevated if needed.

### Step 5: end-to-end check

Open https://igdaiiitd.github.io/TheFury/ on your phone (mobile data works too) and sign
in. The Battle tab should be there. Register two accounts. Each already has the
**Red-Green Starter** deck. Player A: Battle → create lobby → share the code.
Player B: join with the code. When the game ends, the winner gets 50 XP, a
`game_log` MATCH row is written for each player, and the match shows in both profiles.

### Limits and alternatives

- Cloudflare treats quick tunnels as a testing feature: no uptime guarantee, and a
  cap of about 200 in-flight requests. That's fine for a campus game. A tunnel restart means a
  new URL, which the script handles, but it drops in-progress matches (as any engine
  restart does).
- For a permanent URL later: a **named Cloudflare Tunnel** (needs a domain on
  Cloudflare) or **Tailscale Funnel** (`tailscale funnel --bg 17175`, gives
  `https://<machine>.<tailnet>.ts.net`, no domain). With either, put the URL in
  `VITE_BATTLE_ENGINE_URL` in `deploy-web.yml`, or run
  `update public.app_config set value = '<url>' where key = 'battle_engine_url';`
  without a rebuild.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve forge:forge-headless:2.0.14-SNAPSHOT` | Run step 2 (it installs into `~/.m2`). |
| `Forge resource dir not found` | Run from `battle-engine/` with `forge-engine/` next to it, or pass `-Dforge.res.dir=...`. |
| `error: patch failed` in setup-forge | The checkout has CRLF line endings; delete `forge-engine/` and re-run the script (it pins `core.eol=lf`). |
| `Filename too long` while cloning | Windows path limit; the script already sets `core.longpaths` and a sparse checkout; keep the repo path short. |
| Every call returns 401 | Token not from this project, expired, or the engine could not reach `SUPABASE_URL` for JWKS at startup (check the `Loaded N JWKS keys` line). |
| Browser: CORS error | Add the exact page origin to `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` and restart. |
| Battle tab never appears on Pages | Run `battle-server.ps1 status` / `logs`; `start-public.ps1` not running / failed, or `app_config.battle_engine_url` is empty. The site only shows the tab if the URL answers `/api/v1/battle/features`. |
| cloudflared: "failed to request quick Tunnel" | Cloudflare rate-limits quick tunnels; wait a minute and re-run. |
| "Deck not valid" when starting a match | `validate_deck` rejected it (not owned, too many copies, < 60 cards...). The message names the first problem. |
| Battle tab missing | `VITE_BATTLE_ENGINE_URL` was empty at build time. It is baked into the bundle; rebuild after changing it. |
