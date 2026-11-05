-- School Register database
-- Paste this whole file into Supabase > SQL Editor > New query, then press "Run".
-- Safe to run again: it only creates what is missing.

-- ============ TABLES ============

create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  subject     text not null default '' check (char_length(subject) <= 60),
  term        text not null default '' check (char_length(term) <= 40),
  teacher_name text not null default '' check (char_length(teacher_name) <= 60),
  created_at  timestamptz not null default now()
);

-- Login code: 10 random characters, shown as XXXXX-XXXXX. Avoids 0/O and 1/I.
create or replace function public.new_login_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
  out text := '';
  i int;
begin
  for i in 0..9 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return substr(out, 1, 5) || '-' || substr(out, 6, 5);
end $$;

create table if not exists public.students (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references public.classes(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  roll         text not null default '' check (char_length(roll) <= 10),
  student_code text not null unique default public.new_login_code(),
  parent_code  text not null unique default public.new_login_code(),
  created_at   timestamptz not null default now()
);
create index if not exists students_class_idx on public.students(class_id);

create table if not exists public.attendance (
  student_id uuid not null references public.students(id) on delete cascade,
  class_id   uuid not null references public.classes(id) on delete cascade,
  day        date not null,
  mark       char(1) not null check (mark in ('P','L','A')),
  primary key (student_id, day)
);
create index if not exists attendance_class_idx on public.attendance(class_id, day);

create table if not exists public.assessments (
  id        uuid primary key default gen_random_uuid(),
  class_id  uuid not null references public.classes(id) on delete cascade,
  title     text not null check (char_length(title) between 1 and 60),
  max_marks numeric not null check (max_marks > 0 and max_marks <= 1000),
  day       date not null default current_date
);
create index if not exists assessments_class_idx on public.assessments(class_id);

create table if not exists public.scores (
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  student_id    uuid not null references public.students(id) on delete cascade,
  class_id      uuid not null references public.classes(id) on delete cascade,
  score         numeric not null check (score >= 0),
  primary key (assessment_id, student_id)
);
create index if not exists scores_class_idx on public.scores(class_id);

-- ============ SECURITY ============
-- Each teacher can only see and change their own classes.
-- Students and parents never read tables directly: they use get_report() with their code.

alter table public.classes     enable row level security;
alter table public.students    enable row level security;
alter table public.attendance  enable row level security;
alter table public.assessments enable row level security;
alter table public.scores      enable row level security;

create or replace function public.owns_class(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = cid and c.teacher_id = auth.uid());
$$;

drop policy if exists "own classes" on public.classes;
create policy "own classes" on public.classes for all to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

drop policy if exists "own students" on public.students;
create policy "own students" on public.students for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));

drop policy if exists "own attendance" on public.attendance;
create policy "own attendance" on public.attendance for all to authenticated
  using (public.owns_class(class_id))
  with check (public.owns_class(class_id)
              and exists (select 1 from public.students s where s.id = student_id and s.class_id = attendance.class_id));

drop policy if exists "own assessments" on public.assessments;
create policy "own assessments" on public.assessments for all to authenticated
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));

drop policy if exists "own scores" on public.scores;
create policy "own scores" on public.scores for all to authenticated
  using (public.owns_class(class_id))
  with check (public.owns_class(class_id)
              and exists (select 1 from public.students s where s.id = student_id and s.class_id = scores.class_id)
              and exists (select 1 from public.assessments a where a.id = assessment_id and a.class_id = scores.class_id));

-- Nobody signed out can touch the tables.
revoke all on public.classes, public.students, public.attendance, public.assessments, public.scores from anon;

-- ============ STUDENT / PARENT REPORT ============
-- Returns one student's record for a valid student or parent code, or null.

