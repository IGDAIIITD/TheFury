CREATE TABLE formats (
    id                 uuid NOT NULL,
    code               varchar(32) NOT NULL,
    name               varchar(255) NOT NULL,
    max_copies         integer NOT NULL,
    min_deck_size      integer NOT NULL,
    max_deck_size      integer,
    commander_required boolean NOT NULL,
    basics_unlimited   boolean NOT NULL,
    CONSTRAINT formats_pkey PRIMARY KEY (id),
    CONSTRAINT uk_formats_code UNIQUE (code)
);

CREATE TABLE card_legalities (
    id        uuid NOT NULL,
    card_id   uuid NOT NULL,
    format_id uuid NOT NULL,
    legality  varchar(16) NOT NULL,
    CONSTRAINT card_legalities_pkey PRIMARY KEY (id),
    CONSTRAINT uk_card_legalities_card_format UNIQUE (card_id, format_id),
    CONSTRAINT fk_card_legalities_card FOREIGN KEY (card_id) REFERENCES cards (id),
    CONSTRAINT fk_card_legalities_format FOREIGN KEY (format_id) REFERENCES formats (id)
);

ALTER TABLE cards ADD COLUMN commander_eligible boolean NOT NULL DEFAULT false;

INSERT INTO formats (id, code, name, max_copies, min_deck_size, max_deck_size, commander_required, basics_unlimited)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'STANDARD', 'Standard', 4, 60, NULL, false, true),
    ('22222222-2222-4222-8222-222222222222', 'COMMANDER', 'Commander', 1, 99, 99, true, true);
