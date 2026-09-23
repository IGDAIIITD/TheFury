-- =====================================================================
-- Campus Forge -> Supabase  Full Setup (single script for SQL Editor)
-- =====================================================================
-- Paste ALL of this into the hosted Supabase SQL Editor and run once on a
-- fresh project. (Migrations use plain CREATE, so don't re-run wholesale on
-- an already-provisioned DB.)
--
-- After running, update the web-client env vars (web-client/.env.development
-- or .env.local) with YOUR project's URL and anon key:
--   VITE_SUPABASE_URL          = https://<project-ref>.supabase.co
--   VITE_SUPABASE_ANON_KEY     = <anon key from Project Settings -> API>
--   VITE_BATTLE_ENGINE_URL     = <your inline-tunnel engine URL, if any>
-- And on the battle-engine host:
--   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CAMPUSFORGE_CORS_ALLOWED_ORIGINS
--
-- ******************** FILE: 20260923000000_profiles_auth.sql ********************
-- Campus Forge → Supabase
-- Migration 1/9: profiles replaces `players`, keyed 1:1 off auth.users.
-- Mirrors backend/.../V1__create_players.sql + V10__add_player_cohort.sql,
-- plus cohort validation + the level formula as a single Postgres function.

-- Level formula, single source of truth (TECHNICAL.md rule #2).
create or replace function public.compute_level(xp bigint)
returns integer
language sql
immutable
as $$
    select 1 + (xp / 100)::integer;
$$;

-- Cohort validation, single source of truth (Cohort.java).
create or replace function public.is_cohort_valid(degree_level text, specialization text)
returns boolean
language sql
immutable
as $$
    select case upper(degree_level)
        when 'BTECH' then upper(specialization) in ('CSE','CSAI','CSAM','CSB','CSSS','CSD','CSECON','ECE','EVE')
        when 'MTECH' then upper(specialization) in ('CSE','ECE')
        else false
    end;
$$;

-- Department roll-up (Cohort.java): ECE group = ECE, EVE; everything else CSE.
create or replace function public.department_of(specialization text)
returns text
language sql
immutable
as $$
    select case upper(specialization)
        when 'ECE' then 'ECE'
        when 'EVE' then 'ECE'
        else 'CSE'
    end;
$$;

-- profiles: identity + progression, hand-written to auth.users.
create table public.profiles (
    id              uuid primary key references auth.users (id) on delete cascade,
    display_name    text not null,
    email           text not null,
    student_id      text,
    avatar          text,
    role            text not null default 'PLAYER' check (role in ('PLAYER','ADMIN')),
    experience      bigint not null default 0,
    level           integer not null default 1,
    degree_level    text,
    specialization  text,
    banned          boolean not null default false,
    banned_at       timestamp,
    onboarding_seen boolean not null default false,
    created         timestamptz not null default now(),
    last_login      timestamptz,
    constraint chk_profiles_cohort check (
        (degree_level is null and specialization is null)
        or public.is_cohort_valid(degree_level, specialization)
    ),
    constraint fk_profiles_auth foreign key (id) references auth.users (id) on delete cascade
);

create index idx_profiles_cohort on public.profiles (degree_level, specialization);
create index idx_profiles_role on public.profiles (role);
create index idx_profiles_level on public.profiles (level);

-- keep level derived from experience at all times
create or replace function public.sync_profile_level()
returns trigger
language plpgsql
as $$
begin
    new.level := public.compute_level(new.experience);
    return new;
end;
$$;

create trigger trg_profiles_sync_level
before insert or update of experience on public.profiles
for each row execute function public.sync_profile_level();

-- create a profile the moment a user signs up (Phase 2 auth hook).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))),
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- admin check used by RLS policies; security definer so it does not recurse.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'ADMIN'
    );
$$;

alter table public.profiles enable row level security;

-- users read/update their own row; admins read/update everyone.
create policy profiles_select_own
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy profiles_update_own
on public.profiles for update
using (id = auth.uid() or public.is_admin());

-- insert/delete are driven by the auth trigger (definer) and admins only.
create policy profiles_insert_admin
on public.profiles for insert
with check (public.is_admin());

create policy profiles_delete_admin
on public.profiles for delete
using (public.is_admin());


-- ******************** FILE: 20260923000001_card_catalog.sql ********************
-- Campus Forge → Supabase
-- Migration 2/9: card catalog + formats/legalities.
-- Mirrors V2__create_card_catalog.sql + V4__create_formats.sql.

create table public.cards (
    id                 uuid primary key,
    oracle_id          text not null unique,
    forge_name         text not null,
    rarity             text,
    ownership_type     text not null check (ownership_type in ('UNLIMITED','UNLOCK','UNIQUE')),
    set_code           text,
    mana_value         integer,
    types              text,
    colors             text,
    image_url          text,
    discoverable       boolean not null default true,
    spawn_region       text,
    weight             double precision,
    commander_eligible boolean not null default false
);

create index idx_cards_forge_name on public.cards (forge_name);
create index idx_cards_ownership_type on public.cards (ownership_type);

create table public.formats (
    id                 uuid primary key,
    code               text not null unique,
    name               text not null,
    max_copies         integer not null,
    min_deck_size      integer not null,
    max_deck_size      integer,
    commander_required boolean not null,
    basics_unlimited   boolean not null
);

create table public.card_legalities (
    id        uuid primary key,
    card_id   uuid not null references public.cards (id) on delete cascade,
    format_id uuid not null references public.formats (id) on delete cascade,
    legality  text not null check (legality in ('LEGAL','BANNED','NOTLEGAL','RESTRICTED')),
    constraint uk_card_legalities_card_format unique (card_id, format_id)
);

-- Catalog is public-read; only admins mutate it.
alter table public.cards enable row level security;
alter table public.formats enable row level security;
alter table public.card_legalities enable row level security;

create policy cards_select_all on public.cards for select using (true);
create policy formats_select_all on public.formats for select using (true);
create policy card_legalities_select_all on public.card_legalities for select using (true);

create policy cards_admin_all on public.cards for all using (public.is_admin()) with check (public.is_admin());
create policy formats_admin_all on public.formats for all using (public.is_admin()) with check (public.is_admin());
create policy card_legalities_admin_all on public.card_legalities for all using (public.is_admin()) with check (public.is_admin());

-- Fixed format ids, matching V4.
insert into public.formats (id, code, name, max_copies, min_deck_size, max_deck_size, commander_required, basics_unlimited)
values
    ('11111111-1111-4111-8111-111111111111', 'STANDARD',  'Standard',  4, 60, null, false, true),
    ('22222222-2222-4222-8222-222222222222', 'COMMANDER', 'Commander', 1, 99, 99,  true,  true)
on conflict (code) do nothing;


-- ******************** FILE: 20260923000002_collection.sql ********************
-- Campus Forge → Supabase
-- Migration 3/9: collection/ownership tables.
-- Mirrors V2 player_unlocks/unique_cards/discoveries + V5 favorites.

create table public.player_unlocks (
    id          uuid primary key,
    player_id   uuid not null references public.profiles (id) on delete cascade,
    card_id     uuid not null references public.cards (id) on delete cascade,
    unlocked_at timestamptz not null default now(),
    constraint uk_player_unlocks_player_card unique (player_id, card_id)
);

create index idx_player_unlocks_player on public.player_unlocks (player_id);

create table public.unique_cards (
    physical_uuid uuid primary key,
    owner_id      uuid not null references public.profiles (id) on delete cascade,
    card_id       uuid not null references public.cards (id) on delete cascade,
    serial_number integer not null,
    claimed_at    timestamptz not null default now(),
    history       text,
    constraint uk_unique_cards_serial unique (card_id, serial_number)
);

create index idx_unique_cards_owner on public.unique_cards (owner_id);
create index idx_unique_cards_card on public.unique_cards (card_id);

create table public.discoveries (
    id              uuid primary key,
    player_id       uuid not null references public.profiles (id) on delete cascade,
    card_id         uuid not null references public.cards (id) on delete cascade,
    count           bigint not null default 0,
    last_discovered timestamptz not null default now(),
    constraint uk_discoveries_player_card unique (player_id, card_id)
);

create index idx_discoveries_player on public.discoveries (player_id);

