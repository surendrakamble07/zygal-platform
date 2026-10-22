-- ZYGAL platform - Migration 5: security rules (Row Level Security)
-- Roles: support < team_lead < admin.  Nobody can hard-delete jobs, sites or devices.

-- ---------- Lock down default access ----------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

revoke delete, truncate on all tables in schema public from authenticated;
-- The only rows users may truly delete: wrongly entered detail lines (still audited).
grant delete on public.job_checklist, public.material_issues to authenticated;

-- Writes to these tables happen only through triggers / functions.
revoke insert, update, delete, truncate on
  public.job_status_history, public.audit_log, public.user_sessions, public.login_events
  from authenticated;

grant execute on function
  public.my_role(), public.is_staff(), public.is_lead(), public.is_admin(),
  public.start_session(text), public.session_heartbeat(uuid), public.end_session(uuid)
  to authenticated;
grant execute on function public.close_stale_sessions() to service_role;

-- ---------- Turn on RLS everywhere ----------
alter table public.call_types          enable row level security;
alter table public.handover_statuses   enable row level security;
alter table public.final_statuses      enable row level security;
alter table public.material_items      enable row level security;
alter table public.material_problems   enable row level security;
alter table public.checklist_items     enable row level security;
alter table public.checklist_results   enable row level security;
alter table public.states              enable row level security;
alter table public.projects            enable row level security;
alter table public.project_types       enable row level security;
alter table public.profiles            enable row level security;
alter table public.engineers           enable row level security;
alter table public.sites               enable row level security;
alter table public.devices             enable row level security;
alter table public.jobs                enable row level security;
alter table public.job_checklist       enable row level security;
alter table public.material_issues     enable row level security;
alter table public.job_status_history  enable row level security;
alter table public.audit_log           enable row level security;
alter table public.user_sessions       enable row level security;
alter table public.login_events        enable row level security;

-- ---------- Dropdown lists, states, projects: everyone reads, leads edit ----------
do $$
declare t text;
begin
  foreach t in array array['call_types','handover_statuses','final_statuses','material_items',
                           'material_problems','checklist_items','checklist_results','states',
                           'projects','project_types'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())',
                   t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_lead())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_lead()) with check (public.is_lead())',
                   t || '_update', t);
  end loop;
end $$;

-- ---------- Users: everyone active can see names; only Admin changes users ----------
create policy profiles_read   on public.profiles for select to authenticated using (public.is_staff());
create policy profiles_insert on public.profiles for insert to authenticated with check (public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Engineers: any active user can read, add and edit ----------
create policy engineers_read   on public.engineers for select to authenticated using (public.is_staff());
create policy engineers_insert on public.engineers for insert to authenticated with check (public.is_staff());
create policy engineers_update on public.engineers for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- Sites, devices, jobs: removed rows are visible to leads only ----------
do $$
declare t text;
begin
  foreach t in array array['sites','devices','jobs'] loop
    execute format('create policy %I on public.%I for select to authenticated
                      using (public.is_staff() and (deleted_at is null or public.is_lead()))',
                   t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                      using (public.is_staff() and (deleted_at is null or public.is_lead()))
                      with check (public.is_staff())',
                   t || '_update', t);
  end loop;
end $$;

-- ---------- Job detail lines ----------
do $$
declare t text;
begin
  foreach t in array array['job_checklist','material_issues'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_staff())', t || '_delete', t);
  end loop;
end $$;

-- ---------- History, audit, sessions ----------
create policy status_history_read on public.job_status_history for select to authenticated using (public.is_staff());
create policy audit_read          on public.audit_log          for select to authenticated using (public.is_lead());
create policy sessions_read       on public.user_sessions       for select to authenticated
  using (user_id = auth.uid() or public.is_lead());
create policy login_events_read   on public.login_events        for select to authenticated using (public.is_lead());
