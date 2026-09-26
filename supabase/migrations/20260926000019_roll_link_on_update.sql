-- ============================================================================
-- 19: link roll accounts when app_metadata arrives after the insert
--
-- GoTrue's admin createUser inserts auth.users first and writes app_metadata
-- in a follow-up UPDATE (same transaction), so handle_new_user (AFTER INSERT)
-- never saw app_metadata.roll_no on the hosted project. The roster lookup now
-- lives in link_student_roll(), called from the insert hook and from a new
-- AFTER UPDATE trigger. Only unlinked profiles are touched; a roll another
-- account already holds raises (unique), which rolls back the createUser.
-- app_metadata is writable only through the admin API (service role).
-- Idempotent.
-- ============================================================================

create or replace function public.link_student_roll(p_user uuid, p_roll text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_student public.students%rowtype;
begin
    select * into v_student from public.students where roll_no = btrim(coalesce(p_roll, ''));
    if not found then
        return false;
    end if;
    update public.profiles
       set display_name   = left(v_student.name, 40),
           degree_level   = v_student.degree_level,
           specialization = v_student.program,
           student_id     = v_student.roll_no,
           roll_no        = v_student.roll_no
     where id = p_user
       and roll_no is null;
    return found;
end;
$$;

revoke execute on function public.link_student_roll(uuid, text) from public, anon, authenticated;
grant execute on function public.link_student_roll(uuid, text) to service_role;

-- Insert hook: profile + starter pack as before; roster data via link_student_roll.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
    v_roll text  := nullif(btrim(coalesce(new.raw_app_meta_data, '{}'::jsonb) ->> 'roll_no'), '');
    v_name text  := btrim(coalesce(v_meta ->> 'display_name', v_meta ->> 'name', ''));
    v_deg  text  := upper(nullif(btrim(v_meta ->> 'degree_level'), ''));
    v_spec text  := upper(nullif(btrim(v_meta ->> 'specialization'), ''));
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

    if v_roll is not null then
        perform public.link_student_roll(new.id, v_roll);
    end if;

    begin
        perform public.grant_starter_pack(new.id);
    exception when others then
        raise warning 'grant_starter_pack failed for %: %', new.id, sqlerrm;
    end;

    return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Update hook: app_metadata.roll_no appeared (admin API createUser / updateUser).
create or replace function public.handle_user_roll_linked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_roll text := nullif(btrim(coalesce(new.raw_app_meta_data, '{}'::jsonb) ->> 'roll_no'), '');
begin
    if v_roll is not null
       and v_roll is distinct from nullif(btrim(coalesce(old.raw_app_meta_data, '{}'::jsonb) ->> 'roll_no'), '') then
        perform public.link_student_roll(new.id, v_roll);
    end if;
    return new;
end;
$$;

revoke execute on function public.handle_user_roll_linked() from public, anon, authenticated;

drop trigger if exists on_auth_user_roll_linked on auth.users;
create trigger on_auth_user_roll_linked
after update of raw_app_meta_data on auth.users
for each row execute function public.handle_user_roll_linked();
