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

The GitHub Pages build ships with battles **hidden** (`VITE_BATTLE_ENGINE_URL` empty).
Everything below is what it takes to turn them on.

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

## 6. Production: battles on the GitHub Pages site (Tailscale Funnel)

### Why Funnel, and not this PC's "static IP"

This PC's fixed address, `192.168.194.106`, is a **private campus LAN address**. The
internet sees it as `103.25.231.106`, the campus NAT address shared with other
machines, so nothing off campus can reach port 17175. The Pages site is also HTTPS,
so browsers refuse a plain `http://` engine (mixed content).

[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) solves both, and it needs
**no domain**. The Tailscale client makes an outbound connection, and Tailscale then
publishes `https://<machine>.<tailnet>.ts.net` with a real certificate. Requests and
WebSockets are forwarded to `localhost:17175`. The address is permanent, it's free on
the Personal plan, and no ports or firewall changes are needed. Outbound 443 to
Tailscale was tested and works from this network.

### Step 1: install Tailscale and sign in

```powershell
winget install --id Tailscale.Tailscale
```

Open Tailscale from the Start menu and **Log in** (Google, Microsoft or GitHub
account). In the tray icon menu, enable **Preferences → Run unattended**, so Tailscale
keeps running when nobody is logged in to Windows (e.g. after a reboot).

Optional: rename the machine at https://login.tailscale.com/admin/machines
(⋯ → Edit machine name, e.g. `campusforge`). The name becomes part of the URL.

### Step 2: build and start the engine

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 -Mvn "C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd"
cd battle-engine; mvn clean package; cd ..
powershell -ExecutionPolicy Bypass -File battle-engine/run-engine.ps1
```

`run-engine.ps1` reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the repo
`.env` and allows CORS from `https://igdaiiitd.github.io` plus localhost. Leave it
running. In another terminal, `curl.exe -i http://localhost:17175/api/v1/battle/matches`
must return `401`.

### Step 3: publish it with Funnel

In a terminal (run as Administrator if it complains about permissions):

```powershell
tailscale funnel --bg 17175
```

- The first time, it prints a `login.tailscale.com` link to **enable HTTPS
  certificates and Funnel** for your tailnet. Open it, approve, and run the command
  again.
- `--bg` makes it persistent: it survives reboots and Tailscale restarts.
- `tailscale funnel status` shows the public URL, e.g.
  `https://campusforge.tail1234.ts.net`. It is proxied to `http://127.0.0.1:17175`.
- The first certificate and DNS setup can take a few minutes.

Verify from **another network** (e.g. your phone on mobile data):
`https://<machine>.<tailnet>.ts.net/api/v1/battle/matches` → `401` means it works.

To stop publishing: `tailscale funnel --https=443 off` (or `tailscale funnel reset`).

### Step 4: keep the engine running across reboots

Tailscale is already a service (and Funnel is persistent). For the engine, run this in
an **Administrator** PowerShell:

```powershell
schtasks /Create /TN "CampusForge Battle Engine" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\student\Desktop\thingamamagicthegathering\2026-08-02 mtgoffline\battle-engine\run-engine.ps1\""
schtasks /Run /TN "CampusForge Battle Engine"
```

Also stop the PC from sleeping: `powercfg /change standby-timeout-ac 0`.
If the repo moves, recreate the task with the new path. To stop the engine:
`schtasks /End /TN "CampusForge Battle Engine"`.

### Step 5: point the website at the engine

In `.github/workflows/deploy-web.yml` set

```yaml
          VITE_BATTLE_ENGINE_URL: 'https://<machine>.<tailnet>.ts.net'
```

(no trailing slash), then commit and push to `main`. Once the Pages deploy finishes,
the Battle tab appears on https://igdaiiitd.github.io/TheFury/. The URL is baked in at
build time; it only changes if you rename the machine or tailnet.

### Step 6: end-to-end check

Register two accounts (two browsers, or phone + laptop). Each already has the
**Red-Green Starter** deck. Player A: Battle → create lobby → share the code.
Player B: join with the code. When the game ends, the winner gets 50 XP, a
`game_log` MATCH row is written for each player, and the match shows in both profiles.

**Notes.** Funnel traffic is relayed through Tailscale's servers, and Tailscale doesn't
publish bandwidth limits for it. Battle traffic is small JSON, so it's plenty for a campus game. If you ever
want a URL under your own domain, a named Cloudflare Tunnel works the same way
(`cloudflared` → `localhost:17175`). For a no-account throwaway test there's also
`cloudflared tunnel --url http://localhost:17175`, which prints a temporary
`*.trycloudflare.com` URL.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve forge:forge-headless:2.0.14-SNAPSHOT` | Run step 2 (it installs into `~/.m2`). |
| `Forge resource dir not found` | Run from `battle-engine/` with `forge-engine/` next to it, or pass `-Dforge.res.dir=...`. |
| `error: patch failed` in setup-forge | The checkout has CRLF line endings; delete `forge-engine/` and re-run the script (it pins `core.eol=lf`). |
| `Filename too long` while cloning | Windows path limit; the script already sets `core.longpaths` and a sparse checkout; keep the repo path short. |
| Every call returns 401 | Token not from this project, expired, or the engine could not reach `SUPABASE_URL` for JWKS at startup (check the `Loaded N JWKS keys` line). |
| Browser: CORS error | Add the exact page origin to `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` and restart. |
| Funnel URL times out / 502 | Engine not running on `localhost:17175` (step 4), Funnel off (`tailscale funnel status`), or Tailscale logged out. First-time certificate issuance can take a few minutes. |
| Works on campus Wi-Fi, not outside | You tested the `100.x` tailnet IP or the machine name; use the full `https://….ts.net` Funnel URL. |
| "Deck not valid" when starting a match | `validate_deck` rejected it (not owned, too many copies, < 60 cards...). The message names the first problem. |
| Battle tab missing | `VITE_BATTLE_ENGINE_URL` was empty at build time. It is baked into the bundle; rebuild after changing it. |
