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