CREATE TABLE favorites (
    id         uuid NOT NULL,
    player_id  uuid NOT NULL,
    card_id    uuid NOT NULL,
    created_at timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT favorites_pkey PRIMARY KEY (id),
    CONSTRAINT uk_favorites_player_card UNIQUE (player_id, card_id),
    CONSTRAINT fk_favorites_player FOREIGN KEY (player_id) REFERENCES players (id),
    CONSTRAINT fk_favorites_card FOREIGN KEY (card_id) REFERENCES cards (id)
);

CREATE INDEX idx_favorites_player ON favorites (player_id);
