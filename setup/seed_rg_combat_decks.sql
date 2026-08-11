-- Seeds a playable 60-card combat deck ("RG Combat") containing attacking
-- creatures for the two battle test users so headless PvP battles can actually
-- deal damage and end in a win. Mirrors the starter deck granted to every new
-- player by StarterDeckService (same roster, same unlocks).
--
-- Card ids are resolved by forge_name so this stays correct regardless of the
-- UUIDs assigned by the card catalog / StarterCardSeeder. Run this AFTER the
-- backend has started once so the starter creature cards exist in the catalog.

CREATE OR REPLACE FUNCTION fill_rg_deck(p_deck_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  c uuid;
BEGIN
  DELETE FROM deck_cards WHERE deck_id = p_deck_id;

  -- 1 copy of each combat card
  FOR c IN
    SELECT id FROM cards WHERE forge_name IN (
      'Llanowar Elves', 'Raging Goblin', 'Grizzly Bears', 'Elvish Warrior',
      'Elvish Archers', 'Goblin Piker', 'Goblin Mountaineer', 'Trained Armodon',
      'Goblin Hero', 'Vulshok Berserker', 'Cudgel Troll', 'Giant Spider',
      'War Mammoth', 'Hill Giant', 'Fire Elemental', 'Craw Wurm',
      'Solemn Simulacrum', 'Lightning Bolt', 'Shock', 'Giant Growth'
    )
  LOOP
    INSERT INTO deck_cards (id, deck_id, card_id, quantity) VALUES (gen_random_uuid(), p_deck_id, c, 1);
  END LOOP;

  -- 20 Forest, 20 Mountain
  INSERT INTO deck_cards (id, deck_id, card_id, quantity)
  SELECT gen_random_uuid(), p_deck_id, id, 20 FROM cards WHERE forge_name = 'Forest';
  INSERT INTO deck_cards (id, deck_id, card_id, quantity)
  SELECT gen_random_uuid(), p_deck_id, id, 20 FROM cards WHERE forge_name = 'Mountain';
END $$;

DO $$
DECLARE
  t_user uuid := 'ac3cc775-3c5f-4de9-99fe-75266b4ebca8'; -- testbattle@campus.edu
  o_user uuid := '4d4fb548-712b-4868-b04f-9a47e0bc37c5'; -- opponent@campus.edu
  d uuid;
BEGIN
  -- Repopulate the existing "RG Combat" decks in place (matches keep their FK),
  -- creating one if a user does not have one yet.
  FOR d IN
    SELECT id FROM decks WHERE name = 'RG Combat' AND player_id IN (t_user, o_user)
  LOOP
    PERFORM fill_rg_deck(d);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM decks WHERE name = 'RG Combat' AND player_id = t_user) THEN
    d := gen_random_uuid();
    INSERT INTO decks (id, player_id, name, format_code, commander_card_id, created_at, updated_at)
    VALUES (d, t_user, 'RG Combat', 'STANDARD', NULL, now(), now());
    PERFORM fill_rg_deck(d);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM decks WHERE name = 'RG Combat' AND player_id = o_user) THEN
    d := gen_random_uuid();
    INSERT INTO decks (id, player_id, name, format_code, commander_card_id, created_at, updated_at)
    VALUES (d, o_user, 'RG Combat', 'STANDARD', NULL, now(), now());
    PERFORM fill_rg_deck(d);
  END IF;
END $$;

-- Grant ownership (unlocks) + discovery counts for the combat cards.
INSERT INTO player_unlocks (id, player_id, card_id, unlocked_at)
SELECT gen_random_uuid(), p::uuid, c.id, now()
FROM (VALUES
  ('ac3cc775-3c5f-4de9-99fe-75266b4ebca8'),
  ('4d4fb548-712b-4868-b04f-9a47e0bc37c5')
) AS g(p)
CROSS JOIN cards c
WHERE c.forge_name IN (
  'Llanowar Elves', 'Raging Goblin', 'Grizzly Bears', 'Elvish Warrior',
  'Elvish Archers', 'Goblin Piker', 'Goblin Mountaineer', 'Trained Armodon',
  'Goblin Hero', 'Vulshok Berserker', 'Cudgel Troll', 'Giant Spider',
  'War Mammoth', 'Hill Giant', 'Fire Elemental', 'Craw Wurm',
  'Solemn Simulacrum', 'Lightning Bolt', 'Shock', 'Giant Growth'
)
ON CONFLICT (player_id, card_id) DO NOTHING;

INSERT INTO discoveries (id, player_id, card_id, count, last_discovered)
SELECT gen_random_uuid(), p::uuid, c.id, 1, now()
FROM (VALUES
  ('ac3cc775-3c5f-4de9-99fe-75266b4ebca8'),
  ('4d4fb548-712b-4868-b04f-9a47e0bc37c5')
) AS g(p)
CROSS JOIN cards c
WHERE c.forge_name IN (
  'Llanowar Elves', 'Raging Goblin', 'Grizzly Bears', 'Elvish Warrior',
  'Elvish Archers', 'Goblin Piker', 'Goblin Mountaineer', 'Trained Armodon',
  'Goblin Hero', 'Vulshok Berserker', 'Cudgel Troll', 'Giant Spider',
  'War Mammoth', 'Hill Giant', 'Fire Elemental', 'Craw Wurm',
  'Solemn Simulacrum', 'Lightning Bolt', 'Shock', 'Giant Growth'
)
ON CONFLICT (player_id, card_id) DO UPDATE SET count = EXCLUDED.count;

