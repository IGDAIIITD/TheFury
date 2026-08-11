CREATE TABLE decks (
    id                uuid NOT NULL,
    player_id         uuid NOT NULL,
    name              varchar(255) NOT NULL,
    format_code       varchar(32) NOT NULL,
    commander_card_id uuid,
    created_at        timestamp(6) WITHOUT TIME ZONE NOT NULL,
    updated_at        timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT decks_pkey PRIMARY KEY (id),
    CONSTRAINT fk_decks_player FOREIGN KEY (player_id) REFERENCES players (id),
    CONSTRAINT fk_decks_commander FOREIGN KEY (commander_card_id) REFERENCES cards (id)
);

CREATE INDEX idx_decks_player ON decks (player_id);

CREATE TABLE deck_cards (
    id       uuid NOT NULL,
    deck_id  uuid NOT NULL,
    card_id  uuid NOT NULL,
    quantity integer NOT NULL,
    CONSTRAINT deck_cards_pkey PRIMARY KEY (id),
    CONSTRAINT uk_deck_cards_deck_card UNIQUE (deck_id, card_id),
    CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES decks (id) ON DELETE CASCADE,
    CONSTRAINT fk_deck_cards_card FOREIGN KEY (card_id) REFERENCES cards (id)
);

CREATE INDEX idx_deck_cards_deck ON deck_cards (deck_id);
