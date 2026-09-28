-- ============================================================================
-- 21: text game logs for finished battles
--
-- When a match ends (win, concede or disconnect timeout) the battle engine
-- saves Forge's own game log as plain text, oldest line first, e.g.
--   [Turn] Turn 3 (Aadi)
--   [Combat] Aadi assigned Grizzly Bears to attack Rehan.
--   [Life] Rehan lost 2 life.
-- Mana taps and phase steps are left out. No replay data, just a record for
-- disputes and curiosity. The two players and admins can read it; only the
-- engine (service role) writes it. Idempotent.
-- ============================================================================

create table if not exists public.match_logs (
    match_id   uuid primary key references public.matches (id) on delete cascade,
    log        text not null,
    line_count integer not null default 0,
    created_at timestamptz not null default now()
);

alter table public.match_logs enable row level security;
revoke all on table public.match_logs from public, anon, authenticated;
grant select on table public.match_logs to authenticated;
grant all on table public.match_logs to service_role;

drop policy if exists match_logs_select_players on public.match_logs;
create policy match_logs_select_players on public.match_logs
    for select to authenticated
    using (
        public.is_admin()
        or exists (
            select 1 from public.matches m
             where m.id = match_logs.match_id
               and auth.uid() in (m.player1_id, m.player2_id)
        )
    );
