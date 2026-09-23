-- Campus Forge → Supabase
-- Migration 1/9: profiles replaces `players`, keyed 1:1 off auth.users.
-- Mirrors backend/.../V1__create_players.sql + V10__add_player_cohort.sql,
-- plus cohort validation + the level formula as a single Postgres function.

-- Level formula, single source of truth (TECHNICAL.md rule #2).
create or replace function public.compute_level(xp bigint)
returns integer
language sql
immutable
as $$
    select 1 + (xp / 100)::integer;
$$;

-- Cohort validation, single source of truth (Cohort.java).
create or replace function public.is_cohort_valid(degree_level text, specialization text)
returns boolean
language sql
immutable
as $$
    select case upper(degree_level)
        when 'BTECH' then upper(specialization) in ('CSE','CSAI','CSAM','CSB','CSSS','CSD','CSECON','ECE','EVE')
        when 'MTECH' then upper(specialization) in ('CSE','ECE')
        else false
    end;
$$;

-- Department roll-up (Cohort.java): ECE group = ECE, EVE; everything else CSE.
create or replace function public.department_of(specialization text)
returns text
language sql
immutable
as $$
    select case upper(specialization)
        when 'ECE' then 'ECE'
        when 'EVE' then 'ECE'
        else 'CSE'
    end;
$$;

-- profiles: identity + progression, hand-written to auth.users.
create table public.profiles (
    id              uuid primary key references auth.users (id) on delete cascade,
    display_name    text not null,
    email           text not null,
    student_id      text,
    avatar          text,
    role            text not null default 'PLAYER' check (role in ('PLAYER','ADMIN')),
    experience      bigint not null default 0,
    level           integer not null default 1,
    degree_level    text,
    specialization  text,
    banned          boolean not null default false,
    banned_at       timestamp,
    onboarding_seen boolean not null default false,
    created         timestamptz not null default now(),
    last_login      timestamptz,
    constraint chk_profiles_cohort check (
        (degree_level is null and specialization is null)
        or public.is_cohort_valid(degree_level, specialization)
    ),
    constraint fk_profiles_auth foreign key (id) references auth.users (id) on delete cascade
);

create index idx_profiles_cohort on public.profiles (degree_level, specialization);
create index idx_profiles_role on public.profiles (role);
create index idx_profiles_level on public.profiles (level);

-- keep level derived from experience at all times
create or replace function public.sync_profile_level()
returns trigger
language plpgsql
as $$
begin
    new.level := public.compute_level(new.experience);
    return new;
end;
$$;

create trigger trg_profiles_sync_level
before insert or update of experience on public.profiles
for each row execute function public.sync_profile_level();

-- create a profile the moment a user signs up (Phase 2 auth hook).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, email)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'display_name', coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))),
        new.email
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- admin check used by RLS policies; security definer so it does not recurse.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'ADMIN'
    );
$$;

alter table public.profiles enable row level security;

-- users read/update their own row; admins read/update everyone.
create policy profiles_select_own
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy profiles_update_own
on public.profiles for update
using (id = auth.uid() or public.is_admin());

-- insert/delete are driven by the auth trigger (definer) and admins only.
create policy profiles_insert_admin
on public.profiles for insert
with check (public.is_admin());

create policy profiles_delete_admin
on public.profiles for delete
using (public.is_admin());