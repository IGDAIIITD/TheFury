CREATE TABLE matches (
    id         uuid NOT NULL,
    player1_id uuid NOT NULL,
    player2_id uuid,
    deck1_id   uuid NOT NULL,
    deck2_id   uuid,
    status     varchar(32) NOT NULL,
    winner_id  uuid,
    created_at timestamp(6) WITHOUT TIME ZONE NOT NULL,
    ended_at   timestamp(6) WITHOUT TIME ZONE,
    CONSTRAINT matches_pkey PRIMARY KEY (id),
    CONSTRAINT fk_matches_player1 FOREIGN KEY (player1_id) REFERENCES players (id),
    CONSTRAINT fk_matches_player2 FOREIGN KEY (player2_id) REFERENCES players (id),
    CONSTRAINT fk_matches_deck1 FOREIGN KEY (deck1_id) REFERENCES decks (id),
    CONSTRAINT fk_matches_deck2 FOREIGN KEY (deck2_id) REFERENCES decks (id)
);

CREATE INDEX idx_matches_player1 ON matches (player1_id);
CREATE INDEX idx_matches_status ON matches (status);
