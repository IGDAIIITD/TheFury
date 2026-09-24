-- Campus Forge → Supabase
-- Migration 17: UNLIMITED cards (other than the base 15) must be scanned once.
--
-- Before: every UNLIMITED card (basic lands, the 10 starter creatures and all
-- imported-set commons) was owned by everyone from the start.
--
-- Now: cards.requires_unlock marks UNLIMITED cards that are locked until the
-- player scans ANY code for them once; after that the player owns unlimited
-- copies. The base 15 (5 basic lands + 10 starter creatures) stay free.
--
--   * owned_copies(player, card) is the single ownership rule, used by
--     apply_claim, validate_deck_spec and validate_deck:
--       UNLIMITED → unlimited if free or unlocked, else 0
--       UNLOCK    → number of player_unlocks rows (one per distinct code, ≤ 4)
--       UNIQUE    → number of serials owned
--   * collection-% queries (achievements, profile stats, leaderboard) count an
--     UNLIMITED card as owned only if it is free or unlocked;
--   * apply_claim: the first scan of a locked UNLIMITED card unlocks it
--     (player_unlocks row, +10 XP × event bonus); later scans are
--     discovery-only (reason UNLIMITED);
--   * all imported-set commons already in the catalog are flagged.
--
-- Idempotent.

alter table public.cards add column if not exists requires_unlock boolean not null default false;

update public.cards
   set requires_unlock = true
 where ownership_type = 'UNLIMITED'
   and requires_unlock = false
   and forge_name not in ('Plains', 'Island', 'Swamp', 'Mountain', 'Forest',
                          'Raging Goblin', 'Goblin Piker', 'Vulshok Berserker', 'Hill Giant', 'Fire Elemental',
                          'Grizzly Bears', 'Elvish Warrior', 'Trained Armodon', 'War Mammoth', 'Craw Wurm');

-- ---------------------------------------------------------------
-- The ownership rule (copies a player may use in a deck).
-- ---------------------------------------------------------------
create or replace function public.owned_copies(p_player uuid, p_card uuid)
returns integer
language sql
stable
set search_path = public
as $$
    select case c.ownership_type
        when 'UNLIMITED' then
            case when not c.requires_unlock
                   or exists (select 1 from public.player_unlocks u where u.player_id = p_player and u.card_id = c.id)
                 then 2147483647 else 0 end
        when 'UNLOCK' then
            (select count(*)::integer from public.player_unlocks u where u.player_id = p_player and u.card_id = c.id)
        else
            (select count(*)::integer from public.unique_cards uc where uc.owner_id = p_player and uc.card_id = c.id)
    end
    from public.cards c
    where c.id = p_card;
$$;

revoke execute on function public.owned_copies(uuid, uuid) from public, anon, authenticated;
grant execute on function public.owned_copies(uuid, uuid) to service_role;

