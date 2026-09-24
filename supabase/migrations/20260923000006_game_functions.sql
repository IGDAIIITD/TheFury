-- Campus Forge → Supabase
-- Migration 7/9: core game functions called by Edge Functions, the
-- battle-engine (service role), and direct client RPC.
-- Deadlock-avoidance rule preserved: row locks in sorted-UUID order.
--
-- Faithful ports of the Java semantics (ClaimService, CollectionService,
-- TradeService, MatchManager, FeedService). The resulting rules are
-- documented in DOCS/game-rules.md and DOCS/database.md.

-- ---------------------------------------------------------------
-- Feed ring (moved here from migration 8/9 so the definer functions
-- below can write feed rows). Mirrors the old in-memory CAPACITY=50.
-- ---------------------------------------------------------------
create table public.activity_feed (
    id         bigint generated always as identity primary key,
    type       text not null,
    text       text not null,
    player_id  uuid references public.profiles (id) on delete set null,
    card_id    uuid references public.cards (id) on delete set null,
    created_at timestamptz not null default now()
);

create index idx_activity_feed_created on public.activity_feed (created_at desc);

alter table public.activity_feed enable row level security;
create policy activity_feed_select_all on public.activity_feed for select using (true);

create or replace function public.prune_feed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.activity_feed
     where id not in (
        select id from public.activity_feed order by id desc limit 50
     );
    return null;
end;
$$;

create trigger trg_feed_prune
after insert on public.activity_feed
for each statement execute function public.prune_feed();

