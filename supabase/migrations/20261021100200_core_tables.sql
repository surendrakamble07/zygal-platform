-- ZYGAL platform - Migration 2: engineers, sites, devices, jobs and their detail tables

-- Engineers are a name list only. They never log in.
create table public.engineers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (btrim(full_name) <> ''),
  phone text,
  vendor text,                       -- vendor/company name, empty if in-house
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index engineers_name_unique on public.engineers (lower(btrim(full_name)));

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  project_type_id uuid not null,
  branch_code text not null check (branch_code = btrim(branch_code) and branch_code <> ''),
  branch_name text,
  state text references public.states(name) on update cascade,
  latitude numeric(9,6) check (latitude between 6 and 38),
  longitude numeric(9,6) check (longitude between 68 and 98),
  status text not null default 'Active' check (status in ('Active','Inactive')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- the chosen type must belong to the chosen project
  constraint sites_type_matches_project
    foreign key (project_type_id, project_id) references public.project_types (id, project_id),
  -- branch code is unique per project, not across all projects
  constraint sites_branch_unique unique (project_id, branch_code),
  constraint sites_lat_long_together check ((latitude is null) = (longitude is null))
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id),
  sim_name text,
  sim_number text check (sim_number is null or sim_number ~ '^[0-9]{18,22}$'),
  link_ip text,
  link_mac_id text,
  vault_tam text,
  cash_counter_tam text,
  main_door_tam text,
  ngl_main_door_tam text,
  device_status text not null default 'Active' check (device_status in ('Active','Replaced')),
  notes text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- One physical SIM / link device can be active at only one site.
create unique index devices_sim_active_unique on public.devices (sim_number)
  where sim_number is not null and device_status = 'Active' and deleted_at is null;
create unique index devices_mac_active_unique on public.devices (link_mac_id)
  where link_mac_id is not null and device_status = 'Active' and deleted_at is null;

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_no bigint generated always as identity unique,   -- friendly number: JOB-000123
  job_date date not null,
  call_type text not null references public.call_types(name) on update cascade,
  site_id uuid not null references public.sites(id),
  call_taken_by uuid not null references public.profiles(id) default auth.uid(),
  engineer_id uuid references public.engineers(id),
  handover_status text not null default 'Pending'
    references public.handover_statuses(name) on update cascade,
  final_status text not null default 'WIP'
    references public.final_statuses(name) on update cascade,
  has_minor_issue boolean not null default false,
  remark text,
  completed_at timestamptz,                             -- stamped automatically
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.job_checklist (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  item text not null references public.checklist_items(name) on update cascade,
  result text not null default 'Pending' references public.checklist_results(name) on update cascade,
  remark text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, item)
);

create table public.material_issues (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  item text not null references public.material_items(name) on update cascade,
  problem text not null references public.material_problems(name) on update cascade,
  quantity int not null default 1 check (quantity between 1 and 1000),
  status text not null default 'Pending' check (status in ('Pending','Resolved')),
  remark text,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every change to handover/final status, written by the database itself.
create table public.job_status_history (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id),
  field_name text not null check (field_name in ('handover_status','final_status')),
  old_value text,
  new_value text,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

-- Every create / edit / delete across the main tables.
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

-- Indexes: what makes "all jobs for site XYZ last month" instant.
create index jobs_date_idx            on public.jobs (job_date desc)                  where deleted_at is null;
create index jobs_site_date_idx       on public.jobs (site_id, job_date desc)         where deleted_at is null;
create index jobs_engineer_date_idx   on public.jobs (engineer_id, job_date desc)     where deleted_at is null;
create index jobs_takenby_date_idx    on public.jobs (call_taken_by, job_date desc)   where deleted_at is null;
create index jobs_final_status_idx    on public.jobs (final_status)                   where deleted_at is null;
create index jobs_handover_idx        on public.jobs (handover_status)                where deleted_at is null;
create index sites_project_idx        on public.sites (project_id)                    where deleted_at is null;
create index sites_state_idx          on public.sites (state)                         where deleted_at is null;
create index sites_type_idx           on public.sites (project_type_id, project_id);
create index devices_site_idx         on public.devices (site_id)                     where deleted_at is null;
create index material_job_idx         on public.material_issues (job_id);
create index material_pending_idx     on public.material_issues (item)                where status = 'Pending';
create index status_history_job_idx   on public.job_status_history (job_id, changed_at desc);
create index audit_record_idx         on public.audit_log (table_name, record_id);
create index audit_time_idx           on public.audit_log (changed_at desc);
