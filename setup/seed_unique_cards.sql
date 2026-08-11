-- Seeds demo UNIQUE physical cards for the Phase 8 trade flow.
-- testbattle@campus.edu and opponent@campus.edu each get the three catalog
-- UNIQUE cards (Black Lotus, Ancestral Recall, Mox Sapphire) so multi-card
-- trade bundles can be offered either way.
-- Run AFTER the backend has started once so the catalog exists.
-- Idempotent: re-runs are no-ops (physical uuids are deterministic).

-- testbattle (serial 9001..9003)
INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-tb-lotus')::uuid, p.id, c.id, 9001, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Black Lotus'
WHERE p.email = 'testbattle@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;

INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-tb-recall')::uuid, p.id, c.id, 9002, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Ancestral Recall'
WHERE p.email = 'testbattle@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;

INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-tb-mox')::uuid, p.id, c.id, 9003, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Mox Sapphire'
WHERE p.email = 'testbattle@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;

-- opponent (serial 9101..9103)
INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-op-lotus')::uuid, p.id, c.id, 9101, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Black Lotus'
WHERE p.email = 'opponent@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;

INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-op-recall')::uuid, p.id, c.id, 9102, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Ancestral Recall'
WHERE p.email = 'opponent@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;

INSERT INTO unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history)
SELECT md5('cf-trade-op-mox')::uuid, p.id, c.id, 9103, now(), 'created: trade demo seed'
FROM players p JOIN cards c ON c.forge_name = 'Mox Sapphire'
WHERE p.email = 'opponent@campus.edu'
ON CONFLICT (physical_uuid) DO NOTHING;
