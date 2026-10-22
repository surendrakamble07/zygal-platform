-- ZYGAL platform - Migration 1: reference tables, users, helper functions
-- Apply to the DEV project first (zygal-dev).

create type public.app_role as enum ('support', 'team_lead', 'admin');

-- Keeps updated_at correct on every edit.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Dropdown lookup tables. Team Leads can add values from the app later.
-- Name is the key, so a rename cascades to every record that uses it.
do $$
declare t text;
begin
  foreach t in array array[
    'call_types','handover_statuses','final_statuses',
    'material_items','material_problems','checklist_items','checklist_results'
  ] loop
    execute format(
      'create table public.%I (
         name text primary key,
         sort_order int not null default 100,
         is_active boolean not null default true,
         created_at timestamptz not null default now(),
         constraint %I check (name = btrim(name) and name <> '''')
       )', t, t || '_name_clean');
  end loop;
end $$;

create table public.states (
  name text primary key,
  sort_order int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and name <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index projects_name_unique on public.projects (lower(name));

create table public.project_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  name text not null check (name = btrim(name) and name <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name),
  unique (id, project_id)   -- lets sites prove "type belongs to project"
);

-- Platform users (support team, leads, admins). One row per login account.
-- Never deleted: deactivate with is_active = false so old jobs keep the name.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (btrim(full_name) <> ''),
  email text not null check (email = lower(email)),
  role public.app_role not null default 'support',
  job_title text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_unique on public.profiles (email);

-- Who is the current user? Used by the security rules.
create or replace function public.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
$$;

create or replace function public.is_lead()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.is_active and p.role in ('team_lead','admin'))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.is_active and p.role = 'admin')
$$;
