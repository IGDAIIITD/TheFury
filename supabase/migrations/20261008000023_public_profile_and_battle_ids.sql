-- 20261008000023_public_profile_and_battle_ids.sql
-- UI-6: add public_profile RPC and include winner_id/loser_id in recent_battles

-- 1) Add winner_id/loser_id to recent_battles for linking player names to profiles
drop function if exists public.recent_battles(int);

create function public.recent_battles(p_limit int default 30)
returns table (
    match_id      uuid,
    winner_id     uuid,
    loser_id      uuid,
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
           m.winner_id,
           case
               when m.winner_id is null then coalesce(m.player1_id, m.player2_id)
               when m.winner_id = m.player1_id then m.player2_id
               else m.player1_id
           end,
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

-- 2) public_profile(uuid): return a safe public view of a player profile
create or replace function public.public_profile(p_player uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_row public.profiles%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Not signed in' using errcode = 'CF401';
    end if;

    select * into v_row from public.profiles where id = p_player;
    if not found then
        return null;
    end if;

    return jsonb_build_object(
        'id', v_row.id,
        'displayName', v_row.display_name,
        'avatar', v_row.avatar,
        'degreeLevel', v_row.degree_level,
        'specialization', v_row.specialization,
        'level', public.compute_level(v_row.experience),
        'experience', v_row.experience,
        'role', v_row.role,
        'banned', v_row.banned
    );
end;
$$;

revoke execute on function public.public_profile(uuid) from public, anon, authenticated;
grant execute on function public.public_profile(uuid) to authenticated;
