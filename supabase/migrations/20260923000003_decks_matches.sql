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