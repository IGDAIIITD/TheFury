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

## 6. Production: battles on the GitHub Pages site

GitHub Pages is HTTPS, so browsers will only talk to an **HTTPS/WSS** engine
(mixed content is blocked). The engine itself speaks plain HTTP; put TLS in front:

**Option A: Cloudflare Tunnel (no open ports, free).** On the machine running the jar:

```bash
cloudflared tunnel login
cloudflared tunnel create campusforge-battle
cloudflared tunnel route dns campusforge-battle battle.<your-domain>
cloudflared tunnel run --url http://localhost:17175 campusforge-battle
```

For a quick test without a domain, `cloudflared tunnel --url http://localhost:17175`
prints a temporary `https://<random>.trycloudflare.com` URL (it changes every run).
WebSockets pass through tunnels with no extra config.

**Option B: a VM with a reverse proxy** (Caddy/nginx) terminating TLS and proxying
`/api/` and `/ws/` (with `Upgrade`/`Connection` headers) to `localhost:17175`.

Then:

1. Start the engine with `CAMPUSFORGE_CORS_ALLOWED_ORIGINS=https://igdaiiitd.github.io`.
2. In `.github/workflows/deploy-web.yml`, set `VITE_BATTLE_ENGINE_URL` to the HTTPS
   origin (e.g. `https://battle.<your-domain>`) and push to `main`. The Battle tab
   appears once the new build is live.
3. Keep the engine running (Windows: NSSM or Task Scheduler "at startup"; Linux:
   a systemd unit with `Restart=always`). One JVM with `-Xmx1g` comfortably hosts a
   few dozen concurrent matches.

## 7. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve forge:forge-headless:2.0.14-SNAPSHOT` | Run step 2 (it installs into `~/.m2`). |
| `Forge resource dir not found` | Run from `battle-engine/` with `forge-engine/` next to it, or pass `-Dforge.res.dir=...`. |
| `error: patch failed` in setup-forge | The checkout has CRLF line endings; delete `forge-engine/` and re-run the script (it pins `core.eol=lf`). |
| `Filename too long` while cloning | Windows path limit; the script already sets `core.longpaths` and a sparse checkout; keep the repo path short. |
| Every call returns 401 | Token not from this project, expired, or the engine could not reach `SUPABASE_URL` for JWKS at startup (check the `Loaded N JWKS keys` line). |
| Browser: CORS error | Add the exact page origin to `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` and restart. |
| "Deck not valid" when starting a match | `validate_deck` rejected it (not owned, too many copies, < 60 cards...). The message names the first problem. |
| Battle tab missing | `VITE_BATTLE_ENGINE_URL` was empty at build time. It is baked into the bundle; rebuild after changing it. |
