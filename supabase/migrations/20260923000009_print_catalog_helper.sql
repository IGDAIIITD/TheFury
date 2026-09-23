-- Campus Forge → Supabase
-- Migration 9/9: qr print-catalog helper used by the qr-catalog Edge Function.
-- Mirrors ClaimService.generatePrintCatalog: a deterministic token core per
-- card (card_print_core, migration 06) with an idempotent claim insert.
-- The signed full token (V1.<CORE>.<SIG>) is computed in the Edge Function,
-- which owns the HMAC secret; the postgres helper just guarantees a row exists.

create or replace function public.ensure_print_claim(
    p_card_id uuid,
    p_core    text,
    p_token   text
)
returns public.claims
language plpgsql
set search_path = public
as $$
declare
    v_claim public.claims;
    v_cnt   int;
begin
    select 1 into v_cnt from public.claims where token_core = p_core limit 1;
    if not found then
        insert into public.claims (id, token, token_core, card_id, status, created_at)
        values (gen_random_uuid(), p_token, p_core, p_card_id, 'ACTIVE', now())
        on conflict (token_core) do nothing;
    end if;

    select * into v_claim from public.claims where token_core = p_core limit 1;
    return v_claim;
end;
$$;

revoke all on function public.ensure_print_claim(uuid, text, text) from public;
grant execute on function public.ensure_print_claim(uuid, text, text) to service_role;