create or replace function public.get_report(code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  st public.students;
  who text;
  result json;
begin
  if char_length(c) <> 10 then return null; end if;
  c := substr(c, 1, 5) || '-' || substr(c, 6, 5);

  select * into st from public.students where student_code = c;
  if found then who := 'student';
  else
    select * into st from public.students where parent_code = c;
    if found then who := 'parent'; else return null; end if;
  end if;

  select json_build_object(
    'role', who,
    'name', st.name,
    'roll', st.roll,
    'class', (select json_build_object('name', k.name, 'subject', k.subject, 'term', k.term, 'teacher', k.teacher_name)
              from public.classes k where k.id = st.class_id),
    'attendance', coalesce((select json_agg(json_build_object('d', a.day, 'm', a.mark) order by a.day)
                            from public.attendance a where a.student_id = st.id), '[]'::json),
    'grades', coalesce((select json_agg(json_build_object('t', s.title, 'd', s.day, 'm', s.max_marks, 's', sc.score) order by s.day, s.title)
                        from public.assessments s join public.scores sc on sc.assessment_id = s.id and sc.student_id = st.id), '[]'::json)
  ) into result;
  return result;
end $$;

revoke all on function public.get_report(text) from public;
grant execute on function public.get_report(text) to anon, authenticated;

-- Teachers can give a student or parent a fresh code (old one stops working).
create or replace function public.reset_code(sid uuid, which text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare newc text := public.new_login_code();
begin
  if not exists (select 1 from public.students s where s.id = sid and public.owns_class(s.class_id)) then
    raise exception 'not allowed';
  end if;
  if which = 'parent' then update public.students set parent_code = newc where id = sid;
  else update public.students set student_code = newc where id = sid; end if;
  return newc;
end $$;
revoke all on function public.reset_code(uuid, text) from public, anon;
grant execute on function public.reset_code(uuid, text) to authenticated;
revoke all on function public.new_login_code() from public, anon;
revoke all on function public.owns_class(uuid) from public, anon;
grant execute on function public.owns_class(uuid) to authenticated;
grant execute on function public.new_login_code() to authenticated;

-- ============ PERMISSIONS ============
-- Newer Supabase projects don't grant these automatically. Row-level security above still applies.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.classes, public.students, public.attendance, public.assessments, public.scores to authenticated;

-- Tell the Data API to pick up the new tables right away.
notify pgrst, 'reload schema';

-- =====================================================================
-- ============ INSTITUTES (principal, departments, invites) ===========
-- =====================================================================
-- The principal creates an institute and invites teachers / department heads
-- with one-time codes. Each class stays private to its teacher.
-- The principal can VIEW everything in the institute (read-only), through the
-- functions below. Nobody else can see other teachers' classes.

create table if not exists public.institutes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 100),
  kind       text not null default 'School' check (kind in ('School','College','University','Academy','Organization')),
  city       text not null default '' check (char_length(city) <= 60),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  created_at   timestamptz not null default now()
);

create table if not exists public.members (
  institute_id  uuid not null references public.institutes(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('principal','head','teacher')),
  department_id uuid references public.departments(id) on delete set null,
  name          text not null default '' check (char_length(name) <= 80),
  joined_at     timestamptz not null default now(),
  primary key (institute_id, user_id)
);
create unique index if not exists members_one_institute on public.members(user_id);

create table if not exists public.invites (
  code          text primary key default public.new_login_code(),
  institute_id  uuid not null references public.institutes(id) on delete cascade,
  role          text not null check (role in ('head','teacher')),
  department_id uuid references public.departments(id) on delete set null,
  name          text not null check (char_length(name) between 1 and 80),
  created_at    timestamptz not null default now(),
  used_by       uuid references auth.users(id) on delete set null,
  used_at       timestamptz
);

alter table public.classes add column if not exists institute_id uuid references public.institutes(id) on delete set null;
alter table public.classes add column if not exists department_id uuid references public.departments(id) on delete set null;
alter table public.assessments add column if not exists kind text not null default 'Test';
do $$ begin
  alter table public.assessments add constraint assessments_kind_check check (kind in ('Test','Quiz','Assignment','Exam'));
exception when duplicate_object then null; end $$;

-- ---------- helpers ----------
create or replace function public.my_institute_id() returns uuid
language sql stable security definer set search_path = public as $$
  select institute_id from public.members where user_id = auth.uid();
$$;
create or replace function public.is_principal(iid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members m where m.institute_id = iid and m.user_id = auth.uid() and m.role = 'principal');
$$;
create or replace function public.need_principal() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare iid uuid := public.my_institute_id();
begin
  if iid is null or not public.is_principal(iid) then raise exception 'Only the principal can do this.'; end if;
  return iid;
end $$;

-- ---------- row security ----------
alter table public.institutes  enable row level security;
alter table public.departments enable row level security;
alter table public.members     enable row level security;
alter table public.invites     enable row level security;

