-- ZYGAL platform - Migration 3: login / logout / activity tracking
-- A "tracked session" = one working period. It closes on Logout, or after 15
-- minutes with no activity (end time is then the last activity time).
-- This is separate from the 7-day "remembered login", which is an Auth setting.

create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason in ('logout','timeout')),
  user_agent text
);
create index user_sessions_user_idx on public.user_sessions (user_id, started_at desc);
-- At most one open session per person (two tabs share it).
create unique index user_sessions_one_open on public.user_sessions (user_id) where ended_at is null;

-- Security events, written by the login Edge Function (service role).
create table public.login_events (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id),
  email text,
  event text not null check (event in
    ('otp_requested','login_success','login_failed','logout','blocked_inactive','new_device')),
  user_agent text,
  created_at timestamptz not null default now()
);
create index login_events_time_idx on public.login_events (created_at desc);
create index login_events_user_idx on public.login_events (user_id, created_at desc);

-- Called when the app opens or after the user comes back from idle.
create or replace function public.start_session(p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  update public.user_sessions
     set ended_at = last_active_at, end_reason = 'timeout'
   where user_id = auth.uid() and ended_at is null
     and last_active_at < now() - interval '15 minutes';

  insert into public.user_sessions (user_id, user_agent)
  values (auth.uid(), left(p_user_agent, 300))
  on conflict (user_id) where ended_at is null
  do update set last_active_at = now()
  returning id into v_id;

  return v_id;
end $$;

-- Called every few minutes while the page is open. Returns false if the
-- session was already closed (the app then calls start_session again).
create or replace function public.session_heartbeat(p_session_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'Account is not active' using errcode = '42501';
  end if;

  update public.user_sessions
     set ended_at = last_active_at, end_reason = 'timeout'
   where id = p_session_id and user_id = auth.uid() and ended_at is null
     and last_active_at < now() - interval '15 minutes';

  update public.user_sessions
     set last_active_at = now()
   where id = p_session_id and user_id = auth.uid() and ended_at is null;

  return found;
end $$;

-- Called when the user presses Logout.
create or replace function public.end_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.user_sessions
     set ended_at = now(), end_reason = 'logout'
   where id = p_session_id and user_id = auth.uid() and ended_at is null;
end $$;

-- Safety net for tabs closed without logout. Run every 5 minutes by a
-- schedule that we set up later. Not callable by normal users.
create or replace function public.close_stale_sessions()
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.user_sessions
     set ended_at = last_active_at, end_reason = 'timeout'
   where ended_at is null and last_active_at < now() - interval '15 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- Who is online right now. Support sees only themselves; leads see everyone.
create view public.v_online_now with (security_invoker = true) as
select s.id as session_id, s.user_id, p.full_name, s.started_at, s.last_active_at
from public.user_sessions s
join public.profiles p on p.id = s.user_id
where s.ended_at is null and s.last_active_at > now() - interval '15 minutes';
