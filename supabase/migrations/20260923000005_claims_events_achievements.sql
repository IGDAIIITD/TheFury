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