drop policy if exists "see my institute" on public.institutes;
create policy "see my institute" on public.institutes for select to authenticated using (id = public.my_institute_id());
drop policy if exists "see my departments" on public.departments;
create policy "see my departments" on public.departments for select to authenticated using (institute_id = public.my_institute_id());
drop policy if exists "see me or all if principal" on public.members;
create policy "see me or all if principal" on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_principal(institute_id));
drop policy if exists "principal sees invites" on public.invites;
create policy "principal sees invites" on public.invites for select to authenticated using (public.is_principal(institute_id));

-- A teacher's class can only be put in their own institute and one of its departments.
drop policy if exists "own classes" on public.classes;
create policy "own classes" on public.classes for all to authenticated
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid()
    and (institute_id is null or institute_id = public.my_institute_id())
    and (department_id is null or exists (select 1 from public.departments d where d.id = department_id and d.institute_id = classes.institute_id)));

revoke all on public.institutes, public.departments, public.members, public.invites from anon;
grant select on public.institutes, public.departments, public.members, public.invites to authenticated;

-- ---------- one student's record (used by get_report and the principal) ----------
create or replace function public.student_record(sid uuid, who text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'role', who, 'id', st.id, 'name', st.name, 'roll', st.roll,
    'class', (select json_build_object('name', k.name, 'subject', k.subject, 'term', k.term, 'teacher', k.teacher_name,
                     'institute', (select i.name from public.institutes i where i.id = k.institute_id),
                     'department', (select d.name from public.departments d where d.id = k.department_id))
              from public.classes k where k.id = st.class_id),
    'attendance', coalesce((select json_agg(json_build_object('d', a.day, 'm', a.mark) order by a.day)
                            from public.attendance a where a.student_id = st.id), '[]'::json),
    'grades', coalesce((select json_agg(json_build_object('t', s.title, 'k', s.kind, 'd', s.day, 'm', s.max_marks, 's', sc.score) order by s.day, s.title)
                        from public.assessments s join public.scores sc on sc.assessment_id = s.id and sc.student_id = st.id), '[]'::json))
  from public.students st where st.id = sid;
$$;

