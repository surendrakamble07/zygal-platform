-- Avoid recursive RLS evaluation between tickets and ticket-related tables.
create or replace function public.is_current_user_assigned_to_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ticket_assignments a
    where a.ticket_id = p_ticket_id
      and a.assigned_to = auth.uid()
  );
$$;

create or replace function public.current_user_has_ticket_project_access(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and public.has_project_access(auth.uid(), t.project_id)
  );
$$;

revoke all on function public.is_current_user_assigned_to_ticket(uuid) from public, anon;
revoke all on function public.current_user_has_ticket_project_access(uuid) from public, anon;
grant execute on function public.is_current_user_assigned_to_ticket(uuid) to authenticated;
grant execute on function public.current_user_has_ticket_project_access(uuid) to authenticated;

drop policy if exists tickets_read on public.tickets;
create policy tickets_read on public.tickets for select to authenticated
  using (
    public.has_project_access(auth.uid(), project_id)
    and (
      public.is_lead()
      or public.is_current_user_assigned_to_ticket(id)
    )
  );

drop policy if exists ticket_assignments_read on public.ticket_assignments;
create policy ticket_assignments_read on public.ticket_assignments for select to authenticated
  using (
    assigned_to = auth.uid()
    or (
      public.is_lead()
      and public.current_user_has_ticket_project_access(ticket_id)
    )
  );

drop policy if exists ticket_contributors_read on public.ticket_contributors;
create policy ticket_contributors_read on public.ticket_contributors for select to authenticated
  using (
    profile_id = auth.uid()
    or (
      public.is_lead()
      and public.current_user_has_ticket_project_access(ticket_id)
    )
  );
