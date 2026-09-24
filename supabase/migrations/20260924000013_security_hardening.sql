-- Campus Forge → Supabase
-- Migration 13: production security hardening + durable game history.
--
-- Fixes (all verified against a Supabase-shaped Postgres before shipping):
--   * Function privileges. Supabase's default privileges GRANT EXECUTE on every
--     new public function to anon + authenticated *directly*, so the
--     `revoke ... from public` lines in 06–11 never took effect: apply_claim,
--     record_match_result, add_feed_entry, ensure_print_claim, … were callable
--     by anyone with the publishable key (e.g. unlock every card for any player,
--     since print cores are derivable from public card ids). Now: revoke all,
--     then allow-list exactly what the PWA calls.
--   * profiles: a player could UPDATE their own role/experience/level/banned.
--     A trigger now pins those columns unless the caller is an admin or a
--     trusted server path (service role / definer functions).
--   * Direct-write RLS holes: players could insert their own unlocks,
--     discoveries and achievements, and insert/update trades + trade_cards
--     directly (skipping create_trade validation, or flipping status to
--     ACCEPTED). Writes now go only through the definer RPCs.
--   * Trade RPCs trusted auth.uid() without a NULL check; a caller with no
--     user (anon/service) slipped past the participant checks.
--   * my_profile_stats(p_player) returned any player's email to anyone.
--   * popular_decks / active_buildings ran as invoker, so RLS silently limited
--     the "global" analytics to the caller's own rows.
--   * validate_deck (battle-time) skipped the deck-size check when the deck had
--     no cards, ignored copy counts, and checked bans in every format.
--   * Banned players can no longer claim or trade.
--
-- Adds:
--   * public.game_log: append-only history (claims, trades, match results,
--     starter grants, admin spawns) — activity_feed is a 50-row UI ring, this
--     is the durable record. Owner/admin readable; written only server-side.
--   * trades on the supabase_realtime publication (live incoming offers).
--
-- Idempotent: safe to paste into the SQL Editor more than once.

-- ---------------------------------------------------------------
-- game_log: durable, append-only event history
-- ---------------------------------------------------------------
create table if not exists public.game_log (
    id         bigint generated always as identity primary key,
    kind       text not null check (kind in ('CLAIM', 'TRADE', 'MATCH', 'STARTER', 'SPAWN')),
    player_id  uuid references public.profiles (id) on delete set null,
    card_id    uuid references public.cards (id) on delete set null,
    ref_id     uuid,
    xp         bigint not null default 0,
    detail     jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_game_log_player_created on public.game_log (player_id, created_at desc);
create index if not exists idx_game_log_kind_created on public.game_log (kind, created_at desc);

alter table public.game_log enable row level security;

drop policy if exists game_log_select_own on public.game_log;
create policy game_log_select_own on public.game_log for select
to authenticated
using (player_id = auth.uid() or public.is_admin());

-- no insert/update/delete policies: only definer functions + service role write.
revoke insert, update, delete, truncate on public.game_log from anon, authenticated;

-- ---------------------------------------------------------------
-- assert_active_player: the caller must be a signed-in, non-banned player.
-- ---------------------------------------------------------------
create or replace function public.assert_active_player(p_player uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_banned boolean;
begin
    if p_player is null then
        raise exception 'Not authenticated' using errcode = 'CF401';
    end if;
    select banned into v_banned from public.profiles where id = p_player;
    if not found then
        raise exception 'Player not found' using errcode = 'CF404';
    end if;
    if v_banned then
        raise exception 'This account is banned' using errcode = 'CF403';
    end if;
end;
$$;

-- ---------------------------------------------------------------
-- profiles: players may only edit their own presentation/cohort fields.
-- current_user is 'authenticated'/'anon' for PostgREST requests and the
-- function owner inside SECURITY DEFINER functions, so server paths
-- (apply_claim XP, record_match_result, admin tooling via service role)
-- are unaffected.
-- ---------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
as $$
begin
    if current_user in ('anon', 'authenticated') and not public.is_admin() then
        if new.id is distinct from old.id
           or new.email is distinct from old.email
           or new.role is distinct from old.role
           or new.experience is distinct from old.experience
           or new.banned is distinct from old.banned
           or new.banned_at is distinct from old.banned_at
           or new.created is distinct from old.created then
            raise exception 'Players may only edit display name, avatar, student id, cohort and onboarding fields'
                using errcode = '42501';
        end if;
    end if;
    -- level is always derived (trg_profiles_sync_level only fires on experience changes)
    new.level := public.compute_level(new.experience);
    return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
before update on public.profiles
for each row execute function public.guard_profile_update();

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'chk_profiles_display_name') then
        alter table public.profiles
            add constraint chk_profiles_display_name
            check (char_length(btrim(display_name)) between 1 and 40) not valid;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'chk_deck_cards_quantity') then
        alter table public.deck_cards
            add constraint chk_deck_cards_quantity check (quantity between 1 and 250) not valid;
    end if;
