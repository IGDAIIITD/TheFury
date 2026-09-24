-- Campus Forge → Supabase
-- Migration 11/11: client read RPCs.
--
-- RLS lets a player read their own rows, but the web client needs several
-- cross-player or denormalized reads that plain RLS blocks (RLS can only see
-- rows for auth.uid()). These are SECURITY DEFINER ports of the Java services
-- (LeaderboardService, PlayerStatsService, PlayerController, TradeService,
-- DeckValidationService, AchievementCatalog) so the PWA calls one RPC instead
-- of a stack of RLS-fenced selects.
--
-- Idempotent (create or replace + guarded ALTER) so it can be pasted straight
-- into the hosted-dashboard SQL Editor on top of the applied 00–10 migrations.

-- ---------------------------------------------------------------
-- Feed: denormalize player_name on activity_feed so both the REST-history
-- reads and Realtime pushes carry a display name without a join (the join
-- would hit profiles RLS for other players' rows).
-- ---------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'activity_feed' and column_name = 'player_name'
    ) then
        alter table public.activity_feed add column player_name text;
    end if;
end;
$$;

update public.activity_feed af
   set player_name = p.display_name
  from public.profiles p
 where p.id = af.player_id
   and (af.player_name is null or af.player_name = '');

create or replace function public.add_feed_entry(p_type text, p_text text, p_player uuid default null, p_card uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.activity_feed (type, text, player_id, card_id, player_name)
    values (
        p_type,
        p_text,
        p_player,
        p_card,
        case when p_player is null then null
             else (select display_name from public.profiles where id = p_player)
        end
    );
end;
$$;

revoke all on function public.add_feed_entry(text, text, uuid, uuid) from public;
grant execute on function public.add_feed_entry(text, text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------
-- Achievement catalog (single source of truth, AchievementCatalog.java).
-- ---------------------------------------------------------------
create or replace function public.achievement_catalog()
returns table (
    code        text,
    name        text,
    description text,
    metric      text,
    threshold   integer
)
language sql
immutable
as $$
    values
        ('FIRST_DISCOVERY', 'First Discovery', 'Discover your first card.', 'DISCOVERIES', 1),
        ('EXPLORER', 'Explorer', 'Discover 25 cards.', 'DISCOVERIES', 25),
        ('COLLECTOR_I', 'Collector I', 'Own 25% of the card catalog.', 'COLLECTION_PCT', 25),
        ('COLLECTOR_II', 'Collector II', 'Own 50% of the card catalog.', 'COLLECTION_PCT', 50),
        ('COLLECTOR_III', 'Collector III', 'Own 75% of the card catalog.', 'COLLECTION_PCT', 75),
        ('COMPLETIONIST', 'Completionist', 'Own every card.', 'COLLECTION_PCT', 100),
        ('BATTLE_VETERAN', 'Battle Veteran', 'Win your first battle.', 'BATTLES_WON', 1),
        ('UNDEFEATED', 'Undefeated', 'Win every battle you finish.', 'UNDEFEATED', 1),
        ('RISING_STAR', 'Rising Star', 'Reach level 5.', 'LEVEL', 5),
        ('HALL_OF_FAME', 'Hall of Fame', 'Reach level 10.', 'LEVEL', 10),
        ('FIRST_TRADE', 'First Trade', 'Complete your first unique-card trade.', 'UNIQUE_TRADES', 1),
        ('MASTER_TRADER', 'Master Trader', 'Complete 5 unique-card trades.', 'UNIQUE_TRADES', 5);
$$;

-- ---------------------------------------------------------------
-- sweep_achievements: achievement unlock check, AchievementService.unlockFor
-- port. Runs at the top of my_profile_stats (like PlayerStatsService does
-- before badges). Security definer so it can write player_achievements.
-- ---------------------------------------------------------------
create or replace function public.sweep_achievements(p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_level    integer;
    v_disc     bigint;
    v_played   integer;
    v_wins     integer;
    v_owned    integer;
    v_total    integer;
    v_comp     integer;
    v_trades   bigint;
    v_undef    integer;
    ac         record;
    v_value    bigint;
begin
    if p_player is null then
        return;
    end if;

    select public.compute_level(p.experience) into v_level
      from public.profiles p where p.id = p_player;
    if not found then
        return;
    end if;

    select coalesce(sum(count), 0) into v_disc
      from public.discoveries where player_id = p_player;

    select count(*) into v_played from public.matches
     where (player1_id = p_player or player2_id = p_player)
       and status in ('FINISHED', 'CONCEDED');
    select count(*) into v_wins from public.matches
     where winner_id = p_player and status in ('FINISHED', 'CONCEDED');

    select count(*) into v_total from public.cards;
    select count(distinct c.id) into v_owned from public.cards c
     where c.ownership_type = 'UNLIMITED'
        or exists (select 1 from public.player_unlocks u where u.player_id = p_player and u.card_id = c.id)
        or exists (select 1 from public.unique_cards uc where uc.owner_id = p_player and uc.card_id = c.id);

    v_comp := case when v_total = 0 then 0 else round(100.0 * v_owned / v_total)::integer end;

    select count(*) into v_trades from public.trades
     where status = 'ACCEPTED' and (sender_id = p_player or receiver_id = p_player);

    v_undef := case when v_played >= 1 and v_wins = v_played then 1 else 0 end;

    for ac in select * from public.achievement_catalog() loop
        v_value := case ac.metric
            when 'DISCOVERIES'    then v_disc
            when 'BATTLES_WON'    then v_wins
            when 'UNIQUE_TRADES'  then v_trades
            when 'LEVEL'          then v_level
            when 'COLLECTION_PCT' then v_comp
            when 'UNDEFEATED'     then v_undef
            else 0
        end;
        if v_value >= ac.threshold then
            insert into public.player_achievements (id, player_id, code)
            values (gen_random_uuid(), p_player, ac.code)
            on conflict on constraint uk_player_achievements_player_code do nothing;
        end if;
    end loop;
end;
$$;

revoke all on function public.sweep_achievements(uuid) from public;
grant execute on function public.sweep_achievements(uuid) to authenticated;
grant execute on function public.sweep_achievements(uuid) to service_role;

-- ---------------------------------------------------------------
-- my_profile_stats: GET /players/me/stats port (PlayerStatsService.myStats).
-- Sweeps achievements first, returns the full ProfileStatsDto payload as JSON
-- (badges resolved through achievement_catalog).
-- ---------------------------------------------------------------
create or replace function public.my_profile_stats(p_player uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid      uuid := coalesce(p_player, auth.uid());
    v_exp      bigint;
    v_level    integer;
    v_xp_next  bigint;
    v_disc     bigint;
    v_owned    integer;
    v_total    integer;
    v_comp     integer;
    v_colors   text[];
    v_buildings text[];
    v_played   integer;
    v_wins     integer;
    v_losses   integer;
    v_rate     integer;
    v_player   jsonb;
    v_badges   jsonb;
begin
    if v_uid is null then
        return null;
    end if;

    select
        p.experience,
        public.compute_level(p.experience),
        jsonb_build_object(
            'id', p.id, 'email', p.email, 'displayName', p.display_name, 'role', p.role,
            'avatar', p.avatar, 'studentId', p.student_id,
            'degreeLevel', p.degree_level, 'specialization', p.specialization,
            'experience', p.experience, 'level', public.compute_level(p.experience)
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
     where c.ownership_type = 'UNLIMITED'
        or exists (select 1 from public.player_unlocks u where u.player_id = v_uid and u.card_id = c.id)
        or exists (select 1 from public.unique_cards uc where uc.owner_id = v_uid and uc.card_id = c.id);
    v_comp := case when v_total = 0 then 0 else round(100.0 * v_owned / v_total)::integer end;

    -- favoriteColors (PlayerMetrics.favoriteColors): top 3 identity colors by
    -- count across owned cards, count desc then color asc.
    select array_agg(ch) into v_colors
    from (
        select ch as ch, count(*) as cnt
        from (
            select distinct c.id, c.colors
            from public.cards c
            where (c.ownership_type = 'UNLIMITED'
                   or exists (select 1 from public.player_unlocks u where u.player_id = v_uid and u.card_id = c.id)
                   or exists (select 1 from public.unique_cards uc where uc.owner_id = v_uid and uc.card_id = c.id))
              and c.colors is not null and c.colors <> ''
        ) owned,
        lateral unnest(string_to_array(replace(replace(replace(replace(replace(
            upper(owned.colors), 'W', 'W'), 'U', 'U'), 'B', 'B'), 'R', 'R'), 'G', 'G'), '')) as ch
        where ch in ('W', 'U', 'B', 'R', 'G')
        group by ch
        order by cnt desc, ch asc
        limit 3
    ) s;

    -- buildingsVisited (PlayerStatsService.buildingsVisited): distinct trimmed
    -- non-blank buildings from claimed spawns, sorted.
    select array_agg(b) into v_buildings
    from (
        select distinct trim(building) as b
        from public.claims
        where claimed_by = v_uid and building is not null and trim(building) <> ''
        order by b
    ) s;

    -- battleStats (PlayerMetrics.battleStats)
    select count(*) into v_played from public.matches
     where (player1_id = v_uid or player2_id = v_uid) and status in ('FINISHED', 'CONCEDED');
    select count(*) into v_wins from public.matches
     where winner_id = v_uid and status in ('FINISHED', 'CONCEDED');
    v_losses := v_played - v_wins;
    v_rate := case when v_played = 0 then 0 else round(100.0 * v_wins / v_played)::integer end;

    -- achievements: sweep, then badges resolved via the catalog.
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

revoke all on function public.my_profile_stats(uuid) from public;
grant execute on function public.my_profile_stats(uuid) to authenticated;
grant execute on function public.my_profile_stats(uuid) to anon;
grant execute on function public.my_profile_stats(uuid) to service_role;

-- ---------------------------------------------------------------
-- leaderboard_full: GET /api/v1/leaderboard port (LeaderboardService). Three
-- metrics: 'level' (score=level, value=experience), 'collection'
-- (score=completion %, value=owned count), 'winrate' (score=win %, value=wins).
-- Banned players excluded; cohort/department filters; limit clamped 1..100.
-- Returns { rows: [{rank, playerId, displayName, avatar, degreeLevel,
-- specialization, score, value}], myRank } where myRank is the caller's
-- 1-based position over the FULL filtered set (may be beyond the limit/rows).
-- ---------------------------------------------------------------
create or replace function public.leaderboard_full(
    p_metric       text     default 'level',
    p_degree_level text     default null,
    p_specialization text   default null,
    p_department   text     default null,
    p_limit        integer  default 50
)
returns jsonb
language sql
security definer
set search_path = public
as $$
    with
    tot as (
        select count(*)::integer as n from public.cards
    ),
    base as (
        select
            p.id, p.display_name, p.avatar, p.degree_level, p.specialization,
            p.experience,
            public.compute_level(p.experience) as level,
            (select count(distinct c.id) from public.cards c
              where c.ownership_type = 'UNLIMITED'
                 or exists (select 1 from public.player_unlocks u where u.player_id = p.id and u.card_id = c.id)
                 or exists (select 1 from public.unique_cards uc where uc.owner_id = p.id and uc.card_id = c.id)
            ) as owned_count,
            (select count(*) from public.matches m
              where (m.player1_id = p.id or m.player2_id = p.id) and m.status in ('FINISHED', 'CONCEDED')) as played,
            (select count(*) from public.matches m
              where m.winner_id = p.id and m.status in ('FINISHED', 'CONCEDED')) as wins
        from public.profiles p
        where p.banned = false
          and (p_degree_level is null     or upper(p.degree_level) = upper(p_degree_level))
          and (p_specialization is null   or upper(p.specialization) = upper(p_specialization))
          and (p_department is null       or public.department_of(p.specialization) = upper(p_department))
    ),
    scored as (
        select
            b.*,
            case p_metric
                when 'collection' then case when t.n = 0 then 0 else round(100.0 * b.owned_count / t.n)::integer end
                when 'winrate'    then case when b.played = 0 then 0 else round(100.0 * b.wins / b.played)::integer end
                else b.level
            end as score,
            case p_metric
                when 'collection' then b.owned_count
                when 'winrate'    then b.wins
                else b.experience
            end as value,
            row_number() over (
                order by
                    case p_metric
                        when 'collection' then case when t.n = 0 then 0 else round(100.0 * b.owned_count / t.n)::integer end
                        when 'winrate'    then case when b.played = 0 then 0 else round(100.0 * b.wins / b.played)::integer end
                        else b.level
                    end desc,
                    case p_metric
                        when 'collection' then b.owned_count
                        when 'winrate'    then b.wins
                        else b.experience
                    end desc,
                    b.display_name asc
            ) as rn
        from base b
        cross join tot t
    )
    select jsonb_build_object(
        'rows', coalesce((
            select jsonb_agg(jsonb_build_object(
                'rank', s.rn, 'playerId', s.id, 'displayName', s.display_name,
                'avatar', s.avatar, 'degreeLevel', s.degree_level,
                'specialization', s.specialization, 'score', s.score, 'value', s.value)
            order by s.rn)
            from scored s
            where s.rn <= least(greatest(p_limit, 1), 100)
        ), '[]'::jsonb),
        'myRank', (select s.rn from scored s where s.id = auth.uid()),
        'total', (select count(*) from scored)
    );
$$;

revoke all on function public.leaderboard_full(text, text, text, text, integer) from public;
grant execute on function public.leaderboard_full(text, text, text, text, integer) to authenticated;
grant execute on function public.leaderboard_full(text, text, text, text, integer) to anon;
grant execute on function public.leaderboard_full(text, text, text, text, integer) to service_role;

-- ---------------------------------------------------------------
-- search_players: GET /api/v1/players/search port (PlayerController.search).
-- Matches display name first (top 10), then email (top 10), deduped, ordered
-- by name. Output never includes the email column (PlayerSummaryDto fields
-- only); SECURITY DEFINER so the search crosses RLS like the legacy endpoint.
-- ---------------------------------------------------------------
create or replace function public.search_players(p_query text default null)
returns table (
    id             uuid,
    display_name   text,
    avatar         text,
    student_id     text,
    degree_level   text,
    specialization text
)
language sql
security definer
set search_path = public
stable
as $$
    select p.id, p.display_name, p.avatar, p.student_id, p.degree_level, p.specialization
    from public.profiles p
    where p.banned = false
      and ((p_query is null or p_query = '')
           or p.display_name ilike '%' || p_query || '%'
           or p.email ilike '%' || p_query || '%')
    order by
        case when p_query is not null and p_query <> '' and p.display_name ilike '%' || p_query || '%' then 0 else 1 end,
        p.display_name asc
    limit 20;
$$;

revoke all on function public.search_players(text) from public;
grant execute on function public.search_players(text) to authenticated;
grant execute on function public.search_players(text) to service_role;

-- ---------------------------------------------------------------
-- player_unique_cards: GET /api/v1/players/{id}/unique-cards port
-- (PlayerController.uniqueCards → UniqueCardDto). SECURITY DEFINER because RLS
-- only shows own uniques (plus pending-trade cards) and TradePage legitimately
-- browses a partner's collection before offering.
-- ---------------------------------------------------------------
create or replace function public.player_unique_cards(p_player uuid)
returns table (
    physical_uuid uuid,
    card_id       uuid,
    forge_name    text,
    set_code      text,
    rarity        text,
    image_url     text,
    serial_number integer,
    claimed_at    timestamptz,
    history       text
)
language sql
security definer
set search_path = public
stable
as $$
    select uc.physical_uuid, uc.card_id, c.forge_name, c.set_code, c.rarity, c.image_url,
           uc.serial_number, uc.claimed_at, uc.history
    from public.unique_cards uc
    join public.cards c on c.id = uc.card_id
    where uc.owner_id = p_player
    order by c.forge_name asc, uc.serial_number asc;
$$;

revoke all on function public.player_unique_cards(uuid) from public;
grant execute on function public.player_unique_cards(uuid) to authenticated;
grant execute on function public.player_unique_cards(uuid) to service_role;

-- ---------------------------------------------------------------
-- list_my_trades: GET /trades/incoming + /trades/outgoing + GET /trades/{id}
-- port (TradeService). Returns full TradeDto JSON (sender/receiver players +
-- offered/requested cards). 'INCOMING'/'OUTGOING' lazily expire pending trades
-- whose 24h TTL passed (matching expireAll); 'ALL' is the read-only view used
-- by get-trade after an accept/decline/cancel so the UI refreshes one row.
-- ---------------------------------------------------------------
create or replace function public.list_my_trades(p_direction text default 'ALL')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid    uuid := auth.uid();
    v_result jsonb;
    v_ids    uuid[];
begin
    if v_uid is null then
        return '[]'::jsonb;
    end if;

    if p_direction in ('INCOMING', 'OUTGOING') then
        -- capture the pending set first, then lazily expire (separate statement
        -- so the returned payload sees the EXPIRED status, matching expireAll)
        select array_agg(t.id) into v_ids
        from public.trades t
        where t.status = 'PENDING'
          and (
               (p_direction = 'INCOMING' and t.receiver_id = v_uid)
            or (p_direction = 'OUTGOING' and t.sender_id = v_uid)
          );

        if v_ids is not null then
            update public.trades
               set status = 'EXPIRED', resolved_at = now()
             where id = any(v_ids) and expires_at < now();
        end if;

        select coalesce(jsonb_agg(payload order by created_at desc), '[]'::jsonb)
        into v_result
        from (
            select jsonb_build_object(
                'id', t.id,
                'status', t.status,
                'sender', jsonb_build_object(
                    'id', sp.id, 'displayName', sp.display_name, 'avatar', sp.avatar,
                    'studentId', sp.student_id, 'degreeLevel', sp.degree_level,
                    'specialization', sp.specialization),
                'receiver', jsonb_build_object(
                    'id', rp.id, 'displayName', rp.display_name, 'avatar', rp.avatar,
                    'studentId', rp.student_id, 'degreeLevel', rp.degree_level,
                    'specialization', rp.specialization),
                'offered', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'physicalUuid', tc.physical_uuid, 'cardId', c.id,
                        'forgeName', c.forge_name, 'setCode', c.set_code,
                        'rarity', c.rarity, 'imageUrl', c.image_url,
                        'serialNumber', uc.serial_number)
                    order by c.forge_name)
                    from public.trade_cards tc
                    join public.unique_cards uc on uc.physical_uuid = tc.physical_uuid
                    join public.cards c on c.id = uc.card_id
                    where tc.trade_id = t.id and tc.side = 'OFFERED'), '[]'::jsonb),
                'requested', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'physicalUuid', tc.physical_uuid, 'cardId', c.id,
                        'forgeName', c.forge_name, 'setCode', c.set_code,
                        'rarity', c.rarity, 'imageUrl', c.image_url,
                        'serialNumber', uc.serial_number)
                    order by c.forge_name)
                    from public.trade_cards tc
                    join public.unique_cards uc on uc.physical_uuid = tc.physical_uuid
                    join public.cards c on c.id = uc.card_id
                    where tc.trade_id = t.id and tc.side = 'REQUESTED'), '[]'::jsonb),
                'createdAt', t.created_at,
                'resolvedAt', t.resolved_at,
                'expiresAt', t.expires_at
            ) as payload, t.created_at as created_at
            from public.trades t
            join public.profiles sp on sp.id = t.sender_id
            join public.profiles rp on rp.id = t.receiver_id
            where t.id = any(coalesce(v_ids, '{}'::uuid[]))
        ) dto;
        return v_result;
    end if;

    -- 'ALL' (default): every trade involving the caller, no state mutation.
    select coalesce(jsonb_agg(payload order by created_at desc), '[]'::jsonb)
    into v_result
    from (
        select jsonb_build_object(
            'id', t.id,
            'status', t.status,
            'sender', jsonb_build_object(
                'id', sp.id, 'displayName', sp.display_name, 'avatar', sp.avatar,
                'studentId', sp.student_id, 'degreeLevel', sp.degree_level,
                'specialization', sp.specialization),
            'receiver', jsonb_build_object(
                'id', rp.id, 'displayName', rp.display_name, 'avatar', rp.avatar,
                'studentId', rp.student_id, 'degreeLevel', rp.degree_level,
                'specialization', rp.specialization),
            'offered', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'physicalUuid', tc.physical_uuid, 'cardId', c.id,
                    'forgeName', c.forge_name, 'setCode', c.set_code,
                    'rarity', c.rarity, 'imageUrl', c.image_url,
                    'serialNumber', uc.serial_number)
                order by c.forge_name)
                from public.trade_cards tc
                join public.unique_cards uc on uc.physical_uuid = tc.physical_uuid
                join public.cards c on c.id = uc.card_id
                where tc.trade_id = t.id and tc.side = 'OFFERED'), '[]'::jsonb),
            'requested', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'physicalUuid', tc.physical_uuid, 'cardId', c.id,
                    'forgeName', c.forge_name, 'setCode', c.set_code,
                    'rarity', c.rarity, 'imageUrl', c.image_url,
                    'serialNumber', uc.serial_number)
                order by c.forge_name)
                from public.trade_cards tc
                join public.unique_cards uc on uc.physical_uuid = tc.physical_uuid
                join public.cards c on c.id = uc.card_id
                where tc.trade_id = t.id and tc.side = 'REQUESTED'), '[]'::jsonb),
            'createdAt', t.created_at,
            'resolvedAt', t.resolved_at,
            'expiresAt', t.expires_at
        ) as payload, t.created_at as created_at
        from public.trades t
        join public.profiles sp on sp.id = t.sender_id
        join public.profiles rp on rp.id = t.receiver_id
        where t.sender_id = v_uid or t.receiver_id = v_uid
    ) dto;
    return v_result;
