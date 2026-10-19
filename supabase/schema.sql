-- Team Operations v5.0 relational foundation.
-- Apply with Supabase migrations. Authentication users live in auth.users.

create extension if not exists pgcrypto;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('Employee', 'Team Lead', 'Assistant Manager', 'Admin')),
  created_at timestamptz not null default now()
);

insert into public.roles (name)
values ('Admin'), ('Assistant Manager'), ('Team Lead'), ('Employee')
on conflict (name) do nothing;

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  employee_id text not null unique,
  email text not null,
  email_normalized text generated always as (lower(trim(email))) stored,
  mobile text,
  department text,
  project text,
  designation text,
  role_id uuid not null references public.roles(id),
  department_id uuid references public.departments(id),
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Suspended')),
  email_verified boolean not null default false,
  last_login_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  branch_id uuid references public.branches(id),
  status text not null default 'Active' check (status in ('Active', 'Inactive', 'Completed')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  attendance_date date not null,
  status text not null check (status in ('Present', 'Absent', 'Half Day', 'Leave', 'Week Off')),
  remark text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, attendance_date)
);

create table if not exists public.daily_work (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id),
  work_date date not null,
  category text not null,
  description text not null,
  start_time timestamptz,
  end_time timestamptz,
  status text not null default 'Pending' check (status in ('Pending', 'In Progress', 'Completed', 'Blocked')),
  remarks text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_work add column if not exists details jsonb not null default '{}'::jsonb;

create table if not exists public.hardware (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null unique,
  serial_number text unique,
  device_type text not null,
  brand text,
  model text,
  assigned_to uuid references public.profiles(id),
  project_id uuid references public.projects(id),
  status text not null default 'Available' check (status in ('Available', 'Assigned', 'Under Repair', 'Retired')),
  purchase_date date,
  condition text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sim_cards (
  id uuid primary key default gen_random_uuid(),
  sim_number text not null unique,
  mobile_number text unique,
  provider text,
  assigned_to uuid references public.profiles(id),
  project_id uuid references public.projects(id),
  status text not null default 'Available' check (status in ('Available', 'Assigned', 'Suspended', 'Retired')),
  activation_date date,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  priority text not null default 'Normal' check (priority in ('Normal', 'High', 'Critical')),
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email_normalized text generated always as (lower(trim(email))) stored;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists department text;
alter table public.profiles add column if not exists project text;
alter table public.profiles add column if not exists designation text;
alter table public.profiles add column if not exists email_verified boolean not null default false;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists created_by uuid references auth.users(id);
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('Active', 'Inactive', 'Suspended'));
create unique index if not exists profiles_employee_id_uidx on public.profiles(employee_id);

create index if not exists attendance_date_idx on public.attendance(attendance_date);
create index if not exists daily_work_date_idx on public.daily_work(work_date);
create index if not exists notifications_profile_idx on public.notifications(profile_id, read_at);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);
create unique index if not exists profiles_email_normalized_uidx on public.profiles(email_normalized);

create or replace function public.request_email_otp(requested_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare account_status text;
begin
  select status into account_status
  from public.profiles
  where email_normalized = lower(trim(requested_email));
  return case
    when account_status is null then 'NOT_FOUND'
    when account_status = 'Active' then 'ACTIVE'
    when account_status = 'Suspended' then 'SUSPENDED'
    else 'INACTIVE'
  end;
end;
$$;

create or replace function public.mark_email_verified()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set email_verified = true, last_login_at = now(), updated_at = now()
  where id = auth.uid() and status = 'Active';
$$;

revoke all on function public.request_email_otp(text) from public;
grant execute on function public.request_email_otp(text) to anon, authenticated;
revoke all on function public.mark_email_verified() from public;
grant execute on function public.mark_email_verified() to authenticated;