end;
$$;

-- ---------------------------------------------------------------
-- RLS: remove direct-write policies that bypass the game rules.
-- ---------------------------------------------------------------
drop policy if exists player_unlocks_insert_own on public.player_unlocks;
drop policy if exists player_unlocks_delete_own on public.player_unlocks;   -- delete + rescan = XP farm
drop policy if exists discoveries_insert_own on public.discoveries;
drop policy if exists discoveries_update_own on public.discoveries;
drop policy if exists player_achievements_insert_own on public.player_achievements;
drop policy if exists trades_insert_sender on public.trades;
drop policy if exists trades_update_party on public.trades;
drop policy if exists trade_cards_insert_party on public.trade_cards;
drop policy if exists trade_cards_delete_party on public.trade_cards;

-- the feed carries player names; keep it behind sign-in (Realtime included).
drop policy if exists activity_feed_select_all on public.activity_feed;
drop policy if exists activity_feed_select_auth on public.activity_feed;
create policy activity_feed_select_auth on public.activity_feed for select
to authenticated
using (true);

-- ---------------------------------------------------------------
-- apply_claim: + banned check, + game_log row. Otherwise unchanged (06).
-- ---------------------------------------------------------------
create or replace function public.apply_claim(p_core text, p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    c          public.claims%rowtype;
    v_card     public.cards%rowtype;
    v_count    bigint;
    v_owns     boolean;
    v_unlocked boolean := false;
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

    v_owns := (v_card.ownership_type = 'UNLIMITED')
           or (v_card.ownership_type = 'UNLOCK'
               and exists (select 1 from public.player_unlocks ul
                            where ul.player_id = p_player and ul.card_id = v_card.id))
           or (v_card.ownership_type = 'UNIQUE'
               and exists (select 1 from public.unique_cards uq
                            where uq.owner_id = p_player and uq.card_id = v_card.id));

    if not v_owns then
        if v_card.ownership_type = 'UNLOCK' then
            insert into public.player_unlocks (id, player_id, card_id, unlocked_at)
            values (gen_random_uuid(), p_player, v_card.id, now())
            on conflict on constraint uk_player_unlocks_player_card do nothing;
            v_unlocked := true;
            v_xp := round(10 * v_bonus)::bigint;
        elsif v_card.ownership_type = 'UNIQUE' then
            select coalesce(max(uq.serial_number), 0) + 1 into v_serial
              from public.unique_cards uq where uq.card_id = v_card.id;
            v_phys := public.unique_physical_uuid(c.token_core);
            insert into public.unique_cards (physical_uuid, owner_id, card_id, serial_number, history)
            values (v_phys, p_player, c.card_id, v_serial, 'claimed via discovery')
            on conflict (physical_uuid) do nothing;
            v_unlocked := true;
            v_xp := round(10 * v_bonus)::bigint;
        end if;
    end if;

    if v_unlocked then
        update public.profiles set experience = experience + v_xp where id = p_player;
        perform public.add_feed_entry('DISCOVERY', 'discovered ' || v_card.forge_name, p_player, v_card.id);
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
        'discoveryCount', v_count,
        'experienceAwarded', v_xp,
        'token', c.token,
        'building', c.building,
        'physicalUuid', v_phys
    );
end;
$$;

