-- Phase 9: events, achievements, spawn metadata, event matches, player bans.

CREATE TABLE events (
    id                uuid NOT NULL,
    name              varchar(120) NOT NULL,
    allowed_sets_json text NOT NULL,
    bonus_multiplier  numeric(5,2) NOT NULL DEFAULT 1.00,
    start_time        timestamp(6) WITHOUT TIME ZONE NOT NULL,
    end_time          timestamp(6) WITHOUT TIME ZONE NOT NULL,
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT events_pkey PRIMARY KEY (id),
    CONSTRAINT chk_events_window CHECK (end_time > start_time),
    CONSTRAINT chk_events_bonus CHECK (bonus_multiplier >= 1.00)
);

CREATE INDEX idx_events_window ON events (start_time, end_time);

CREATE TABLE player_achievements (
    id          uuid NOT NULL,
    player_id   uuid NOT NULL,
    code        varchar(64) NOT NULL,
    unlocked_at timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT player_achievements_pkey PRIMARY KEY (id),
    CONSTRAINT uk_player_achievements_player_code UNIQUE (player_id, code),
    CONSTRAINT fk_player_achievements_player FOREIGN KEY (player_id) REFERENCES players (id)
);

CREATE INDEX idx_player_achievements_player ON player_achievements (player_id);

ALTER TABLE claims ADD COLUMN event_id uuid;
ALTER TABLE claims ADD COLUMN spawned_by uuid;
ALTER TABLE claims ADD CONSTRAINT fk_claims_event FOREIGN KEY (event_id) REFERENCES events (id);
ALTER TABLE claims ADD CONSTRAINT fk_claims_spawned_by FOREIGN KEY (spawned_by) REFERENCES players (id);
CREATE INDEX idx_claims_event ON claims (event_id);

ALTER TABLE matches ADD COLUMN event_id uuid;
ALTER TABLE matches ADD CONSTRAINT fk_matches_event FOREIGN KEY (event_id) REFERENCES events (id);
CREATE INDEX idx_matches_event ON matches (event_id);

ALTER TABLE players ADD COLUMN banned boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN banned_at timestamp(6) WITHOUT TIME ZONE;
