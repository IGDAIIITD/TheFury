CREATE TABLE claims (
    id         uuid NOT NULL,
    token      varchar(64) NOT NULL,
    card_id    uuid NOT NULL,
    building   varchar(255),
    expires_at timestamp(6) WITHOUT TIME ZONE,
    status     varchar(16) NOT NULL,
    claimed_by uuid,
    claimed_at timestamp(6) WITHOUT TIME ZONE,
    created_at timestamp(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT claims_pkey PRIMARY KEY (id),
    CONSTRAINT uk_claims_token UNIQUE (token),
    CONSTRAINT fk_claims_card FOREIGN KEY (card_id) REFERENCES cards (id),
    CONSTRAINT fk_claims_player FOREIGN KEY (claimed_by) REFERENCES players (id)
);

CREATE INDEX idx_claims_status ON claims (status);
CREATE INDEX idx_claims_card ON claims (card_id);
