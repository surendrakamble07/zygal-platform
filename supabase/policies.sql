-- Supabase RLS foundation. Run after schema.sql.
-- These policies are the backend boundary; client-side role checks are UX only.

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.name
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.departments enable row level security;
alter table public.branches enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_work enable row level security;
alter table public.hardware enable row level security;
alter table public.sim_cards enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "authenticated users can read roles"
on public.roles for select to authenticated
using (true);

create policy "authenticated users can read departments"
on public.departments for select to authenticated
using (true);

create policy "authenticated users can read active branches"
on public.branches for select to authenticated
using (status = 'Active' or public.current_role() in ('Assistant Manager', 'Admin'));

create policy "profiles can view own profile or managers view profiles"
on public.profiles for select to authenticated
using (id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "managers can manage profiles"
on public.profiles for all to authenticated
using (public.current_role() in ('Assistant Manager', 'Admin'))
with check (public.current_role() in ('Assistant Manager', 'Admin'));

create policy "authenticated users can view projects"
on public.projects for select to authenticated
using (true);

create policy "managers can manage projects"
on public.projects for all to authenticated
using (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'))
with check (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "users can view own attendance or team attendance"
on public.attendance for select to authenticated
using (profile_id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "users can create own attendance"
on public.attendance for insert to authenticated
with check (profile_id = auth.uid() and created_by = auth.uid());

create policy "attendance managers can update attendance"
on public.attendance for update to authenticated
using (profile_id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'))
with check (profile_id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "users can manage own daily work"
on public.daily_work for all to authenticated
using (profile_id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'))
with check (profile_id = auth.uid() or public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "operations managers can manage assets"
on public.hardware for all to authenticated
using (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'))
with check (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "operations managers can manage sim cards"
on public.sim_cards for all to authenticated
using (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'))
with check (public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin'));

create policy "users can view own notifications"
on public.notifications for select to authenticated
using (profile_id = auth.uid());

create policy "users can mark own notifications read"
on public.notifications for update to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create policy "admins can view audit logs"
on public.audit_logs for select to authenticated
using (public.current_role() = 'Admin');

create policy "admins can update employee authentication fields"
on public.profiles for update to authenticated
using (public.current_role() in ('Assistant Manager', 'Admin'))
with check (public.current_role() in ('Assistant Manager', 'Admin'));

revoke insert, update, delete on public.audit_logs from authenticated;
