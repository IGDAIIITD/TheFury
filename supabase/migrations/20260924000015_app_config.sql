-- Campus Forge → Supabase
-- Migration 15: public runtime configuration (app_config).
--
-- Key/value settings the PWA reads at startup, so they can change without
-- rebuilding the GitHub Pages bundle. First use: `battle_engine_url`, the
-- current public URL of the battle engine. A Cloudflare quick tunnel gets a
-- new *.trycloudflare.com URL on every start; battle-engine/start-public.ps1
-- writes it here (service role) and clears it on shutdown, and clients pick
-- it up on load and live via Realtime.
--
-- Everything in this table is PUBLIC (readable without signing in). Never
-- store secrets here. Only the service role / admins write.
--
-- Idempotent.

create table if not exists public.app_config (
    key        text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
    value      text,
    updated_at timestamptz not null default now()
);

alter table public.app_config enable row level security;

drop policy if exists app_config_select_all on public.app_config;
create policy app_config_select_all on public.app_config for select
to anon, authenticated
using (true);

drop policy if exists app_config_admin_all on public.app_config;
create policy app_config_admin_all on public.app_config for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke insert, update, delete, truncate on public.app_config from anon;

create or replace function public.touch_app_config()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

revoke execute on function public.touch_app_config() from public, anon, authenticated;

drop trigger if exists trg_app_config_touch on public.app_config;
create trigger trg_app_config_touch
before insert or update on public.app_config
for each row execute function public.touch_app_config();

insert into public.app_config (key, value) values ('battle_engine_url', null)
on conflict (key) do nothing;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_config'
    ) then
        alter publication supabase_realtime add table public.app_config;
    end if;
end;
$$;
