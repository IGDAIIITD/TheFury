-- ============================================================================
-- 20: open-battle feed, campus battle history, personal match history
--
-- Players can only read matches they played (RLS), so the Events page reads
-- these through definer functions that expose just what the feed needs:
--   open_lobbies()        lobbies waiting for an opponent (< 2 minutes old,
--                         the engine closes older ones as EXPIRED); joining by
--                         clicking uses the lobby's code, which is the point
--   recent_battles(n)     finished battles: who beat whom, and when
--   my_match_history(n)   the caller's matches: result, XP, time
-- Match statuses: WAITING, ACTIVE, FINISHED, CONCEDED, EXPIRED (nobody joined
-- in 2 minutes), CANCELLED (host closed the lobby).
-- Idempotent.
-- ============================================================================

create index if not exists idx_matches_status_created on public.matches (status, created_at desc);

create or replace function public.open_lobbies()
returns table (
    match_id    uuid,
    battle_code text,
    host_id     uuid,
    host_name   text,
    created_at  timestamptz,
    expires_at  timestamptz,
    mine        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'Not signed in' using errcode = 'CF401';
    end if;
    return query
    select m.id, m.battle_code, m.player1_id, p.display_name, m.created_at,
           m.created_at + interval '2 minutes', m.player1_id = v_me
      from public.matches m
      join public.profiles p on p.id = m.player1_id
     where m.status = 'WAITING'
       and m.battle_code is not null
       and m.created_at > now() - interval '2 minutes'
       and not p.banned
     order by m.created_at desc
     limit 50;
end;
$$;

revoke execute on function public.open_lobbies() from public, anon, authenticated;
grant execute on function public.open_lobbies() to authenticated;

create or replace function public.recent_battles(p_limit int default 30)
returns table (
    match_id      uuid,
    winner_name   text,
    loser_name    text,
    win_condition text,
    ended_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Not signed in' using errcode = 'CF401';
    end if;
    return query
    select m.id,
           -- a null winner in a bot match means the bot won; player2 null = the bot
           coalesce(w.display_name, case when m.player2_id is null then 'Campus Bot' end),
           case
               when m.winner_id is null then coalesce(p1.display_name, 'Unknown')
               when m.winner_id = m.player1_id then coalesce(p2.display_name, 'Campus Bot')
               else p1.display_name
           end,
           m.win_condition,
           coalesce(m.ended_at, m.created_at)
      from public.matches m
      join public.profiles p1 on p1.id = m.player1_id
      left join public.profiles p2 on p2.id = m.player2_id
      left join public.profiles w on w.id = m.winner_id
     where m.status in ('FINISHED', 'CONCEDED')
       and (m.winner_id is not null or m.player2_id is null)
     order by coalesce(m.ended_at, m.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end;
$$;

revoke execute on function public.recent_battles(int) from public, anon, authenticated;
grant execute on function public.recent_battles(int) to authenticated;

create or replace function public.my_match_history(p_limit int default 50)
returns table (
    match_id    uuid,
    result      text,   -- WON | LOST | DRAW | ACTIVE | WAITING | EXPIRED | CANCELLED
    xp          bigint,
    at          timestamptz,
    battle_code text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'Not signed in' using errcode = 'CF401';
    end if;
    return query
    select m.id,
           case
               when m.status in ('FINISHED', 'CONCEDED') then
                   case when m.winner_id = v_me then 'WON'
                        when m.winner_id is null and m.player2_id is not null then 'DRAW'
                        else 'LOST' end
               when m.status = 'WAITING' and m.created_at <= now() - interval '2 minutes' then 'EXPIRED'
               else m.status
           end,
           coalesce((select sum(g.xp) from public.game_log g
                      where g.kind = 'MATCH' and g.ref_id = m.id and g.player_id = v_me), 0)::bigint,
           coalesce(m.ended_at, m.created_at),
           m.battle_code
      from public.matches m
     where v_me in (m.player1_id, m.player2_id)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.my_match_history(int) from public, anon, authenticated;
grant execute on function public.my_match_history(int) to authenticated;
