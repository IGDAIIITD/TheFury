ALTER TABLE players
    ADD COLUMN degree_level varchar(10),
    ADD COLUMN specialization varchar(10);

CREATE INDEX idx_players_cohort ON players (degree_level, specialization);
