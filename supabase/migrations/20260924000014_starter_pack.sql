-- Campus Forge → Supabase
-- Migration 14: starter pack so every account can battle on day one.
--
-- Starter creatures: 5 red + 5 green attacking creatures become UNLIMITED,
-- exactly like basic lands: every player owns infinite copies and can build
-- any deck with them (format rules still apply: max 4 copies per deck in
-- STANDARD). Scanning their QR codes still counts as a discovery (no XP).
--
-- grant_starter_pack(player):
--   * builds a legal 60-card STANDARD deck "Red-Green Starter":
--     4x each of the 10 creatures + 10 Mountain + 10 Forest,
--   * logs a STARTER row in game_log, which is also the idempotency marker
--     (a player who deletes the deck does not get a new one). If the catalog
--     is not seeded yet nothing is marked, so re-running the backfill at the
--     bottom of this file completes the grant.
-- No XP, unlocks or discoveries are granted, so scan-based achievements still
-- have to be earned.
--
-- handle_new_user now also copies a *valid* cohort from signup metadata and
-- calls grant_starter_pack; a failure there is logged as a warning and never
-- blocks signup. Existing players are backfilled once at the end.
--
-- Idempotent.

-- ---------------------------------------------------------------
-- Starter creatures are UNLIMITED (seed.sql matches for fresh installs).
-- ---------------------------------------------------------------
update public.cards
   set ownership_type = 'UNLIMITED'
 where ownership_type <> 'UNLIMITED'
   and forge_name in ('Raging Goblin', 'Goblin Piker', 'Vulshok Berserker', 'Hill Giant', 'Fire Elemental',
                      'Grizzly Bears', 'Elvish Warrior', 'Trained Armodon', 'War Mammoth', 'Craw Wurm');

create or replace function public.grant_starter_pack(p_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    -- mana curve 1-2-3-4-5 (red) / 2-2-3-4-6 (green); all vanilla-ish beaters
    v_red   constant text[] := array['Raging Goblin', 'Goblin Piker', 'Vulshok Berserker', 'Hill Giant', 'Fire Elemental'];
    v_green constant text[] := array['Grizzly Bears', 'Elvish Warrior', 'Trained Armodon', 'War Mammoth', 'Craw Wurm'];
    v_names text[] := v_red || v_green;
    v_ids   uuid[];
    v_mountain uuid;
    v_forest   uuid;
    v_deck  uuid := null;
begin
    if p_player is null or not exists (select 1 from public.profiles where id = p_player) then
        return;
    end if;
    if exists (select 1 from public.game_log where kind = 'STARTER' and player_id = p_player) then
        return;
    end if;

    select array_agg(id) into v_ids
      from public.cards
     where forge_name = any (v_names) and ownership_type = 'UNLIMITED';

    select id into v_mountain from public.cards where forge_name = 'Mountain' and ownership_type = 'UNLIMITED' limit 1;
    select id into v_forest   from public.cards where forge_name = 'Forest'   and ownership_type = 'UNLIMITED' limit 1;

    -- only build the deck when the whole roster is in the catalog (it must be legal)
    if coalesce(array_length(v_ids, 1), 0) = array_length(v_names, 1)
       and v_mountain is not null and v_forest is not null then
        v_deck := gen_random_uuid();
        insert into public.decks (id, player_id, name, format_code)
        values (v_deck, p_player, 'Red-Green Starter', 'STANDARD');

        insert into public.deck_cards (id, deck_id, card_id, quantity)
        select gen_random_uuid(), v_deck, c, 4 from unnest(v_ids) as c
        union all
        select gen_random_uuid(), v_deck, v_mountain, 10
        union all
        select gen_random_uuid(), v_deck, v_forest, 10;
    end if;

    -- no marker unless the full pack landed, so a later backfill can finish the job
    if v_deck is null then
        raise warning 'starter pack incomplete for % (catalog not seeded?)', p_player;
        return;
    end if;

    insert into public.game_log (kind, player_id, ref_id, detail)
    values ('STARTER', p_player, v_deck, jsonb_build_object(
        'cards', (select coalesce(jsonb_agg(forge_name order by forge_name), '[]'::jsonb)
                    from public.cards where id = any (coalesce(v_ids, '{}'::uuid[]))),
        'deckId', v_deck));
end;
$$;

revoke execute on function public.grant_starter_pack(uuid) from public, anon, authenticated;
grant execute on function public.grant_starter_pack(uuid) to service_role;

-- ---------------------------------------------------------------
-- Signup hook: profile row + valid cohort from metadata + starter pack.
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_name text := btrim(coalesce(v_meta ->> 'display_name', v_meta ->> 'name', ''));
    v_deg  text := upper(nullif(btrim(v_meta ->> 'degree_level'), ''));
    v_spec text := upper(nullif(btrim(v_meta ->> 'specialization'), ''));
    v_ok   boolean;
begin
    if v_name = '' then
        v_name := split_part(new.email, '@', 1);
    end if;
    v_ok := coalesce(public.is_cohort_valid(v_deg, v_spec), false);

    insert into public.profiles (id, display_name, email, degree_level, specialization)
    values (
        new.id,
        left(coalesce(nullif(v_name, ''), 'player'), 40),
        new.email,
        case when v_ok then v_deg end,
        case when v_ok then v_spec end
    )
    on conflict (id) do nothing;

    begin
        perform public.grant_starter_pack(new.id);
    exception when others then
        raise warning 'grant_starter_pack failed for %: %', new.id, sqlerrm;
    end;

    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Backfill: every existing player gets the pack once.
-- ---------------------------------------------------------------
select public.grant_starter_pack(p.id) from public.profiles p;
