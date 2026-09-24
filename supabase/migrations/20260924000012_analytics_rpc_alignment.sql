-- Campus Forge → Supabase
-- Migration 12: align the analytics read RPCs with the retired backend's
-- AnalyticsService (the migration 07 versions drifted).
--
--   popular_decks  : aggregate by deck NAME across matches that are not
--                    PENDING (counts deck1 + deck2), like
--                    AnalyticsService.popularDecks — not by deck id.
--   active_buildings: count every claim with a non-blank building, whether or
--                    not it was ever claimed, like
--                    AnalyticsService.activeBuildings.
--
-- The OUT-column sets change, so CREATE OR REPLACE is not enough: drop first.
-- Idempotent: safe to paste into the hosted SQL Editor more than once.

drop function if exists public.popular_decks(integer);
create function public.popular_decks(p_limit integer default 10)
returns table (
    deck_name  text,
    play_count bigint
)
language sql
stable
as $$
    select d.name as deck_name, count(*) as play_count
    from public.matches m
    join public.decks d on d.id = m.deck1_id or d.id = m.deck2_id
    where m.status <> 'PENDING'
    group by d.name
    order by play_count desc, d.name asc
    limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.popular_decks(integer) to authenticated;
grant execute on function public.popular_decks(integer) to anon;

drop function if exists public.active_buildings(integer);
create function public.active_buildings(p_limit integer default 10)
returns table (
    building text,
    claims   bigint
)
language sql
stable
as $$
    select btrim(building) as building, count(*) as claims
    from public.claims
    where building is not null and btrim(building) <> ''
    group by btrim(building)
    order by claims desc, btrim(building) asc
    limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.active_buildings(integer) to authenticated;
grant execute on function public.active_buildings(integer) to anon;
