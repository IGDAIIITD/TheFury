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