-- ---------------------------------------------------------------
-- apply_claim (migration 16) + first scan unlocks locked UNLIMITED cards.
-- ---------------------------------------------------------------
create or replace function public.apply_claim(p_core text, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_max_copies constant integer := 4;   -- per UNLOCK card, one per distinct code
    c          public.claims%rowtype;
    v_card     public.cards%rowtype;
    v_count    bigint;
    v_unlocked boolean := false;
    v_reason   text := null;
    v_copies   integer := null;
    v_xp       bigint := 0;
    v_phys     uuid := null;
    v_serial   integer;
    v_bonus    numeric := 1.00;
begin
    perform public.assert_active_player(p_player);

    select * into c from public.claims where token_core = p_core for update;
    if not found then
        raise exception 'Claim token not found: %', p_core using errcode = 'CF404';
    end if;

    select * into v_card from public.cards where id = c.card_id;
    if not found then
        raise exception 'unknown card' using errcode = 'CF404';
    end if;

    if c.status = 'REVOKED' then
        raise exception 'Claim token has been revoked' using errcode = 'CF410';
    end if;
    if c.expires_at is not null and c.expires_at < now() then
        update public.claims set status = 'EXPIRED' where id = c.id;
        raise exception 'Claim token has expired' using errcode = 'CF410';
    end if;
    if v_card.ownership_type = 'UNIQUE' and c.claimed_by is not null then
        raise exception 'This unique card has already been claimed' using errcode = 'CF409';
    end if;
    if c.status <> 'ACTIVE' then
        raise exception 'Claim token is no longer active' using errcode = 'CF410';
    end if;

    -- serialize concurrent scans by the same player for the same card, so the
    -- copy cap and the one-unique-per-player rule below can't be raced
    perform pg_advisory_xact_lock(hashtextextended(p_player::text || ':' || v_card.id::text, 0));

    if v_card.ownership_type = 'UNIQUE'
       and exists (select 1 from public.unique_cards uq where uq.owner_id = p_player and uq.card_id = v_card.id) then
        raise exception 'You already own a copy of this unique card; leave this one for someone else'
            using errcode = 'CF409';
    end if;

    insert into public.discoveries (id, player_id, card_id, count, last_discovered)
    values (gen_random_uuid(), p_player, c.card_id, 1, now())
    on conflict on constraint uk_discoveries_player_card do update
    set count = public.discoveries.count + 1,
        last_discovered = now();

    select d.count into v_count
      from public.discoveries d
     where d.player_id = p_player and d.card_id = c.card_id;

    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.active = true and e.start_time <= now() and e.end_time >= now()
     order by e.start_time
     limit 1;
    if not found then
        v_bonus := 1.00;
    end if;

    if v_card.ownership_type = 'UNLOCK' then
        select count(*)::integer into v_copies
          from public.player_unlocks where player_id = p_player and card_id = v_card.id;
        if exists (select 1 from public.player_unlocks where player_id = p_player and claim_id = c.id) then
            v_reason := 'SAME_CODE';
        elsif v_copies >= v_max_copies then
            v_reason := 'MAX_COPIES';
        else
            insert into public.player_unlocks (id, player_id, card_id, unlocked_at, claim_id)
            values (gen_random_uuid(), p_player, v_card.id, now(), c.id);
            v_copies := v_copies + 1;
            v_unlocked := true;
            v_xp := round(10 * v_bonus)::bigint;
        end if;
    elsif v_card.ownership_type = 'UNIQUE' then
        select coalesce(max(uq.serial_number), 0) + 1 into v_serial
          from public.unique_cards uq where uq.card_id = v_card.id;
        v_phys := public.unique_physical_uuid(c.token_core);
        insert into public.unique_cards (physical_uuid, owner_id, card_id, serial_number, history)
        values (v_phys, p_player, c.card_id, v_serial, 'claimed via discovery')
        on conflict (physical_uuid) do nothing;
        v_copies := 1;
        v_unlocked := true;
        v_xp := round(10 * v_bonus)::bigint;
    elsif v_card.requires_unlock
          and not exists (select 1 from public.player_unlocks where player_id = p_player and card_id = v_card.id) then
        -- UNLIMITED but locked: this first scan unlocks unlimited copies
        insert into public.player_unlocks (id, player_id, card_id, unlocked_at, claim_id)
        values (gen_random_uuid(), p_player, v_card.id, now(), c.id);
        v_unlocked := true;
        v_xp := round(10 * v_bonus)::bigint;
    else
        v_reason := 'UNLIMITED';
    end if;

    if v_unlocked then
        update public.profiles set experience = experience + v_xp where id = p_player;
        perform public.add_feed_entry('DISCOVERY',
            case when v_card.ownership_type = 'UNLOCK' and v_copies > 1
                 then 'found copy ' || v_copies || ' of ' || v_card.forge_name
                 else 'discovered ' || v_card.forge_name end,
            p_player, v_card.id);
    else
        perform public.add_feed_entry('DISCOVERY', 'scanned ' || v_card.forge_name, p_player, v_card.id);
    end if;

    if v_card.ownership_type = 'UNIQUE' then
        update public.claims set status = 'CLAIMED', claimed_by = p_player, claimed_at = now()
         where id = c.id;
    else
        update public.claims set claimed_by = p_player, claimed_at = now() where id = c.id;
    end if;

    insert into public.game_log (kind, player_id, card_id, ref_id, xp, detail)
    values ('CLAIM', p_player, v_card.id, c.id, v_xp, jsonb_build_object(
        'unlocked', v_unlocked,
        'reason', v_reason,
        'copiesOwned', v_copies,
        'building', c.building,
        'eventId', c.event_id,
        'bonus', v_bonus,
        'discoveryCount', v_count,
        'physicalUuid', v_phys));

    return jsonb_build_object(
        'card', jsonb_build_object(
            'id', v_card.id,
            'oracleId', v_card.oracle_id,
            'forgeName', v_card.forge_name,
            'rarity', v_card.rarity,
            'ownershipType', v_card.ownership_type,
            'requiresUnlock', v_card.requires_unlock,
            'setCode', v_card.set_code,
            'manaValue', v_card.mana_value,
            'types', v_card.types,
            'colors', v_card.colors,
            'imageUrl', v_card.image_url,
            'discoverable', v_card.discoverable,
            'spawnRegion', v_card.spawn_region,
            'weight', v_card.weight,
            'commanderEligible', v_card.commander_eligible
        ),
        'unlocked', v_unlocked,
        'alreadyOwned', (not v_unlocked),
        'reason', v_reason,
        'copiesOwned', v_copies,
        'maxCopies', case when v_card.ownership_type = 'UNLOCK' then v_max_copies end,
        'discoveryCount', v_count,
        'experienceAwarded', v_xp,
        'token', c.token,
        'building', c.building,
        'physicalUuid', v_phys
    );
end;
$$;

revoke execute on function public.apply_claim(text, uuid) from public, anon, authenticated;
grant execute on function public.apply_claim(text, uuid) to service_role;

-- ---------------------------------------------------------------
-- validate_deck_spec (migration 11) with owned_copies(); also fixes the
-- color-identity check for multicolor cards (string_to_array(x, '') does not
-- split into characters; a NULL delimiter does).
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

        v_owned_qty := coalesce(public.owned_copies(v_uid, e.card_id), 0);

        if v_owned_qty = 0 then
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
                if coalesce(public.owned_copies(v_uid, v_cmdr.id), 0) = 0 then
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

                -- color identity: every card's colors must be a subset of the commander's
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
                    for v_ch in select * from unnest(string_to_array(v_colors, null)) loop
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

revoke execute on function public.validate_deck_spec(text, uuid, jsonb) from public, anon;
grant execute on function public.validate_deck_spec(text, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------
-- validate_deck (migration 13, battle time) with owned_copies().
-- ---------------------------------------------------------------
create or replace function public.validate_deck(
    p_deck  uuid,
    p_event uuid default null
)
returns setof public.deck_problem
language plpgsql
security definer
set search_path = public
as $$
declare
    d         public.decks%rowtype;
    f         public.formats%rowtype;
    v_total   integer;
    v_allowed jsonb;
    e         record;
begin
    select * into d from public.decks where id = p_deck;
    if not found then
        return next row('ERROR', 'NOT_FOUND', 'deck not found')::public.deck_problem;
        return;
    end if;

    select * into f from public.formats where code = d.format_code;
    if not found then
        return next row('ERROR', 'UNKNOWN_FORMAT', format('unknown format %s', d.format_code))::public.deck_problem;
        return;
    end if;

    if p_event is not null then
        select allowed_sets_json::jsonb into v_allowed from public.events where id = p_event and active = true;
    end if;

    select coalesce(sum(dc.quantity), 0)::integer into v_total
      from public.deck_cards dc where dc.deck_id = p_deck;

    for e in
        select c.id, c.forge_name, c.set_code, dc.quantity,
               coalesce(c.types ilike '%Basic%', false) as basic,
               coalesce(public.owned_copies(d.player_id, c.id), 0) as owned_qty,
               exists (select 1 from public.card_legalities cl
                        where cl.card_id = c.id and cl.format_id = f.id and cl.legality = 'BANNED') as banned
          from public.deck_cards dc
          join public.cards c on c.id = dc.card_id
         where dc.deck_id = p_deck
    loop
        if e.owned_qty = 0 then
            return next row('ERROR', 'NOT_OWNED', format('%s is not owned by the player', e.forge_name))::public.deck_problem;
        elsif e.owned_qty < e.quantity then
            return next row('ERROR', 'NOT_ENOUGH_COPIES', format('only %s owned of %s', e.owned_qty, e.forge_name))::public.deck_problem;
        end if;
        if not (f.basics_unlimited and e.basic) and e.quantity > f.max_copies then
            return next row('ERROR', 'TOO_MANY_COPIES', format('%s exceeds max copies of %s', e.forge_name, f.max_copies))::public.deck_problem;
        end if;
        if e.banned then
            return next row('ERROR', 'BANNED_CARD', format('%s is banned in %s', e.forge_name, f.name))::public.deck_problem;
        end if;
        if v_allowed is not null and not e.basic
           and (e.set_code is null or not (e.set_code = any (select jsonb_array_elements_text(v_allowed)))) then
            return next row('ERROR', 'NOT_IN_EVENT', format('%s is not in the event allowed sets', e.forge_name))::public.deck_problem;
        end if;
    end loop;

    if v_total < f.min_deck_size then
        return next row('WARNING', 'NOT_ENOUGH_CARDS', format('deck has %s cards, requires %s', v_total, f.min_deck_size))::public.deck_problem;
    end if;
    if f.max_deck_size is not null and v_total > f.max_deck_size then
        return next row('ERROR', 'TOO_MANY_CARDS', format('deck has %s cards, maximum %s', v_total, f.max_deck_size))::public.deck_problem;
    end if;
    if f.commander_required and d.commander_card_id is null then
        return next row('ERROR', 'NO_COMMANDER', 'a commander is required')::public.deck_problem;
    end if;
end;
$$;

revoke execute on function public.validate_deck(uuid, uuid) from public, anon, authenticated;
grant execute on function public.validate_deck(uuid, uuid) to service_role;

-- ---------------------------------------------------------------
-- sweep_achievements (migration 11): collection % counts locked UNLIMITED
-- cards only once unlocked.
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
     where (c.ownership_type = 'UNLIMITED' and not c.requires_unlock)
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

revoke execute on function public.sweep_achievements(uuid) from public, anon, authenticated;
grant execute on function public.sweep_achievements(uuid) to service_role;

-- ---------------------------------------------------------------
-- my_profile_stats (migration 13): same ownership rule.
-- ---------------------------------------------------------------
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
begin
    if v_uid is null then
        return null;
    end if;
    if auth.uid() is not null and v_uid <> auth.uid() and not public.is_admin() then
        raise exception 'You can only view your own stats' using errcode = 'CF403';
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

-- ---------------------------------------------------------------
-- leaderboard_full (migration 11): same ownership rule for 'collection'.
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
              where (c.ownership_type = 'UNLIMITED' and not c.requires_unlock)
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

revoke execute on function public.leaderboard_full(text, text, text, text, integer) from public, anon;
grant execute on function public.leaderboard_full(text, text, text, text, integer) to authenticated, service_role;
