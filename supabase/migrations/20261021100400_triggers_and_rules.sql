-- ZYGAL platform - Migration 4: automatic rules, history and audit trail

-- 1) updated_at on every edit
do $$
declare t text;
begin
  foreach t in array array['profiles','projects','project_types','engineers','sites',
                           'devices','jobs','job_checklist','material_issues'] loop
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- 2) Audit trail: who created / changed / removed what, and the data before and after.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, record_id, action, new_data, changed_by)
    values (tg_table_name, (to_jsonb(new) ->> 'id')::uuid, 'INSERT', to_jsonb(new), auth.uid());
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
      return null;                       -- nothing really changed
    end if;
    insert into public.audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, (to_jsonb(new) ->> 'id')::uuid, 'UPDATE', to_jsonb(old), to_jsonb(new), auth.uid());
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (table_name, record_id, action, old_data, changed_by)
    values (tg_table_name, (to_jsonb(old) ->> 'id')::uuid, 'DELETE', to_jsonb(old), auth.uid());
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','projects','project_types','engineers','sites',
                           'devices','jobs','job_checklist','material_issues'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end $$;

-- 3) Only Team Leads / Admins may remove (soft-delete) sites, devices and jobs.
create or replace function public.guard_soft_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is distinct from old.deleted_at and public.my_role() = 'support' then
    raise exception 'Only a Team Lead or Admin can remove or restore records.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger sites_guard_delete   before update on public.sites   for each row execute function public.guard_soft_delete();
create trigger devices_guard_delete before update on public.devices for each row execute function public.guard_soft_delete();
create trigger jobs_guard_delete    before update on public.jobs    for each row execute function public.guard_soft_delete();

-- 4) Job rules (replaces the old "Rule Validator Status" column).
--    A job cannot be Completed/Live while handover or material is pending.
--    completed_at is stamped automatically and cleared if the job is reopened.
create or replace function public.jobs_enforce_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.final_status in ('Completed','Live') then
    if new.handover_status = 'Pending' then
      raise exception 'Cannot close this job while Handover is Pending. Set Handover to Done first.'
        using errcode = '23514';
    end if;
    if exists (select 1 from public.material_issues m
               where m.job_id = new.id and m.status = 'Pending') then
      raise exception 'Cannot close this job while a material issue is still Pending. Resolve it first.'
        using errcode = '23514';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

create trigger jobs_rules before insert or update on public.jobs
  for each row execute function public.jobs_enforce_rules();

-- 5) Material issue rules: stamp resolved date; no new Pending issue on a closed job.
create or replace function public.material_enforce_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'Resolved' then
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_at := null;
    if exists (select 1 from public.jobs j
               where j.id = new.job_id and j.final_status in ('Completed','Live')) then
      raise exception 'This job is already closed. Reopen the job before adding a Pending material issue.'
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger material_rules before insert or update on public.material_issues
  for each row execute function public.material_enforce_rules();

-- 6) Status history: every change to handover / final status.
create or replace function public.jobs_log_status_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_status_history (job_id, field_name, old_value, new_value, changed_by)
    values (new.id, 'handover_status', null, new.handover_status, auth.uid()),
           (new.id, 'final_status',    null, new.final_status,    auth.uid());
  else
    if new.handover_status is distinct from old.handover_status then
      insert into public.job_status_history (job_id, field_name, old_value, new_value, changed_by)
      values (new.id, 'handover_status', old.handover_status, new.handover_status, auth.uid());
    end if;
    if new.final_status is distinct from old.final_status then
      insert into public.job_status_history (job_id, field_name, old_value, new_value, changed_by)
      values (new.id, 'final_status', old.final_status, new.final_status, auth.uid());
    end if;
  end if;
  return null;
end $$;

create trigger jobs_status_history after insert or update on public.jobs
  for each row execute function public.jobs_log_status_history();
