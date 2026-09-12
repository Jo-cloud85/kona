-- Kona — preserve a stated distance range verbatim instead of collapsing it
-- ===========================================================================
-- Real alpha report: telling Kona "13-14km" saved as distance_km = 13.5 — a
-- defensible midpoint for the fueling math, but a precise-looking number the
-- athlete never actually said. `distance_km` stays a single number (the
-- calculation engine needs one to work with); `distance_label` is the
-- athlete's own words ("13-14 km") shown on Home/Week instead, when present.
--
-- Safe to run after 0001_init.sql / 0002_origin_message_id.sql on an existing
-- project.

alter table public.planned_sessions
  add column if not exists distance_label text;
alter table public.sessions
  add column if not exists distance_label text;
