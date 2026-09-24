# Testing and CI

| Suite | Where | Command | What it covers |
| --- | --- | --- | --- |
| Frontend | `web-client/` | `npm run lint` · `npm test` | TypeScript types; vitest + Testing Library for every page, the battle logic (`battleUi.ts`), engine discovery, the offline cache |
| Database | `supabase/tests/` | `npm ci && npm test` | every migration + seed applied to PGlite; RLS, privileges, game RPCs, starter pack, `app_config`; the bootstrap file is up to date |
| Edge Functions | `supabase/functions/` | `deno test --allow-env supabase/functions/_shared/qr.test.ts` · `deno check …` | QR sign/verify, forged tokens, fail-closed secret, parity with SQL `card_print_core` |
| Battle engine | `battle-engine/` | `mvn test` | JWT verification, error status mapping, lobby join race + idempotency |

## Database tests without Docker

`supabase/tests` runs Postgres **in WebAssembly** ([PGlite](https://pglite.dev)) with a small shim
(`shim.sql`) that recreates what the migrations expect from Supabase: the `anon` / `authenticated` /
`service_role` roles, `auth.users`, `auth.uid()`, the default grants (so privilege bugs reproduce), the
`storage` schema and the `supabase_realtime` publication.

`harness.mjs` boots a database with all migrations + seed and offers:

- `signUp(db, email, meta)`: inserts into `auth.users`, firing the real signup trigger;
- `as(db, role, uid, sql, params)`: runs SQL as that role with `auth.uid() = uid`, inside a transaction.

`schema.test.mjs` holds the checks (90+), grouped by area (including the imported M19 set). `setup-file.test.mjs` checks that
`SQL_EDITOR_SETUP.sql` equals the generated migrations + seed and bootstraps a working project on its own.

**When you add a migration:** add checks to `schema.test.mjs`, run `npm test`, then `npm run build:setup-sql`
and commit the regenerated `SQL_EDITOR_SETUP.sql`.

## CI

| Workflow | Trigger | Jobs |
| --- | --- | --- |
| `deploy-web.yml` | push to `main` | web-client lint, test, build, deploy to Pages |
| `supabase-tests.yml` | changes under `supabase/**` (push to `main` / PRs) | PGlite schema suite; Deno tests + type checks |

The battle engine isn't built in CI (it needs the Forge build); run `mvn test` locally, or rely on
`battle-server.ps1 update`, which runs the tests before deploying.

## Manual end-to-end check

1. Two accounts (two browsers): both have the Red-Green Starter deck.
2. Scan a printed code (or `claim` via curl) → XP, collection and feed update.
3. Trade: offer a unique card → the other side sees it live → accept → the owners swap.
4. Battle: create lobby → join by code → play to the end → the winner gets +50 XP; `game_log` has MATCH rows.
