-- Campus Forge → Supabase
-- Migration 16: collect up to 4 copies of an UNLOCK card by scanning 4 different codes.
--
-- Before: player_unlocks was unique per (player, card), so a player owned at
-- most ONE copy of every UNLOCK card, however many codes they found.
--
-- Now:
--   * every unlock row records the claim (QR code) that granted it
--     (player_unlocks.claim_id); a code gives a player at most one copy
--     (unique (player_id, claim_id)), and each DIFFERENT code for the same
--     card adds a copy, up to 4 (the Standard per-deck maximum);
--   * each new copy is worth the usual 10 XP × event bonus; rescanning a code
--     you already used, or scanning a 5th code, only bumps the discovery count;
--   * a per-player-per-card advisory lock stops two concurrent scans from
--     overshooting the cap;
--   * UNIQUE cards: a player who already holds a serial of a card can no
--     longer claim a second one by scanning; the code is NOT consumed (it
--     used to be burned without granting anything), so someone else can have it;
--   * the claim result tells the app how many copies you now own and why a
--     scan granted nothing (reason: SAME_CODE | MAX_COPIES | UNLIMITED).
--
-- Copy quantities are already read as row counts everywhere else
-- (validate_deck_spec, validate_deck, the collection page), so no other change
-- is needed. Pre-existing unlock rows keep claim_id = null and count as copies.
--
-- Idempotent.

alter table public.player_unlocks
    add column if not exists claim_id uuid references public.claims (id) on delete set null;

do $$
begin
    if exists (select 1 from pg_constraint where conname = 'uk_player_unlocks_player_card') then
        alter table public.player_unlocks drop constraint uk_player_unlocks_player_card;
    end if;
    if not exists (select 1 from pg_constraint where conname = 'uk_player_unlocks_player_claim') then
        alter table public.player_unlocks
            add constraint uk_player_unlocks_player_claim unique (player_id, claim_id);
    end if;
end;
$$;

create index if not exists idx_player_unlocks_player_card on public.player_unlocks (player_id, card_id);

-- ---------------------------------------------------------------
-- apply_claim: multi-copy unlocks, unique-card guard, richer result.
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
