-- Allow signed-in players to view public stats for profiles linked from the
-- leaderboard and battle history, without disclosing private account fields.
create or replace function public.my_profile_stats(p_player uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := coalesce(p_player, auth.uid());
    v_exp       bigint;
    v_level     integer;
    v_xp_next   bigint;
    v_disc      bigint;
    v_owned     integer;
    v_total     integer;
    v_comp      integer;
    v_colors    text[];
    v_buildings text[];
    v_played    integer;
    v_wins      integer;
    v_losses    integer;
    v_rate      integer;
    v_player    jsonb;
    v_badges    jsonb;
    v_private   boolean;
begin
    if v_uid is null then
        return null;
    end if;

    v_private := auth.uid() is null or v_uid = auth.uid() or public.is_admin();

    select
        p.experience,
        public.compute_level(p.experience),
        jsonb_build_object(
            'id', p.id,
            'email', case when v_private then p.email end,
            'displayName', p.display_name,
            'role', p.role,
            'avatar', p.avatar,
            'studentId', case when v_private then p.student_id end,
            'degreeLevel', p.degree_level,
            'specialization', p.specialization,
            'experience', p.experience,
            'level', public.compute_level(p.experience)
        )
    into v_exp, v_level, v_player
      from public.profiles p where p.id = v_uid;
    if not found then
        return null;
    end if;

    v_xp_next := greatest(0, (v_level * 100) - v_exp);

    select coalesce(sum(count), 0) into v_disc
      from public.discoveries where player_id = v_uid;

    select count(*) into v_total from public.cards;
    select count(distinct c.id) into v_owned from public.cards c
     where (c.ownership_type = 'UNLIMITED' and not c.requires_unlock)
        or exists (select 1 from public.player_unlocks u where u.player_id = v_uid and u.card_id = c.id)
        or exists (select 1 from public.unique_cards uc where uc.owner_id = v_uid and uc.card_id = c.id);
    v_comp := case when v_total = 0 then 0 else round(100.0 * v_owned / v_total)::integer end;

    select array_agg(ch order by cnt desc, ch asc) into v_colors
    from (
        select ch, count(*) as cnt
        from (
            select c.id, c.colors
            from public.cards c
            where ((c.ownership_type = 'UNLIMITED' and not c.requires_unlock)
                   or exists (select 1 from public.player_unlocks u where u.player_id = v_uid and u.card_id = c.id)
                   or exists (select 1 from public.unique_cards uc where uc.owner_id = v_uid and uc.card_id = c.id))
              and coalesce(c.colors, '') <> ''
        ) owned,
        lateral unnest(string_to_array(upper(owned.colors), null)) as ch
        where ch in ('W', 'U', 'B', 'R', 'G')
        group by ch
        order by cnt desc, ch asc
        limit 3
    ) s;

    select array_agg(b order by b) into v_buildings
    from (
        select distinct btrim(building) as b
        from public.claims
        where claimed_by = v_uid and building is not null and btrim(building) <> ''
    ) s;

    select count(*) into v_played from public.matches
     where (player1_id = v_uid or player2_id = v_uid) and status in ('FINISHED', 'CONCEDED');
    select count(*) into v_wins from public.matches
     where winner_id = v_uid and status in ('FINISHED', 'CONCEDED');
    v_losses := v_played - v_wins;
    v_rate := case when v_played = 0 then 0 else round(100.0 * v_wins / v_played)::integer end;

    perform public.sweep_achievements(v_uid);
    select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name', c.name, 'description', c.description)
                   order by a.unlocked_at), '[]'::jsonb)
      into v_badges
      from public.player_achievements a
      left join public.achievement_catalog() c on c.code = a.code
     where a.player_id = v_uid;

    return jsonb_build_object(
        'player', v_player,
        'experience', v_exp,
        'level', v_level,
        'experienceToNextLevel', v_xp_next,
        'collectionCompletionPercent', v_comp,
        'ownedCards', v_owned,
        'totalCards', v_total,
        'totalDiscoveries', v_disc,
        'favoriteColors', coalesce(v_colors, '{}'),
        'buildingsVisited', coalesce(v_buildings, '{}'),
        'battleStats', jsonb_build_object(
            'played', v_played, 'wins', v_wins, 'losses', v_losses, 'winRatePercent', v_rate
        ),
        'badges', v_badges
    );
end;
$$;

revoke execute on function public.my_profile_stats(uuid) from public, anon;
grant execute on function public.my_profile_stats(uuid) to authenticated, service_role;
