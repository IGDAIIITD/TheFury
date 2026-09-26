# Edge Functions

Deno functions in `supabase/functions/`, served at `https://prjsiywvhxqnsvsmfgxm.supabase.co/functions/v1/<name>`.
They exist for work that needs a secret: signing and verifying QR tokens, and calling service-role-only
database functions.

| Function | Who calls it | Purpose |
| --- | --- | --- |
| `claim` | the PWA Scan page | redeem a QR token |
| `qr-catalog` | admins | export the printable QR catalog |
| `admin-spawn` | admins (admin console) | mint new QR tokens for a card |

Shared code: `_shared/qr.ts` (token alphabet, deterministic cores, HMAC sign/verify, `signingSecret()`) and
`_shared/http.ts` (CORS + JSON helpers).

## Common behaviour

- **Auth:** `Authorization: Bearer <user access token>` (plus the `apikey` header). The function verifies the
  user with the service-role client. Missing or invalid tokens get **401**.
- **CORS:** every response, including errors, carries `Access-Control-Allow-Origin: *`. Use the
  `_shared/http.ts` helpers (`json`, `errorJson`, `text`, `preflight`) for every response, or browsers on
  GitHub Pages will drop it.
- **Errors:** `{ "status": <code>, "message": "..." }`. Database errors raised as `CF4xx` map to that HTTP status.
- **Secret:** `QR_SIGNING_SECRET` (project secret, ≥ 32 characters) is required. There is no fallback, and the
  functions return **500** if it's missing. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
  automatically.

## `claim`

`POST /functions/v1/claim` with body `{ "token": "V1.<CORE>.<SIG>" }` (the exact QR text) or a 12-character code
typed by hand.

1. Verify the user; rate limit (token bucket per user: burst 30, 2/s; per instance, best-effort).
2. Signed token → HMAC-SHA256 verification (constant time) **before any database access**; tampered → 400.
   Unsigned code → accepted **only** if it belongs to an admin-spawned claim (printed cores are derivable from
   public card ids, so they must be signed). Otherwise 400.
3. `rpc apply_claim(core, player)` with the service role.

| Status | Meaning |
| --- | --- |
| 200 | `{ card, unlocked, alreadyOwned, reason, copiesOwned, maxCopies, discoveryCount, experienceAwarded, token, building, physicalUuid }`. `reason` is set when nothing new was granted: `SAME_CODE` (you already used this code), `MAX_COPIES` (you have 4) or `UNLIMITED` |
| 400 | missing, forged or unknown-unsigned token |
| 401 | not signed in |
| 403 | account banned |
| 404 | token not found |
| 409 | unique card already claimed, or you already own a copy of that unique card (the code isn't used up) |
| 410 | token expired or revoked |
| 429 | rate limited (`Retry-After` header) |

## `student-auth` (public)

`POST /functions/v1/student-auth`, no session needed (deployed with `--no-verify-jwt`; see
`supabase/config.toml`). Powers the roll-number login.

```json
{ "action": "check", "rollNo": "2026001", "firstName": "Aadi" }
{ "action": "register", "rollNo": "2026001", "firstName": "Aadi", "password": "at least 8 chars" }
```

- `check` → **200** `{ status: "NEW" | "REGISTERED", rollNo, name, program, degreeLevel, batch }`.
- `register` → **201** `{ email }`; the client then signs in with that email and the password. The account is
  created through the admin API with `app_metadata.roll_no` (which public sign-ups can't set), and
  `handle_new_user` fills the profile from the roster.
- Errors: 400 bad roll / short password, **403** first name doesn't match, **404** roll not in the roster,
  **409** roll already registered, 429 more than 20 attempts a minute from one IP (best effort).

Uses `student_roll_status()` (service role only); the roster is never exposed to the browser.

## `qr-catalog` (admin)

- `GET /functions/v1/qr-catalog` → one entry per card, sorted by name:
  ```json
  [{ "cardName": "Grizzly Bears", "qrContent": "V1.NBS8FE8VTBAA.9F3C…" }]
  ```
  `qrContent` is exactly what to encode in the QR image.
- `?copies=N` (1–4, default 1): **N distinct codes for every UNLOCK card**, since a player gets one copy per
  different code. Entries then include `"copy": 1..N`. UNLIMITED and UNIQUE cards always get one code.
- `GET /functions/v1/qr-catalog?format=csv` → `cardName,copy,qrContent,tokenCore,ownershipType,rarity,oracleId`.
- `POST /functions/v1/qr-catalog/regenerate` (accepts `?copies`) → make sure a claim row exists for every
  code → `{ "codes": n }`.

Tokens are **deterministic** (core = f(card id, copy), signed with the project secret), so exporting again always
gives the same codes, and new cards simply appear. Copy 1 is the original single code per card (identical to
SQL `card_print_core`). 400 for a bad `copies`, 401/403 for non-admins.

## `admin-spawn` (admin)

`POST /functions/v1/admin-spawn`

```json
{ "cardId": "<uuid>", "quantity": 5, "building": "Library", "expiresAt": "2026-10-01T18:00:00Z", "eventId": "<uuid>" }
```

`quantity` is 1–100 (default 1); `building`, `expiresAt` (must be in the future) and `eventId` are optional.
Each token gets a random 12-character core (rejection-sampled, no bias) and is signed. The call writes a SPAWN
entry to the feed and to `game_log`. Response: **201** with the created claims, including the signed `token`
(the QR text) and the 12-character core, which players can type in manually.

## Developing and deploying

```powershell
deno test --allow-env supabase/functions/_shared/qr.test.ts      # sign/verify + parity with SQL card_print_core
deno check supabase/functions/claim/index.ts supabase/functions/qr-catalog/index.ts supabase/functions/admin-spawn/index.ts supabase/functions/student-auth/index.ts

# deploy (needs SUPABASE_ACCESS_TOKEN; no Docker)
supabase functions deploy claim qr-catalog admin-spawn --project-ref prjsiywvhxqnsvsmfgxm --use-api
supabase functions deploy student-auth --no-verify-jwt --project-ref prjsiywvhxqnsvsmfgxm --use-api
```

Set or rotate the secret in the dashboard (Edge Functions → Secrets) or with
`supabase secrets set QR_SIGNING_SECRET=<value> --project-ref prjsiywvhxqnsvsmfgxm`. **Rotating it invalidates
every printed and spawned QR code.**

Quick check after a deploy: `POST` without a token must return **401 with an `Access-Control-Allow-Origin`
header**. A 500 means the secret is missing or too short.
