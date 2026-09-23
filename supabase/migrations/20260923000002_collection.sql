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