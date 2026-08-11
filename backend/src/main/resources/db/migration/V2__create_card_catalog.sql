CREATE TABLE cards (
    id             uuid NOT NULL,
    oracle_id      varchar(255) NOT NULL,
    forge_name     varchar(255) NOT NULL,
    rarity         varchar(255),
    ownership_type varchar(31) NOT NULL,
    set_code       varchar(255),
    mana_value     integer,
    types          varchar(255),
    colors         varchar(255),
    image_url      varchar(1024),
    discoverable   boolean NOT NULL,
    spawn_region   varchar(255),
    weight         double precision,
    CONSTRAINT cards_pkey PRIMARY KEY (id),
    CONSTRAINT uk_cards_oracle_id UNIQUE (oracle_id)
);

CREATE TABLE player_unlocks (
    id            uuid NOT NULL,
    player_id     uuid NOT NULL,
    card_id       uuid NOT NULL,
    unlocked_at   timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT player_unlocks_pkey PRIMARY KEY (id),
    CONSTRAINT uk_player_unlocks_player_card UNIQUE (player_id, card_id),
    CONSTRAINT fk_player_unlocks_player FOREIGN KEY (player_id) REFERENCES players (id),
    CONSTRAINT fk_player_unlocks_card FOREIGN KEY (card_id) REFERENCES cards (id)
);

CREATE TABLE unique_cards (
    physical_uuid uuid NOT NULL,
    owner_id      uuid NOT NULL,
    card_id       uuid NOT NULL,
    serial_number integer NOT NULL,
    claimed_at    timestamp(6) WITHOUT TIME ZONE NOT NULL,
    history       text,
    CONSTRAINT unique_cards_pkey PRIMARY KEY (physical_uuid),
    CONSTRAINT uk_unique_cards_serial UNIQUE (card_id, serial_number),
    CONSTRAINT fk_unique_cards_player FOREIGN KEY (owner_id) REFERENCES players (id),
    CONSTRAINT fk_unique_cards_card FOREIGN KEY (card_id) REFERENCES cards (id)
);

CREATE TABLE discoveries (
    id              uuid NOT NULL,
    player_id       uuid NOT NULL,
    card_id         uuid NOT NULL,
    count           bigint NOT NULL,
    last_discovered timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT discoveries_pkey PRIMARY KEY (id),
    CONSTRAINT uk_discoveries_player_card UNIQUE (player_id, card_id),
    CONSTRAINT fk_discoveries_player FOREIGN KEY (player_id) REFERENCES players (id),
    CONSTRAINT fk_discoveries_card FOREIGN KEY (card_id) REFERENCES cards (id)
);

CREATE INDEX idx_cards_forge_name ON cards (forge_name);
CREATE INDEX idx_cards_ownership_type ON cards (ownership_type);
CREATE INDEX idx_player_unlocks_player ON player_unlocks (player_id);
CREATE INDEX idx_unique_cards_owner ON unique_cards (owner_id);
CREATE INDEX idx_discoveries_player ON discoveries (player_id);