create table public.favorites (
    id         uuid primary key,
    player_id  uuid not null references public.profiles (id) on delete cascade,
    card_id    uuid not null references public.cards (id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint uk_favorites_player_card unique (player_id, card_id)
);

create index idx_favorites_player on public.favorites (player_id);

alter table public.player_unlocks enable row level security;
alter table public.unique_cards enable row level security;
alter table public.discoveries enable row level security;
alter table public.favorites enable row level security;

-- players manage their own unlocks / discoveries / favorites
create policy player_unlocks_select_own on public.player_unlocks for select using (player_id = auth.uid() or public.is_admin());
create policy player_unlocks_insert_own on public.player_unlocks for insert with check (player_id = auth.uid());
create policy player_unlocks_delete_own on public.player_unlocks for delete using (player_id = auth.uid());

create policy discoveries_select_own on public.discoveries for select using (player_id = auth.uid() or public.is_admin());
create policy discoveries_insert_own on public.discoveries for insert with check (player_id = auth.uid());
create policy discoveries_update_own on public.discoveries for update using (player_id = auth.uid());

create policy favorites_select_own on public.favorites for select using (player_id = auth.uid() or public.is_admin());
create policy favorites_insert_own on public.favorites for insert with check (player_id = auth.uid());
create policy favorites_delete_own on public.favorites for delete using (player_id = auth.uid());

-- unique_cards: owner sees their own; admins see all. A trade-partner
-- visibility policy is added in migration 5/9 once trades/trade_cards exist.
create policy unique_cards_select_own on public.unique_cards for select
using (owner_id = auth.uid() or public.is_admin());

create policy unique_cards_insert_admin on public.unique_cards for insert with check (public.is_admin());
create policy unique_cards_update_admin on public.unique_cards for update using (public.is_admin()) with check (public.is_admin());

-- a player is allowed to update the unique cards they are trading only through
-- the definer function accept_trade (see migration 7/9), never directly.


-- ******************** FILE: 20260923000003_decks_matches.sql ********************
-- Campus Forge → Supabase
-- Migration 4/9: decks + deck_cards, and the matches table.
-- Mirrors V3__create_decks.sql and V6__create_matches.sql (+V7/V8/V12 event id).
-- The battle-engine (writes) is the only writer of `matches`, via
-- service-role RPC record_match_result (migration 8/9).

create table public.decks (
    id                uuid primary key,
    player_id         uuid not null references public.profiles (id) on delete cascade,
    name              text not null,
    format_code       text not null,
    commander_card_id uuid references public.cards (id),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index idx_decks_player on public.decks (player_id);

create table public.deck_cards (
    id       uuid primary key,
    deck_id  uuid not null references public.decks (id) on delete cascade,
    card_id  uuid not null references public.cards (id) on delete cascade,
    quantity integer not null default 1,
    constraint uk_deck_cards_deck_card unique (deck_id, card_id)
);

create index idx_deck_cards_deck on public.deck_cards (deck_id);

create table public.matches (
    id            uuid primary key,
    player1_id    uuid not null references public.profiles (id) on delete cascade,
    player2_id    uuid references public.profiles (id),
    deck1_id      uuid not null references public.decks (id),
    deck2_id      uuid references public.decks (id),
    status        text not null default 'WAITING',
    winner_id     uuid references public.profiles (id),
    win_condition text,
    battle_code   text,
    created_at    timestamptz not null default now(),
    ended_at      timestamptz
);

create unique index uq_matches_battle_code on public.matches (battle_code);
create index idx_matches_player1 on public.matches (player1_id);
create index idx_matches_status on public.matches (status);

alter table public.decks enable row level security;
alter table public.deck_cards enable row level security;
alter table public.matches enable row level security;

-- decks belong to their owner
create policy decks_select_own on public.decks for select using (player_id = auth.uid() or public.is_admin());
create policy decks_insert_own on public.decks for insert with check (player_id = auth.uid());
create policy decks_update_own on public.decks for update using (player_id = auth.uid());
create policy decks_delete_own on public.decks for delete using (player_id = auth.uid());

create policy deck_cards_select_own on public.deck_cards for select
using (deck_id in (select id from public.decks where player_id = auth.uid()) or public.is_admin());
create policy deck_cards_insert_own on public.deck_cards for insert
with check (deck_id in (select id from public.decks where player_id = auth.uid()));
create policy deck_cards_update_own on public.deck_cards for update
using (deck_id in (select id from public.decks where player_id = auth.uid()));
create policy deck_cards_delete_own on public.deck_cards for delete
using (deck_id in (select id from public.decks where player_id = auth.uid()));

-- matches: participants can read their own matches (for profile/history) and
-- admins can read all; the battle-engine writes via a definer service-role RPC.
create policy matches_select_own on public.matches for select
using (player1_id = auth.uid() or player2_id = auth.uid() or public.is_admin());

create policy matches_insert_admin on public.matches for insert with check (public.is_admin());
create policy matches_update_admin on public.matches for update using (public.is_admin()) with check (public.is_admin());


-- ******************** FILE: 20260923000004_trades.sql ********************
-- Campus Forge → Supabase
-- Migration 5/9: trades + trade_cards (V11) and the trade-partner RLS
-- visibility policy on unique_cards.

create table public.trades (
    id          uuid primary key,
    sender_id   uuid not null references public.profiles (id) on delete cascade,
    receiver_id uuid not null references public.profiles (id) on delete cascade,
    status      text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
    created_at  timestamptz not null default now(),
    resolved_at timestamptz,
    expires_at  timestamptz not null default now() + interval '24 hours',
    constraint chk_trades_parties check (sender_id <> receiver_id)
);

create table public.trade_cards (
    id            uuid primary key,
    trade_id      uuid not null references public.trades (id) on delete cascade,
    side          text not null check (side in ('OFFERED','REQUESTED')),
    physical_uuid uuid not null references public.unique_cards (physical_uuid) on delete cascade,
    constraint uk_trade_cards_trade_side_card unique (trade_id, side, physical_uuid)
);

create index idx_trades_sender_status on public.trades (sender_id, status);
create index idx_trades_receiver_status on public.trades (receiver_id, status);
create index idx_trade_cards_trade on public.trade_cards (trade_id);
create index idx_trade_cards_physical_uuid on public.trade_cards (physical_uuid);

alter table public.trades enable row level security;
alter table public.trade_cards enable row level security;

create policy trades_select_party on public.trades for select
using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());

create policy trades_insert_sender on public.trades for insert
with check (sender_id = auth.uid());

-- accept/decline/cancel happen through the accept_trade definer function;
-- the receiver may mark DECLINED and the sender CANCELLED directly, matching
-- current role rules, but ownership swaps only go through the function.
create policy trades_update_party on public.trades for update
using ((sender_id = auth.uid() or receiver_id = auth.uid()) or public.is_admin());

create policy trade_cards_select_party on public.trade_cards for select
using (
    trade_id in (select id from public.trades where sender_id = auth.uid() or receiver_id = auth.uid())
    or public.is_admin()
);

create policy trade_cards_insert_party on public.trade_cards for insert
with check (
    trade_id in (select id from public.trades where sender_id = auth.uid())
);

create policy trade_cards_delete_party on public.trade_cards for delete
using (
    trade_id in (select id from public.trades where sender_id = auth.uid() and status = 'PENDING')
);

-- trade-partner visibility: a PENDING trade makes the listed unique cards
-- visible to both parties (TradePage reads partner's uniques this way).
create policy unique_cards_select_trade_party on public.unique_cards for select
using (
    exists (
        select 1 from public.trade_cards tc
        join public.trades t on t.id = tc.trade_id
        where tc.physical_uuid = unique_cards.physical_uuid
          and t.status = 'PENDING'
          and (t.sender_id = auth.uid() or t.receiver_id = auth.uid())
    )
);


-- ******************** FILE: 20260923000005_claims_events_achievements.sql ********************
-- Campus Forge → Supabase
-- Migration 6/9: events + achievements (V12/V13), claims (V9 + V14 signed cores),
-- and the matches.event_id cascade added once events exists.

create table public.events (
    id                uuid primary key,
    name              text not null,
    allowed_sets_json text not null default '[]',
    bonus_multiplier  numeric(5,2) not null default 1.00,
    start_time        timestamptz not null,
    end_time          timestamptz not null,
    active            boolean not null default true,
    created_at        timestamptz not null default now(),
    constraint chk_events_window check (end_time > start_time),
    constraint chk_events_bonus check (bonus_multiplier >= 1.00)
);

create index idx_events_window on public.events (start_time, end_time);

-- matches.event_id with V13 cascade (matches table is from migration 4/9).
alter table public.matches add column event_id uuid;
alter table public.matches
    add constraint fk_matches_event foreign key (event_id) references public.events (id) on delete cascade;
create index idx_matches_event on public.matches (event_id);

create table public.claims (
    id         uuid primary key,
    token      text not null unique,
    token_core text not null,
    card_id    uuid not null references public.cards (id),
    building   text,
    expires_at timestamptz,
    status     text not null default 'ACTIVE' check (status in ('ACTIVE','CLAIMED','EXPIRED','REVOKED')),
    claimed_by uuid references public.profiles (id),
    claimed_at timestamptz,
    created_at timestamptz not null default now(),
    event_id   uuid references public.events (id) on delete cascade,
    spawned_by uuid references public.profiles (id)
);

create unique index uk_claims_token_core on public.claims (token_core);
create index idx_claims_status on public.claims (status);
create index idx_claims_card on public.claims (card_id);
create index idx_claims_event on public.claims (event_id);

create table public.player_achievements (
    id          uuid primary key,
    player_id   uuid not null references public.profiles (id) on delete cascade,
    code        text not null,
    unlocked_at timestamptz not null default now(),
    constraint uk_player_achievements_player_code unique (player_id, code)
);

create index idx_player_achievements_player on public.player_achievements (player_id);

alter table public.claims enable row level security;
alter table public.events enable row level security;
alter table public.player_achievements enable row level security;

-- claims are minted/consumed by the claim Edge Function via service role.
-- players may read the claims they have already claimed (claim history).
create policy claims_select_own on public.claims for select
using (claimed_by = auth.uid() or public.is_admin());

-- events: everyone reads; only admins manage.
create policy events_select_all on public.events for select using (true);
create policy events_admin_all on public.events for all using (public.is_admin()) with check (public.is_admin());

-- achievements are written by definer functions (sweep) and read by the owner.
create policy player_achievements_select_own on public.player_achievements for select
using (player_id = auth.uid() or public.is_admin());
create policy player_achievements_insert_own on public.player_achievements for insert
with check (player_id = auth.uid());


-- ******************** FILE: 20260923000006_game_functions.sql ********************
-- Campus Forge → Supabase
-- Migration 7/9: core game functions called by Edge Functions, the
-- battle-engine (service role), and direct client RPC.
-- Deadlock-avoidance rule preserved: row locks in sorted-UUID order.
--
-- Faithful ports of the Java semantics (ClaimService, CollectionService,
-- TradeService, MatchManager, FeedService) — see the fix list in
-- STEPS/supabase-migration-map.md.

-- ---------------------------------------------------------------
-- Feed ring (moved here from migration 8/9 so the definer functions
-- below can write feed rows). Mirrors the old in-memory CAPACITY=50.
-- ---------------------------------------------------------------
create table public.activity_feed (
    id         bigint generated always as identity primary key,
    type       text not null,
    text       text not null,
    player_id  uuid references public.profiles (id) on delete set null,
    card_id    uuid references public.cards (id) on delete set null,
    created_at timestamptz not null default now()
);

create index idx_activity_feed_created on public.activity_feed (created_at desc);

alter table public.activity_feed enable row level security;
create policy activity_feed_select_all on public.activity_feed for select using (true);

create or replace function public.prune_feed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.activity_feed
     where id not in (
        select id from public.activity_feed order by id desc limit 50
     );
    return null;
end;
$$;

create trigger trg_feed_prune
after insert on public.activity_feed
for each statement execute function public.prune_feed();

create or replace function public.add_feed_entry(p_type text, p_text text, p_player uuid default null, p_card uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.activity_feed (type, text, player_id, card_id)
    values (p_type, p_text, p_player, p_card);
end;
$$;

revoke all on function public.add_feed_entry(text, text, uuid, uuid) from public;
grant execute on function public.add_feed_entry(text, text, uuid, uuid) to service_role;

alter publication supabase_realtime add table public.activity_feed;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- unique_physical_uuid: UUID.nameUUIDFromBytes("cf-unique:" + core),
-- the deterministic physical identity of a UNIQUE card so a QR token
-- maps to exactly one serialized copy (Java ClaimService.physicalUuidFor).
-- MD5 with version-3 + IETF-variant bits set.
-- ---------------------------------------------------------------
create or replace function public.unique_physical_uuid(p_core text)
returns uuid
language plpgsql
immutable
as $$
declare
    v bytea := decode(md5('cf-unique:' || p_core), 'hex');
    hex text;
begin
    v := set_byte(v, 6, (get_byte(v, 6) & 15) | 48);
    v := set_byte(v, 8, (get_byte(v, 8) & 63) | 128);
    hex := encode(v, 'hex');
    return (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-' ||
            substr(hex, 13, 4) || '-' || substr(hex, 17, 4) || '-' ||
            substr(hex, 21, 12))::uuid;
end;
$$;

-- ---------------------------------------------------------------
-- card_print_core: deterministic QR print core, exact port of
-- Java ClaimService.deterministicCore: SHA-256("cf-print:"+cardId),
-- first 6 bytes as a 48-bit big-endian long, then 12 iterations of
-- (v % 31) taking the next char from the 31-char token alphabet.
-- ---------------------------------------------------------------
create or replace function public.card_print_core(p_card_id uuid)
returns text
language plpgsql
stable
as $$
declare
    d        bytea := digest(convert_to('cf-print:' || p_card_id, 'UTF8'), 'sha256');
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v        bigint;
    sb       text := '';
begin
    v := (get_byte(d, 0)::bigint << 40)
      | (get_byte(d, 1)::bigint << 32)
      | (get_byte(d, 2)::bigint << 24)
      | (get_byte(d, 3)::bigint << 16)
      | (get_byte(d, 4)::bigint << 8)
      |  get_byte(d, 5)::bigint;
    for i in 0..11 loop
        sb := sb || substr(alphabet, (v % length(alphabet))::int + 1, 1);
        v := v / length(alphabet);
    end loop;
    return sb;
end;
$$;

-- ---------------------------------------------------------------
-- apply_claim: consume a QR token. Faithful port of ClaimService.claim
-- + CollectionService.discover (+ MatchManager reward semantics on XP).
-- Signature check happens in the Edge Function BEFORE this RPC; this
-- function is service-role only so clients cannot bypass verification.
--
-- Error codes → HTTP mapping (EF):
--   CF404 → 404, CF409 → 409, CF410 → 410, CF403 → 403
--
-- pkgs semantics:
--   UNLOCK token claims  → reusable per player; each player gets unlock +
--                          XP on first discovery, then count++ / alreadyOwned
--                          (0 XP) afterwards. Token stays ACTIVE.
--   UNIQUE token claims  → one-shot; first claimer gets the serialized copy
--                          (deterministic physical uuid + max(serial)+1) and
--                          XP, token flips to CLAIMED; anyone else → 409.
--   UNLIMITED claims     → discovery count only, always alreadyOwned (0 XP).
-- ---------------------------------------------------------------
create or replace function public.apply_claim(p_core text, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    c          public.claims%rowtype;
    v_card     public.cards%rowtype;
    v_count    bigint;
    v_owns     boolean;
    v_unlocked boolean := false;
    v_xp       bigint := 0;
    v_phys     uuid := null;
    v_serial   integer;
    v_bonus    numeric := 1.00;
begin
    select * into c from public.claims where token_core = p_core for update;
    if not found then
        raise exception 'Claim token not found: %', p_core using errcode = 'CF404';
    end if;

    select * into v_card from public.cards where id = c.card_id;
    if not found then
        raise exception 'unknown card' using errcode = 'CF404';
    end if;

    -- status gate, in ClaimService order
    if c.status = 'REVOKED' then
        raise exception 'Claim token has been revoked' using errcode = 'CF410';
    end if;
    if c.expires_at is not null and c.expires_at < now() then
        update public.claims set status = 'EXPIRED' where id = c.id;
        raise exception 'Claim token has expired' using errcode = 'CF410';
    end if;
    if v_card.ownership_type = 'UNIQUE' and c.claimed_by is not null then
        raise exception 'This unique card has already been claimed' using errcode = 'CF409';
    end if;
    if c.status <> 'ACTIVE' then
        raise exception 'Claim token is no longer active' using errcode = 'CF410';
    end if;

    -- discovery always bumps (CollectionService.discover)
    insert into public.discoveries (id, player_id, card_id, count, last_discovered)
    values (gen_random_uuid(), p_player, c.card_id, 1, now())
    on conflict on constraint uk_discoveries_player_card do update
    set count = public.discoveries.count + 1,
        last_discovered = now();

    select d.count into v_count
      from public.discoveries d
     where d.player_id = p_player and d.card_id = c.card_id;

    -- first active event by start time wins (EventService.activeEvent)
    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.active = true and e.start_time <= now() and e.end_time >= now()
     order by e.start_time
     limit 1;
    if not found then
        v_bonus := 1.00;
    end if;

    -- ownership gate (CollectionService.owns): UNLIMITED always owned
    v_owns := (v_card.ownership_type = 'UNLIMITED')
           or (v_card.ownership_type = 'UNLOCK'
               and exists (select 1 from public.player_unlocks ul
                            where ul.player_id = p_player and ul.card_id = v_card.id))
           or (v_card.ownership_type = 'UNIQUE'
               and exists (select 1 from public.unique_cards uq
                            where uq.owner_id = p_player and uq.card_id = v_card.id));

    if not v_owns then
        if v_card.ownership_type = 'UNLOCK' then
            insert into public.player_unlocks (id, player_id, card_id, unlocked_at)
            values (gen_random_uuid(), p_player, v_card.id, now())
            on conflict on constraint uk_player_unlocks_player_card do nothing;
            v_unlocked := true;
            v_xp := round(10 * v_bonus)::bigint;
        elsif v_card.ownership_type = 'UNIQUE' then
            select coalesce(max(uq.serial_number), 0) + 1 into v_serial
              from public.unique_cards uq where uq.card_id = v_card.id;
            v_phys := public.unique_physical_uuid(c.token_core);
            insert into public.unique_cards (physical_uuid, owner_id, card_id, serial_number, history)
            values (v_phys, p_player, c.card_id, v_serial, 'claimed via discovery')
            on conflict (physical_uuid) do nothing;
            v_unlocked := true;
            v_xp := round(10 * v_bonus)::bigint;
        end if;
    end if;

    if v_unlocked then
        update public.profiles set experience = experience + v_xp where id = p_player;
        perform public.add_feed_entry('DISCOVERY', 'discovered ' || v_card.forge_name, p_player, v_card.id);
    else
        perform public.add_feed_entry('DISCOVERY', 'scanned ' || v_card.forge_name, p_player, v_card.id);
    end if;

    -- claim bookkeeping: UNIQUE flips to CLAIMED (one-shot); others keep
    -- ACTIVE but record the last claimer (reusable per player).
    if v_card.ownership_type = 'UNIQUE' then
        update public.claims set status = 'CLAIMED', claimed_by = p_player, claimed_at = now()
         where id = c.id;
    else
        update public.claims set claimed_by = p_player, claimed_at = now() where id = c.id;
    end if;

    return jsonb_build_object(
        'card', jsonb_build_object(
            'id', v_card.id,
            'oracleId', v_card.oracle_id,
            'forgeName', v_card.forge_name,
            'rarity', v_card.rarity,
            'ownershipType', v_card.ownership_type,
            'setCode', v_card.set_code,
            'manaValue', v_card.mana_value,
            'types', v_card.types,
            'colors', v_card.colors,
            'imageUrl', v_card.image_url,
            'discoverable', v_card.discoverable,
            'spawnRegion', v_card.spawn_region,
            'weight', v_card.weight,
            'commanderEligible', v_card.commander_eligible
        ),
        'unlocked', v_unlocked,
        'alreadyOwned', (not v_unlocked),
        'discoveryCount', v_count,
        'experienceAwarded', v_xp,
        'token', c.token,
        'building', c.building,
        'physicalUuid', v_phys
    );
end;
$$;

revoke all on function public.apply_claim(text, uuid) from public;
grant execute on function public.apply_claim(text, uuid) to service_role;

-- ---------------------------------------------------------------
-- accept_trade: receiver accepts. actor = auth.uid() (SECURITY DEFINER +
-- RLS bypass still cannot forge the actor). Faithful port of
-- TradeService.accept: lock pending trade, participant + role + status +
-- TTL checks, lock all involved cards one-by-one in sorted-UUID order,
-- re-verify ownership, swap owners, append history line (display names,
-- "\n"-joined), publish the trade feed entry.
-- ---------------------------------------------------------------
create or replace function public.accept_trade(p_trade uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t              public.trades%rowtype;
    v_card_uuid    uuid;
    v_side         text;
    v_from_name    text;
    v_to_name      text;
    v_now          timestamptz := now();
    v_sender_name  text;
    v_receiver_name text;
    v_actor        uuid := auth.uid();
begin
    select * into t from public.trades where id = p_trade for update;
    if not found then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor <> t.sender_id and v_actor <> t.receiver_id then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor = t.sender_id then
        raise exception 'Only the receiver can perform this action on the trade' using errcode = 'CF403';
    end if;
    if t.status <> 'PENDING' then
        raise exception 'Trade is already %', lower(t.status) using errcode = 'CF409';
    end if;
    if t.expires_at < v_now then
        update public.trades set status = 'EXPIRED', resolved_at = v_now where id = t.id;
        raise exception 'Trade has expired' using errcode = 'CF410';
    end if;

    select display_name into v_sender_name   from public.profiles where id = t.sender_id;
    select display_name into v_receiver_name from public.profiles where id = t.receiver_id;

    -- lock every involved card in sorted-UUID order (deadlock avoidance)
    for v_card_uuid in
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        perform 1 from public.unique_cards where physical_uuid = v_card_uuid for update;
    end loop;

    -- ownership re-verification (TradeService.accept)
    for v_card_uuid in
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        select side into v_side from public.trade_cards where trade_id = t.id and physical_uuid = v_card_uuid;
        if (v_side = 'OFFERED'
            and exists (select 1 from public.unique_cards
                         where physical_uuid = v_card_uuid and owner_id <> t.sender_id))
           or (v_side = 'REQUESTED'
               and exists (select 1 from public.unique_cards
                            where physical_uuid = v_card_uuid and owner_id <> t.receiver_id)) then
            raise exception 'Ownership changed; trade no longer valid' using errcode = 'CF409';
        end if;
    end loop;

    -- swap owners + append history (display names, "\n"-joined)
    for v_card_uuid in
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        select side into v_side from public.trade_cards where trade_id = t.id and physical_uuid = v_card_uuid;
        if v_side = 'OFFERED' then
            v_from_name := v_sender_name;
            v_to_name   := v_receiver_name;
        else
            v_from_name := v_receiver_name;
            v_to_name   := v_sender_name;
        end if;
        update public.unique_cards
           set owner_id = case when v_side = 'OFFERED' then t.receiver_id else t.sender_id end,
               history = coalesce(nullif(history, ''), '')
                          || case when history is null or history = '' then '' else E'\n' end
                          || to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS') || ': '
                          || v_from_name || ' → ' || v_to_name || ' via trade ' || t.id
         where physical_uuid = v_card_uuid;
    end loop;

    update public.trades set status = 'ACCEPTED', resolved_at = v_now where id = t.id;

    perform public.add_feed_entry('TRADE', 'traded unique cards with ' || v_receiver_name, t.sender_id);

    return 'ACCEPTED';
end;
$$;

revoke all on function public.accept_trade(uuid) from public;
grant execute on function public.accept_trade(uuid) to authenticated;
grant execute on function public.accept_trade(uuid) to service_role;

-- decline (receiver) / cancel (sender) with the same role + TTL rules.
create or replace function public.resolve_trade(p_trade uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t            public.trades%rowtype;
    v_now        timestamptz := now();
    v_actor      uuid := auth.uid();
begin
    if p_action not in ('DECLINED', 'CANCELLED') then
        raise exception 'unknown action %', p_action using errcode = 'CF400';
    end if;

    select * into t from public.trades where id = p_trade for update;
    if not found then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor <> t.sender_id and v_actor <> t.receiver_id then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if p_action = 'DECLINED' and v_actor = t.sender_id then
        raise exception 'Only the receiver can perform this action on the trade' using errcode = 'CF403';
    end if;
    if p_action = 'CANCELLED' and v_actor = t.receiver_id then
        raise exception 'Only the sender can perform this action on the trade' using errcode = 'CF403';
    end if;
    if t.status <> 'PENDING' then
        raise exception 'Trade is already %', lower(t.status) using errcode = 'CF409';
    end if;
    if t.expires_at < v_now then
        update public.trades set status = 'EXPIRED', resolved_at = v_now where id = t.id;
        raise exception 'Trade has expired' using errcode = 'CF410';
    end if;

    update public.trades set status = p_action, resolved_at = v_now where id = t.id;
    return p_action;
end;
$$;

revoke all on function public.resolve_trade(uuid, text) from public;
grant execute on function public.resolve_trade(uuid, text) to authenticated;
grant execute on function public.resolve_trade(uuid, text) to service_role;

-- create trade from the client (RPC); sender = auth.uid(). Faithful port of
-- TradeService.create + validateBundles: no self-trade, no duplicate cards
-- in a bundle, no offered∩requested overlap, sender owns offered,
-- receiver owns requested, receiver exists.
create or replace function public.create_trade(
    p_receiver uuid,
    p_offered uuid[],   -- sender-owned unique card physical uuids
    p_requested uuid[]  -- receiver-owned unique card physical uuids
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_trade  uuid := gen_random_uuid();
    v_card   uuid;
    v_sender uuid := auth.uid();
    v_name   text;
begin
    if p_receiver = v_sender then
        raise exception 'You cannot trade with yourself' using errcode = 'CF400';
    end if;
    if not exists (select 1 from public.profiles where id = p_receiver) then
        raise exception 'Receiver not found' using errcode = 'CF404';
    end if;
    if (array_length(p_offered, 1) is null or array_length(p_offered, 1) = 0)
       and (array_length(p_requested, 1) is null or array_length(p_requested, 1) = 0) then
        raise exception 'Empty trade' using errcode = 'CF400';
    end if;

    -- no duplicates within a bundle; no overlap between bundles
    if p_offered is not null
       and (select count(*) from unnest(p_offered) x) <> (select count(distinct x) from unnest(p_offered) x) then
        raise exception 'Duplicate offered card in bundle' using errcode = 'CF400';
    end if;
    if p_requested is not null
       and (select count(*) from unnest(p_requested) x) <> (select count(distinct x) from unnest(p_requested) x) then
        raise exception 'Duplicate requested card in bundle' using errcode = 'CF400';
    end if;
    if p_offered is not null and p_requested is not null
       and exists (select 1 from unnest(p_offered) o join unnest(p_requested) r on r = o) then
        raise exception 'A card cannot be both offered and requested' using errcode = 'CF400';
    end if;

    insert into public.trades (id, sender_id, receiver_id, status)
    values (v_trade, v_sender, p_receiver, 'PENDING');

    if p_offered is not null then
        foreach v_card in array p_offered loop
            select forge_name into v_name from public.cards c
              join public.unique_cards uq on uq.card_id = c.id
             where uq.physical_uuid = v_card;
            if not found then
                raise exception 'Offered unique card not found: %', v_card using errcode = 'CF404';
            end if;
            if not exists (select 1 from public.unique_cards where physical_uuid = v_card and owner_id = v_sender) then
                raise exception 'You do not own offered card: %', v_name using errcode = 'CF400';
            end if;
            insert into public.trade_cards (id, trade_id, side, physical_uuid)
            values (gen_random_uuid(), v_trade, 'OFFERED', v_card);
        end loop;
    end if;

    if p_requested is not null then
        foreach v_card in array p_requested loop
            select forge_name into v_name from public.cards c
              join public.unique_cards uq on uq.card_id = c.id
             where uq.physical_uuid = v_card;
            if not found then
                raise exception 'Requested unique card not found: %', v_card using errcode = 'CF404';
            end if;
            if not exists (select 1 from public.unique_cards where physical_uuid = v_card and owner_id = p_receiver) then
                raise exception 'Receiver does not own requested card: %', v_name using errcode = 'CF400';
            end if;
            insert into public.trade_cards (id, trade_id, side, physical_uuid)
            values (gen_random_uuid(), v_trade, 'REQUESTED', v_card);
        end loop;
    end if;

    return v_trade;
end;
$$;

revoke all on function public.create_trade(uuid, uuid[], uuid[]) from public;
grant execute on function public.create_trade(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_trade(uuid, uuid[], uuid[]) to service_role;

-- ---------------------------------------------------------------
-- record_match_result: called by battle-engine (service role) when a match
-- ends. Winner gets XP (round(50 * bonus)); bonus comes from the match's
-- event if currently active (MatchManager.rewardWinner), else 50.
-- Idempotent on already-finished/conceded matches.
-- ---------------------------------------------------------------
create or replace function public.record_match_result(
    p_match     uuid,
    p_winner    uuid,
    p_win_cond  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    m       public.matches%rowtype;
    v_xp    bigint := 50;
    v_bonus numeric := 1.00;
begin
    select * into m from public.matches where id = p_match for update;
    if not found then
        raise exception 'Match not found: %', p_match using errcode = 'CF404';
    end if;
    if m.status in ('FINISHED', 'CONCEDED') then
        return; -- idempotent
    end if;

    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.id = m.event_id
       and e.active = true and e.start_time <= now() and e.end_time >= now();
    if found then
        v_xp := round(50 * v_bonus)::bigint;
    end if;

    update public.matches
       set status = case when m.status = 'CONCEDED' then 'CONCEDED' else 'FINISHED' end,
           winner_id = p_winner,
           win_condition = coalesce(p_win_cond, m.win_condition),
           ended_at = now()
     where id = p_match;

    if p_winner is not null then
        update public.profiles set experience = experience + v_xp where id = p_winner;
        perform public.add_feed_entry('DISCOVERY', 'won a battle (+' || v_xp || ' XP)', p_winner);
    end if;
end;
$$;

revoke all on function public.record_match_result(uuid, uuid, text) from public;
grant execute on function public.record_match_result(uuid, uuid, text) to service_role;


-- ******************** FILE: 20260923000007_analytics_feed.sql ********************
-- Campus Forge → Supabase
-- Migration 8/9: read-path analytics functions.
-- (activity_feed + add_feed_entry + prune + realtime publication moved to
-- migration 7/9 so the game definer functions can write feed rows.)

-- ---------------------------------------------------------------
-- Analytics
-- ---------------------------------------------------------------

-- leaderboard, filtered by cohort/department (mirrors GET /api/v1/leaderboard).
create or replace function public.leaderboard(
    p_degree_level text default null,
    p_specialization text default null,
    p_department text default null,
    p_limit integer default 100
)
returns table (
    player_id      uuid,
    display_name   text,
    degree_level   text,
    specialization text,
    department     text,
    experience     bigint,
    level          integer,
    wins           bigint
)
language sql
stable
as $$
    select
        p.id,
        p.display_name,
        p.degree_level,
        p.specialization,
        public.department_of(p.specialization) as department,
        p.experience,
        public.compute_level(p.experience) as level,
        (select count(*) from public.matches m where m.winner_id = p.id and m.status in ('FINISHED','CONCEDED')) as wins
    from public.profiles p
    where p.banned = false
      and (p_degree_level is null     or p.degree_level = upper(p_degree_level))
      and (p_specialization is null   or p.specialization = upper(p_specialization))
      and (p_department is null       or public.department_of(p.specialization) = upper(p_department))
    order by p.experience desc, p.display_name asc
    limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.leaderboard(text, text, text, integer) to authenticated;
grant execute on function public.leaderboard(text, text, text, integer) to anon;

-- popular decks (mirrors GET /api/v1/analytics/decks): count by ownership.
create or replace function public.popular_decks(p_limit integer default 10)
returns table (
    deck_id   uuid,
    name      text,
    format_code text,
    player_name text,
    uses      bigint
)
language sql
stable
as $$
    select
        d.id,
        d.name,
        d.format_code,
        (select display_name from public.profiles where id = d.player_id) as player_name,
        coalesce((select count(*) from public.matches m where m.deck1_id = d.id or m.deck2_id = d.id), 0) as uses
    from public.decks d
    order by uses desc, d.name asc
    limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.popular_decks(integer) to authenticated;
grant execute on function public.popular_decks(integer) to anon;

-- active buildings from claims (mirrors GET /api/v1/analytics/buildings).
create or replace function public.active_buildings(p_limit integer default 10)
returns table (
    building text,
    claims   bigint
)
language sql
stable
as $$
    select coalesce(nullif(building, ''), 'Unknown') as building, count(*) as claims
    from public.claims
    where claimed_by is not null
    group by building
    order by claims desc
    limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.active_buildings(integer) to authenticated;
grant execute on function public.active_buildings(integer) to anon;

-- profile stats (mirrors GET /players/{id}/stats).
create or replace function public.profile_stats(p_player uuid)
returns table (
    player_id        uuid,
    display_name     text,
    degree_level     text,
    specialization   text,
    department       text,
    role             text,
    experience       bigint,
    level            integer,
    cards_found      bigint,
    unlock_count     bigint,
    unique_count     bigint,
    achievements     bigint,
    wins             bigint,
    losses           bigint,
    buildings_visited text[]
)
language sql
stable
as $$
    select
        p.id,
        p.display_name,
        p.degree_level,
        p.specialization,
        public.department_of(p.specialization),
        p.role,
        p.experience,
        public.compute_level(p.experience),
        (select coalesce(sum(count), 0) from public.discoveries where player_id = p.id) as cards_found,
        (select count(*) from public.player_unlocks where player_id = p.id) as unlock_count,
        (select count(*) from public.unique_cards where owner_id = p.id) as unique_count,
        (select count(*) from public.player_achievements where player_id = p.id) as achievements,
        (select count(*) from public.matches where winner_id = p.id and status in ('FINISHED','CONCEDED')) as wins,
        (select count(*) from public.matches where (player1_id = p.id or player2_id = p.id) and winner_id is not null and winner_id <> p.id and status in ('FINISHED','CONCEDED')) as losses,
        (select array_agg(distinct building order by building) from public.claims where claimed_by = p.id and building is not null) as buildings_visited
    from public.profiles p
    where p.id = p_player;
$$;

grant execute on function public.profile_stats(uuid) to authenticated;
grant execute on function public.profile_stats(uuid) to anon;


-- ******************** FILE: 20260923000008_deck_validation.sql ********************
-- Campus Forge → Supabase
-- Migration 9/9: deck validation (mirrors DeckValidationService).
-- Returns the same problem vocabulary: NOT_ENOUGH_CARDS, TOO_MANY_COPIES,
-- NOT_OWNED, FORMAT_ILLEGAL, NOT_IN_EVENT, BANNED_CARD, INVALID_COHORT etc.

create type public.deck_problem as (
    severity text,
    code     text,
    message  text
);

-- validate a deck owned by the caller: size, copies, ownership, format legality,
-- and event allowed_sets (non-basic setCode must be in the active event).
-- Returns the list of problems; empty = valid.
create or replace function public.validate_deck(
    p_deck       uuid,
    p_event      uuid default null
)
returns setof public.deck_problem
language plpgsql
security definer
set search_path = public
as $$
declare
    d           public.decks%rowtype;
    f           public.formats%rowtype;
    v_total     integer;
    v_basic     boolean;
    v_allowed   jsonb;
    e           record;
    v_owner     uuid;
begin
    select * into d from public.decks where id = p_deck;
    if not found then
        return next row('ERROR', 'NOT_FOUND', 'deck not found')::public.deck_problem;
        return;
    end if;

    v_owner := d.player_id;

    -- total card count
    select coalesce(sum(dc.quantity), 0)::integer
    into v_total
    from public.deck_cards dc where dc.deck_id = p_deck;

    for e in
        select
            c.id as card_id, c.forge_name, c.ownership_type,
            c.set_code, c.types,
            dc.quantity,
            (case when c.ownership_type = 'UNLIMITED'
                  then true
                  else coalesce((select true from public.player_unlocks u where u.player_id = v_owner and u.card_id = c.id), false)
                      or exists (select 1 from public.unique_cards uc where uc.owner_id = v_owner and uc.card_id = c.id)
             end) as owned,
            (select count(*) from public.card_legalities cl
              where cl.card_id = c.id and cl.legality = 'BANNED') as banned_count
        from public.deck_cards dc
        join public.cards c on c.id = dc.card_id
        where dc.deck_id = p_deck
    loop
        if not e.owned then
            return next row('ERROR', 'NOT_OWNED', format('%s is not owned by the player', e.forge_name))::public.deck_problem;
        end if;

        select * into f from public.formats where code = d.format_code;
        -- copies check vs format.max_copies, except basics_unlimited basics
        select (b.types ilike '%Basic%') into v_basic from public.cards b where b.id = e.card_id;
        if not (f.basics_unlimited and v_basic)
           and e.quantity > f.max_copies
        then
            return next row('ERROR', 'TOO_MANY_COPIES', format('%s exceeds max copies of %s', e.forge_name, f.max_copies))::public.deck_problem;
        end if;

        if e.banned_count > 0 then
            return next row('ERROR', 'BANNED_CARD', format('%s is banned in %s', e.forge_name, f.name))::public.deck_problem;
        end if;

        -- event gate: non-basic setCode must be in the active event's allowed sets
        if p_event is not null then
            select allowed_sets_json::jsonb into v_allowed from public.events where id = p_event and active = true;
            if v_allowed is not null and not v_basic
               and (e.set_code is null or not (e.set_code = any (select jsonb_array_elements_text(v_allowed))))
            then
                return next row('ERROR', 'NOT_IN_EVENT', format('%s is not in the event allowed sets', e.forge_name))::public.deck_problem;
            end if;
        end if;
    end loop;

    if v_total < f.min_deck_size then
        return next row('WARNING', 'NOT_ENOUGH_CARDS', format('deck has %s cards, requires %s', v_total, f.min_deck_size))::public.deck_problem;
    end if;
end;
$$;

revoke all on function public.validate_deck(uuid, uuid) from public;
grant execute on function public.validate_deck(uuid, uuid) to authenticated;
grant execute on function public.validate_deck(uuid, uuid) to service_role;


-- ******************** FILE: 20260923000009_print_catalog_helper.sql ********************
-- Campus Forge → Supabase
-- Migration 9/9: qr print-catalog helper used by the qr-catalog Edge Function.
-- Mirrors ClaimService.generatePrintCatalog: a deterministic token core per
-- card (card_print_core, migration 06) with an idempotent claim insert.
-- The signed full token (V1.<CORE>.<SIG>) is computed in the Edge Function,
-- which owns the HMAC secret; the postgres helper just guarantees a row exists.

create or replace function public.ensure_print_claim(
    p_card_id uuid,
    p_core    text,
    p_token   text
)
returns public.claims
language plpgsql
set search_path = public
as $$
declare
    v_claim public.claims;
    v_cnt   int;
begin
    select 1 into v_cnt from public.claims where token_core = p_core limit 1;
    if not found then
        insert into public.claims (id, token, token_core, card_id, status, created_at)
        values (gen_random_uuid(), p_token, p_core, p_card_id, 'ACTIVE', now())
        on conflict (token_core) do nothing;
    end if;

    select * into v_claim from public.claims where token_core = p_core limit 1;
    return v_claim;
end;
$$;

revoke all on function public.ensure_print_claim(uuid, text, text) from public;
grant execute on function public.ensure_print_claim(uuid, text, text) to service_role;


-- ******************** FILE: 20260923000010_card_art_storage.sql ********************
-- Campus Forge → Supabase
-- Migration 10/10: storage bucket `card-art` for card images.
-- Replaces backend CardArtConfig (`file:../card-art/`). Public read so the
-- PWA can hotlink {bucket}/public/{slug}.jpg on GitHub Pages; uploads happen
-- via setup/download-card-art.ps1 with the service role key (RLS-bypassing).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-art', 'card-art', true, 52428800, array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = true, file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png'];

-- Public read on objects in the bucket (anonymous download for <img> tags).
-- The select policy covers the browser fetching public URLs without auth.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname = 'card-art public read'
    ) then
        create policy "card-art public read" on storage.objects
            for select to anon, authenticated
            using (bucket_id = 'card-art');
    end if;
end;
$$;


-- ******************** FILE: seed.sql (card catalog) ********************
-- Campus Forge → Supabase seed data (idempotent)
-- Run via `supabase db seed` (NOT `supabase db push`): mirrors the backend
-- StarterCardSeeder + CardCatalogSeeder catalog and the demo accounts.

-- ---------------------------------------------------------------
-- Card catalog (StarterCardSeeder first-15 + CardCatalogSeeder 80)
-- ---------------------------------------------------------------
insert into public.cards (id, oracle_id, forge_name, rarity, ownership_type, set_code, mana_value, types, colors, image_url, discoverable, spawn_region, weight, commander_eligible) values
    ('11111111-1111-4111-8111-111111111101', '11111111-1111-4111-8111-111111111101', 'Grizzly Bears', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Bear', 'G', null, true, 'Engineering', 5.0, false),
    ('11111111-1111-4111-8111-111111111102', '11111111-1111-4111-8111-111111111102', 'Elvish Warrior', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Elf Warrior', 'G', null, true, 'Engineering', 5.0, false),
    ('11111111-1111-4111-8111-111111111103', '11111111-1111-4111-8111-111111111103', 'Elvish Archers', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Elf Archer', 'G', null, true, 'Engineering', 5.0, false),
    ('11111111-1111-4111-8111-111111111104', '11111111-1111-4111-8111-111111111104', 'Trained Armodon', 'Common', 'UNLOCK', 'M19', 3, 'Creature — Elephant', 'G', null, true, 'Library', 5.0, false),
    ('11111111-1111-4111-8111-111111111105', '11111111-1111-4111-8111-111111111105', 'Cudgel Troll', 'Common', 'UNLOCK', 'M19', 4, 'Creature — Troll', 'G', null, true, 'Library', 5.0, false),
    ('11111111-1111-4111-8111-111111111106', '11111111-1111-4111-8111-111111111106', 'Giant Spider', 'Common', 'UNLOCK', 'M19', 4, 'Creature — Spider', 'G', null, true, 'Library', 5.0, false),
    ('11111111-1111-4111-8111-111111111107', '11111111-1111-4111-8111-111111111107', 'War Mammoth', 'Common', 'UNLOCK', 'M19', 4, 'Creature — Elephant', 'G', null, true, 'Library', 5.0, false),
    ('11111111-1111-4111-8111-111111111108', '11111111-1111-4111-8111-111111111108', 'Craw Wurm', 'Common', 'UNLOCK', 'M19', 6, 'Creature — Wurm', 'G', null, true, 'Library', 5.0, false),
    ('11111111-1111-4111-8111-111111111109', '11111111-1111-4111-8111-111111111109', 'Raging Goblin', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Goblin Berserker', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110a', '11111111-1111-4111-8111-11111111110a', 'Goblin Piker', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Goblin Warrior', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110b', '11111111-1111-4111-8111-11111111110b', 'Goblin Mountaineer', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Goblin Scout', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110c', '11111111-1111-4111-8111-11111111110c', 'Goblin Hero', 'Common', 'UNLOCK', 'M19', 3, 'Creature — Goblin', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110d', '11111111-1111-4111-8111-11111111110d', 'Vulshok Berserker', 'Common', 'UNLOCK', 'M19', 3, 'Creature — Human Berserker', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110e', '11111111-1111-4111-8111-11111111110e', 'Hill Giant', 'Common', 'UNLOCK', 'M19', 4, 'Creature — Giant', 'R', null, true, 'Gym', 5.0, false),
    ('11111111-1111-4111-8111-11111111110f', '11111111-1111-4111-8111-11111111110f', 'Fire Elemental', 'Common', 'UNLOCK', 'M19', 5, 'Creature — Elemental', 'R', null, true, 'Gym', 5.0, false),

    ('0d49a960-963a-46a4-8d3d-b3f7b0d7b3c4', '0d49a960-963a-46a4-8d3d-b3f7b0d7b3c4', 'Plains', 'Common', 'UNLIMITED', 'M19', 0, 'Basic Land — Plains', 'W', null, true, 'Library', 10.0, false),
    ('6d2ecbb5-5d0e-4bb4-8e8f-1f3a0c3e8b2a', '6d2ecbb5-5d0e-4bb4-8e8f-1f3a0c3e8b2a', 'Island', 'Common', 'UNLIMITED', 'M19', 0, 'Basic Land — Island', 'U', null, true, 'Library', 10.0, false),
    ('a7c4a5e1-5f6d-4a3b-9b2e-4f1c0d6e7a8f', 'a7c4a5e1-5f6d-4a3b-9b2e-4f1c0d6e7a8f', 'Swamp', 'Common', 'UNLIMITED', 'M19', 0, 'Basic Land — Swamp', 'B', null, true, 'Library', 10.0, false),
    ('2b6f9d3e-8c1a-4b7e-9d0f-5e3a7b9c1d2f', '2b6f9d3e-8c1a-4b7e-9d0f-5e3a7b9c1d2f', 'Mountain', 'Common', 'UNLIMITED', 'M19', 0, 'Basic Land — Mountain', 'R', null, true, 'Library', 10.0, false),
    ('4c8e0a5f-9b2d-4c1e-8a3f-6d5b0e2f3a4c', '4c8e0a5f-9b2d-4c1e-8a3f-6d5b0e2f3a4c', 'Forest', 'Common', 'UNLIMITED', 'M19', 0, 'Basic Land — Forest', 'G', null, true, 'Library', 10.0, false),

    ('5a1f2b3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c', '5a1f2b3c-4d5e-4f6a-8b7c-9d0e1f2a3b4c', 'Counterspell', 'Common', 'UNLOCK', 'M19', 2, 'Instant', 'U', null, true, 'Building B', 5.0, false),
    ('7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', '7c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'Lightning Bolt', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'R', null, true, 'Gym', 5.0, false),
    ('9e5f6a7b-8c9d-4a0b-1c2d-3e4f5a6b7c8d', '9e5f6a7b-8c9d-4a0b-1c2d-3e4f5a6b7c8d', 'Giant Growth', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'G', null, true, 'Engineering', 5.0, false),
    ('0b7c8d9e-0a1b-4c2d-3e4f-5a6b7c8d9e0f', '0b7c8d9e-0a1b-4c2d-3e4f-5a6b7c8d9e0f', 'Cancel', 'Uncommon', 'UNLOCK', 'M19', 3, 'Instant', 'U', null, true, 'Building B', 4.0, false),
    ('2d9e0f1a-2b3c-4d4e-5f6a-7b8c9d0e1f2a', '2d9e0f1a-2b3c-4d4e-5f6a-7b8c9d0e1f2a', 'Shock', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'R', null, true, 'Gym', 5.0, false),
    ('4f0a1b2c-3d4e-4f5a-6b7c-8d9e0f1a2b3c', '4f0a1b2c-3d4e-4f5a-6b7c-8d9e0f1a2b3c', 'Llanowar Elves', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Elf Druid', 'G', null, true, 'Engineering', 5.0, false),
    ('6a2b3c4d-5e6f-4a0b-1c2d-3e4f5a6b7c8d', '6a2b3c4d-5e6f-4a0b-1c2d-3e4f5a6b7c8d', 'Doom Blade', 'Common', 'UNLOCK', 'M19', 2, 'Instant', 'B', null, true, 'Library', 5.0, false),
    ('8c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f', '8c4d5e6f-7a8b-4c9d-0e1f-2a3b4c5d6e7f', 'Solemn Simulacrum', 'Rare', 'UNLOCK', 'M19', 4, 'Artifact Creature — Golem', '', null, true, 'Engineering', 2.0, false),

    ('33333333-3333-4333-9333-333333333301', '33333333-3333-4333-9333-333333333301', 'Savannah Lions', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Cat', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333302', '33333333-3333-4333-9333-333333333302', 'Suntail Hawk', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Bird', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333303', '33333333-3333-4333-9333-333333333303', 'Benalish Hero', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Human Soldier', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333304', '33333333-3333-4333-9333-333333333304', 'Soul Warden', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Human Cleric', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333305', '33333333-3333-4333-9333-333333333305', 'Swords to Plowshares', 'Uncommon', 'UNLOCK', 'M19', 1, 'Instant', 'W', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-333333333306', '33333333-3333-4333-9333-333333333306', 'Condemn', 'Uncommon', 'UNLOCK', 'M19', 1, 'Instant', 'W', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-333333333307', '33333333-3333-4333-9333-333333333307', 'White Knight', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Human Knight', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333308', '33333333-3333-4333-9333-333333333308', 'Knight of the White Orchid', 'Uncommon', 'UNLOCK', 'M19', 2, 'Creature — Human Knight', 'W', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-333333333309', '33333333-3333-4333-9333-333333333309', 'Pacifism', 'Common', 'UNLOCK', 'M19', 2, 'Enchantment — Aura', 'W', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-33333333330a', '33333333-3333-4333-9333-33333333330a', 'Suture Priest', 'Uncommon', 'UNLOCK', 'M19', 2, 'Creature — Phyrexian Cleric', 'W', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-33333333330b', '33333333-3333-4333-9333-33333333330b', 'Serra Angel', 'Uncommon', 'UNLOCK', 'M19', 5, 'Creature — Angel', 'W', null, true, 'Library', 4.0, false),

    ('33333333-3333-4333-9333-33333333330c', '33333333-3333-4333-9333-33333333330c', 'Brainstorm', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-33333333330d', '33333333-3333-4333-9333-33333333330d', 'Opt', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-33333333330e', '33333333-3333-4333-9333-33333333330e', 'Serum Visions', 'Common', 'UNLOCK', 'M19', 1, 'Sorcery', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-33333333330f', '33333333-3333-4333-9333-33333333330f', 'Coral Merfolk', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Merfolk', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-333333333310', '33333333-3333-4333-9333-333333333310', 'Man-o''-War', 'Common', 'UNLOCK', 'M19', 3, 'Creature — Jellyfish', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-333333333311', '33333333-3333-4333-9333-333333333311', 'Phantom Warrior', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Illusion Warrior', 'U', null, true, 'Building B', 4.0, false),
    ('33333333-3333-4333-9333-333333333312', '33333333-3333-4333-9333-333333333312', 'Divination', 'Common', 'UNLOCK', 'M19', 3, 'Sorcery', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-333333333313', '33333333-3333-4333-9333-333333333313', 'Windfall', 'Rare', 'UNLOCK', 'M19', 3, 'Sorcery', 'U', null, true, 'Building B', 2.0, false),
    ('33333333-3333-4333-9333-333333333314', '33333333-3333-4333-9333-333333333314', 'Mnemonic Wall', 'Common', 'UNLOCK', 'M19', 5, 'Creature — Wall', 'U', null, true, 'Building B', 5.0, false),
    ('33333333-3333-4333-9333-333333333315', '33333333-3333-4333-9333-333333333315', 'Air Elemental', 'Uncommon', 'UNLOCK', 'M19', 5, 'Creature — Elemental', 'U', null, true, 'Building B', 4.0, false),
    ('33333333-3333-4333-9333-333333333316', '33333333-3333-4333-9333-333333333316', 'Cloud Djinn', 'Common', 'UNLOCK', 'M19', 6, 'Creature — Djinn', 'U', null, true, 'Building B', 5.0, false),

    ('33333333-3333-4333-9333-333333333317', '33333333-3333-4333-9333-333333333317', 'Dark Ritual', 'Common', 'UNLOCK', 'M19', 1, 'Instant', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333318', '33333333-3333-4333-9333-333333333318', 'Viscera Seer', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Vampire Wizard', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333319', '33333333-3333-4333-9333-333333333319', 'Thrull Surgeon', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Thrull', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-33333333331a', '33333333-3333-4333-9333-33333333331a', 'Sign in Blood', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-33333333331b', '33333333-3333-4333-9333-33333333331b', 'Terror', 'Uncommon', 'UNLOCK', 'M19', 2, 'Instant', 'B', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-33333333331c', '33333333-3333-4333-9333-33333333331c', 'Nantuko Shade', 'Uncommon', 'UNLOCK', 'M19', 2, 'Creature — Insect Shade', 'B', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-33333333331d', '33333333-3333-4333-9333-33333333331d', 'Drudge Skeletons', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Skeleton', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-33333333331e', '33333333-3333-4333-9333-33333333331e', 'Dark Banishing', 'Common', 'UNLOCK', 'M19', 3, 'Instant', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-33333333331f', '33333333-3333-4333-9333-33333333331f', 'Hypnotic Specter', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Specter', 'B', null, true, 'Library', 4.0, false),
    ('33333333-3333-4333-9333-333333333320', '33333333-3333-4333-9333-333333333320', 'Drain Life', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333321', '33333333-3333-4333-9333-333333333321', 'Giant Cockroach', 'Common', 'UNLOCK', 'M19', 4, 'Creature — Insect', 'B', null, true, 'Library', 5.0, false),
    ('33333333-3333-4333-9333-333333333322', '33333333-3333-4333-9333-333333333322', 'Nightmare', 'Rare', 'UNLOCK', 'M19', 6, 'Creature — Nightmare Horse', 'B', null, true, 'Library', 2.0, false),
    ('33333333-3333-4333-9333-333333333323', '33333333-3333-4333-9333-333333333323', 'Skeletal Vampire', 'Common', 'UNLOCK', 'M19', 6, 'Creature — Vampire Skeleton', 'B', null, true, 'Library', 5.0, false),

    ('33333333-3333-4333-9333-333333333324', '33333333-3333-4333-9333-333333333324', 'Goblin Guide', 'Common', 'UNLOCK', 'M19', 1, 'Creature — Goblin Scout', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-333333333325', '33333333-3333-4333-9333-333333333325', 'Goblin Grenade', 'Common', 'UNLOCK', 'M19', 1, 'Sorcery', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-333333333326', '33333333-3333-4333-9333-333333333326', 'Seal of Fire', 'Common', 'UNLOCK', 'M19', 1, 'Enchantment', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-333333333327', '33333333-3333-4333-9333-333333333327', 'Lava Spike', 'Common', 'UNLOCK', 'M19', 1, 'Sorcery — Arcane', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-333333333328', '33333333-3333-4333-9333-333333333328', 'Incinerate', 'Common', 'UNLOCK', 'M19', 2, 'Instant', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-333333333329', '33333333-3333-4333-9333-333333333329', 'Searing Spear', 'Common', 'UNLOCK', 'M19', 2, 'Instant', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-33333333332a', '33333333-3333-4333-9333-33333333332a', 'Volcanic Hammer', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-33333333332b', '33333333-3333-4333-9333-33333333332b', 'Arc Trail', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-33333333332c', '33333333-3333-4333-9333-33333333332c', 'Viashino Pyromancer', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Lizard Wizard', 'R', null, true, 'Gym', 5.0, false),
    ('33333333-3333-4333-9333-33333333332d', '33333333-3333-4333-9333-33333333332d', 'Goblin Chieftain', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Goblin', 'R', null, true, 'Gym', 4.0, false),
    ('33333333-3333-4333-9333-33333333332e', '33333333-3333-4333-9333-33333333332e', 'Goblin Ruinblaster', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Goblin Shaman', 'R', null, true, 'Gym', 4.0, false),
    ('33333333-3333-4333-9333-33333333332f', '33333333-3333-4333-9333-33333333332f', 'Goblin Trenches', 'Uncommon', 'UNLOCK', 'M19', 3, 'Enchantment', 'R', null, true, 'Gym', 4.0, false),
    ('33333333-3333-4333-9333-333333333330', '33333333-3333-4333-9333-333333333330', 'Dragon Whelp', 'Uncommon', 'UNLOCK', 'M19', 4, 'Creature — Dragon', 'R', null, true, 'Gym', 4.0, false),
    ('33333333-3333-4333-9333-333333333331', '33333333-3333-4333-9333-333333333331', 'Shivan Dragon', 'Rare', 'UNLOCK', 'M19', 6, 'Creature — Dragon', 'R', null, true, 'Gym', 2.0, false),

    ('33333333-3333-4333-9333-333333333332', '33333333-3333-4333-9333-333333333332', 'Rancor', 'Common', 'UNLOCK', 'M19', 1, 'Enchantment — Aura', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333333', '33333333-3333-4333-9333-333333333333', 'Sakura-Tribe Elder', 'Common', 'UNLOCK', 'M19', 2, 'Creature — Snake Shaman', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333334', '33333333-3333-4333-9333-333333333334', 'Rampant Growth', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333335', '33333333-3333-4333-9333-333333333335', 'Nature''s Lore', 'Common', 'UNLOCK', 'M19', 2, 'Sorcery', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333336', '33333333-3333-4333-9333-333333333336', 'Centaur Courser', 'Common', 'UNLOCK', 'M19', 3, 'Creature — Centaur Warrior', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333337', '33333333-3333-4333-9333-333333333337', 'Cultivate', 'Common', 'UNLOCK', 'M19', 3, 'Sorcery', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-333333333338', '33333333-3333-4333-9333-333333333338', 'Yavimaya Elder', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Human Druid', 'G', null, true, 'Engineering', 4.0, false),
    ('33333333-3333-4333-9333-333333333339', '33333333-3333-4333-9333-333333333339', 'Terravore', 'Uncommon', 'UNLOCK', 'M19', 3, 'Creature — Lhurgoyf', 'G', null, true, 'Engineering', 4.0, false),
    ('33333333-3333-4333-9333-33333333333a', '33333333-3333-4333-9333-33333333333a', 'Stampeding Elk Herd', 'Common', 'UNLOCK', 'M19', 5, 'Creature — Elk', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-33333333333b', '33333333-3333-4333-9333-33333333333b', 'Stampeding Rhino', 'Common', 'UNLOCK', 'M19', 5, 'Creature — Rhino', 'G', null, true, 'Engineering', 5.0, false),
    ('33333333-3333-4333-9333-33333333333c', '33333333-3333-4333-9333-33333333333c', 'Baloth Woodcrasher', 'Uncommon', 'UNLOCK', 'M19', 6, 'Creature — Beast', 'G', null, true, 'Engineering', 4.0, false),

    ('33333333-3333-4333-9333-33333333333d', '33333333-3333-4333-9333-33333333333d', 'Phyrexian Walker', 'Common', 'UNLOCK', 'M19', 0, 'Artifact Creature — Phyrexian Construct', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-33333333333e', '33333333-3333-4333-9333-33333333333e', 'Brass Man', 'Common', 'UNLOCK', 'M19', 1, 'Artifact Creature — Construct', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-33333333333f', '33333333-3333-4333-9333-33333333333f', 'Skullclamp', 'Uncommon', 'UNLOCK', 'M19', 1, 'Artifact — Equipment', '', null, true, 'Special', 4.0, false),
    ('33333333-3333-4333-9333-333333333340', '33333333-3333-4333-9333-333333333340', 'Sol Ring', 'Uncommon', 'UNLOCK', 'M19', 1, 'Artifact', '', null, true, 'Special', 4.0, false),
    ('33333333-3333-4333-9333-333333333341', '33333333-3333-4333-9333-333333333341', 'Shadowblood Egg', 'Common', 'UNLOCK', 'M19', 1, 'Artifact', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333342', '33333333-3333-4333-9333-333333333342', 'Iron Myr', 'Common', 'UNLOCK', 'M19', 2, 'Artifact Creature — Myr', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333343', '33333333-3333-4333-9333-333333333343', 'Leaden Myr', 'Common', 'UNLOCK', 'M19', 2, 'Artifact Creature — Myr', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333344', '33333333-3333-4333-9333-333333333344', 'Silver Myr', 'Common', 'UNLOCK', 'M19', 2, 'Artifact Creature — Myr', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333345', '33333333-3333-4333-9333-333333333345', 'Wurm''s Tooth', 'Common', 'UNLOCK', 'M19', 2, 'Artifact', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333346', '33333333-3333-4333-9333-333333333346', 'Armored Transport', 'Common', 'UNLOCK', 'M19', 3, 'Artifact Creature — Construct', '', null, true, 'Special', 5.0, false),
    ('33333333-3333-4333-9333-333333333347', '33333333-3333-4333-9333-333333333347', 'Bottled Cloister', 'Uncommon', 'UNLOCK', 'M19', 4, 'Artifact', '', null, true, 'Special', 4.0, false),
    ('33333333-3333-4333-9333-333333333348', '33333333-3333-4333-9333-333333333348', 'Clockwork Beast', 'Uncommon', 'UNLOCK', 'M19', 6, 'Artifact Creature — Beast', '', null, true, 'Special', 4.0, false),
    ('33333333-3333-4333-9333-333333333349', '33333333-3333-4333-9333-333333333349', 'Darksteel Colossus', 'Rare', 'UNLOCK', 'M19', 11, 'Artifact Creature — Golem', '', null, true, 'Special', 2.0, false),

    ('a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a', 'a0e1f2a3-4b5c-4d6e-7f8a-9b0c1d2e3f4a', 'Black Lotus', 'Mythic', 'UNIQUE', 'LEA', 0, 'Artifact', '', null, false, 'Special', 0.1, false),
    ('c2f3a4b5-6c7d-4e8f-9a0b-1c2d3e4f5a6b', 'c2f3a4b5-6c7d-4e8f-9a0b-1c2d3e4f5a6b', 'Ancestral Recall', 'Mythic', 'UNIQUE', 'LEA', 1, 'Instant', 'U', null, false, 'Special', 0.1, false),
    ('e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c', 'e4a5b6c7-8d9e-4f0a-1b2c-3d4e5f6a7b8c', 'Mox Sapphire', 'Mythic', 'UNIQUE', 'LEA', 0, 'Artifact', '', null, false, 'Special', 0.1, false)
on conflict (oracle_id) do nothing;
