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
