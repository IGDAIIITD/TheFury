# Security model

## Trust boundaries

| Actor | Holds | Trusted to |
| --- | --- | --- |
| Browser (anyone) | publishable key; a user access token after sign-in | nothing. Every request is checked by RLS or a definer function |
| Edge Functions | service-role key, `QR_SIGNING_SECRET` | verify QR signatures, apply claims, mint tokens (admin-gated) |
| Battle engine | service-role key | record matches it actually ran; validates user tokens via JWKS |
| Admins | `profiles.role = 'ADMIN'` | catalog, events, claims, players |

The publishable key and Supabase URL are public by design. **The service-role key bypasses RLS**: it lives only
in the gitignored `.env`, the engine's environment, and Supabase itself.

## Controls

**Row-level security on every table.** Players read their own rows plus public data (catalog, events, formats,
`app_config`). The feed requires sign-in. Players directly write only their profile presentation fields,
decks, deck cards and favorites. Unlocks, discoveries, achievements, trades, trade cards, matches, claims and
`game_log` have no player write policies.

**Deny-by-default function privileges.** Supabase grants `EXECUTE` on new public functions to `anon` and
`authenticated` directly, so `revoke … from public` alone doesn't protect anything. Migration 13 revokes
everything and allow-lists only the client RPC surface (listed in [database.md](database.md#functions)).
New functions must declare their grants explicitly. Before this, `apply_claim` and `record_match_result` were
callable with the public key.

**Actor from the token, never a parameter.** Client RPCs use `auth.uid()` and reject NULL.
`my_profile_stats(p)` refuses other players (it returns email) unless the caller is an admin.

**Profile guard.** A trigger blocks players from changing `role`, `experience`, `banned`, `email` and similar
fields; `level` is always derived from XP.

**Game invariants in the database.** Claims lock the claim row; trades lock the trade and all involved cards in
sorted-UUID order (no deadlocks) and re-check ownership; match results are idempotent and the winner must be a
participant; battle lobbies are claimed with a conditional update (one winner).

**QR tokens.** HMAC-SHA256 signed and verified in constant time before any database access. There is no
fallback secret: the functions fail closed. Printed cores are derivable from public card ids, so they are only
accepted signed; unsigned codes work only for random admin-spawned cores (~59 bits, rate-limited). Claims are
rate-limited per user (best effort, per function instance).

**Battle engine auth.** Tokens are verified against the Supabase JWKS; the HS256 shared-secret fallback is off
unless `SUPABASE_JWT_SECRET` is set (the old default was the public Supabase CLI secret, which allowed forged
tokens). STOMP `CONNECT` requires a valid token. CORS is restricted to configured origins; unknown paths
return 4xx, not 500.

**CORS on Edge Functions** is `*`: auth is a bearer token (no cookies), so a wildcard doesn't expose anything.

**History.** `game_log` is append-only for players (no write policies) and records every claim, trade, match,
starter grant and spawn with XP and details. Use it for audits.

## Secrets checklist

- [ ] `QR_SIGNING_SECRET` set, ≥ 32 random characters, never committed (rotating it invalidates all QR codes).
- [ ] Service-role key only in `.env` and the engine's environment.
- [ ] Personal access tokens revoked after use.
- [ ] `.env` files gitignored (`**/.env`, `.env.*.local`).

## Known limitations

- The battle engine doesn't check bans: banned players can still play matches.
- The claim rate limiter lives in memory per Edge Function instance, so it's best effort.
- Quick-tunnel URLs are public; anyone can reach the engine, but everything except `/features` requires a valid
  player token.
- `search_players` matches on email substrings (without returning email), which can confirm that an address
  has an account.
- Supabase Auth hardening (leaked-password protection, CAPTCHA, email confirmation) is not enabled; consider
  it before a campus-wide launch (Dashboard → Authentication).

## Reporting a problem

Check `game_log` for the affected player, ban the account if needed ([operations.md](operations.md#ban--unban)),
and rotate any secret you suspect has leaked.
