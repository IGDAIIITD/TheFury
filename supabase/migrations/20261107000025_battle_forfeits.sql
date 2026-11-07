-- Early concessions are forfeits: they do not award XP and temporarily prevent
-- the forfeiting player from immediately farming another match.

alter table public.profiles
  add column if not exists battle_cooldown_until timestamptz;

alter table public.matches
  add column if not exists early_forfeit boolean not null default false;

create or replace function public.enforce_battle_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cooldown timestamptz;
begin
    if tg_op = 'INSERT' or new.player1_id is distinct from old.player1_id then
        select battle_cooldown_until into v_cooldown
          from public.profiles where id = new.player1_id;
        if v_cooldown is not null and v_cooldown > now() then
            raise exception 'You are temporarily unable to start battles until %', v_cooldown
              using errcode = 'CF429';
        end if;
    end if;

    if new.player2_id is not null
       and (tg_op = 'INSERT' or new.player2_id is distinct from old.player2_id) then
        select battle_cooldown_until into v_cooldown
          from public.profiles where id = new.player2_id;
        if v_cooldown is not null and v_cooldown > now() then
            raise exception 'You are temporarily unable to join battles until %', v_cooldown
              using errcode = 'CF429';
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_matches_battle_cooldown on public.matches;
create trigger trg_matches_battle_cooldown
before insert or update of player1_id, player2_id on public.matches
for each row execute function public.enforce_battle_cooldown();

-- Preserve the original three-argument entry point for old engine builds.
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
begin
    perform public.record_match_result(p_match, p_winner, p_win_cond, null, false);
end;
$$;

