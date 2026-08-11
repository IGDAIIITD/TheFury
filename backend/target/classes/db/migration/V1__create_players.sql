CREATE TABLE players (
    id            uuid NOT NULL,
    avatar        varchar(255),
    created       timestamp(6) WITHOUT TIME ZONE NOT NULL,
    display_name  varchar(255) NOT NULL,
    email         varchar(255) NOT NULL,
    experience    bigint NOT NULL,
    last_login    timestamp(6) WITHOUT TIME ZONE,
    level         integer NOT NULL,
    password_hash varchar(255) NOT NULL,
    role          varchar(255) NOT NULL,
    student_id    varchar(255),
    CONSTRAINT players_pkey PRIMARY KEY (id),
    CONSTRAINT ukpnrwm9bkjel7qss1ekm05j953 UNIQUE (email)
);
