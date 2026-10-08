-- ============================================================================
-- 22: postgraduate roster (M.Tech + PhD sign-in)
--
-- M.Tech students sign in with their MT roll number (MT26001) and PhD students
-- with their IIITD address - the institute lists no roll numbers for them - so
-- the roster key is no longer just seven digits. is_cohort_valid() grows the
-- cohorts those rows carry: M.Tech CSE/ECE/CB and PhD CSE/CB/ECE/SSH/
-- MATHEMATICS/HCD (the codes the PhD page groups people by).
--
-- PhD roster ids are real addresses, and search_players returns student_id to
-- every signed-in player, so profiles.student_id stays NULL for them and
-- search_players only matches the synthetic <roll>@students.thefury.app
-- addresses: a real email can neither be read back nor probed through search.
--
-- Roll lookup is case-insensitive: the login screen accepts mt26001 and a
-- lower-cased address; student_roll_status returns the canonical roster value,
-- which is what the client then signs in with. Idempotent.
-- ============================================================================

alter table public.students drop constraint if exists students_roll_no_check;
alter table public.students add constraint students_roll_no_check
    check (
        length(roll_no) between 3 and 254
        and (
            roll_no ~ '^[0-9]{7}$'                     -- B.Tech: 2026001
            or roll_no ~ '^MT[0-9]{5}$'                -- M.Tech: MT26001
            or roll_no ~ '^[^@\s]+@iiitd\.ac\.in$'     -- PhD: institute address
        )
    );

-- Cohorts: single source of truth (Cohort.java). The M.Tech Program column is
-- normalised by scripts/import-postgrad.mjs (Gate/Non-Gate/Research flavours
-- fold into the department), and PhD specialisations come from data-course.
create or replace function public.is_cohort_valid(degree_level text, specialization text)
returns boolean
language sql
immutable
as $$
    select case upper(degree_level)
        when 'BTECH' then upper(specialization) in ('CSE','CSAI','CSAM','CSB','CSSS','CSD','CSECON','ECE','EVE')
        when 'MTECH' then upper(specialization) in ('CSE','ECE','CB')
        when 'PHD'   then upper(specialization) in ('CSE','CB','ECE','SSH','MATHEMATICS','HCD')
        else false
    end;
$$;

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
    select * into v_student
      from public.students
     where lower(roll_no) = lower(btrim(coalesce(p_roll, '')));
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

-- Roster link: same fill as before, except an email-shaped id (PhD) never lands
-- in student_id - that column is readable by other players through
-- search_players, and the roster email is not theirs to publish.
create or replace function public.link_student_roll(p_user uuid, p_roll text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    v_student public.students%rowtype;
begin
    select * into v_student
      from public.students
     where lower(roll_no) = lower(btrim(coalesce(p_roll, '')));
    if not found then
        return false;
    end if;
    update public.profiles
       set display_name   = left(v_student.name, 40),
           degree_level   = v_student.degree_level,
           specialization = v_student.program,
           student_id     = case when v_student.roll_no like '%@%' then null else v_student.roll_no end,
           roll_no        = v_student.roll_no
     where id = p_user
       and roll_no is null;
    return found;
end;
$$;

revoke execute on function public.link_student_roll(uuid, text) from public, anon, authenticated;
grant execute on function public.link_student_roll(uuid, text) to service_role;

-- Search matches a name, or the synthetic roll address (so "2026001" still
-- finds that player). Real addresses are never a search key: matching one
-- would confirm whether an email belongs to a player.
create or replace function public.search_players(p_query text default null)
returns table (
    id             uuid,
    display_name   text,
    avatar         text,
    student_id     text,
    degree_level   text,
    specialization text
)
language sql
security definer
set search_path = public
stable
as $$
    select p.id, p.display_name, p.avatar, p.student_id, p.degree_level, p.specialization
    from public.profiles p
    where p.banned = false
      and ((p_query is null or p_query = '')
           or p.display_name ilike '%' || p_query || '%'
           or (p.email like '%@students.thefury.app'     -- keep in sync with ROLL_EMAIL_DOMAIN
               and p.email ilike '%' || p_query || '%'))
    order by
        case when p_query is not null and p_query <> '' and p.display_name ilike '%' || p_query || '%' then 0 else 1 end,
        p.display_name asc
    limit 20;
$$;

revoke all on function public.search_players(text) from public;
grant execute on function public.search_players(text) to authenticated;
grant execute on function public.search_players(text) to service_role;