create or replace function public.record_match_result(
    p_match       uuid,
    p_winner      uuid,
    p_win_cond    text,
    p_forfeiter   uuid,
    p_early       boolean
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
    v_cond  text := case when p_early then 'EARLY_FORFEIT' else p_win_cond end;
begin
    select * into m from public.matches where id = p_match for update;
    if not found then
        raise exception 'Match not found: %', p_match using errcode = 'CF404';
    end if;
    if m.status in ('FINISHED', 'CONCEDED') then
        return;
    end if;
    if p_winner is not null and p_winner is distinct from m.player1_id and p_winner is distinct from m.player2_id then
        raise exception 'Winner is not a participant of match %', p_match using errcode = 'CF400';
    end if;
    if p_forfeiter is not null and p_forfeiter is distinct from m.player1_id and p_forfeiter is distinct from m.player2_id then
        raise exception 'Forfeiter is not a participant of match %', p_match using errcode = 'CF400';
    end if;

    if not p_early then
        select e.bonus_multiplier into v_bonus
          from public.events e
         where e.id = m.event_id
           and e.active = true and e.start_time <= now() and e.end_time >= now();
        if found then
            v_xp := round(50 * v_bonus)::bigint;
        end if;
    else
        v_xp := 0;
    end if;

    update public.matches
       set status = 'FINISHED',
           winner_id = p_winner,
           win_condition = coalesce(v_cond, m.win_condition),
           early_forfeit = p_early,
           ended_at = now()
     where id = p_match;

    insert into public.game_log (kind, player_id, ref_id, xp, detail)
    select 'MATCH', pid, m.id,
           case when not p_early and pid = p_winner then v_xp else 0 end,
           jsonb_build_object(
               'result', case when p_early then 'FORFEIT' when p_winner is null then 'DRAW' when pid = p_winner then 'WIN' else 'LOSS' end,
               'winCondition', coalesce(v_cond, m.win_condition),
               'opponent', case when pid = m.player1_id then m.player2_id else m.player1_id end,
               'eventId', m.event_id,
               'battleCode', m.battle_code)
      from unnest(array[m.player1_id, m.player2_id]) as pid
     where pid is not null;

    if p_early and p_forfeiter is not null then
        update public.profiles
           set battle_cooldown_until = greatest(coalesce(battle_cooldown_until, now()), now() + interval '10 minutes')
         where id = p_forfeiter;
    elsif p_winner is not null then
        update public.profiles set experience = experience + v_xp where id = p_winner;
        perform public.add_feed_entry('DISCOVERY', 'won a battle (+' || v_xp || ' XP)', p_winner);
    end if;
end;
$$;

-- Early forfeits count as played, but never as wins in public statistics.
create or replace function public.leaderboard_full(
    p_metric       text default 'level',
    p_degree_level text default null,
    p_specialization text default null,
    p_department   text default null,
    p_limit        integer default 50
)
returns jsonb
language sql
security definer
set search_path = public
as $$
    with tot as (select count(*)::integer as n from public.cards),
    base as (
        select p.id, p.display_name, p.avatar, p.degree_level, p.specialization,
               p.experience, public.compute_level(p.experience) as level,
               (select count(distinct c.id) from public.cards c
                 where (c.ownership_type = 'UNLIMITED' and not c.requires_unlock)
                    or exists (select 1 from public.player_unlocks u where u.player_id = p.id and u.card_id = c.id)
                    or exists (select 1 from public.unique_cards uc where uc.owner_id = p.id and uc.card_id = c.id)) as owned_count,
               (select count(*) from public.matches m where (m.player1_id = p.id or m.player2_id = p.id)
                    and m.status in ('FINISHED', 'CONCEDED')) as played,
               (select count(*) from public.matches m where m.winner_id = p.id
                    and m.status in ('FINISHED', 'CONCEDED') and not m.early_forfeit) as wins
          from public.profiles p
         where p.banned = false
           and (p_degree_level is null or upper(p.degree_level) = upper(p_degree_level))
           and (p_specialization is null or upper(p.specialization) = upper(p_specialization))
           and (p_department is null or public.department_of(p.specialization) = upper(p_department))
    ), scored as (
        select b.*, case p_metric
          when 'collection' then case when t.n = 0 then 0 else round(100.0 * b.owned_count / t.n)::integer end
          when 'winrate' then case when b.played = 0 then 0 else round(100.0 * b.wins / b.played)::integer end
          else b.level end as score,
          case p_metric when 'collection' then b.owned_count when 'winrate' then b.wins else b.experience end as value,
          row_number() over (order by
            case p_metric when 'collection' then case when t.n = 0 then 0 else round(100.0 * b.owned_count / t.n)::integer end
              when 'winrate' then case when b.played = 0 then 0 else round(100.0 * b.wins / b.played)::integer end else b.level end desc,
            case p_metric when 'collection' then b.owned_count when 'winrate' then b.wins else b.experience end desc,
            b.display_name asc) as rn
          from base b cross join tot t
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rn, 'playerId', s.id, 'displayName', s.display_name,
        'avatar', s.avatar, 'degreeLevel', s.degree_level, 'specialization', s.specialization, 'score', s.score, 'value', s.value) order by s.rn)
        from scored s where s.rn <= least(greatest(p_limit, 1), 100)), '[]'::jsonb),
      'myRank', (select s.rn from scored s where s.id = auth.uid()),
      'total', (select count(*) from scored)
    );
$$;

create or replace function public.my_match_history(p_limit int default 50)
returns table (
    match_id uuid,
    result text,
    xp bigint,
    at timestamptz,
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
             when m.early_forfeit then 'FORFEIT'
             when m.status in ('FINISHED', 'CONCEDED') then
               case when m.winner_id = v_me then 'WON'
                    when m.winner_id is null and m.player2_id is not null then 'DRAW'
                    else 'LOST' end
             when m.status = 'WAITING' and m.created_at <= now() - interval '2 minutes' then 'EXPIRED'
             else m.status
           end,
           coalesce((select sum(g.xp) from public.game_log g where g.kind = 'MATCH' and g.ref_id = m.id and g.player_id = v_me), 0)::bigint,
           coalesce(m.ended_at, m.created_at), m.battle_code
      from public.matches m
     where v_me in (m.player1_id, m.player2_id)
     order by m.created_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke execute on function public.enforce_battle_cooldown() from public, anon, authenticated;
revoke execute on function public.record_match_result(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.record_match_result(uuid, uuid, text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.leaderboard_full(text, text, text, text, integer) from public, anon;
grant execute on function public.record_match_result(uuid, uuid, text) to service_role;
grant execute on function public.record_match_result(uuid, uuid, text, uuid, boolean) to service_role;
grant execute on function public.leaderboard_full(text, text, text, text, integer) to authenticated, service_role;
revoke execute on function public.my_match_history(integer) from public, anon, authenticated;
grant execute on function public.my_match_history(integer) to authenticated;
