-- Campus Forge → Supabase
-- Migration 5/9: trades + trade_cards (V11) and the trade-partner RLS
-- visibility policy on unique_cards.

create table public.trades (
    id          uuid primary key,
    sender_id   uuid not null references public.profiles (id) on delete cascade,
    receiver_id uuid not null references public.profiles (id) on delete cascade,
    status      text not null default 'PENDING' check (status in ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED')),
    created_at  timestamptz not null default now(),
    resolved_at timestamptz,
    expires_at  timestamptz not null default now() + interval '24 hours',
    constraint chk_trades_parties check (sender_id <> receiver_id)
);

create table public.trade_cards (
    id            uuid primary key,
    trade_id      uuid not null references public.trades (id) on delete cascade,
    side          text not null check (side in ('OFFERED','REQUESTED')),
    physical_uuid uuid not null references public.unique_cards (physical_uuid) on delete cascade,
    constraint uk_trade_cards_trade_side_card unique (trade_id, side, physical_uuid)
);

create index idx_trades_sender_status on public.trades (sender_id, status);
create index idx_trades_receiver_status on public.trades (receiver_id, status);
create index idx_trade_cards_trade on public.trade_cards (trade_id);
create index idx_trade_cards_physical_uuid on public.trade_cards (physical_uuid);

alter table public.trades enable row level security;
alter table public.trade_cards enable row level security;

create policy trades_select_party on public.trades for select
using (sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin());

create policy trades_insert_sender on public.trades for insert
with check (sender_id = auth.uid());

-- accept/decline/cancel happen through the accept_trade definer function;
-- the receiver may mark DECLINED and the sender CANCELLED directly, matching
-- current role rules, but ownership swaps only go through the function.
create policy trades_update_party on public.trades for update
using ((sender_id = auth.uid() or receiver_id = auth.uid()) or public.is_admin());

create policy trade_cards_select_party on public.trade_cards for select
using (
    trade_id in (select id from public.trades where sender_id = auth.uid() or receiver_id = auth.uid())
    or public.is_admin()
);

create policy trade_cards_insert_party on public.trade_cards for insert
with check (
    trade_id in (select id from public.trades where sender_id = auth.uid())
);

create policy trade_cards_delete_party on public.trade_cards for delete
using (
    trade_id in (select id from public.trades where sender_id = auth.uid() and status = 'PENDING')
);

-- trade-partner visibility: a PENDING trade makes the listed unique cards
-- visible to both parties (TradePage reads partner's uniques this way).
create policy unique_cards_select_trade_party on public.unique_cards for select
using (
    exists (
        select 1 from public.trade_cards tc
        join public.trades t on t.id = tc.trade_id
        where tc.physical_uuid = unique_cards.physical_uuid
          and t.status = 'PENDING'
          and (t.sender_id = auth.uid() or t.receiver_id = auth.uid())
    )
);