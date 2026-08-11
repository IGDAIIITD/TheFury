CREATE TABLE trades (
    id          uuid NOT NULL,
    sender_id   uuid NOT NULL,
    receiver_id uuid NOT NULL,
    status      varchar(16) NOT NULL,
    created_at  timestamp(6) WITHOUT TIME ZONE NOT NULL,
    resolved_at timestamp(6) WITHOUT TIME ZONE,
    expires_at  timestamp(6) WITHOUT TIME ZONE,
    CONSTRAINT trades_pkey PRIMARY KEY (id),
    CONSTRAINT fk_trades_sender FOREIGN KEY (sender_id) REFERENCES players (id),
    CONSTRAINT fk_trades_receiver FOREIGN KEY (receiver_id) REFERENCES players (id)
);

CREATE TABLE trade_cards (
    id            uuid NOT NULL,
    trade_id      uuid NOT NULL,
    side          varchar(16) NOT NULL,
    physical_uuid uuid NOT NULL,
    CONSTRAINT trade_cards_pkey PRIMARY KEY (id),
    CONSTRAINT uk_trade_cards_trade_side_card UNIQUE (trade_id, side, physical_uuid),
    CONSTRAINT fk_trade_cards_trade FOREIGN KEY (trade_id) REFERENCES trades (id) ON DELETE CASCADE,
    CONSTRAINT fk_trade_cards_unique_card FOREIGN KEY (physical_uuid) REFERENCES unique_cards (physical_uuid)
);

CREATE INDEX idx_trades_sender_status ON trades (sender_id, status);
CREATE INDEX idx_trades_receiver_status ON trades (receiver_id, status);
CREATE INDEX idx_trade_cards_trade ON trade_cards (trade_id);
CREATE INDEX idx_trade_cards_physical_uuid ON trade_cards (physical_uuid);
