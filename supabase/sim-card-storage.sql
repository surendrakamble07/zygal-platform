-- Optional production setup for SIM card photos.
-- Run after schema.sql and policies.sql in the Supabase SQL editor.
-- The current browser demo continues to use localStorage until its SIM adapter is migrated.

alter table public.sim_cards
  add column if not exists image_path text,
  add column if not exists image_url text,
  add column if not exists created_by uuid references auth.users(id);

insert into storage.buckets (id, name, public)
values ('sim-card-photos', 'sim-card-photos', false)
on conflict (id) do nothing;

drop policy if exists "authenticated users can read SIM photos" on storage.objects;
create policy "authenticated users can read SIM photos"
on storage.objects for select to authenticated
using (bucket_id = 'sim-card-photos');

drop policy if exists "operations managers can upload SIM photos" on storage.objects;
create policy "operations managers can upload SIM photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'sim-card-photos'
  and public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin')
);

drop policy if exists "operations managers can update SIM photos" on storage.objects;
create policy "operations managers can update SIM photos"
on storage.objects for update to authenticated
using (
  bucket_id = 'sim-card-photos'
  and public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin')
)
with check (
  bucket_id = 'sim-card-photos'
  and public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin')
);

drop policy if exists "operations managers can delete SIM photos" on storage.objects;
create policy "operations managers can delete SIM photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'sim-card-photos'
  and public.current_role() in ('Team Lead', 'Assistant Manager', 'Admin')
);
