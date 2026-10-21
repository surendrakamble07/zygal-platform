-- One-time bootstrap for the initial administrator.
-- First create this email in Supabase Dashboard -> Authentication -> Users:
-- surendra.kamble@zygal.io
-- Then run this script in the Supabase SQL Editor.

alter table public.profiles add column if not exists designation text;

do $$
declare
  auth_user_id uuid;
  admin_role_id uuid;
begin
  select id into auth_user_id
  from auth.users
  where lower(email) = 'surendra.kamble@zygal.io';

  if auth_user_id is null then
    raise exception 'Create surendra.kamble@zygal.io in Supabase Auth first.';
  end if;

  select id into admin_role_id
  from public.roles
  where name = 'Admin';

  if admin_role_id is null then
    raise exception 'The Admin role is missing. Run schema.sql first.';
  end if;

  insert into public.profiles (
    id,
    employee_id,
    full_name,
    email,
    role_id,
    status,
    email_verified
  ) values (
    auth_user_id,
    'ADMIN001',
    'Surendra Kamble',
    'surendra.kamble@zygal.io',
    admin_role_id,
    'Active',
    false
  )
  on conflict (id) do update set
    employee_id = excluded.employee_id,
    full_name = excluded.full_name,
    email = excluded.email,
    role_id = excluded.role_id,
    status = 'Active',
    updated_at = now();
end;
$$;
