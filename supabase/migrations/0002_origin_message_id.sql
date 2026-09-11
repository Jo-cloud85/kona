-- Kona — M23.1: attribute structured records to the chat turn that created them
-- ===========================================================================
-- Adds `origin_message_id` to every table a chat turn can write, so an edited /
-- regenerated turn can reconcile the records it produced. FK is ON DELETE
-- CASCADE: a structured record can never outlive its originating message, so
-- even a message deletion that bypasses the app path stays consistent. The
-- edit flow also deletes these rows explicitly (and reports what it removed).
--
-- Safe to run after 0001_init.sql on an existing project.

alter table public.planned_sessions
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.sessions
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.weekly_plans
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.fuel_logs
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.recovery_logs
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.personal_memories
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;
alter table public.activity_events
  add column if not exists origin_message_id uuid references public.messages(id) on delete cascade;

create index if not exists planned_sessions_origin_idx  on public.planned_sessions  (user_id, origin_message_id);
create index if not exists sessions_origin_idx          on public.sessions          (user_id, origin_message_id);
create index if not exists weekly_plans_origin_idx      on public.weekly_plans      (user_id, origin_message_id);
create index if not exists fuel_logs_origin_idx         on public.fuel_logs         (user_id, origin_message_id);
create index if not exists recovery_logs_origin_idx     on public.recovery_logs     (user_id, origin_message_id);
create index if not exists personal_memories_origin_idx on public.personal_memories (user_id, origin_message_id);
create index if not exists activity_events_origin_idx   on public.activity_events   (user_id, origin_message_id);

-- Reminder: the session-link FKs from 0001 stay ON DELETE SET NULL
--   fuel_logs.session_id, recovery_logs.session_id, sessions.planned_session_id
-- so deleting a session created by an edited turn keeps a later, kept record
-- and only nulls its dangling link. The app performs the same repair explicitly.
