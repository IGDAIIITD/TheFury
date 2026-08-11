-- Seeds demo events for the Phase 9 Events page and admin console.
-- Idempotent: inserts only when the fixed event ids are absent.
-- Run AFTER the backend has started once (catalog/format seeders run at startup).
--
-- Race Week (live): starter cards are M19 (Llanowar Elves, Forest, ...) so decks
--   built from the starter collection pass the set gate; LEA/other-set cards fail.

INSERT INTO events (id, name, allowed_sets_json, bonus_multiplier, start_time, end_time, active, created_at)
SELECT 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Race Week', '["M19","UNLIMITED"]', 2.00,
       now() - interval '1 day', now() + interval '2 days', TRUE, now()
WHERE NOT EXISTS (SELECT 1 FROM events WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO events (id, name, allowed_sets_json, bonus_multiplier, start_time, end_time, active, created_at)
SELECT 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Commander Clash', '["LEA"]', 3.00,
       now() + interval '3 days', now() + interval '5 days', TRUE, now()
WHERE NOT EXISTS (SELECT 1 FROM events WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

INSERT INTO events (id, name, allowed_sets_json, bonus_multiplier, start_time, end_time, active, created_at)
SELECT 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid, 'Rookie Rumble', '["M19"]', 1.50,
       now() - interval '5 days', now() - interval '3 days', FALSE, now()
WHERE NOT EXISTS (SELECT 1 FROM events WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc');
