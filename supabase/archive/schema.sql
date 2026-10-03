-- Rehearse Supabase schema — run in Supabase SQL editor

-- Profiles (extends auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  role text not null check (role in ('student', 'teacher')),
  created_at timestamptz default now()
);

-- Simulations
create table if not exists simulations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references profiles(id) on delete cascade,
  title text not null,
  description text,
  persona_name text not null,
  persona_role text not null,
  persona_system_prompt text not null,
  product_context text not null,
  simli_face_id text not null,
  is_published boolean default false,
  created_at timestamptz default now()
);

-- Student attempts
create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id) on delete cascade,
  simulation_id uuid references simulations(id) on delete cascade,
  status text default 'in_progress'
    check (status in ('in_progress', 'completed')),
  current_stage text default 'lead_gen',
  total_score integer default 0,
  started_at timestamptz default now(),
  completed_at timestamptz
);

-- Per-stage scores
create table if not exists stage_scores (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references attempts(id) on delete cascade,
  stage text not null,
  score integer not null check (score between 0 and 100),
  feedback text,
  transcript text,
  completed_at timestamptz default now(),
  unique (attempt_id, stage)
);

-- RLS
alter table profiles enable row level security;
alter table simulations enable row level security;
alter table attempts enable row level security;
alter table stage_scores enable row level security;

create policy "Users read own profile" on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);
create policy "Users insert own profile" on profiles for insert with check (auth.uid() = id);

create policy "Teachers manage own simulations" on simulations for all
  using (auth.uid() = teacher_id);
create policy "Students read published simulations" on simulations for select
  using (is_published = true or auth.uid() = teacher_id);

create policy "Students manage own attempts" on attempts for all
  using (auth.uid() = student_id);
create policy "Teachers read attempts for their sims" on attempts for select
  using (
    exists (
      select 1 from simulations s
      where s.id = attempts.simulation_id and s.teacher_id = auth.uid()
    )
  );

create policy "Students manage own stage scores" on stage_scores for all
  using (
    exists (
      select 1 from attempts a
      where a.id = stage_scores.attempt_id and a.student_id = auth.uid()
    )
  );
create policy "Teachers read stage scores" on stage_scores for select
  using (
    exists (
      select 1 from attempts a
      join simulations s on s.id = a.simulation_id
      where a.id = stage_scores.attempt_id and s.teacher_id = auth.uid()
    )
  );

create policy "Teachers read profiles for their simulation attempts"
  on profiles for select
  using (
    exists (
      select 1
      from attempts a
      join simulations s on s.id = a.simulation_id
      where a.student_id = profiles.id
        and s.teacher_id = auth.uid()
    )
  );

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'User'),
    coalesce(new.raw_user_meta_data->>'role', 'student')
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
