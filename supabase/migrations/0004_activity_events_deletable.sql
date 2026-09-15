-- Kona — allow an athlete to delete their own activity_events rows
-- ===========================================================================
-- 0001_init.sql deliberately made activity_events append-only ("read + append
-- only. No update/delete policy => immutable") as a durable audit trail of
-- how Kona learned. Founder request (2026-09-15): a full account data reset
-- ("wipe everything, I'm re-adding my data from scratch") needs to clear this
-- too, or old timeline entries would linger after every other table is wiped.
-- That reverses the immutability guarantee on purpose — see progress.md.
--
-- Safe to run after 0001_init.sql on an existing project.

drop policy if exists activity_events_delete on public.activity_events;
create policy activity_events_delete on public.activity_events
  for delete using (auth.uid() = user_id);
