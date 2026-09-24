# AGENTS.md

Campus Forge: a campus-wide collectible MTG game. **Current stack: Supabase is the backend** (Postgres + RLS + RPC + Auth + Storage + Edge Functions + Realtime); the **Vite/React PWA on GitHub Pages** is the client and talks to Supabase directly; a standalone **`battle-engine/`** Spring Boot service wraps the Forge headless rules engine. `backend/` (Spring Boot + Flyway) is the **legacy** pre-Supabase server — reference only, don't extend.

## Layout
- `web-client/` — Vite + React 18 + TS PWA; `src/api/*` is the only layer that talks to Supabase. Deployed to GitHub Pages under `/TheFury/`.
- `supabase/` — `migrations/*.sql` (schema source of truth), `functions/` (Edge Functions), `seed.sql`, `SQL_EDITOR_SETUP.sql` (consolidated paste for a fresh hosted project).
- `battle-engine/` — Spring Boot 3.3 service (port **17175**) embedding `forge-engine/forge-headless`. In-memory match state, no DB; validates Supabase JWTs; writes results via a service-role RPC. Not part of the Pages build. Run env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `CAMPUSFORGE_CORS_ALLOWED_ORIGINS`.
- `admin-console/` — Vite admin app, rewritten to Supabase, **not deployed** (use the Supabase dashboard instead).
- `forge-engine/` — full Forge fork (its own git repo). `forge-headless` is what battle-engine embeds.
- `backend/`, `docker/`, `setup/`, root `restart-*.ps1` / `start-backend.cmd`, `web-client/serve.mjs` + `scripts/*.cjs` — **legacy** (target the pre-Supabase backend).
- Docs: `THEPLAN.md` (architecture bible), `STEPS/supabase-migration-map.md` (migration mapping), `TECHNICAL.md` (describes the legacy backend).

## Commands
- Node is on PATH (v20). **Maven is NOT** — use `C:\Users\student\AppData\Local\Temp\opencode\apache-maven-3.9.9\bin\mvn.cmd` (prepend to `$env:Path`) and run from the module dir.
- web-client (from `web-client/`): `npm run lint` = `tsc --noEmit` (there is no ESLint); `npm test` = `vitest run`; `npm run build` = `tsc -b && vite build`.
- **After editing frontend code run `npm run lint` AND `npm test`; also run `npm run build` when serving `dist/` — Deno `serve.mjs` / e2e read `dist/`, not `src/`.**
- Pages build: `BASE_PATH=/TheFury/ npm run build` (Vite `base` = `BASE_PATH` env, default `/`).
- Focused test: `npm test -- src/pages/LoginPage.test.tsx` (or `-t "<name>"`).
- battle-engine build order matters: build forge first (`mvn -pl forge-headless -am install -DskipTests` in `forge-engine/`), then `mvn clean package -DskipTests` in `battle-engine/`.

## Supabase
- Hosted project ref `prjsiywvhxqnsvsmfgxm` (URL + publishable key in `web-client/.env.development`; **public by design**). Root `.env` (gitignored) holds the service-role key.
- **Schema changes = a new file in `supabase/migrations/`; never hand-edit schema via the dashboard.** Migrations 00–10 use plain `CREATE` (not safe to re-run wholesale); 11–12 are idempotent.
- **The hosted DB has no `supabase_migrations` table** (it was provisioned by pasting `SQL_EDITOR_SETUP.sql`), so **`supabase db push` is unusable**. Apply DDL to hosted via the Management API `POST https://api.supabase.com/v1/projects/{ref}/database/query` (PAT auth; accepts multi-statement + `do $$` bodies) or the SQL Editor.
- Edge Functions `claim`, `qr-catalog`, `admin-spawn` (+ `_shared/qr.ts`): deploy with `SUPABASE_ACCESS_TOKEN=… supabase functions deploy <name> --project-ref <ref>`. The CLI bundles `_shared/` itself and does **not** need Docker. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected; `QR_SIGNING_SECRET` is a project secret.
- Auth: email/password, `mailer_autoconfirm` on (no email confirmation). `profiles` is 1:1 with `auth.users` via the `handle_new_user` trigger.
- Card art: public Storage bucket `card-art` (`{slug}.jpg`); `src/lib/scryfall.tsx` returns the storage URL when `VITE_SUPABASE_URL` is set, else local `/card-art/`.

## Frontend / Pages gotchas
- **The router basename must come from Vite's base** (`main.tsx`: `import.meta.env.BASE_URL`). Omit it and the Pages subpath renders a blank page with no console error.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BATTLE_ENGINE_URL`. An **empty** `VITE_BATTLE_ENGINE_URL` → `battleEngineConfigured()` false → Battle tab/route hidden (this is the Pages build).
- `src/api/*` is the only Supabase layer: `supabaseClient.ts` (client + `callEdgeFunction`), `endpoints.ts` (PostgREST/RPC), `tradeEndpoints.ts`, `qrEndpoints.ts`, `feedRealtime.ts`. Keep their exported signatures stable — tests `vi.mock` these modules.
- `src/lib/idb.ts` no-ops when IndexedDB is absent, so jsdom needs no IDB mock. Keep `jsdom` pinned `^25` with `vitest ^0.34`.
- Pages deploy = `.github/workflows/deploy-web.yml` (lint+test+build, copies `index.html`→`404.html` for deep links). Settings → Pages **Source must be "GitHub Actions"**, and the `github-pages` environment branch policy must allow `main`. Live: https://igdaiiitd.github.io/TheFury/.

## Domain invariants (now single-sourced in SQL/EF — don't duplicate)
- Level: Postgres `compute_level(xp)` (`level = 1 + xp/100`) is the only formula.
- Cohorts: `is_cohort_valid()` / `department_of()` mirror `common/Cohort.java` (B.Tech CSE/CSAI/CSAM/CSB/CSSS/CSD/CSECON/ECE/EVE; M.Tech CSE/ECE).
- QR tokens: signed `V1.<CORE>.<SIG>` (HMAC-SHA256, constant-time); forged/tampered → **400 before any DB lookup**; legacy bare cores resolve via `claims.token_core`. Implemented in `supabase/functions/_shared/qr.ts`.
- Trades: `accept_trade` RPC locks the trade row + all `unique_cards` in **sorted-UUID order**, re-verifies ownership, swaps owners, appends to `unique_cards.history`; 24h TTL → 410 on expired.
- Admin = `profiles.role = 'ADMIN'` (RLS policies + EF gates).
- Forge never touches Postgres; battle-engine keeps match state in memory only.

## Battle UI (frontend, unchanged)
- `src/pages/battleUi.ts` is the pure, tested logic layer. Instant-speed spells are demoted outside `COMBAT_*` phases; the ActionBar confirm row appears only when ≥1 card is selected. `CostPartMana.canPay()` always returns true (engine TODO; real filtering is in `HumanPlayerController.getPlayableSAs()`).