create or replace function public.add_feed_entry(p_type text, p_text text, p_player uuid default null, p_card uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.activity_feed (type, text, player_id, card_id)
    values (p_type, p_text, p_player, p_card);
end;
$$;

revoke all on function public.add_feed_entry(text, text, uuid, uuid) from public;
grant execute on function public.add_feed_entry(text, text, uuid, uuid) to service_role;

alter publication supabase_realtime add table public.activity_feed;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- unique_physical_uuid: UUID.nameUUIDFromBytes("cf-unique:" + core),
-- the deterministic physical identity of a UNIQUE card so a QR token
-- maps to exactly one serialized copy (Java ClaimService.physicalUuidFor).
-- MD5 with version-3 + IETF-variant bits set.
-- ---------------------------------------------------------------
create or replace function public.unique_physical_uuid(p_core text)
returns uuid
language plpgsql
immutable
as $$
declare
    v bytea := decode(md5('cf-unique:' || p_core), 'hex');
    hex text;
begin
    v := set_byte(v, 6, (get_byte(v, 6) & 15) | 48);
    v := set_byte(v, 8, (get_byte(v, 8) & 63) | 128);
    hex := encode(v, 'hex');
    return (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-' ||
            substr(hex, 13, 4) || '-' || substr(hex, 17, 4) || '-' ||
            substr(hex, 21, 12))::uuid;
end;
$$;

-- ---------------------------------------------------------------
-- card_print_core: deterministic QR print core, exact port of
-- Java ClaimService.deterministicCore: SHA-256("cf-print:"+cardId),
-- first 6 bytes as a 48-bit big-endian long, then 12 iterations of
-- (v % 31) taking the next char from the 31-char token alphabet.
-- ---------------------------------------------------------------
create or replace function public.card_print_core(p_card_id uuid)
returns text
language plpgsql
stable
as $$
declare
    d        bytea := digest(convert_to('cf-print:' || p_card_id, 'UTF8'), 'sha256');
    alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    v        bigint;
    sb       text := '';
begin
    v := (get_byte(d, 0)::bigint << 40)
      | (get_byte(d, 1)::bigint << 32)
      | (get_byte(d, 2)::bigint << 24)
      | (get_byte(d, 3)::bigint << 16)
      | (get_byte(d, 4)::bigint << 8)
      |  get_byte(d, 5)::bigint;
    for i in 0..11 loop
        sb := sb || substr(alphabet, (v % length(alphabet))::int + 1, 1);
        v := v / length(alphabet);
    end loop;
    return sb;
end;
$$;

-- ---------------------------------------------------------------
-- apply_claim: consume a QR token. Faithful port of ClaimService.claim
-- + CollectionService.discover (+ MatchManager reward semantics on XP).
-- Signature check happens in the Edge Function BEFORE this RPC; this
-- function is service-role only so clients cannot bypass verification.
--
-- Error codes → HTTP mapping (EF):
--   CF404 → 404, CF409 → 409, CF410 → 410, CF403 → 403
--
-- pkgs semantics:
--   UNLOCK token claims  → reusable per player; each player gets unlock +
--                          XP on first discovery, then count++ / alreadyOwned
--                          (0 XP) afterwards. Token stays ACTIVE.
--   UNIQUE token claims  → one-shot; first claimer gets the serialized copy
--                          (deterministic physical uuid + max(serial)+1) and
--                          XP, token flips to CLAIMED; anyone else → 409.
--   UNLIMITED claims     → discovery count only, always alreadyOwned (0 XP).
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
    select * into c from public.claims where token_core = p_core for update;
    if not found then
        raise exception 'Claim token not found: %', p_core using errcode = 'CF404';
    end if;

    select * into v_card from public.cards where id = c.card_id;
    if not found then
        raise exception 'unknown card' using errcode = 'CF404';
    end if;

    -- status gate, in ClaimService order
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

    -- discovery always bumps (CollectionService.discover)
    insert into public.discoveries (id, player_id, card_id, count, last_discovered)
    values (gen_random_uuid(), p_player, c.card_id, 1, now())
    on conflict on constraint uk_discoveries_player_card do update
    set count = public.discoveries.count + 1,
        last_discovered = now();

    select d.count into v_count
      from public.discoveries d
     where d.player_id = p_player and d.card_id = c.card_id;

    -- first active event by start time wins (EventService.activeEvent)
    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.active = true and e.start_time <= now() and e.end_time >= now()
     order by e.start_time
     limit 1;
    if not found then
        v_bonus := 1.00;
    end if;

    -- ownership gate (CollectionService.owns): UNLIMITED always owned
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

    -- claim bookkeeping: UNIQUE flips to CLAIMED (one-shot); others keep
    -- ACTIVE but record the last claimer (reusable per player).
    if v_card.ownership_type = 'UNIQUE' then
        update public.claims set status = 'CLAIMED', claimed_by = p_player, claimed_at = now()
         where id = c.id;
    else
        update public.claims set claimed_by = p_player, claimed_at = now() where id = c.id;
    end if;

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

revoke all on function public.apply_claim(text, uuid) from public;
grant execute on function public.apply_claim(text, uuid) to service_role;

-- ---------------------------------------------------------------
-- accept_trade: receiver accepts. actor = auth.uid() (SECURITY DEFINER +
-- RLS bypass still cannot forge the actor). Faithful port of
-- TradeService.accept: lock pending trade, participant + role + status +
-- TTL checks, lock all involved cards one-by-one in sorted-UUID order,
-- re-verify ownership, swap owners, append history line (display names,
-- "\n"-joined), publish the trade feed entry.
-- ---------------------------------------------------------------
create or replace function public.accept_trade(p_trade uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t              public.trades%rowtype;
    v_card_uuid    uuid;
    v_side         text;
    v_from_name    text;
    v_to_name      text;
    v_now          timestamptz := now();
    v_sender_name  text;
    v_receiver_name text;
    v_actor        uuid := auth.uid();
begin
    select * into t from public.trades where id = p_trade for update;
    if not found then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor <> t.sender_id and v_actor <> t.receiver_id then
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
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        perform 1 from public.unique_cards where physical_uuid = v_card_uuid for update;
    end loop;

    -- ownership re-verification (TradeService.accept)
    for v_card_uuid in
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        select side into v_side from public.trade_cards where trade_id = t.id and physical_uuid = v_card_uuid;
        if (v_side = 'OFFERED'
            and exists (select 1 from public.unique_cards
                         where physical_uuid = v_card_uuid and owner_id <> t.sender_id))
           or (v_side = 'REQUESTED'
               and exists (select 1 from public.unique_cards
                            where physical_uuid = v_card_uuid and owner_id <> t.receiver_id)) then
            raise exception 'Ownership changed; trade no longer valid' using errcode = 'CF409';
        end if;
    end loop;

    -- swap owners + append history (display names, "\n"-joined)
    for v_card_uuid in
        select tc.physical_uuid
          from public.trade_cards tc
         where tc.trade_id = t.id
         order by tc.physical_uuid
    loop
        select side into v_side from public.trade_cards where trade_id = t.id and physical_uuid = v_card_uuid;
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

    perform public.add_feed_entry('TRADE', 'traded unique cards with ' || v_receiver_name, t.sender_id);

    return 'ACCEPTED';
end;
$$;

revoke all on function public.accept_trade(uuid) from public;
grant execute on function public.accept_trade(uuid) to authenticated;
grant execute on function public.accept_trade(uuid) to service_role;

-- decline (receiver) / cancel (sender) with the same role + TTL rules.
create or replace function public.resolve_trade(p_trade uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    t            public.trades%rowtype;
    v_now        timestamptz := now();
    v_actor      uuid := auth.uid();
begin
    if p_action not in ('DECLINED', 'CANCELLED') then
        raise exception 'unknown action %', p_action using errcode = 'CF400';
    end if;

    select * into t from public.trades where id = p_trade for update;
    if not found then
        raise exception 'Trade not found: %', p_trade using errcode = 'CF404';
    end if;
    if v_actor <> t.sender_id and v_actor <> t.receiver_id then
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

revoke all on function public.resolve_trade(uuid, text) from public;
grant execute on function public.resolve_trade(uuid, text) to authenticated;
grant execute on function public.resolve_trade(uuid, text) to service_role;

-- create trade from the client (RPC); sender = auth.uid(). Faithful port of
-- TradeService.create + validateBundles: no self-trade, no duplicate cards
-- in a bundle, no offered∩requested overlap, sender owns offered,
-- receiver owns requested, receiver exists.
create or replace function public.create_trade(
    p_receiver uuid,
    p_offered uuid[],   -- sender-owned unique card physical uuids
    p_requested uuid[]  -- receiver-owned unique card physical uuids
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
    if p_receiver = v_sender then
        raise exception 'You cannot trade with yourself' using errcode = 'CF400';
    end if;
    if not exists (select 1 from public.profiles where id = p_receiver) then
        raise exception 'Receiver not found' using errcode = 'CF404';
    end if;
    if (array_length(p_offered, 1) is null or array_length(p_offered, 1) = 0)
       and (array_length(p_requested, 1) is null or array_length(p_requested, 1) = 0) then
        raise exception 'Empty trade' using errcode = 'CF400';
    end if;

    -- no duplicates within a bundle; no overlap between bundles
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
            select forge_name into v_name from public.cards c
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
            select forge_name into v_name from public.cards c
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

revoke all on function public.create_trade(uuid, uuid[], uuid[]) from public;
grant execute on function public.create_trade(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.create_trade(uuid, uuid[], uuid[]) to service_role;

-- ---------------------------------------------------------------
-- record_match_result: called by battle-engine (service role) when a match
-- ends. Winner gets XP (round(50 * bonus)); bonus comes from the match's
-- event if currently active (MatchManager.rewardWinner), else 50.
-- Idempotent on already-finished/conceded matches.
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

    select e.bonus_multiplier into v_bonus
      from public.events e
     where e.id = m.event_id
       and e.active = true and e.start_time <= now() and e.end_time >= now();
    if found then
        v_xp := round(50 * v_bonus)::bigint;
    end if;

    update public.matches
       set status = case when m.status = 'CONCEDED' then 'CONCEDED' else 'FINISHED' end,
           winner_id = p_winner,
           win_condition = coalesce(p_win_cond, m.win_condition),
           ended_at = now()
     where id = p_match;

    if p_winner is not null then
        update public.profiles set experience = experience + v_xp where id = p_winner;
        perform public.add_feed_entry('DISCOVERY', 'won a battle (+' || v_xp || ' XP)', p_winner);
    end if;
end;
$$;

revoke all on function public.record_match_result(uuid, uuid, text) from public;
grant execute on function public.record_match_result(uuid, uuid, text) to service_role;