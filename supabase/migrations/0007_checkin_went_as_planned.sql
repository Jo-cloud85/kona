-- Kona — "did today go as planned?" as a structured, queryable field.
-- ===========================================================================
-- The check-in already asks this, but the answer was only folded into
-- free_text prose. That meant a day with a check-in but no separately
-- logged ActualSession had no queryable "this was off-plan" signal at all —
-- Rhythm's consistency grid showed such a day as empty (nothing happened),
-- which is wrong when the athlete DID check in and say it didn't go as
-- planned (founder report, M27.8).
--
-- Safe to run after 0001_init.sql on an existing project.

alter table public.recovery_logs
  add column if not exists went_as_planned boolean;
