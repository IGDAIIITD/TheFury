--
-- PostgreSQL database dump
--

\restrict ML66vtyjeb2biOf34VbqJ6YZQk2K4Gk4fQqUwoWADo2K9fDWKGppOtCDiR5k2N9

-- Dumped from database version 17.10 (Debian 17.10-0+deb13u1)
-- Dumped by pg_dump version 17.10 (Debian 17.10-0+deb13u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: card_legalities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.card_legalities (
    id uuid NOT NULL,
    card_id uuid NOT NULL,
    format_id uuid NOT NULL,
    legality character varying(16) NOT NULL
);


ALTER TABLE public.card_legalities OWNER TO postgres;

--
-- Name: cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cards (
    id uuid NOT NULL,
    oracle_id character varying(255) NOT NULL,
    forge_name character varying(255) NOT NULL,
    rarity character varying(255),
    ownership_type character varying(31) NOT NULL,
    set_code character varying(255),
    mana_value integer,
    types character varying(255),
    colors character varying(255),
    image_url character varying(1024),
    discoverable boolean NOT NULL,
    spawn_region character varying(255),
    weight double precision,
    commander_eligible boolean DEFAULT false NOT NULL
);


ALTER TABLE public.cards OWNER TO postgres;

--
-- Name: deck_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deck_cards (
    id uuid NOT NULL,
    deck_id uuid NOT NULL,
    card_id uuid NOT NULL,
    quantity integer NOT NULL
);


ALTER TABLE public.deck_cards OWNER TO postgres;

--
-- Name: decks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.decks (
    id uuid NOT NULL,
    player_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    format_code character varying(32) NOT NULL,
    commander_card_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    updated_at timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.decks OWNER TO postgres;

--
-- Name: discoveries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.discoveries (
    id uuid NOT NULL,
    player_id uuid NOT NULL,
    card_id uuid NOT NULL,
    count bigint NOT NULL,
    last_discovered timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.discoveries OWNER TO postgres;

--
-- Name: favorites; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.favorites (
    id uuid NOT NULL,
    player_id uuid NOT NULL,
    card_id uuid NOT NULL,
    created_at timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.favorites OWNER TO postgres;

--
-- Name: flyway_schema_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.flyway_schema_history (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


ALTER TABLE public.flyway_schema_history OWNER TO postgres;

--
-- Name: formats; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.formats (
    id uuid NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(255) NOT NULL,
    max_copies integer NOT NULL,
    min_deck_size integer NOT NULL,
    max_deck_size integer,
    commander_required boolean NOT NULL,
    basics_unlimited boolean NOT NULL
);


ALTER TABLE public.formats OWNER TO postgres;

--
-- Name: matches; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.matches (
    id uuid NOT NULL,
    player1_id uuid NOT NULL,
    player2_id uuid,
    deck1_id uuid NOT NULL,
    deck2_id uuid,
    status character varying(32) NOT NULL,
    winner_id uuid,
    created_at timestamp(6) without time zone NOT NULL,
    ended_at timestamp(6) without time zone,
    battle_code character varying(16)
);


ALTER TABLE public.matches OWNER TO postgres;

--
-- Name: player_unlocks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.player_unlocks (
    id uuid NOT NULL,
    player_id uuid NOT NULL,
    card_id uuid NOT NULL,
    unlocked_at timestamp(6) without time zone NOT NULL
);


ALTER TABLE public.player_unlocks OWNER TO postgres;

--
-- Name: players; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.players (
    id uuid NOT NULL,
    avatar character varying(255),
    created timestamp(6) without time zone NOT NULL,
    display_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    experience bigint NOT NULL,
    last_login timestamp(6) without time zone,
    level integer NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(255) NOT NULL,
    student_id character varying(255)
);


ALTER TABLE public.players OWNER TO postgres;

--
-- Name: unique_cards; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.unique_cards (
    physical_uuid uuid NOT NULL,
    owner_id uuid NOT NULL,
    card_id uuid NOT NULL,
    serial_number integer NOT NULL,
    claimed_at timestamp(6) without time zone NOT NULL,
    history text
);


ALTER TABLE public.unique_cards OWNER TO postgres;

--
-- Data for Name: card_legalities; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.card_legalities (id, card_id, format_id, legality) FROM stdin;
317979e1-c493-480e-ac7e-3fb44d881b43	c5c85d64-a338-4995-84a9-638fe59a6037	11111111-1111-4111-8111-111111111111	LEGAL
4d8826ec-099a-46cb-a40d-69f097edc88c	c5c85d64-a338-4995-84a9-638fe59a6037	22222222-2222-4222-8222-222222222222	LEGAL
bffa1655-d28c-4c9f-80c2-89501eecebad	d26ad579-da87-4288-b4d7-b56addbbcd3e	11111111-1111-4111-8111-111111111111	LEGAL
9f4d6ff1-db23-4739-ad91-37b72957298d	d26ad579-da87-4288-b4d7-b56addbbcd3e	22222222-2222-4222-8222-222222222222	LEGAL
361cb6ae-7100-4a5e-8722-04d2d58d566b	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	11111111-1111-4111-8111-111111111111	LEGAL
d0d8e7a7-8ad5-4e38-aa76-11c9f9bc21d8	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	22222222-2222-4222-8222-222222222222	LEGAL
9fbed053-6a10-4891-b46c-bc2a9451259c	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	11111111-1111-4111-8111-111111111111	LEGAL
8a7a4c1a-be7d-40c6-934e-58a16170afbe	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	22222222-2222-4222-8222-222222222222	LEGAL
00da1d79-1b8b-464b-a1ad-900c558f4415	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	11111111-1111-4111-8111-111111111111	LEGAL
b6ed47c7-6e6d-4bdc-90aa-aad93c9302f5	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	22222222-2222-4222-8222-222222222222	LEGAL
08390e2c-8223-4fd6-8e8a-9c9671223215	57a8c339-1ba9-4302-9e32-c76937d4a484	11111111-1111-4111-8111-111111111111	LEGAL
982b7086-283e-457f-9ea8-a8fbe05cee2b	57a8c339-1ba9-4302-9e32-c76937d4a484	22222222-2222-4222-8222-222222222222	LEGAL
c96db133-fee2-433b-8813-2aafaff4c76a	88317948-f783-4011-b821-279fc52664ed	11111111-1111-4111-8111-111111111111	LEGAL
ddbcc299-c4a2-4225-93e0-a9a695ee8156	88317948-f783-4011-b821-279fc52664ed	22222222-2222-4222-8222-222222222222	LEGAL
cf7ac48c-082f-4272-8ec6-42a0f5c89444	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	11111111-1111-4111-8111-111111111111	LEGAL
31abf2a8-0b29-41a8-8f2c-1a0f6d39f6e2	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	22222222-2222-4222-8222-222222222222	LEGAL
a7fc77ae-eb07-40ed-943e-93a06e630dbc	63564589-8028-4e6b-9a2f-888706f5107e	11111111-1111-4111-8111-111111111111	LEGAL
fcafdd80-c0cc-40cf-aeb4-8c87d36e0345	63564589-8028-4e6b-9a2f-888706f5107e	22222222-2222-4222-8222-222222222222	LEGAL
9d6f1319-8c2c-4f66-bcfa-fe536236fa81	ed650960-6d6b-466d-938f-baa44172b04b	11111111-1111-4111-8111-111111111111	LEGAL
223e765c-6f90-4bfd-b04e-956d7f77fb56	ed650960-6d6b-466d-938f-baa44172b04b	22222222-2222-4222-8222-222222222222	LEGAL
9d075a91-fae0-4f10-87c8-c153337b6d2f	c2253db3-d365-4410-8d60-b344e5c54996	11111111-1111-4111-8111-111111111111	LEGAL
6f0196af-430e-4817-963f-fa5c16861c2b	c2253db3-d365-4410-8d60-b344e5c54996	22222222-2222-4222-8222-222222222222	LEGAL
6e02e897-8aec-4e32-b299-7ebcbce35c44	87e63623-0386-4ee5-ae51-7e200442b7b6	11111111-1111-4111-8111-111111111111	LEGAL
8b2afa86-d171-4217-90ee-b186a39f3611	87e63623-0386-4ee5-ae51-7e200442b7b6	22222222-2222-4222-8222-222222222222	LEGAL
86863485-90c8-47c5-a249-4e5e2295e450	18777f10-b733-465c-a591-c9257770e1af	11111111-1111-4111-8111-111111111111	LEGAL
0b51f83b-a10e-440a-bf74-1ea82635d68b	18777f10-b733-465c-a591-c9257770e1af	22222222-2222-4222-8222-222222222222	LEGAL
0ab3d600-dde0-48e7-8c66-af7d2ba15f18	e82712cd-232a-40c0-92d1-3d583435f7d4	11111111-1111-4111-8111-111111111111	BANNED
ae3b0b9c-d519-4abe-9950-e5ee28b33d17	e82712cd-232a-40c0-92d1-3d583435f7d4	22222222-2222-4222-8222-222222222222	LEGAL
e3a9e6ac-db81-46cc-8972-97968296f00e	97aea0d8-b95f-4fce-ad37-3b6b0cbebf62	11111111-1111-4111-8111-111111111111	BANNED
26601564-3881-4461-a200-2a04a9128697	97aea0d8-b95f-4fce-ad37-3b6b0cbebf62	22222222-2222-4222-8222-222222222222	LEGAL
443435aa-327f-4bb4-9a94-66b86fc0431d	1520f825-25f2-482f-a2b3-0e613c64a61d	11111111-1111-4111-8111-111111111111	BANNED
7956e150-1ec9-43a9-8e22-63fb4f3e2f16	1520f825-25f2-482f-a2b3-0e613c64a61d	22222222-2222-4222-8222-222222222222	LEGAL
\.


--
-- Data for Name: cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cards (id, oracle_id, forge_name, rarity, ownership_type, set_code, mana_value, types, colors, image_url, discoverable, spawn_region, weight, commander_eligible) FROM stdin;
c5c85d64-a338-4995-84a9-638fe59a6037	0d49a960-963a-46a4-8d3d-b3f7b0d7b3c4	Plains	Common	UNLIMITED	M19	0	Basic Land — Plains	W	\N	t	Library	10	f
d26ad579-da87-4288-b4d7-b56addbbcd3e	6d2ecbb5-5d0e-4bb4-8e8f-1f3a0c3e8b2a	Island	Common	UNLIMITED	M19	0	Basic Land — Island	U	\N	t	Library	10	f
d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	a7c4a5e1-5f6d-4a3b-9b2e-4f1c0d6e7a8f	Swamp	Common	UNLIMITED	M19	0	Basic Land — Swamp	B	\N	t	Library	10	f
c58955ad-fa92-45a5-b5eb-5fbc730e3e77	2b6f9d3e-8c1a-4b7e-9d0f-5e3a7b9c1d2f	Mountain	Common	UNLIMITED	M19	0	Basic Land — Mountain	R	\N	t	Library	10	f
461d36fe-4d8f-47ef-ba7c-86d97b1cd974	4c8e0a5f-9b2d-4c1e-8a3f-6d5b0e2f3a4c	Forest	Common	UNLIMITED	M19	0	Basic Land — Forest	G	\N	t	Library	10	f
57a8c339-1ba9-4302-9e32-c76937d4a484	5a1f2b3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c	Counterspell	Common	UNLOCK	M19	2	Instant	U	\N	t	Building B	5	f
88317948-f783-4011-b821-279fc52664ed	7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f	Lightning Bolt	Common	UNLOCK	M19	1	Instant	R	\N	t	Gym	5	f
f45b7b77-66bd-4190-8d54-2aa4a191f3a8	9e5f6a7b-8c9d-4a0b-1c2d-3e4f5a6b7c8d	Giant Growth	Common	UNLOCK	M19	1	Instant	G	\N	t	Engineering	5	f
63564589-8028-4e6b-9a2f-888706f5107e	0b7c8d9e-0a1b-4c2d-3e4f-5a6b7c8d9e0f	Cancel	Uncommon	UNLOCK	M19	3	Instant	U	\N	t	Building B	4	f
ed650960-6d6b-466d-938f-baa44172b04b	2d9e0f1a-2b3c-4d4e-5f6a-7b8c9d0e1f2a	Shock	Common	UNLOCK	M19	1	Instant	R	\N	t	Gym	5	f
c2253db3-d365-4410-8d60-b344e5c54996	4f0a1b2c-3d4e-4f5a-6b7c-8d9e0f1a2b3c	Llanowar Elves	Common	UNLOCK	M19	1	Creature — Elf Druid	G	\N	t	Engineering	5	f
87e63623-0386-4ee5-ae51-7e200442b7b6	6a2b3c4d-5e6f-4a0b-1c2d-3e4f5a6b7c8d	Doom Blade	Common	UNLOCK	M19	2	Instant	B	\N	t	Library	5	f
97aea0d8-b95f-4fce-ad37-3b6b0cbebf62	c2f3a4b5-6c7d-4e8f-9a0b-1c2d3e4f5a6b	Ancestral Recall	Mythic	UNIQUE	LEA	1	Instant	U	\N	f	Special	0.1	f
1520f825-25f2-482f-a2b3-0e613c64a61d	e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c	Mox Sapphire	Mythic	UNIQUE	LEA	0	Artifact		\N	f	Special	0.1	f
18777f10-b733-465c-a591-c9257770e1af	8c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f	Solemn Simulacrum	Rare	UNLOCK	M19	4	Artifact Creature — Golem		\N	t	Engineering	2	t
e82712cd-232a-40c0-92d1-3d583435f7d4	a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a	Black Lotus	Mythic	UNIQUE	LEA	0	Artifact		\N	f	Special	0.1	t
\.


--
-- Data for Name: deck_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deck_cards (id, deck_id, card_id, quantity) FROM stdin;
b8803c9c-7ca3-4ca4-b47c-6ffc2509ef91	5ef5091e-d5c2-43cb-bbcf-d1d8d4e465a2	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	13
29097b8d-5db6-4d5a-b85b-c9ea3a82bb43	5ef5091e-d5c2-43cb-bbcf-d1d8d4e465a2	d26ad579-da87-4288-b4d7-b56addbbcd3e	20
e9a05e52-7165-4d41-b927-ca1d3a530146	5ef5091e-d5c2-43cb-bbcf-d1d8d4e465a2	c5c85d64-a338-4995-84a9-638fe59a6037	39
67ef251e-2de8-4422-88d8-b1e6a864d097	bce0e377-e176-453f-8c8b-2240f175ef9d	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	10
fd75ba6d-c02c-460a-a03b-42fb0141c4ee	bce0e377-e176-453f-8c8b-2240f175ef9d	d26ad579-da87-4288-b4d7-b56addbbcd3e	10
8615f327-aafb-439a-a16f-d071815a773e	bce0e377-e176-453f-8c8b-2240f175ef9d	c5c85d64-a338-4995-84a9-638fe59a6037	14
2de83a1e-9f93-4e74-8fc1-d0b37e5991c3	bce0e377-e176-453f-8c8b-2240f175ef9d	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	14
0b627e39-fbbe-4af1-b26c-b215a1182a94	bce0e377-e176-453f-8c8b-2240f175ef9d	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	12
ee73eb8e-1e71-4191-b1ee-dd8fd27a5ca9	c67fc8e9-861e-4f95-855d-563bde2f3b6e	57a8c339-1ba9-4302-9e32-c76937d4a484	1
04fdea7f-6c51-4d53-be64-143aedfbe6ad	c67fc8e9-861e-4f95-855d-563bde2f3b6e	ed650960-6d6b-466d-938f-baa44172b04b	1
8affa3f0-066b-4b82-a29a-d626415542b3	c67fc8e9-861e-4f95-855d-563bde2f3b6e	18777f10-b733-465c-a591-c9257770e1af	1
a9f8cdc4-58bf-4d91-a1c6-34da51c4539e	c67fc8e9-861e-4f95-855d-563bde2f3b6e	87e63623-0386-4ee5-ae51-7e200442b7b6	1
796a2f80-a139-41e9-bae7-b71c5245f896	c67fc8e9-861e-4f95-855d-563bde2f3b6e	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	11
44544ce9-3a2b-4f0f-9936-e34bb5de2a00	c67fc8e9-861e-4f95-855d-563bde2f3b6e	c2253db3-d365-4410-8d60-b344e5c54996	1
c3c8376f-468d-4ab2-8d80-ba020e0fd4e3	c67fc8e9-861e-4f95-855d-563bde2f3b6e	d26ad579-da87-4288-b4d7-b56addbbcd3e	12
960cdae7-cd4a-4677-87d1-be7314630925	c67fc8e9-861e-4f95-855d-563bde2f3b6e	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	1
e099de3a-eb53-4dc7-8816-62048834e228	c67fc8e9-861e-4f95-855d-563bde2f3b6e	c5c85d64-a338-4995-84a9-638fe59a6037	12
e32dd6c7-79b1-41e2-9001-dbc10dc4d86e	c67fc8e9-861e-4f95-855d-563bde2f3b6e	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	11
d13a6ff5-26fe-4a5a-a65e-0115e3b1a3dc	c67fc8e9-861e-4f95-855d-563bde2f3b6e	88317948-f783-4011-b821-279fc52664ed	1
8cece262-81fa-4802-ab34-deab259491ca	c67fc8e9-861e-4f95-855d-563bde2f3b6e	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	12
9548e62b-745c-45a5-872a-a105e16cf98a	c67fc8e9-861e-4f95-855d-563bde2f3b6e	63564589-8028-4e6b-9a2f-888706f5107e	1
79352ebd-288f-4048-9a42-43154990e82d	8582af98-6cef-47a5-ac69-cfcd33f1d9f2	d26ad579-da87-4288-b4d7-b56addbbcd3e	60
a82d83af-b0f1-4a05-85be-7e9206f919a3	cbaaf17d-1511-4cd0-ae20-45811504f4bd	ed650960-6d6b-466d-938f-baa44172b04b	1
25642ac2-207f-4d6c-9d5d-7600198ba9df	cbaaf17d-1511-4cd0-ae20-45811504f4bd	57a8c339-1ba9-4302-9e32-c76937d4a484	1
adcd0444-baf9-40b9-870a-7705fd9c9ab6	cbaaf17d-1511-4cd0-ae20-45811504f4bd	18777f10-b733-465c-a591-c9257770e1af	1
6be81d14-141c-4cff-a10d-4b2fcc89ea6d	cbaaf17d-1511-4cd0-ae20-45811504f4bd	87e63623-0386-4ee5-ae51-7e200442b7b6	1
934ba0cc-afe3-4e30-94ee-eceec81886ad	cbaaf17d-1511-4cd0-ae20-45811504f4bd	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	12
057a1975-9a20-46c5-999d-d65d050cb104	cbaaf17d-1511-4cd0-ae20-45811504f4bd	c2253db3-d365-4410-8d60-b344e5c54996	1
e9b3d12b-d30c-4fb0-b640-3746cea5ddfc	cbaaf17d-1511-4cd0-ae20-45811504f4bd	d26ad579-da87-4288-b4d7-b56addbbcd3e	15
56488b59-32ce-4bfb-a39b-1e696fd98de0	cbaaf17d-1511-4cd0-ae20-45811504f4bd	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	1
08848ac8-705b-4a56-9b7c-61d60e741d6e	cbaaf17d-1511-4cd0-ae20-45811504f4bd	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	12
9a52e9c0-dedb-4a4e-abb6-151ce1a16c36	cbaaf17d-1511-4cd0-ae20-45811504f4bd	88317948-f783-4011-b821-279fc52664ed	1
85b41703-a164-4039-a0ea-acb9d375a84f	cbaaf17d-1511-4cd0-ae20-45811504f4bd	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	15
099633dc-c91f-4f79-a5c4-14c0f6f3ac18	cbaaf17d-1511-4cd0-ae20-45811504f4bd	63564589-8028-4e6b-9a2f-888706f5107e	1
d7b5b0d7-9e66-4806-a0a7-d3886d6fd656	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	c2253db3-d365-4410-8d60-b344e5c54996	1
e6bfe894-a37c-46fa-a84b-44971db66817	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	1
64e4e063-704d-452d-bb40-0d57897ea8c6	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	28
89139ac0-a430-4fcc-ba10-56c626a66611	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	88317948-f783-4011-b821-279fc52664ed	1
e626fc02-dcb4-41a7-afca-9258d7debebf	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	29
36f393f6-27e3-494c-9903-400bdb017e02	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	c2253db3-d365-4410-8d60-b344e5c54996	1
3afe2455-1a27-45fe-969d-910627f071d1	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	1
7158c43f-f452-4292-8ede-1d2d5b4fae45	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	28
569b9365-1d32-433d-942b-9df9b12f2a2a	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	88317948-f783-4011-b821-279fc52664ed	1
254e5b25-3cc4-4fab-89e8-6063f5082946	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	29
65d1263c-84ad-4e25-aad5-ddc9b8054213	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	30
5730b528-fe58-46f7-944d-6f081da0d727	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	30
73b7b865-978c-4544-9047-58fc8f9fdbd7	3847a5d1-3a65-470b-8e1e-2e9caa895d99	d26ad579-da87-4288-b4d7-b56addbbcd3e	31
220b6657-d4ea-497e-b698-4d5b5cc1655d	3847a5d1-3a65-470b-8e1e-2e9caa895d99	c5c85d64-a338-4995-84a9-638fe59a6037	31
\.


--
-- Data for Name: decks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.decks (id, player_id, name, format_code, commander_card_id, created_at, updated_at) FROM stdin;
5ef5091e-d5c2-43cb-bbcf-d1d8d4e465a2	874748dc-99cc-4fdf-9f7a-a1c368d9e111	New Deck	STANDARD	\N	2026-08-02 15:14:01.838948	2026-08-02 15:14:01.838948
bce0e377-e176-453f-8c8b-2240f175ef9d	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	New Deck	STANDARD	\N	2026-08-02 15:14:14.281775	2026-08-02 15:14:14.281775
c67fc8e9-861e-4f95-855d-563bde2f3b6e	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	New Deck	STANDARD	\N	2026-08-02 17:34:12.460721	2026-08-02 17:34:12.460721
8582af98-6cef-47a5-ac69-cfcd33f1d9f2	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	Valid Island Deck	STANDARD	\N	2026-08-02 17:41:13.04203	2026-08-02 17:41:13.04203
cbaaf17d-1511-4cd0-ae20-45811504f4bd	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	New Deck	STANDARD	\N	2026-08-02 17:47:59.598653	2026-08-02 17:47:59.598653
19c9e942-aac7-490f-a33e-b1f5df9cb2ad	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	BattleTest RG	STANDARD	\N	2026-08-02 18:36:09.256855	2026-08-02 18:36:09.256855
c5d24cf4-43b4-4dff-a1f5-f30e4a761404	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	E2E RG	STANDARD	\N	2026-08-02 20:26:36.518543	2026-08-02 20:26:36.518543
daee486e-9a4c-4a8d-81c9-5c7f3086dea9	4d4fb548-712b-4868-b04f-9a47e0bc37c5	E2E Lands	STANDARD	\N	2026-08-02 20:26:37.042676	2026-08-02 20:26:37.042676
3847a5d1-3a65-470b-8e1e-2e9caa895d99	140a2eb6-ee86-4435-b0af-dba6cdca4ee4	New Deck	STANDARD	\N	2026-08-02 21:56:43.930172	2026-08-02 21:56:43.930172
\.


--
-- Data for Name: discoveries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.discoveries (id, player_id, card_id, count, last_discovered) FROM stdin;
e86960bf-c3dd-44bc-9f27-c122783128b2	c7cd01f7-2ec9-4730-924f-ec18b084b768	1520f825-25f2-482f-a2b3-0e613c64a61d	1	2026-08-02 14:28:21.670366
abc78ead-b910-4538-94e6-aec3faa7afe1	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	c5c85d64-a338-4995-84a9-638fe59a6037	1	2026-08-02 15:20:25.56251
48d9a3e0-2231-4060-8dbb-d659761e1779	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	d26ad579-da87-4288-b4d7-b56addbbcd3e	1	2026-08-02 15:20:25.56251
7e629614-728f-4f62-a564-f1f41a089cc9	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	d8a7cfe4-0cfa-4735-ba70-9f7da8e8efca	1	2026-08-02 15:20:25.56251
47d8605d-9e9f-4314-97a0-204852ddf64d	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	c58955ad-fa92-45a5-b5eb-5fbc730e3e77	1	2026-08-02 15:20:25.56251
649861b9-cffb-45f5-aa70-704b54aa5980	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	461d36fe-4d8f-47ef-ba7c-86d97b1cd974	1	2026-08-02 15:20:25.56251
47433747-50a9-4368-8f9a-7d59e45b3b74	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	57a8c339-1ba9-4302-9e32-c76937d4a484	1	2026-08-02 15:20:25.56251
848d80e6-b669-4111-a929-2efc52273c45	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	88317948-f783-4011-b821-279fc52664ed	1	2026-08-02 15:20:25.56251
f2009cc9-8d27-4257-9990-53c1c786ec60	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	1	2026-08-02 15:20:25.56251
e2b30972-5849-435c-884d-a8ff94d0d57a	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	63564589-8028-4e6b-9a2f-888706f5107e	1	2026-08-02 15:20:25.56251
a8ed875a-e37a-4bb7-b78f-f31548c75a04	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	ed650960-6d6b-466d-938f-baa44172b04b	1	2026-08-02 15:20:25.56251
f43cff74-ac0d-4624-baa9-d3de68d6fb96	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	c2253db3-d365-4410-8d60-b344e5c54996	1	2026-08-02 15:20:25.56251
1f7e487e-1f82-4466-b8b9-4c78ed1bef6d	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	87e63623-0386-4ee5-ae51-7e200442b7b6	1	2026-08-02 15:20:25.56251
e82ed3c3-379c-44c6-babf-28597c35f8a6	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	97aea0d8-b95f-4fce-ad37-3b6b0cbebf62	1	2026-08-02 15:20:25.56251
70811520-1210-4b61-bc03-b07fa1536a64	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	1520f825-25f2-482f-a2b3-0e613c64a61d	1	2026-08-02 15:20:25.56251
3e6a5e41-c4d2-49aa-9632-5928548122d4	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	18777f10-b733-465c-a591-c9257770e1af	1	2026-08-02 15:20:25.56251
7df2fc5a-22b0-4db5-bfec-4a0b67a87a5b	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	e82712cd-232a-40c0-92d1-3d583435f7d4	1	2026-08-02 15:20:25.56251
\.


--
-- Data for Name: favorites; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.favorites (id, player_id, card_id, created_at) FROM stdin;
0fba8eb3-f0ad-4e68-be73-760ff28dc71a	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	57a8c339-1ba9-4302-9e32-c76937d4a484	2026-08-02 15:57:28.022235
8f3f17c9-7cd7-4264-b828-8fc23d464a50	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	2026-08-02 16:33:49.251565
\.


--
-- Data for Name: flyway_schema_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	create players	SQL	V1__create_players.sql	-1367248091	postgres	2026-08-02 14:26:51.391708	3888	t
2	2	create card catalog	SQL	V2__create_card_catalog.sql	672130975	postgres	2026-08-02 14:27:00.616764	320	t
3	3	create decks	SQL	V3__create_decks.sql	536056284	postgres	2026-08-02 14:50:57.336352	95	t
4	4	create formats	SQL	V4__create_formats.sql	38255997	postgres	2026-08-02 14:50:59.123954	28	t
5	5	create favorites	SQL	V5__create_favorites.sql	319053925	postgres	2026-08-02 15:56:43.7147	119	t
6	6	create matches	SQL	V6__create_matches.sql	529561130	postgres	2026-08-02 17:01:25.669667	106	t
7	7	add battle code	SQL	V7__add_battle_code.sql	-1733440095	postgres	2026-08-02 20:24:37.219455	175	t
\.


--
-- Data for Name: formats; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.formats (id, code, name, max_copies, min_deck_size, max_deck_size, commander_required, basics_unlimited) FROM stdin;
11111111-1111-4111-8111-111111111111	STANDARD	Standard	4	60	\N	f	t
22222222-2222-4222-8222-222222222222	COMMANDER	Commander	1	99	99	t	t
\.


--
-- Data for Name: matches; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.matches (id, player1_id, player2_id, deck1_id, deck2_id, status, winner_id, created_at, ended_at, battle_code) FROM stdin;
57f7cfcd-a7af-4cba-add4-bac8b422e0ff	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	\N	bce0e377-e176-453f-8c8b-2240f175ef9d	\N	CONCEDED	\N	2026-08-02 17:29:01.549597	2026-08-02 17:29:52.30255	\N
fb76d818-e34a-4cb3-a4d7-b938870ba805	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	\N	bce0e377-e176-453f-8c8b-2240f175ef9d	\N	CONCEDED	\N	2026-08-02 17:12:35.379914	2026-08-02 17:29:57.653149	\N
80e6ffb1-3567-42af-aef9-781287ea8503	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	\N	cbaaf17d-1511-4cd0-ae20-45811504f4bd	\N	CONCEDED	\N	2026-08-02 17:48:24.164559	2026-08-02 17:48:44.266427	\N
ecd11f01-dbad-497e-8dcd-f35ffe6a3e59	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	\N	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	\N	COMPLETED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 18:36:15.1021	2026-08-02 18:37:28.901137	\N
0d742481-3397-4c5d-92fd-20cbd88776ae	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	\N	19c9e942-aac7-490f-a33e-b1f5df9cb2ad	\N	COMPLETED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 18:48:34.279577	2026-08-02 18:49:27.312407	\N
30559a42-f465-488b-8695-50a440753a94	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	\N	c67fc8e9-861e-4f95-855d-563bde2f3b6e	\N	CONCEDED	\N	2026-08-02 18:55:38.709596	2026-08-02 18:56:04.947137	\N
1fb3a259-01e0-4abe-8993-07462cf6aa23	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	4d4fb548-712b-4868-b04f-9a47e0bc37c5	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	CONCEDED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 20:35:59.67274	2026-08-02 20:37:21.431536	MVR83E
e29b54f9-2fc8-4ff2-801e-a207f5b4e3b6	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	4d4fb548-712b-4868-b04f-9a47e0bc37c5	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	CONCEDED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 20:41:00.602498	2026-08-02 20:41:09.505335	DWYKA9
0494f58e-5175-482d-928c-88cfb8cfdae5	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	4d4fb548-712b-4868-b04f-9a47e0bc37c5	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	CONCEDED	4d4fb548-712b-4868-b04f-9a47e0bc37c5	2026-08-02 20:42:25.643928	2026-08-02 20:43:47.570371	883PRT
f307c67e-6e86-415a-808d-799e587a8211	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	4d4fb548-712b-4868-b04f-9a47e0bc37c5	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	CONCEDED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 20:43:39.522123	2026-08-02 20:45:01.220306	MVTQG8
4e2ac42e-6291-450b-ba5f-c3b8f032a05c	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	4d4fb548-712b-4868-b04f-9a47e0bc37c5	c5d24cf4-43b4-4dff-a1f5-f30e4a761404	daee486e-9a4c-4a8d-81c9-5c7f3086dea9	CONCEDED	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	2026-08-02 20:44:07.069387	2026-08-02 20:45:28.929985	ZZJ9RT
3d5c163a-413e-49cf-9d38-5ca05d346848	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	140a2eb6-ee86-4435-b0af-dba6cdca4ee4	8582af98-6cef-47a5-ac69-cfcd33f1d9f2	3847a5d1-3a65-470b-8e1e-2e9caa895d99	CONCEDED	140a2eb6-ee86-4435-b0af-dba6cdca4ee4	2026-08-02 21:55:00.423842	2026-08-02 21:58:40.755798	P6GTWX
\.


--
-- Data for Name: player_unlocks; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.player_unlocks (id, player_id, card_id, unlocked_at) FROM stdin;
fcb48084-dc22-45a1-8917-1321141e2dbe	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	57a8c339-1ba9-4302-9e32-c76937d4a484	2026-08-02 15:20:25.56251
d0c56ea9-cca8-4fcd-8ee6-db183fd61eea	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	88317948-f783-4011-b821-279fc52664ed	2026-08-02 15:20:25.56251
1dbe147c-3282-4265-a670-bb98b95caf2e	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	2026-08-02 15:20:25.56251
c7a6a457-f9c3-4369-b17e-3196ec5f2278	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	63564589-8028-4e6b-9a2f-888706f5107e	2026-08-02 15:20:25.56251
82e326e0-297a-4dd5-b022-7a5049d77b95	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	ed650960-6d6b-466d-938f-baa44172b04b	2026-08-02 15:20:25.56251
1f435f08-1647-45c3-8094-534f514fb527	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	c2253db3-d365-4410-8d60-b344e5c54996	2026-08-02 15:20:25.56251
3c3e8116-11fb-41a2-8ee3-5541831c4cbc	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	87e63623-0386-4ee5-ae51-7e200442b7b6	2026-08-02 15:20:25.56251
df7c5e94-4917-489f-8bdc-5a194126c1e5	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	18777f10-b733-465c-a591-c9257770e1af	2026-08-02 15:20:25.56251
57535225-f084-40d4-bed4-fd5efe6b6f0f	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	88317948-f783-4011-b821-279fc52664ed	2026-08-02 18:36:02.891352
88039800-a4c8-47ff-a843-e67098b6121f	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	f45b7b77-66bd-4190-8d54-2aa4a191f3a8	2026-08-02 18:36:02.891352
e3f5bea6-8ceb-42ad-b0c9-2c1fe75e2661	ac3cc775-3c5f-4de9-99fe-75266b4ebca8	c2253db3-d365-4410-8d60-b344e5c54996	2026-08-02 18:36:02.891352
\.


--
-- Data for Name: players; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.players (id, avatar, created, display_name, email, experience, last_login, level, password_hash, role, student_id) FROM stdin;
c7cd01f7-2ec9-4730-924f-ec18b084b768	\N	2026-08-02 14:28:05.037588	Dave	dave@campus.edu	10	\N	1	$2a$10$EEVf90o5Eezpc4Fio/sOUe62m5STB6IZYlyJGuNJlVEQx.TNFwN5u	ROLE_PLAYER	\N
ac3cc775-3c5f-4de9-99fe-75266b4ebca8	\N	2026-08-02 18:34:51.429639	BattleTest	testbattle@campus.edu	0	2026-08-02 20:44:05.576202	1	$2a$10$WlrEGv8MF/30L/ucaDiRUeiUaemzJb0vfB.aiazTZzweWvpr.6qCK	ROLE_PLAYER	\N
874748dc-99cc-4fdf-9f7a-a1c368d9e111	\N	2026-08-02 15:13:27.280981	Tcent	a@iiitd.ac.in	0	\N	1	$2a$10$tHDnVvECskqN4aVFxeEFi.NeXAMutnCLekJtrJem/mWPRGxiutLKO	ROLE_PLAYER	\N
4d4fb548-712b-4868-b04f-9a47e0bc37c5	\N	2026-08-02 20:26:25.77772	Opponent	opponent@campus.edu	0	2026-08-02 20:44:06.398419	1	$2a$10$tUquxUOlaE2CVBhRWmQjReBjxw0SW1XhJhx24aZbaCsOb2xAZHBMK	ROLE_PLAYER	\N
140a2eb6-ee86-4435-b0af-dba6cdca4ee4	\N	2026-08-02 21:55:59.711625	firewall	test2@gmail.com	0	\N	1	$2a$10$xpukjz.9KaxdRQhq6F1D2eDXhdpct4XzIfDK1CBSEYuwzv9.TghTO	ROLE_PLAYER	\N
8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	\N	2026-08-02 15:11:54.61529	FireBall	test0@gmail.com	0	2026-08-02 18:27:43.91496	1	$2a$10$.i8/1atUJLSMlp1kRH.bNOBIzpTufzomprQVec2RexFMnljnyjjxq	ROLE_PLAYER	\N
\.


--
-- Data for Name: unique_cards; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.unique_cards (physical_uuid, owner_id, card_id, serial_number, claimed_at, history) FROM stdin;
0626328f-e117-4b4b-a8fc-61e20e37d928	c7cd01f7-2ec9-4730-924f-ec18b084b768	1520f825-25f2-482f-a2b3-0e613c64a61d	1	2026-08-02 14:28:21.703657	claimed via discovery
7d76a73e-bb31-411c-b750-a89622eb1cbe	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	97aea0d8-b95f-4fce-ad37-3b6b0cbebf62	1	2026-08-02 15:20:25.56251	granted for testing
06f63d11-d26d-4b4e-8d41-c3d0a11e6a72	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	e82712cd-232a-40c0-92d1-3d583435f7d4	2	2026-08-02 15:20:25.56251	granted for testing
fb4df728-82b6-4f91-b1c8-b11ded672390	8cccb17b-1b9f-45b2-ab77-5d4bf631c5a3	1520f825-25f2-482f-a2b3-0e613c64a61d	2	2026-08-02 15:20:25.56251	granted for testing
\.


--
-- Name: card_legalities card_legalities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_legalities
    ADD CONSTRAINT card_legalities_pkey PRIMARY KEY (id);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: deck_cards deck_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deck_cards
    ADD CONSTRAINT deck_cards_pkey PRIMARY KEY (id);


--
-- Name: decks decks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT decks_pkey PRIMARY KEY (id);


--
-- Name: discoveries discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discoveries
    ADD CONSTRAINT discoveries_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: flyway_schema_history flyway_schema_history_pk; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.flyway_schema_history
    ADD CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank);


--
-- Name: formats formats_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.formats
    ADD CONSTRAINT formats_pkey PRIMARY KEY (id);


--
-- Name: matches matches_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT matches_pkey PRIMARY KEY (id);


--
-- Name: player_unlocks player_unlocks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_unlocks
    ADD CONSTRAINT player_unlocks_pkey PRIMARY KEY (id);


--
-- Name: players players_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT players_pkey PRIMARY KEY (id);


--
-- Name: card_legalities uk_card_legalities_card_format; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_legalities
    ADD CONSTRAINT uk_card_legalities_card_format UNIQUE (card_id, format_id);


--
-- Name: cards uk_cards_oracle_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT uk_cards_oracle_id UNIQUE (oracle_id);


--
-- Name: deck_cards uk_deck_cards_deck_card; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deck_cards
    ADD CONSTRAINT uk_deck_cards_deck_card UNIQUE (deck_id, card_id);


--
-- Name: discoveries uk_discoveries_player_card; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discoveries
    ADD CONSTRAINT uk_discoveries_player_card UNIQUE (player_id, card_id);


--
-- Name: favorites uk_favorites_player_card; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT uk_favorites_player_card UNIQUE (player_id, card_id);


--
-- Name: formats uk_formats_code; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.formats
    ADD CONSTRAINT uk_formats_code UNIQUE (code);


--
-- Name: player_unlocks uk_player_unlocks_player_card; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_unlocks
    ADD CONSTRAINT uk_player_unlocks_player_card UNIQUE (player_id, card_id);


--
-- Name: unique_cards uk_unique_cards_serial; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unique_cards
    ADD CONSTRAINT uk_unique_cards_serial UNIQUE (card_id, serial_number);


--
-- Name: players ukpnrwm9bkjel7qss1ekm05j953; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.players
    ADD CONSTRAINT ukpnrwm9bkjel7qss1ekm05j953 UNIQUE (email);


--
-- Name: unique_cards unique_cards_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unique_cards
    ADD CONSTRAINT unique_cards_pkey PRIMARY KEY (physical_uuid);


--
-- Name: flyway_schema_history_s_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX flyway_schema_history_s_idx ON public.flyway_schema_history USING btree (success);


--
-- Name: idx_cards_forge_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cards_forge_name ON public.cards USING btree (forge_name);


--
-- Name: idx_cards_ownership_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cards_ownership_type ON public.cards USING btree (ownership_type);


--
-- Name: idx_deck_cards_deck; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_deck_cards_deck ON public.deck_cards USING btree (deck_id);


--
-- Name: idx_decks_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_decks_player ON public.decks USING btree (player_id);


--
-- Name: idx_discoveries_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_discoveries_player ON public.discoveries USING btree (player_id);


--
-- Name: idx_favorites_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_favorites_player ON public.favorites USING btree (player_id);


--
-- Name: idx_matches_player1; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_player1 ON public.matches USING btree (player1_id);


--
-- Name: idx_matches_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_matches_status ON public.matches USING btree (status);


--
-- Name: idx_player_unlocks_player; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_player_unlocks_player ON public.player_unlocks USING btree (player_id);


--
-- Name: idx_unique_cards_owner; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_unique_cards_owner ON public.unique_cards USING btree (owner_id);


--
-- Name: uq_matches_battle_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_matches_battle_code ON public.matches USING btree (battle_code);


--
-- Name: card_legalities fk_card_legalities_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_legalities
    ADD CONSTRAINT fk_card_legalities_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: card_legalities fk_card_legalities_format; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.card_legalities
    ADD CONSTRAINT fk_card_legalities_format FOREIGN KEY (format_id) REFERENCES public.formats(id);


--
-- Name: deck_cards fk_deck_cards_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deck_cards
    ADD CONSTRAINT fk_deck_cards_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: deck_cards fk_deck_cards_deck; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deck_cards
    ADD CONSTRAINT fk_deck_cards_deck FOREIGN KEY (deck_id) REFERENCES public.decks(id) ON DELETE CASCADE;


--
-- Name: decks fk_decks_commander; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT fk_decks_commander FOREIGN KEY (commander_card_id) REFERENCES public.cards(id);


--
-- Name: decks fk_decks_player; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.decks
    ADD CONSTRAINT fk_decks_player FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: discoveries fk_discoveries_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discoveries
    ADD CONSTRAINT fk_discoveries_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: discoveries fk_discoveries_player; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.discoveries
    ADD CONSTRAINT fk_discoveries_player FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: favorites fk_favorites_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT fk_favorites_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: favorites fk_favorites_player; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT fk_favorites_player FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: matches fk_matches_deck1; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT fk_matches_deck1 FOREIGN KEY (deck1_id) REFERENCES public.decks(id);


--
-- Name: matches fk_matches_deck2; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT fk_matches_deck2 FOREIGN KEY (deck2_id) REFERENCES public.decks(id);


--
-- Name: matches fk_matches_player1; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT fk_matches_player1 FOREIGN KEY (player1_id) REFERENCES public.players(id);


--
-- Name: matches fk_matches_player2; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matches
    ADD CONSTRAINT fk_matches_player2 FOREIGN KEY (player2_id) REFERENCES public.players(id);


--
-- Name: player_unlocks fk_player_unlocks_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_unlocks
    ADD CONSTRAINT fk_player_unlocks_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: player_unlocks fk_player_unlocks_player; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.player_unlocks
    ADD CONSTRAINT fk_player_unlocks_player FOREIGN KEY (player_id) REFERENCES public.players(id);


--
-- Name: unique_cards fk_unique_cards_card; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unique_cards
    ADD CONSTRAINT fk_unique_cards_card FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: unique_cards fk_unique_cards_player; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unique_cards
    ADD CONSTRAINT fk_unique_cards_player FOREIGN KEY (owner_id) REFERENCES public.players(id);


--
-- PostgreSQL database dump complete
--

\unrestrict ML66vtyjeb2biOf34VbqJ6YZQk2K4Gk4fQqUwoWADo2K9fDWKGppOtCDiR5k2N9

