ALTER TABLE matches ADD COLUMN battle_code varchar(16);

CREATE UNIQUE INDEX uq_matches_battle_code ON matches (battle_code);
