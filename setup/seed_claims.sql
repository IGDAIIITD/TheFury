-- Seeds demo QR claim tokens for the Phase 6 claim flow.
-- Tokens are resolved by card forge_name so UUIDs assigned by the card
-- catalog / StarterCardSeeder don't matter. Run this AFTER the backend has
-- started once so the catalog exists. Idempotent: re-runs are no-ops.
--
-- Phase 10 (V14): claims require a non-null unique token_core. These demo
-- tokens are bare cores (the ClaimService still accepts the legacy bare-core
-- form); minted production tokens are the signed "V1.<CORE>.<SIG>" payload.
--
-- Demo tokens:
--   COUNTSPELL01  -> Counterspell (UNLOCK) at Building B
--   LIGHTNBOLT02  -> Lightning Bolt (UNLOCK) at Gym
--   BLACKLOTUS03  -> Black Lotus (UNIQUE, one-shot) at Special
--   EXPIREDTOKX01 -> Counterspell (UNLOCK), ACTIVE but past expiry (claim -> 410)
--   REVOKEDTOKN01 -> Lightning Bolt (UNLOCK), REVOKED (claim -> 410)

INSERT INTO claims (id, token, token_core, card_id, building, expires_at, status, created_at)
SELECT gen_random_uuid(), 'COUNTSPELL01', 'COUNTSPELL01', id, 'Building B', NULL, 'ACTIVE', now()
FROM cards WHERE forge_name = 'Counterspell'
ON CONFLICT (token) DO NOTHING;

INSERT INTO claims (id, token, token_core, card_id, building, expires_at, status, created_at)
SELECT gen_random_uuid(), 'LIGHTNBOLT02', 'LIGHTNBOLT02', id, 'Gym', NULL, 'ACTIVE', now()
FROM cards WHERE forge_name = 'Lightning Bolt'
ON CONFLICT (token) DO NOTHING;

INSERT INTO claims (id, token, token_core, card_id, building, expires_at, status, created_at)
SELECT gen_random_uuid(), 'BLACKLOTUS03', 'BLACKLOTUS03', id, 'Special', NULL, 'ACTIVE', now()
FROM cards WHERE forge_name = 'Black Lotus'
ON CONFLICT (token) DO NOTHING;

INSERT INTO claims (id, token, token_core, card_id, building, expires_at, status, created_at)
SELECT gen_random_uuid(), 'EXPIREDTOKX01', 'EXPIREDTOKX01', id, 'Building B', now() - interval '1 day', 'ACTIVE', now()
FROM cards WHERE forge_name = 'Counterspell'
ON CONFLICT (token) DO NOTHING;

INSERT INTO claims (id, token, token_core, card_id, building, expires_at, status, created_at)
SELECT gen_random_uuid(), 'REVOKEDTOKN01', 'REVOKEDTOKN01', id, 'Gym', NULL, 'REVOKED', now()
FROM cards WHERE forge_name = 'Lightning Bolt'
ON CONFLICT (token) DO NOTHING;