create or replace function public.get_report(code text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  sid uuid; who text;
begin
  if char_length(c) <> 10 then return null; end if;
  c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
  select id into sid from public.students where student_code = c;
  if found then who := 'student';
  else
    select id into sid from public.students where parent_code = c;
    if found then who := 'parent'; else return null; end if;
  end if;
  return public.student_record(sid, who);
end $$;

-- ---------- principal: set up ----------
create or replace function public.create_institute(p_name text, p_kind text, p_city text, p_my_name text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid;
begin
  if auth.uid() is null then raise exception 'Please log in again.'; end if;
  if public.my_institute_id() is not null then raise exception 'You are already in an institute.'; end if;
  insert into public.institutes(name, kind, city, created_by) values (trim(p_name), coalesce(nullif(p_kind,''),'School'), trim(coalesce(p_city,'')), auth.uid()) returning id into iid;
  insert into public.members(institute_id, user_id, role, name) values (iid, auth.uid(), 'principal', trim(coalesce(p_my_name,'')));
  update public.classes set institute_id = iid where teacher_id = auth.uid() and institute_id is null;
  return json_build_object('id', iid);
end $$;

create or replace function public.update_institute(p_name text, p_kind text, p_city text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  update public.institutes set name = trim(p_name), kind = p_kind, city = trim(coalesce(p_city,'')) where id = iid;
end $$;

create or replace function public.add_department(p_name text) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal(); did uuid;
begin
  insert into public.departments(institute_id, name) values (iid, trim(p_name)) returning id into did;
  return did;
end $$;

create or replace function public.rename_department(p_id uuid, p_name text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  update public.departments set name = trim(p_name) where id = p_id and institute_id = iid;
end $$;

create or replace function public.delete_department(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  delete from public.departments where id = p_id and institute_id = iid;
end $$;

create or replace function public.create_invite(p_name text, p_role text, p_department uuid) returns text
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal(); c text;
begin
  if p_role not in ('head','teacher') then raise exception 'Role must be teacher or head.'; end if;
  if p_department is not null and not exists (select 1 from public.departments d where d.id = p_department and d.institute_id = iid) then
    raise exception 'That department is not in your institute.';
  end if;
  insert into public.invites(institute_id, role, department_id, name) values (iid, p_role, p_department, trim(p_name)) returning code into c;
  return c;
end $$;

create or replace function public.delete_invite(p_code text) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  delete from public.invites where code = p_code and institute_id = iid and used_by is null;
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  if p_user = auth.uid() then raise exception 'You cannot remove yourself.'; end if;
  delete from public.members where institute_id = iid and user_id = p_user;
  update public.classes set institute_id = null, department_id = null where institute_id = iid and teacher_id = p_user;
end $$;

create or replace function public.set_member(p_user uuid, p_role text, p_department uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  if p_role not in ('head','teacher') then raise exception 'Role must be teacher or head.'; end if;
  if p_department is not null and not exists (select 1 from public.departments d where d.id = p_department and d.institute_id = iid) then
    raise exception 'That department is not in your institute.';
  end if;
  update public.members set role = p_role, department_id = p_department where institute_id = iid and user_id = p_user and role <> 'principal';
end $$;

-- ---------- teachers: join with an invite code ----------
create or replace function public.join_institute(p_code text, p_my_name text) returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  inv public.invites;
begin
  if auth.uid() is null then raise exception 'Please log in again.'; end if;
  if public.my_institute_id() is not null then raise exception 'You are already in an institute.'; end if;
  if char_length(c) <> 10 then raise exception 'Invite codes have 10 letters and numbers.'; end if;
  c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
  select * into inv from public.invites where code = c and used_by is null for update;
  if not found then raise exception 'That invite code is wrong or was already used.'; end if;
  insert into public.members(institute_id, user_id, role, department_id, name)
    values (inv.institute_id, auth.uid(), inv.role, inv.department_id, coalesce(nullif(trim(p_my_name), ''), inv.name));
  update public.invites set used_by = auth.uid(), used_at = now() where code = c;
  update public.classes set institute_id = inv.institute_id, department_id = coalesce(department_id, inv.department_id)
    where teacher_id = auth.uid() and institute_id is null;
  return json_build_object('institute', (select name from public.institutes where id = inv.institute_id));
end $$;

-- ---------- principal: view everything (read-only) ----------
create or replace function public.institute_overview() returns json
language plpgsql stable security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  return json_build_object(
    'institute', (select row_to_json(i) from public.institutes i where i.id = iid),
    'departments', coalesce((select json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d where d.institute_id = iid), '[]'::json),
    'members', coalesce((select json_agg(json_build_object('user_id', m.user_id, 'name', m.name, 'role', m.role, 'department_id', m.department_id, 'joined_at', m.joined_at) order by m.role, m.name) from public.members m where m.institute_id = iid), '[]'::json),
    'invites', coalesce((select json_agg(json_build_object('code', v.code, 'name', v.name, 'role', v.role, 'department_id', v.department_id, 'created_at', v.created_at) order by v.created_at desc) from public.invites v where v.institute_id = iid and v.used_by is null), '[]'::json),
    'classes', coalesce((select json_agg(json_build_object(
        'id', k.id, 'name', k.name, 'subject', k.subject, 'term', k.term, 'teacher_id', k.teacher_id, 'teacher_name', k.teacher_name, 'department_id', k.department_id,
        'students', coalesce((select json_agg(json_build_object(
            'id', s.id, 'name', s.name, 'roll', s.roll,
            'P', (select count(*) from public.attendance a where a.student_id = s.id and a.mark = 'P'),
            'L', (select count(*) from public.attendance a where a.student_id = s.id and a.mark = 'L'),
            'A', (select count(*) from public.attendance a where a.student_id = s.id and a.mark = 'A'),
            'avg', (select avg(sc.score / nullif(x.max_marks, 0)) * 100 from public.scores sc join public.assessments x on x.id = sc.assessment_id where sc.student_id = s.id),
            'n', (select count(*) from public.scores sc where sc.student_id = s.id)
          ) order by nullif(regexp_replace(s.roll, '\D', '', 'g'), '')::numeric nulls last, s.name) from public.students s where s.class_id = k.id), '[]'::json),
        'assessments', coalesce((select json_agg(json_build_object(
            'id', x.id, 'title', x.title, 'kind', x.kind, 'day', x.day, 'max', x.max_marks,
            'avg', (select avg(sc.score) from public.scores sc where sc.assessment_id = x.id),
            'n', (select count(*) from public.scores sc where sc.assessment_id = x.id)
          ) order by x.day desc) from public.assessments x where x.class_id = k.id), '[]'::json)
      ) order by k.name) from public.classes k where k.institute_id = iid), '[]'::json)
  );
end $$;

-- Who was present / late / absent on one date, across the whole institute.
create or replace function public.institute_day(p_day date) returns json
language plpgsql stable security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  return coalesce((select json_object_agg(a.student_id, a.mark)
    from public.attendance a join public.classes k on k.id = a.class_id
    where k.institute_id = iid and a.day = p_day), '{}'::json);
end $$;

-- One student's full record: every date present/late/absent, and every result.
create or replace function public.institute_student(p_sid uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare iid uuid := public.need_principal();
begin
  if not exists (select 1 from public.students s join public.classes k on k.id = s.class_id where s.id = p_sid and k.institute_id = iid) then
    return null;
  end if;
  return public.student_record(p_sid, 'principal');
end $$;

-- Teachers and heads: what institute am I in?
create or replace function public.my_membership() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('role', m.role, 'department_id', m.department_id, 'name', m.name,
    'institute', (select json_build_object('id', i.id, 'name', i.name, 'kind', i.kind, 'city', i.city) from public.institutes i where i.id = m.institute_id),
    'departments', coalesce((select json_agg(json_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d where d.institute_id = m.institute_id), '[]'::json))
  from public.members m where m.user_id = auth.uid();
$$;

-- ---------- function permissions ----------
do $$ declare f text; begin
  foreach f in array array[
    'public.my_institute_id()', 'public.is_principal(uuid)', 'public.need_principal()',
    'public.create_institute(text,text,text,text)', 'public.update_institute(text,text,text)',
    'public.add_department(text)', 'public.rename_department(uuid,text)', 'public.delete_department(uuid)',
    'public.create_invite(text,text,uuid)', 'public.delete_invite(text)', 'public.remove_member(uuid)',
    'public.set_member(uuid,text,uuid)', 'public.join_institute(text,text)', 'public.institute_overview()',
    'public.institute_day(date)', 'public.institute_student(uuid)', 'public.my_membership()'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
end $$;
revoke all on function public.student_record(uuid, text) from public, anon, authenticated;
revoke all on function public.get_report(text) from public;
grant execute on function public.get_report(text) to anon, authenticated;

notify pgrst, 'reload schema';
-- ============ PARENT MESSAGES & MONTHLY REPORTS ============
-- Parent's phone number (only the class teacher can see it).
alter table public.students add column if not exists parent_phone text not null default '';
do $$ begin
  alter table public.students add constraint students_parent_phone_check check (char_length(parent_phone) <= 20);
exception when duplicate_object then null; end $$;

-- When the teacher sent the "absent today" message to the parent.
alter table public.attendance add column if not exists notified_at timestamptz;

-- Principal: one class's attendance for one month (view only).
create or replace function public.institute_class_month(p_class uuid, p_month date) returns json
language plpgsql stable security definer set search_path = public as $$
declare iid uuid := public.need_principal();
  m0 date := date_trunc('month', p_month)::date;
begin
  if not exists (select 1 from public.classes k where k.id = p_class and k.institute_id = iid) then return null; end if;
  return json_build_object(
    'class', (select json_build_object('id', k.id, 'name', k.name, 'subject', k.subject, 'teacher_name', k.teacher_name) from public.classes k where k.id = p_class),
    'students', coalesce((select json_agg(json_build_object('id', s.id, 'name', s.name, 'roll', s.roll)) from public.students s where s.class_id = p_class), '[]'::json),
    'attendance', coalesce((select json_agg(json_build_object('s', a.student_id, 'd', a.day, 'm', a.mark))
                            from public.attendance a where a.class_id = p_class and a.day >= m0 and a.day < (m0 + interval '1 month')::date), '[]'::json));
end $$;
revoke all on function public.institute_class_month(uuid, date) from public, anon;
grant execute on function public.institute_class_month(uuid, date) to authenticated;

notify pgrst, 'reload schema';
