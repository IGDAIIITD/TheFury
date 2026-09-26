-- ============================================================================
-- 18: student roster + roll-number accounts
--
-- Players sign in with their IIITD roll number instead of an email:
--   1. `students` holds the official roster (roll, name, program, batch), loaded
--      by scripts/import-students.mjs. It is personal data: service role and
--      admins only, never exposed to players.
--   2. The `student-auth` Edge Function checks roll + first name against it
--      (student_roll_status) and creates the auth user through the admin API
--      with app_metadata.roll_no. Only the admin API can set app_metadata, so a
--      public sign-up can never claim a roll number.
--   3. handle_new_user fills the profile from the roster: display name, cohort,
--      student id, roll_no. Players can't change roll_no, and roll accounts
--      can't change their student id or cohort either (trg_profiles_guard).
-- Email accounts (staff, older test accounts) keep working as before.
-- Idempotent.
-- ============================================================================

create table if not exists public.students (
    roll_no       text primary key check (roll_no ~ '^[0-9]{7}$'),
    name          text not null check (length(btrim(name)) between 1 and 80),
    program       text not null,
    batch         int  not null check (batch between 2000 and 2100),
    degree_level  text not null default 'BTECH',
    constraint students_cohort_valid check (public.is_cohort_valid(degree_level, program))
);

alter table public.students enable row level security;
revoke all on table public.students from public, anon, authenticated;
grant all on table public.students to service_role;

drop policy if exists students_admin_read on public.students;
create policy students_admin_read on public.students
    for select to authenticated using (public.is_admin());
grant select on table public.students to authenticated;   -- rows still gated by the admin-only policy

alter table public.profiles add column if not exists roll_no text;
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_roll_no_key') then
        alter table public.profiles add constraint profiles_roll_no_key unique (roll_no);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'profiles_roll_no_fkey') then
        alter table public.profiles add constraint profiles_roll_no_fkey
            foreign key (roll_no) references public.students (roll_no) on update cascade;
    end if;
end;
$$;

-- ---------------------------------------------------------------
-- Name check: the typed first name must equal one word of the roster name
-- (letters only, case-insensitive), so "Mohd Rehan" accepts "mohd" or "Rehan".
-- ---------------------------------------------------------------
create or replace function public.student_name_matches(p_name text, p_typed text)
returns boolean
language sql
immutable
as $$
    with typed as (
        select lower(regexp_replace(split_part(btrim(coalesce(p_typed, '')), ' ', 1), '[^A-Za-z]', '', 'g')) as t
    )
    select length(typed.t) >= 2 and exists (
        select 1
        from regexp_split_to_table(coalesce(p_name, ''), '\s+') as w
        where lower(regexp_replace(w, '[^A-Za-z]', '', 'g')) = typed.t
    )
    from typed;
$$;

revoke execute on function public.student_name_matches(text, text) from public, anon, authenticated;
grant execute on function public.student_name_matches(text, text) to service_role;

-- ---------------------------------------------------------------
-- student_roll_status: what the login screen needs to know about a roll.
-- NOT_FOUND / NAME_MISMATCH reveal nothing else; the name and cohort are only
-- returned once the first name matched. Service role only (student-auth EF).
-- ---------------------------------------------------------------
create or replace function public.student_roll_status(p_roll text, p_first_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_student public.students%rowtype;
begin
    select * into v_student from public.students where roll_no = btrim(coalesce(p_roll, ''));
    if not found then
        return jsonb_build_object('status', 'NOT_FOUND');
    end if;
    if not public.student_name_matches(v_student.name, p_first_name) then
        return jsonb_build_object('status', 'NAME_MISMATCH');
    end if;
    return jsonb_build_object(
        'status', case when exists (select 1 from public.profiles where roll_no = v_student.roll_no)
                       then 'REGISTERED' else 'NEW' end,
        'rollNo', v_student.roll_no,
        'name', v_student.name,
        'program', v_student.program,
        'degreeLevel', v_student.degree_level,
        'batch', v_student.batch
    );
end;
$$;

revoke execute on function public.student_roll_status(text, text) from public, anon, authenticated;
grant execute on function public.student_roll_status(text, text) to service_role;

-- ---------------------------------------------------------------
-- Signup hook: roll accounts get their profile from the roster.
-- The roll comes from app_metadata (admin API only), never user metadata.
-- ---------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_roll    text  := nullif(btrim(coalesce(new.raw_app_meta_data, '{}'::jsonb) ->> 'roll_no'), '');
    v_name    text  := btrim(coalesce(v_meta ->> 'display_name', v_meta ->> 'name', ''));
    v_deg     text  := upper(nullif(btrim(v_meta ->> 'degree_level'), ''));
    v_spec    text  := upper(nullif(btrim(v_meta ->> 'specialization'), ''));
    v_student public.students%rowtype;
    v_ok      boolean;
begin
    if v_roll is not null then
        select * into v_student from public.students where roll_no = v_roll;
        if found then
            v_name := v_student.name;
            v_deg  := v_student.degree_level;
            v_spec := v_student.program;
        else
            v_roll := null;
        end if;
    end if;
    if v_name = '' then
        v_name := split_part(new.email, '@', 1);
    end if;
    v_ok := coalesce(public.is_cohort_valid(v_deg, v_spec), false);

    insert into public.profiles (id, display_name, email, degree_level, specialization, student_id, roll_no)
    values (
        new.id,
        left(coalesce(nullif(v_name, ''), 'player'), 40),
        new.email,
        case when v_ok then v_deg end,
        case when v_ok then v_spec end,
        v_roll,
        v_roll
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
-- Profile guard: roll_no is never player-editable; roll accounts also keep
-- the student id and cohort the roster gave them.
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
           or new.created is distinct from old.created
           or new.roll_no is distinct from old.roll_no then
            raise exception 'Players may only edit display name, avatar, student id, cohort and onboarding fields'
                using errcode = '42501';
        end if;
        if old.roll_no is not null
           and (new.student_id is distinct from old.student_id
                or new.degree_level is distinct from old.degree_level
                or new.specialization is distinct from old.specialization) then
            raise exception 'Roll number accounts take their student id and cohort from the roster'
                using errcode = '42501';
        end if;
    end if;
    -- level is always derived (trg_profiles_sync_level only fires on experience changes)
    new.level := public.compute_level(new.experience);
    return new;
end;
$$;

revoke execute on function public.guard_profile_update() from public, anon, authenticated;
