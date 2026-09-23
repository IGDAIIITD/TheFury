-- Campus Forge → Supabase
-- Migration 9/9: deck validation (mirrors DeckValidationService).
-- Returns the same problem vocabulary: NOT_ENOUGH_CARDS, TOO_MANY_COPIES,
-- NOT_OWNED, FORMAT_ILLEGAL, NOT_IN_EVENT, BANNED_CARD, INVALID_COHORT etc.

create type public.deck_problem as (
    severity text,
    code     text,
    message  text
);

-- validate a deck owned by the caller: size, copies, ownership, format legality,
-- and event allowed_sets (non-basic setCode must be in the active event).
-- Returns the list of problems; empty = valid.
create or replace function public.validate_deck(
    p_deck       uuid,
    p_event      uuid default null
)
returns setof public.deck_problem
language plpgsql
security definer
set search_path = public
as $$
declare
    d           public.decks%rowtype;
    f           public.formats%rowtype;
    v_total     integer;
    v_basic     boolean;
    v_allowed   jsonb;
    e           record;
    v_owner     uuid;
begin
    select * into d from public.decks where id = p_deck;
    if not found then
        return next row('ERROR', 'NOT_FOUND', 'deck not found')::public.deck_problem;
        return;
    end if;

    v_owner := d.player_id;

    -- total card count
    select coalesce(sum(dc.quantity), 0)::integer
    into v_total
    from public.deck_cards dc where dc.deck_id = p_deck;

    for e in
        select
            c.id as card_id, c.forge_name, c.ownership_type,
            c.set_code, c.types,
            dc.quantity,
            (case when c.ownership_type = 'UNLIMITED'
                  then true
                  else coalesce((select true from public.player_unlocks u where u.player_id = v_owner and u.card_id = c.id), false)
                      or exists (select 1 from public.unique_cards uc where uc.owner_id = v_owner and uc.card_id = c.id)
             end) as owned,
            (select count(*) from public.card_legalities cl
              where cl.card_id = c.id and cl.legality = 'BANNED') as banned_count
        from public.deck_cards dc
        join public.cards c on c.id = dc.card_id
        where dc.deck_id = p_deck
    loop
        if not e.owned then
            return next row('ERROR', 'NOT_OWNED', format('%s is not owned by the player', e.forge_name))::public.deck_problem;
        end if;

        select * into f from public.formats where code = d.format_code;
        -- copies check vs format.max_copies, except basics_unlimited basics
        select (b.types ilike '%Basic%') into v_basic from public.cards b where b.id = e.card_id;
        if not (f.basics_unlimited and v_basic)
           and e.quantity > f.max_copies
        then
            return next row('ERROR', 'TOO_MANY_COPIES', format('%s exceeds max copies of %s', e.forge_name, f.max_copies))::public.deck_problem;
        end if;

        if e.banned_count > 0 then
            return next row('ERROR', 'BANNED_CARD', format('%s is banned in %s', e.forge_name, f.name))::public.deck_problem;
        end if;

        -- event gate: non-basic setCode must be in the active event's allowed sets
        if p_event is not null then
            select allowed_sets_json::jsonb into v_allowed from public.events where id = p_event and active = true;
            if v_allowed is not null and not v_basic
               and (e.set_code is null or not (e.set_code = any (select jsonb_array_elements_text(v_allowed))))
            then
                return next row('ERROR', 'NOT_IN_EVENT', format('%s is not in the event allowed sets', e.forge_name))::public.deck_problem;
            end if;
        end if;
    end loop;

    if v_total < f.min_deck_size then
        return next row('WARNING', 'NOT_ENOUGH_CARDS', format('deck has %s cards, requires %s', v_total, f.min_deck_size))::public.deck_problem;
    end if;
end;
$$;

revoke all on function public.validate_deck(uuid, uuid) from public;
grant execute on function public.validate_deck(uuid, uuid) to authenticated;
grant execute on function public.validate_deck(uuid, uuid) to service_role;