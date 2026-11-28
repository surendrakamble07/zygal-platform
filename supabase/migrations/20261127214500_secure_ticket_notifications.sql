create or replace function public.create_ticket_notifications(
  p_ticket_id uuid,
  p_type text,
  p_message text,
  p_recipient_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_project_id uuid;
  v_has_project_access boolean;
  v_is_lead boolean;
  v_is_assigned boolean;
  v_actor_authorized boolean;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'An active signed-in user is required to send ticket notifications'
      using errcode = '42501';
  end if;

  if p_type is null
     or p_type not in ('Assigned', 'Commented', 'Submitted', 'Approved', 'Reopened', 'Cancelled') then
    raise exception 'Unsupported ticket notification type'
      using errcode = '22023';
  end if;

  if p_message is null or btrim(p_message) = '' then
    raise exception 'Ticket notification message cannot be empty'
      using errcode = '22023';
  end if;

  select t.project_id
    into v_project_id
  from public.tickets t
  where t.id = p_ticket_id;

  if not found then
    raise exception 'Ticket not found'
      using errcode = 'P0002';
  end if;

  v_has_project_access := public.has_project_access(auth.uid(), v_project_id);
  v_is_lead := public.is_lead() and v_has_project_access;
  select exists (
    select 1
    from public.ticket_assignments a
    where a.ticket_id = p_ticket_id
      and a.assigned_to = auth.uid()
  ) into v_is_assigned;

  v_actor_authorized := case p_type
    when 'Assigned' then v_is_lead
    when 'Submitted' then exists (
      select 1
      from public.ticket_assignments a
      where a.ticket_id = p_ticket_id
        and a.assigned_to = auth.uid()
        and a.is_current
    )
    when 'Commented' then v_is_lead or v_is_assigned
    else v_is_lead
  end;

  if not v_has_project_access or not v_actor_authorized then
    raise exception 'You are not allowed to send this ticket notification'
      using errcode = '42501';
  end if;

  if p_recipient_ids is null or cardinality(p_recipient_ids) = 0 then
    return;
  end if;

  if exists (
    select 1
    from unnest(p_recipient_ids) as requested(recipient_id)
    where requested.recipient_id is null
       or requested.recipient_id = auth.uid()
       or not exists (
         select 1
         from public.profiles p
         where p.id = requested.recipient_id
           and (
             (
               p_type in ('Assigned', 'Approved', 'Reopened', 'Cancelled')
               and exists (
                 select 1
                 from public.ticket_assignments a
                 where a.ticket_id = p_ticket_id
                   and a.assigned_to = p.id
                   and a.is_current
               )
             )
             or (
               p_type in ('Commented', 'Submitted')
               and p.role = 'team_lead'
               and exists (
                 select 1
                 from public.profile_projects pp
                 where pp.profile_id = p.id
                   and pp.project_id = v_project_id
               )
             )
             or (
               p_type = 'Commented'
               and exists (
                 select 1
                 from public.ticket_assignments a
                 where a.ticket_id = p_ticket_id
                   and a.assigned_to = p.id
                   and a.is_current
               )
             )
           )
       )
  ) then
    raise exception 'One or more notification recipients are not authorized for this ticket'
      using errcode = '42501';
  end if;

  insert into public.ticket_notifications (ticket_id, recipient_id, type, message)
  select distinct p_ticket_id, requested.recipient_id, p_type, p_message
  from unnest(p_recipient_ids) as requested(recipient_id);
end;
$$;

revoke all on function public.create_ticket_notifications(uuid, text, text, uuid[]) from public, anon;
grant execute on function public.create_ticket_notifications(uuid, text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