end;
$$;

revoke all on function public.list_my_trades(text) from public;
grant execute on function public.list_my_trades(text) to authenticated;
grant execute on function public.list_my_trades(text) to service_role;

-- ---------------------------------------------------------------
-- validate_deck_spec: POST /decks/validate port (DeckValidationService.validate
-- without an event gate; battle-time event gating stays on validate_deck).
-- Accepts {formatCode, commanderCardId, cards:[{cardId,quantity}]} and returns
-- jsonb { valid, problems: [{code, message, cardId}] } with the exact problem
-- vocabulary of the Java service.
-- ---------------------------------------------------------------
create or replace function public.validate_deck_spec(
    p_format_code  text,
    p_commander    uuid,
    p_cards        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    f           public.formats%rowtype;
    v_problems  jsonb := '[]'::jsonb;
    e           record;
    v_card      record;
    v_owned_qty bigint;
    v_owns      boolean;
    v_leg       text;
    v_basic     boolean;
    v_total     integer := 0;
    v_cmdr      record;
    v_cmdr_colors text;
    v_colors    text;
    v_ch        text;
    v_entry     record;
    v_color_ok  boolean;
begin
    select * into f from public.formats where code = p_format_code;
    if not found then
        return jsonb_build_object('valid', false, 'problems', jsonb_build_array(
            jsonb_build_object('code', 'UNKNOWN_FORMAT', 'message', 'Unknown format: ' || p_format_code, 'cardId', null)
        ));
    end if;

    -- accumulate ownership / copies / legality problems, remember the card map
    for e in
        select (elem->>'cardId')::uuid as card_id,
               sum(coalesce((elem->>'quantity')::integer, 0))::integer as qty
        from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) as elem
        where elem->>'cardId' is not null
        group by 1
    loop
        v_card := null;
        select c.id, c.forge_name, c.ownership_type, c.colors, c.types, c.commander_eligible
          into v_card
          from public.cards c where c.id = e.card_id;
        if not found then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'UNKNOWN_CARD', 'message', 'Unknown card: ' || e.card_id, 'cardId', e.card_id));
            continue;
        end if;

        v_owned_qty := case v_card.ownership_type
            when 'UNLIMITED' then 2147483647
            when 'UNLOCK' then (select count(*) from public.player_unlocks where player_id = v_uid and card_id = e.card_id)
            else (select count(*) from public.unique_cards where owner_id = v_uid and card_id = e.card_id)
        end;
        v_owns := v_owned_qty > 0;

        if not v_owns then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'NOT_OWNED', 'message', 'You do not own: ' || v_card.forge_name, 'cardId', e.card_id));
        end if;
        if v_owned_qty < e.qty then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'NOT_ENOUGH_COPIES',
                'message', 'Only ' || v_owned_qty || ' owned of: ' || v_card.forge_name,
                'cardId', e.card_id));
        end if;

        select legality into v_leg from public.card_legalities
         where card_id = e.card_id and format_id = f.id;
        if v_leg = 'BANNED' then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'BANNED', 'message', 'Banned in ' || f.name || ': ' || v_card.forge_name,
                'cardId', e.card_id));
        elsif v_leg = 'RESTRICTED' and e.qty > 1 then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'RESTRICTED', 'message', 'Restricted to 1 copy in ' || f.name || ': ' || v_card.forge_name,
                'cardId', e.card_id));
        end if;

        v_basic := v_card.types is not null and v_card.types like '%Basic Land%';
        if not (f.basics_unlimited and v_basic) and e.qty > f.max_copies then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'TOO_MANY_COPIES', 'message',
                'Max ' || f.max_copies || ' copies in ' || f.name || ': ' || v_card.forge_name,
                'cardId', e.card_id));
        end if;

        v_total := v_total + e.qty;
    end loop;

    if v_total < f.min_deck_size then
        v_problems := v_problems || jsonb_build_array(jsonb_build_object(
            'code', 'TOO_FEW_CARDS', 'message',
            'Minimum ' || f.min_deck_size || ' cards, got ' || v_total, 'cardId', null));
    end if;
    if f.max_deck_size is not null and v_total > f.max_deck_size then
        v_problems := v_problems || jsonb_build_array(jsonb_build_object(
            'code', 'TOO_MANY_CARDS', 'message',
            'Maximum ' || f.max_deck_size || ' cards, got ' || v_total, 'cardId', null));
    end if;

    if f.commander_required then
        if p_commander is null then
            v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                'code', 'NO_COMMANDER', 'message', 'A commander is required.', 'cardId', null));
        else
            v_cmdr := null;
            select c.id, c.forge_name, c.colors, c.commander_eligible
              into v_cmdr
              from public.cards c where c.id = p_commander;
            if not found then
                v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                    'code', 'UNKNOWN_COMMANDER', 'message', 'Unknown commander card', 'cardId', p_commander));
            else
                v_owned_qty := (select case ownership_type
                    when 'UNLIMITED' then 2147483647
                    when 'UNLOCK' then (select count(*) from public.player_unlocks where player_id = v_uid and card_id = v_cmdr.id)
                    else (select count(*) from public.unique_cards where owner_id = v_uid and card_id = v_cmdr.id)
                end from public.cards where id = v_cmdr.id);
                if not (v_owned_qty > 0) then
                    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                        'code', 'COMMANDER_NOT_OWNED', 'message', 'You do not own: ' || v_cmdr.forge_name,
                        'cardId', v_cmdr.id));
                end if;
                if not v_cmdr.commander_eligible then
                    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                        'code', 'NOT_LEGENDARY', 'message', v_cmdr.forge_name || ' cannot be a commander.',
                        'cardId', v_cmdr.id));
                end if;
                select legality into v_leg from public.card_legalities
                 where card_id = v_cmdr.id and format_id = f.id;
                if v_leg = 'BANNED' then
                    v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                        'code', 'BANNED_COMMANDER', 'message', v_cmdr.forge_name || ' is banned as commander.',
                        'cardId', v_cmdr.id));
                end if;

                v_cmdr_colors := coalesce(v_cmdr.colors, '');

                -- color identity: every requested card's colors must be a
                -- subset of the commander's (DeckValidationService.isColorSubset)
                for v_entry in
                    select c.id, c.forge_name, c.colors
                    from public.cards c
                    where c.id in (
                        select (elem->>'cardId')::uuid
                        from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) elem
                        where elem->>'cardId' is not null
                        union
                        select p_commander
                    )
                loop
                    v_colors := coalesce(v_entry.colors, '');
                    v_color_ok := true;
                    for v_ch in select * from unnest(string_to_array(v_colors, '')) loop
                        if position(v_ch in v_cmdr_colors) = 0 then
                            v_color_ok := false;
                            exit;
                        end if;
                    end loop;
                    if not v_color_ok then
                        v_problems := v_problems || jsonb_build_array(jsonb_build_object(
                            'code', 'COLOR_IDENTITY', 'message',
                            v_entry.forge_name || ' (colors ' || v_colors || ') is outside '
                                || v_cmdr.forge_name || '''s color identity (' || v_cmdr_colors || ').',
                            'cardId', v_entry.id));
                    end if;
                end loop;
            end if;
        end if;
    end if;

    return jsonb_build_object('valid', (v_problems = '[]'::jsonb), 'problems', v_problems);
end;
$$;

revoke all on function public.validate_deck_spec(text, uuid, jsonb) from public;
grant execute on function public.validate_deck_spec(text, uuid, jsonb) to authenticated;
grant execute on function public.validate_deck_spec(text, uuid, jsonb) to service_role;