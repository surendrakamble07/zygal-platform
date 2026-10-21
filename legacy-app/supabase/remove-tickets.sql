-- Permanently remove Tickets and its dependent comments from Supabase.
-- This deletes all existing ticket and ticket-comment records.

drop table if exists public.ticket_comments;
drop table if exists public.tickets;
