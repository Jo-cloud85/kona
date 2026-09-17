-- Kona — check-in expansion: mood + structured loop-closing outcome
-- ===========================================================================
-- Part of the "Kona accompanies me" redesign (2026-09). The tap-only
-- check-in gains a mood question alongside the existing sleep_quality, and
-- the M24.5 "did you follow Kona's suggestion" loop-closing answer now
-- records which advice CATEGORY it was about and the outcome as their own
-- columns, instead of only being folded into free_text prose. This lets the
-- new "Kona learned: extra fluid helped on your last two hot runs" detector
-- count outcomes per category directly rather than re-parsing English
-- checkin.ts wrote itself.
--
-- Safe to run after 0001_init.sql on an existing project.

alter table public.recovery_logs
  add column if not exists mood text,
  add column if not exists followed_category text,
  add column if not exists followed_outcome text;
