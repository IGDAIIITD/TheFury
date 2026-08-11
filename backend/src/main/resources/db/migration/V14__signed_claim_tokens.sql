-- Phase 10: signed QR claim tokens.
-- The public claim token becomes a signed payload "V1.<CORE>.<SIG>". The core
-- stays the stable unique identifier used for lookups and unique-card
-- serialization; existing bare-core tokens are backfilled so they remain valid.
ALTER TABLE claims ADD COLUMN token_core varchar(64);
UPDATE claims SET token_core = token WHERE token_core IS NULL;
ALTER TABLE claims ALTER COLUMN token_core SET NOT NULL;
ALTER TABLE claims ALTER COLUMN token TYPE varchar(128);
CREATE UNIQUE INDEX uk_claims_token_core ON claims (token_core);