-- ---------------------------------------------------------------
-- accept_trade: + NULL-actor/banned guard, + game_log rows.
-- ---------------------------------------------------------------
create or replace function public.accept_trade(p_trade uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t               public.trades%rowtype;
    v_card_uuid     uuid;
    v_side          text;
    v_from_name     text;
    v_to_name       text;
    v_now           timestamptz := now();
    v_sender_name   text;
    v_receiver_name text;
    v_actor         uuid := auth.uid();
    v_offered       jsonb;
    v_requested     jsonb;
begin
    perform public.assert_active_player(v_actor);

    select * into t from public.trades where id = p_trade for update;
    if not found or (v_actor <> t.sender_id and v_actor <> t.receiver_id) then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor = t.sender_id then
        raise exception 'Only the receiver can perform this action on the trade' using errcode = 'CF403';
    end if;
    if t.status <> 'PENDING' then
        raise exception 'Trade is already %', lower(t.status) using errcode = 'CF409';
    end if;
    if t.expires_at < v_now then
        update public.trades set status = 'EXPIRED', resolved_at = v_now where id = t.id;
        raise exception 'Trade has expired' using errcode = 'CF410';
    end if;

    select display_name into v_sender_name   from public.profiles where id = t.sender_id;
    select display_name into v_receiver_name from public.profiles where id = t.receiver_id;

    -- lock every involved card in sorted-UUID order (deadlock avoidance)
    for v_card_uuid in
        select tc.physical_uuid from public.trade_cards tc
         where tc.trade_id = t.id order by tc.physical_uuid
    loop
        perform 1 from public.unique_cards where physical_uuid = v_card_uuid for update;
    end loop;

    -- ownership re-verification
    if exists (
        select 1
          from public.trade_cards tc
          left join public.unique_cards uc on uc.physical_uuid = tc.physical_uuid
         where tc.trade_id = t.id
           and (uc.physical_uuid is null
                or (tc.side = 'OFFERED'   and uc.owner_id <> t.sender_id)
                or (tc.side = 'REQUESTED' and uc.owner_id <> t.receiver_id))
    ) then
        raise exception 'Ownership changed; trade no longer valid' using errcode = 'CF409';
    end if;

    -- swap owners + append history (display names, "\n"-joined)
    for v_card_uuid, v_side in
        select tc.physical_uuid, tc.side from public.trade_cards tc
         where tc.trade_id = t.id order by tc.physical_uuid
    loop
        if v_side = 'OFFERED' then
            v_from_name := v_sender_name;
            v_to_name   := v_receiver_name;
        else
            v_from_name := v_receiver_name;
            v_to_name   := v_sender_name;
        end if;
        update public.unique_cards
           set owner_id = case when v_side = 'OFFERED' then t.receiver_id else t.sender_id end,
               history = coalesce(nullif(history, ''), '')
                          || case when history is null or history = '' then '' else E'\n' end
                          || to_char(v_now, 'YYYY-MM-DD"T"HH24:MI:SS') || ': '
                          || v_from_name || ' → ' || v_to_name || ' via trade ' || t.id
         where physical_uuid = v_card_uuid;
    end loop;

    update public.trades set status = 'ACCEPTED', resolved_at = v_now where id = t.id;

    select coalesce(jsonb_agg(physical_uuid) filter (where side = 'OFFERED'), '[]'::jsonb),
           coalesce(jsonb_agg(physical_uuid) filter (where side = 'REQUESTED'), '[]'::jsonb)
      into v_offered, v_requested
      from public.trade_cards where trade_id = t.id;

    insert into public.game_log (kind, player_id, ref_id, detail) values
        ('TRADE', t.sender_id,   t.id, jsonb_build_object('role', 'SENDER',   'partner', t.receiver_id, 'gave', v_offered,   'got', v_requested)),
        ('TRADE', t.receiver_id, t.id, jsonb_build_object('role', 'RECEIVER', 'partner', t.sender_id,   'gave', v_requested, 'got', v_offered));

    perform public.add_feed_entry('TRADE', 'traded unique cards with ' || v_receiver_name, t.sender_id);

    return 'ACCEPTED';
end;
$$;

-- ---------------------------------------------------------------
-- resolve_trade: + NULL-actor guard (banned players may still back out).
-- ---------------------------------------------------------------
create or replace function public.resolve_trade(p_trade uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t       public.trades%rowtype;
    v_now   timestamptz := now();
    v_actor uuid := auth.uid();
begin
    if v_actor is null then
        raise exception 'Not authenticated' using errcode = 'CF401';
    end if;
    if p_action not in ('DECLINED', 'CANCELLED') then
        raise exception 'unknown action %', p_action using errcode = 'CF400';
    end if;

    select * into t from public.trades where id = p_trade for update;
    if not found or (v_actor <> t.sender_id and v_actor <> t.receiver_id) then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if p_action = 'DECLINED' and v_actor = t.sender_id then
        raise exception 'Only the receiver can perform this action on the trade' using errcode = 'CF403';
    end if;
    if p_action = 'CANCELLED' and v_actor = t.receiver_id then
        raise exception 'Only the sender can perform this action on the trade' using errcode = 'CF403';
    end if;
    if t.status <> 'PENDING' then
        raise exception 'Trade is already %', lower(t.status) using errcode = 'CF409';
    end if;
    if t.expires_at < v_now then
        update public.trades set status = 'EXPIRED', resolved_at = v_now where id = t.id;
        raise exception 'Trade has expired' using errcode = 'CF410';
    end if;

    update public.trades set status = p_action, resolved_at = v_now where id = t.id;
    return p_action;
end;
$$;

-- ---------------------------------------------------------------
-- create_trade: + NULL-actor/banned guard, bundle size cap, banned receivers
-- are invisible (matches search_players).
-- ---------------------------------------------------------------
create or replace function public.create_trade(
    p_receiver uuid,
    p_offered uuid[],
    p_requested uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_trade  uuid := gen_random_uuid();
    v_card   uuid;
    v_sender uuid := auth.uid();
    v_name   text;
begin
    perform public.assert_active_player(v_sender);

    if p_receiver = v_sender then
        raise exception 'You cannot trade with yourself' using errcode = 'CF400';
    end if;
    if not exists (select 1 from public.profiles where id = p_receiver and banned = false) then
        raise exception 'Receiver not found' using errcode = 'CF404';
    end if;
    if coalesce(array_length(p_offered, 1), 0) = 0 and coalesce(array_length(p_requested, 1), 0) = 0 then
        raise exception 'Empty trade' using errcode = 'CF400';
    end if;
    if coalesce(array_length(p_offered, 1), 0) > 20 or coalesce(array_length(p_requested, 1), 0) > 20 then
        raise exception 'At most 20 cards per side' using errcode = 'CF400';
    end if;

    if p_offered is not null
       and (select count(*) from unnest(p_offered) x) <> (select count(distinct x) from unnest(p_offered) x) then
        raise exception 'Duplicate offered card in bundle' using errcode = 'CF400';
    end if;
    if p_requested is not null
       and (select count(*) from unnest(p_requested) x) <> (select count(distinct x) from unnest(p_requested) x) then
        raise exception 'Duplicate requested card in bundle' using errcode = 'CF400';
    end if;
    if p_offered is not null and p_requested is not null
       and exists (select 1 from unnest(p_offered) o join unnest(p_requested) r on r = o) then
        raise exception 'A card cannot be both offered and requested' using errcode = 'CF400';
    end if;

    insert into public.trades (id, sender_id, receiver_id, status)
    values (v_trade, v_sender, p_receiver, 'PENDING');

    if p_offered is not null then
        foreach v_card in array p_offered loop
            select c.forge_name into v_name from public.cards c
              join public.unique_cards uq on uq.card_id = c.id
             where uq.physical_uuid = v_card;
            if not found then
                raise exception 'Offered unique card not found: %', v_card using errcode = 'CF404';
            end if;
            if not exists (select 1 from public.unique_cards where physical_uuid = v_card and owner_id = v_sender) then
                raise exception 'You do not own offered card: %', v_name using errcode = 'CF400';
            end if;
            insert into public.trade_cards (id, trade_id, side, physical_uuid)
            values (gen_random_uuid(), v_trade, 'OFFERED', v_card);
        end loop;
    end if;

    if p_requested is not null then
        foreach v_card in array p_requested loop
            select c.forge_name into v_name from public.cards c
              join public.unique_cards uq on uq.card_id = c.id
             where uq.physical_uuid = v_card;
            if not found then
                raise exception 'Requested unique card not found: %', v_card using errcode = 'CF404';
            end if;
            if not exists (select 1 from public.unique_cards where physical_uuid = v_card and owner_id = p_receiver) then
                raise exception 'Receiver does not own requested card: %', v_name using errcode = 'CF400';
            end if;
            insert into public.trade_cards (id, trade_id, side, physical_uuid)
            values (gen_random_uuid(), v_trade, 'REQUESTED', v_card);
        end loop;
    end if;

    return v_trade;
end;
$$;

-- ---------------------------------------------------------------
-- record_match_result (battle-engine, service role): + winner must be a
-- participant, + game_log rows for both players.
-- ---------------------------------------------------------------
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
declare
    m       public.matches%rowtype;
    v_xp    bigint := 50;
    v_bonus numeric := 1.00;
begin
    select * into m from public.matches where id = p_match for update;
    if not found then
        raise exception 'Match not found: %', p_match using errcode = 'CF404';
    end if;
    if m.status in ('FINISHED', 'CONCEDED') then
        return; -- idempotent
    end if;
    if p_winner is not null and p_winner is distinct from m.player1_id and p_winner is distinct from m.player2_id then
        raise exception 'Winner is not a participant of match %', p_match using errcode = 'CF400';
    end if;

    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.id = m.event_id
       and e.active = true and e.start_time <= now() and e.end_time >= now();
    if found then
        v_xp := round(50 * v_bonus)::bigint;
    end if;

    update public.matches
       set status = 'FINISHED',
           winner_id = p_winner,
           win_condition = coalesce(p_win_cond, m.win_condition),
           ended_at = now()
     where id = p_match;

    insert into public.game_log (kind, player_id, ref_id, xp, detail)
    select 'MATCH', pid, m.id,
           case when pid = p_winner then v_xp else 0 end,
           jsonb_build_object(
               'result', case when p_winner is null then 'DRAW' when pid = p_winner then 'WIN' else 'LOSS' end,
               'winCondition', coalesce(p_win_cond, m.win_condition),
               'opponent', case when pid = m.player1_id then m.player2_id else m.player1_id end,
               'eventId', m.event_id,
               'battleCode', m.battle_code)
      from unnest(array[m.player1_id, m.player2_id]) as pid
     where pid is not null;

    if p_winner is not null then
        update public.profiles set experience = experience + v_xp where id = p_winner;
        perform public.add_feed_entry('DISCOVERY', 'won a battle (+' || v_xp || ' XP)', p_winner);
    end if;
end;
$$;

-- ---------------------------------------------------------------
-- validate_deck (battle-engine, service role): load the format first (an
-- empty deck previously skipped the size check), count owned copies like
-- validate_deck_spec, check bans in *this* format, enforce max size and
-- commander presence.
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
               case c.ownership_type
                   when 'UNLIMITED' then 2147483647
                   when 'UNLOCK' then (select count(*) from public.player_unlocks u where u.player_id = d.player_id and u.card_id = c.id)
                   else (select count(*) from public.unique_cards uc where uc.owner_id = d.player_id and uc.card_id = c.id)
               end as owned_qty,
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

-- ---------------------------------------------------------------
-- my_profile_stats: only your own stats unless admin/service role (it
-- returns the email address). Also fixes favoriteColors for multicolor
-- cards (string_to_array(x, '') does not split into characters).
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
     where c.ownership_type = 'UNLIMITED'
        or exists (select 1 from public.player_unlocks u where u.player_id = v_uid and u.card_id = c.id)
        or exists (select 1 from public.unique_cards uc where uc.owner_id = v_uid and uc.card_id = c.id);
    v_comp := case when v_total = 0 then 0 else round(100.0 * v_owned / v_total)::integer end;

    -- favoriteColors: top 3 colors across owned cards, count desc then color asc
    select array_agg(ch order by cnt desc, ch asc) into v_colors
    from (
        select ch, count(*) as cnt
        from (
            select c.id, c.colors
            from public.cards c
            where (c.ownership_type = 'UNLIMITED'
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

-- ---------------------------------------------------------------
-- Global analytics must see every row, not just the caller's.
-- ---------------------------------------------------------------
alter function public.popular_decks(integer) security definer set search_path = public;
alter function public.active_buildings(integer) security definer set search_path = public;

-- Unused migration-07 readers (superseded by leaderboard_full / my_profile_stats).
drop function if exists public.leaderboard(text, text, text, integer);
drop function if exists public.profile_stats(uuid);

-- ---------------------------------------------------------------
-- Realtime: live trade offers (RLS still applies to postgres_changes).
-- ---------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trades'
    ) then
        alter publication supabase_realtime add table public.trades;
    end if;
end;
$$;

-- ---------------------------------------------------------------
-- Function privileges: deny by default, allow-list what clients call.
-- (Runs last so it covers every function defined above.)
-- ---------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- used inside RLS policies / check constraints, so every API role needs them
grant execute on function
    public.is_admin(),
    public.compute_level(bigint),
    public.is_cohort_valid(text, text),
    public.department_of(text)
to anon, authenticated;

-- the PWA's RPC surface (all enforce auth.uid() internally)
grant execute on function
    public.accept_trade(uuid),
    public.resolve_trade(uuid, text),
    public.create_trade(uuid, uuid[], uuid[]),
    public.list_my_trades(text),
    public.player_unique_cards(uuid),
    public.search_players(text),
    public.validate_deck_spec(text, uuid, jsonb),
    public.my_profile_stats(uuid),
    public.leaderboard_full(text, text, text, text, integer),
    public.popular_decks(integer),
    public.active_buildings(integer),
    public.achievement_catalog()
to authenticated;

-- future functions created by this role start locked down too; grant explicitly.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;
