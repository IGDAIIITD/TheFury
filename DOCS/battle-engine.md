# Battle engine

`battle-engine/`: a Spring Boot 3.3 service (default port **17175**) that runs real Magic: The Gathering rules
by embedding the [Forge](https://github.com/Card-Forge/forge) engine headlessly.

- **Live games are in memory.** The database holds decks, match rows and results; a restart drops games in
  progress.
- **Auth:** every REST call and every STOMP `CONNECT` carries the player's Supabase access token, verified
  against the project's JWKS (`/auth/v1/.well-known/jwks.json`, refreshed when an unknown key id shows up).
- **Writes** use the service-role key: insert and claim `matches` rows, `validate_deck` at match start, and
  `record_match_result` at the end.

## Build

### 1. Forge (once, and whenever `battle-engine/forge/` changes)

The engine depends on `forge:forge-headless:2.0.14-SNAPSHOT`, installed into the **repo-local Maven repository
`battle-engine/.m2`** (gitignored). The scripts pass `-Dmaven.repo.local` and `battle-engine/.mvn/maven.config`
sets it for plain `mvn` runs from `battle-engine/`, so builds work the same under any Windows account (an
elevated prompt often runs as a different user with a different `~/.m2`). It is built from upstream
Forge pinned to commit `fd8196a8`, plus:

- `battle-engine/forge/forge-headless/`: the headless driver (`HeadlessMatch`, which sets the 20-life start, remote/human player
  controllers, game-state serializer, bootstrap);
- `battle-engine/forge/campusforge-forge.patch`: trims the Maven reactor to core/game/ai/headless, adds
  `GameRules.startingPlayerChooserIndex` (the lobby host picks play/draw), a `ForgeDebug` trace switch
  (`-Dforge.debug.traces=true`) and a Cudgel Troll fix.

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/setup-forge.ps1 -Mvn "C:\path\to\mvn.cmd"
```

The script clones Forge into `<repo>/forge-engine` (blobless + sparse, ~5 min the first time, gitignored),
applies the patch, copies `forge-headless` in and runs `mvn -pl forge-headless -am install -DskipTests`. It is
idempotent. **Never edit `forge-engine/` directly**: change `battle-engine/forge/` and re-run the script.
Pass `-SkipBuild` to only prepare the checkout.

On macOS/Linux, the same steps by hand:

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

### 2. The engine

```powershell
cd battle-engine
mvn clean package          # runs the unit tests → target/campusforge-battle-engine-0.0.1-SNAPSHOT.jar
```

## Configuration

| Env var | Required | Value |
| --- | --- | --- |
| `SUPABASE_URL` | yes | `https://prjsiywvhxqnsvsmfgxm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service-role key. **Server only.** The scripts read it from the repo-root `.env`. |
| `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` | prod | comma-separated origins (no path), e.g. `https://igdaiiitd.github.io,http://localhost:17170`. `run-engine.ps1` sets this by default. |
| `SUPABASE_JWT_SECRET` | no | only for projects still signing with the legacy HS256 secret. Leave unset: then only JWKS-signed tokens are accepted. |
| `BATTLE_AI_BATTLES_ENABLED` | no | `true` enables "vs AI" matches. Default `false`. |

JVM flags: `-Dforge.res.dir=<path>/forge-gui/res` if the card database isn't at
`../forge-engine/forge-gui/res` relative to the working directory; `-Dforge.debug.traces=true` for verbose
engine logs.

## Run locally

```powershell
powershell -ExecutionPolicy Bypass -File battle-engine/run-engine.ps1   # reads ../.env; -Port to change 17175
```

A healthy start logs `Loaded 1 JWKS keys`, `Forge engine ready in ~3500 ms` and `Started BattleEngineApplication`.
`GET http://localhost:17175/api/v1/battle/features` returns 200, and every other route returns 401 without a
token. Then `npm run dev` in `web-client/`: `.env.development` points the app at `http://localhost:17175`.

## API

### REST (`/api/v1/battle`, JSON, `Authorization: Bearer <access token>`)

| Method & path | Body | Returns |
| --- | --- | --- |
| `GET /features` (no auth) | — | `{ "aiBattlesEnabled": false }`; also the health probe |
| `POST /lobby` | `{ deckId, eventId? }` | `MatchDto` with `battleCode` (status `PENDING`) |
| `POST /join` | `{ code, deckId }` | `MatchDto` (status `ACTIVE`); the game starts |
| `POST /create` | `{ deckId, opponentPlayerId?, opponentDeckId?, eventId? }` | `MatchDto`; with no opponent = vs AI (if enabled) |
| `GET /matches` | — | the caller's matches |
| `GET /matches/{id}` | — | `MatchDto` |
| `GET /matches/{id}/state` | — | the caller's view of the live game, or a terminal summary |
| `POST /matches/{id}/concede` | — | 204 |

`MatchDto`: `{ id, player1Id, player2Id, deck1Id, deck2Id, status, winnerId, winCondition, battleCode, eventId,
createdAt }`, where `status` is one of `PENDING | ACTIVE | COMPLETED | CONCEDED`.

Errors: `{ "code", "message" }` with **400** (bad input, invalid deck, own lobby, unknown code), **401** (no or
invalid token), **404** (unknown match or path), **409** (lobby no longer open), **500** (unexpected; logged).

### Live game (STOMP over native WebSocket)

- Connect: `wss://<engine>/ws/match`, sub-protocol `v12.stomp`, `CONNECT` header
  `Authorization: Bearer <access token>` (rejected with an `ERROR` frame otherwise).
- Subscribe: `/topic/match/{matchId}/p{seat}` (seat 0 = player 1, 1 = player 2). Messages are either
  `{ "type": "info", "message": "..." }` or a full state (typed as `MatchState` in
  `web-client/src/api/battleTypes.ts`):
  `{ matchId, player1Id, player2Id, turn, phase, activePlayerIndex,
  players: [{ index, name, life, hasPriority, hasLost, handSize, librarySize, hand, battlefield, graveyard, mana }],
  stack, pendingChoice: { requestId, type, prompt, cancellable, minCount, maxCount, options: [{ label, value }] },
  gameOver, status, winnerName, winnerId, winCondition }`. Your own `hand` has the cards; the opponent's only
  has `handSize`.
- Act: send to `/app/match/{matchId}/action`:
  `{ "actionType": "CHOICE", "payload": { "requestId": 12, "selectedIndices": [0] } }`.

### Match lifecycle

1. **Lobby:** the deck is validated (`validate_deck`, including event rules), a `WAITING` row is inserted,
   and a 6-character code is generated (same alphabet as QR cores).
2. **Join:** the joiner's deck is validated, then the row is claimed with a **conditional update**
   (`… WHERE status = 'WAITING'`), so only one joiner can win a race. A repeated join by the player who already
   joined returns the running match instead of an error. Both decks are converted and the Forge game starts.
3. **Play:** Forge runs on its own thread; each seat gets its own view of the state.
4. **End:** game over → `record_match_result` (winner +50 XP × event bonus, `game_log` rows for both players).
   A concede, or a disconnect longer than **60 s**, gives the opponent the win (then the row is marked `CONCEDED`).

## Hosting

### Why a tunnel

The host PC's fixed address (`192.168.194.106`) is a private campus address behind a shared NAT
(`103.25.231.106`), so nothing on the internet can reach it directly. The web app is HTTPS, so it also can't
call a plain `http://` engine. A **Cloudflare quick tunnel** solves both without an account or a domain:
`cloudflared` connects **outbound** (TCP 7844, open on this network), and Cloudflare serves
`https://<random-words>.trycloudflare.com` with a valid certificate, forwarding HTTP and WebSockets to
`localhost:17175`.

The URL changes every time the tunnel starts, so the site doesn't bake it in. `start-public.ps1` publishes it
to Supabase `app_config.battle_engine_url`, and the PWA discovers it at runtime
([frontend.md](frontend.md#how-the-battle-tab-finds-the-engine)).

### Scripts

| Script | Purpose |
| --- | --- |
| `setup-forge.ps1` | build Forge + `forge-headless` (see Build) |
| `run-engine.ps1 [-Port 17175]` | run the jar with `.env` settings and default CORS (Pages + localhost) |
| `start-public.ps1` | engine + quick tunnel; publishes the URL, watches both, clears the URL on exit |
| `battle-server.ps1 <action>` | run all of the above as a **Windows service** (scheduled task) |

### Run it as a service (production)

Install `cloudflared` once (`choco install cloudflared -y`), build (see above), then in an
**Administrator** PowerShell:

```powershell
cd "C:\Users\student\Desktop\thingamamagicthegathering\2026-08-02 mtgoffline"
powershell -ExecutionPolicy Bypass -File battle-engine\battle-server.ps1 install
```

`install` checks the prerequisites (java, cloudflared, jar, Forge card data, `.env`), stops anything running,
registers the **CampusForge Battles** scheduled task (runs as SYSTEM **at boot**, no login needed), disables
sleep on AC power, starts it and waits for `Battles are LIVE at https://….trycloudflare.com`. The task runs a
supervisor loop: if the engine or tunnel dies, the URL is cleared (the Battle tab hides) and both come back
on a fresh URL about 2 minutes later.

| `battle-server.ps1 …` | What it does |
| --- | --- |
| `status` | task, processes, published URL and whether it answers (full detail needs an admin shell) |
| `logs` | tail of `battle-engine/logs/{supervisor,start-public,engine,cloudflared}.log` |
| `update` | stop → `mvn clean package` (tests) → start. **Use this to deploy engine code changes.** |
| `restart` / `stop` / `start` | stop clears the URL and kills the whole process tree; the service starts again at boot |
| `uninstall` | stop and remove the task |

Processes started from an interactive or agent shell die with that shell. Use the service for anything
long-running.

### Limits and alternatives

- Quick tunnels are a Cloudflare testing feature: no uptime guarantee and ~200 in-flight requests. That's fine
  for a campus game. Each restart means a new URL (handled automatically) and drops games in progress.
- For a permanent URL: a **named Cloudflare Tunnel** (needs a domain on Cloudflare) or **Tailscale Funnel**
  (`https://<machine>.<tailnet>.ts.net`; the Tailscale login didn't work on the lab PC). With a fixed URL,
  either set `VITE_BATTLE_ENGINE_URL` in `deploy-web.yml` or run
  `update public.app_config set value = '<url>' where key = 'battle_engine_url';`, with no rebuild needed.

## Tests

```powershell
cd battle-engine; mvn test
```

`SupabaseJwtTest` covers forged, foreign-secret and expired tokens. `GlobalExceptionHandlerTest` checks that
framework errors keep their 4xx status. `MatchManagerJoinTest` covers the join race and idempotency.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Could not resolve forge:forge-headless:2.0.14-SNAPSHOT` | Run `setup-forge.ps1` (it installs into `battle-engine/.m2`). If you build with plain `mvn`, run it from `battle-engine/` so `.mvn/maven.config` applies. |
| `update` stopped with `taskkill … not found` | Fixed in the current script (a child process exiting with its parent is expected); pull and re-run. |
| `Forge resource dir not found` | Run from `battle-engine/` with `forge-engine/` next to it, or pass `-Dforge.res.dir=...`. |
| `error: patch failed` in setup-forge | The checkout has CRLF endings; delete `forge-engine/` and re-run (the script pins `core.eol=lf`). |
| `Filename too long` while cloning | Windows path limit; the script sets `core.longpaths` and a sparse checkout. Keep the repo path short. |
| `mvn clean` fails: "Failed to delete …jar" | The engine is running and locks the jar. Use `battle-server.ps1 update`. |
| Every call returns 401 | Expired or foreign token, or the engine couldn't fetch JWKS at startup (look for `Loaded N JWKS keys`). |
| Browser: CORS error | Add the exact page origin to `CAMPUSFORGE_CORS_ALLOWED_ORIGINS` and restart. |
| Battle tab never appears | `battle-server.ps1 status` / `logs`. The tab only shows when `app_config.battle_engine_url` answers `/api/v1/battle/features`. |
| cloudflared: "failed to request quick Tunnel" | Cloudflare rate-limits quick tunnels; wait a minute. The supervisor retries on its own. |
| "Deck is invalid for battle: …" | `validate_deck` rejected the deck; the message names the first problem. |
| 409 "Battle is no longer open" | Someone else already joined that lobby, or it's finished. Create a new lobby. |
