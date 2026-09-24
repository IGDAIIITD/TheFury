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

## 6. Production: battles on the GitHub Pages site (Cloudflare Tunnel)

### Why a tunnel, not this PC's "static IP"

This PC's fixed address, `192.168.194.106`, is a **private campus LAN address**. The
internet sees it as `103.25.231.106`, the campus NAT address shared with other
machines. Nothing off campus can reach port 17175 unless campus IT forwards a port on
their NAT. Even then, the Pages site is HTTPS, so browsers refuse a plain `http://`
engine (mixed content). A Cloudflare Tunnel solves both: `cloudflared` makes an
**outbound** connection to Cloudflare, which serves `https://battle.<your-domain>` with
a valid certificate and forwards requests and WebSockets to `localhost:17175`. It needs
no open ports or firewall changes. Outbound TCP 7844 to Cloudflare, which the tunnel
uses, was tested and is open from this network.

You need a free Cloudflare account and **a domain whose DNS is on Cloudflare**. Any
cheap domain works (Cloudflare Registrar sells them at cost), or a subdomain your
department delegates to Cloudflare. No domain yet? Step 3 gives a temporary URL for testing.

### Step 1: install cloudflared

```powershell
winget install --id Cloudflare.cloudflared
```

Open a **new** terminal, then run `cloudflared --version`.

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

### Step 3 (optional): 2-minute smoke test, no domain needed

```powershell
cloudflared tunnel --url http://localhost:17175
```

It prints `https://<random-words>.trycloudflare.com`. Then
`curl.exe -i https://<random-words>.trycloudflare.com/api/v1/battle/matches` should
return `401` through the tunnel. The URL changes every run, so use this only for
testing (e.g. `VITE_BATTLE_ENGINE_URL=https://<random>.trycloudflare.com npm run dev`
in `web-client/`). Stop it with Ctrl+C.

### Step 4: create the permanent tunnel (Cloudflare dashboard)

1. https://dash.cloudflare.com → your account → **Zero Trust** (first visit: pick a
   team name and the **Free** plan) → **Networks → Tunnels** →
   **Create a tunnel**.
2. Connector type **Cloudflared** → name it `campusforge-battle` → **Save tunnel**.
3. Choose environment **Windows**. Copy the command shown under "Install and run a
   connector"; it looks like `cloudflared.exe service install eyJhIjoi...`.
   Run it in an **Administrator** PowerShell. This installs cloudflared as a Windows
   service that starts on boot and reconnects by itself. The token is a secret:
   don't commit or share it.
4. Back in the dashboard the connector shows **Healthy** → **Next**.
5. **Public hostname**: Subdomain `battle`, Domain `<your-domain>`, Path empty.
   **Service**: Type `HTTP`, URL `localhost:17175`. **Save**. Cloudflare creates the
   DNS record and the HTTPS certificate automatically, and WebSockets need no extra setting.
6. Verify from any network (e.g. your phone on mobile data):
   `https://battle.<your-domain>/api/v1/battle/matches` → `401`.

### Step 5: keep the engine running across reboots

cloudflared is already a service (step 4.3). For the engine, run this in an
**Administrator** PowerShell:

```powershell
schtasks /Create /TN "CampusForge Battle Engine" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"C:\Users\student\Desktop\thingamamagicthegathering\2026-08-02 mtgoffline\battle-engine\run-engine.ps1\""
schtasks /Run /TN "CampusForge Battle Engine"
```

Also stop the PC from sleeping: `powercfg /change standby-timeout-ac 0`.
If the repo moves, recreate the task with the new path. To stop the engine:
`schtasks /End /TN "CampusForge Battle Engine"`.

### Step 6: point the website at the engine

In `.github/workflows/deploy-web.yml` set

```yaml
          VITE_BATTLE_ENGINE_URL: 'https://battle.<your-domain>'
```

then commit and push to `main`. Once the Pages deploy finishes, the Battle tab appears on
https://igdaiiitd.github.io/TheFury/. The URL is baked in at build time; changing
it means another push.

### Step 7: end-to-end check

Register two accounts (two browsers, or phone + laptop). Each already has the
**Red-Green Starter** deck. Player A: Battle → create lobby → share the code.
Player B: join with the code. When the game ends, the winner gets 50 XP, a
`game_log` MATCH row is written for each player, and the match shows in both profiles.

**Other hosting options:** a cloud VM (Oracle Cloud's Always Free tier, or a campus
server with a public IP) running the same jar behind Caddy for automatic HTTPS, with
a reverse proxy for `/api/` and `/ws/`. Or ask campus IT to forward TCP 443 on
`103.25.231.106` to this PC and run a TLS proxy here. Both take more upkeep than the
tunnel.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve forge:forge-headless:2.0.14-SNAPSHOT` | Run step 2 (it installs into `~/.m2`). |
| `Forge resource dir not found` | Run from `battle-engine/` with `forge-engine/` next to it, or pass `-Dforge.res.dir=...`. |
| `error: patch failed` in setup-forge | The checkout has CRLF line endings; delete `forge-engine/` and re-run the script (it pins `core.eol=lf`). |
| `Filename too long` while cloning | Windows path limit; the script already sets `core.longpaths` and a sparse checkout; keep the repo path short. |
| Every call returns 401 | Token not from this project, expired, or the engine could not reach `SUPABASE_URL` for JWKS at startup (check the `Loaded N JWKS keys` line). |
| Browser: CORS error | Add the exact page origin to `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` and restart. |
| Tunnel hostname returns 502 / error 1033 | The engine is not running on `localhost:17175` (step 5), or the connector is down (Zero Trust → Tunnels shows its status). |
| "Deck not valid" when starting a match | `validate_deck` rejected it (not owned, too many copies, < 60 cards...). The message names the first problem. |
| Battle tab missing | `VITE_BATTLE_ENGINE_URL` was empty at build time. It is baked into the bundle; rebuild after changing it. |
