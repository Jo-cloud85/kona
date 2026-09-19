-- Kona — "how did it actually feel?" as a structured, queryable field.
-- ===========================================================================
-- Rhythm's consistency grid previously colored a day using the plan's or the
-- logged session's own stated intensity — a prediction, not what actually
-- happened. A check-in is the most current truth available (ran an "easy"
-- session too fast, or the heat made a planned "moderate" run feel hard),
-- so it should be able to shift the day's color, not just confirm the plan
-- (founder direction, M28.1 — dropped the "off_plan" state entirely in favor
-- of effort color + an independent pain/injury flag).
--
-- Safe to run after 0001_init.sql on an existing project.

alter table public.recovery_logs
  add column if not exists felt_vs_planned text;
