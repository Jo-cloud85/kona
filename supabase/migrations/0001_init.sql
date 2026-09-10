-- Kona — M23 production persistence schema
-- =========================================
-- One migration: every user-owned entity, with Row Level Security so a user can
-- only ever see or change their own rows. Paste into the Supabase SQL editor (or
-- run with the Supabase CLI). Safe to re-run: guarded with IF NOT EXISTS / OR
-- REPLACE where possible, but intended as a first migration on a fresh project.
--
-- Design notes
--  * Every table has `user_id uuid` referencing `auth.users(id)`. RLS compares it
--    to `auth.uid()` — the enforcement boundary, not app code.
--  * `start_at` is stored as TEXT: the domain treats it as a wall-clock local
--    datetime string (no zone), and string-slices it. timestamptz would shift it.
--  * Genuine instants (`created_at`, `logged_at`, `at`, …) are timestamptz.
--  * Nested / variable shapes (`goal`, `environment`, `items`, `meta`,
--    `known_sweat_data`) are jsonb. Simple lists are text[].
--  * There is NO physical `conversations` table. A conversation is fully derived
--    from its messages, so persisting it separately would be duplicated derived
--    state (see PRODUCT_VISION "Derived information"). The `conversation_summaries`
--    VIEW provides the list rows, and runs under the caller's RLS on `messages`.
--  * Insights are NOT stored — they are recomputed deterministically from source
--    records by `deriveInsights()` on every read.

-- ---------------------------------------------------------------------------
-- profiles — one row per user (user_id is the PK and equals auth.uid())
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  username                text,
  goal                    jsonb,                       -- { text, event_date? }
  gender                  text,
  age                     integer,
  body_weight_kg          numeric,
  usual_sports            text[]  not null default '{}',
  usual_bottle_ml         integer,
  typical_weekly_sessions integer,
  known_sweat_data        jsonb,                       -- KnownSweatData[]
  preferred_product_ids   text[],
  recent_injuries_note    text,
  onboarded_at            timestamptz,
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- weekly_plans — one saved week; replaced on re-save for the same week_start
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_plans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  week_start  date not null,
  source_text text,
  rest_days   text[] not null default '{}',
  created_at  timestamptz not null default now(),
  unique (user_id, week_start)
);
create index if not exists weekly_plans_user_idx on public.weekly_plans (user_id, week_start);

-- ---------------------------------------------------------------------------
-- planned_sessions — the intended sessions (kept separate from actuals)
-- ---------------------------------------------------------------------------
create table if not exists public.planned_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  weekly_plan_id    uuid references public.weekly_plans(id) on delete cascade,
  sport             text not null,
  start_at          text not null,                     -- wall-clock local datetime
  time_of_day       text,
  duration_minutes  integer,
  distance_km       numeric,
  intensity         text not null,
  pre_fed_state     text,
  environment       jsonb,
  sequence_index    integer,
  session_group_id  text,
  is_long           boolean,
  needs_detail      text[],
  notes             text,
  created_at        timestamptz not null default now()
);
create index if not exists planned_sessions_user_idx on public.planned_sessions (user_id, start_at);
create index if not exists planned_sessions_week_idx on public.planned_sessions (weekly_plan_id);

-- ---------------------------------------------------------------------------
-- sessions — what ACTUALLY happened (never overwrites a plan)
-- ---------------------------------------------------------------------------
create table if not exists public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  planned_session_id  uuid references public.planned_sessions(id) on delete set null,
  sport               text not null,
  start_at            text not null,
  time_of_day         text,
  duration_minutes    integer,
  distance_km         numeric,
  intensity           text not null,
  pre_fed_state       text,
  environment         jsonb,
  sequence_index      integer,
  session_group_id    text,
  is_long             boolean,
  needs_detail        text[],
  notes               text,
  status              text not null,                   -- completed|modified|skipped|stopped_early
  reason              text,
  created_at          timestamptz not null default now()
);
create index if not exists sessions_user_idx on public.sessions (user_id, start_at);

-- ---------------------------------------------------------------------------
-- fuel_logs — what was consumed. `items` keeps provenance/certainty per item.
-- ---------------------------------------------------------------------------
create table if not exists public.fuel_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.sessions(id) on delete set null,
  logged_at  timestamptz not null default now(),
  items      jsonb not null default '[]'::jsonb
);
create index if not exists fuel_logs_user_idx on public.fuel_logs (user_id, logged_at);

-- ---------------------------------------------------------------------------
-- recovery_logs — how it felt / symptoms. Human free_text is the primary record.
-- ---------------------------------------------------------------------------
create table if not exists public.recovery_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid references public.sessions(id) on delete set null,
  logged_at         timestamptz not null default now(),
  free_text         text not null default '',
  overall_severity  text,                              -- none|low|moderate|high
  reported_symptoms text[],
  sleep_quality     text
);
create index if not exists recovery_logs_user_idx on public.recovery_logs (user_id, logged_at);

-- ---------------------------------------------------------------------------
-- messages — conversation transcript. conversation_id is a client string,
-- unique only within a user. A conversation has no row of its own.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  conversation_id text not null,
  role            text not null,                       -- user|assistant
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (user_id, conversation_id, created_at);

-- Derived conversation list. security_invoker => runs under the caller's RLS on
-- messages, so it never leaks another user's conversations.
create or replace view public.conversation_summaries
  with (security_invoker = true) as
select
  m.user_id,
  m.conversation_id                                                             as id,
  coalesce(
    (array_agg(m.content order by m.created_at) filter (where m.role = 'user'))[1],
    'New chat'
  )                                                                             as title,
  count(*)::int                                                                 as message_count,
  min(m.created_at)                                                             as created_at,
  max(m.created_at)                                                             as updated_at
from public.messages m
group by m.user_id, m.conversation_id;

-- ---------------------------------------------------------------------------
-- personal_memories — durable facts worth carrying between conversations.
-- Product-truth: `certainty` provenance is preserved verbatim from the domain.
-- ---------------------------------------------------------------------------
create table if not exists public.personal_memories (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  key           text not null,
  value         text not null,
  certainty     text not null,                         -- known|user_reported|estimated|inferred|recommended
  source        text not null default 'conversation',
  status        text not null default 'active',
  proposed_at   timestamptz not null default now(),
  persisted_at  timestamptz not null default now(),
  unique (user_id, key)
);
create index if not exists personal_memories_user_idx on public.personal_memories (user_id);

-- ---------------------------------------------------------------------------
-- recommendations — reserved. Current M22 adaptation semantics ride entirely on
-- activity_events (an insight_formed the LLM advice later draws on → one
-- recommendation_adapted). This table is the anchor for a future design that
-- persists explicit recommendation records; nothing writes it today.
-- ---------------------------------------------------------------------------
create table if not exists public.recommendations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  topic          text,
  text           text not null,
  basis          text,                                 -- reported|repeated|outcome|adaptation
  certainty      text,
  evidence_count integer,
  created_at     timestamptz not null default now()
);
create index if not exists recommendations_user_idx on public.recommendations (user_id, created_at);

-- ---------------------------------------------------------------------------
-- activity_events — append-only "how Kona's been learning" stream.
-- No update/delete policy => the DB itself rejects mutation.
-- The reported / repeated / outcome / adaptation distinction lives in `meta`
-- and in the event `type`; nothing here collapses them.
-- ---------------------------------------------------------------------------
create table if not exists public.activity_events (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  type     text not null,
  at       timestamptz not null default now(),
  summary  text not null,
  meta     jsonb
);
create index if not exists activity_events_user_idx on public.activity_events (user_id, at desc);

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
alter table public.profiles          enable row level security;
alter table public.weekly_plans      enable row level security;
alter table public.planned_sessions  enable row level security;
alter table public.sessions          enable row level security;
alter table public.fuel_logs         enable row level security;
alter table public.recovery_logs     enable row level security;
alter table public.messages          enable row level security;
alter table public.personal_memories enable row level security;
alter table public.recommendations   enable row level security;
alter table public.activity_events   enable row level security;

-- Full CRUD on your own rows for the standard tables.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','weekly_plans','planned_sessions','sessions','fuel_logs',
    'recovery_logs','messages','personal_memories','recommendations'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I;', t, t);
    execute format('drop policy if exists %I_insert on public.%I;', t, t);
    execute format('drop policy if exists %I_update on public.%I;', t, t);
    execute format('drop policy if exists %I_delete on public.%I;', t, t);
    execute format('create policy %I_select on public.%I for select using (auth.uid() = user_id);', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (auth.uid() = user_id);', t, t);
    execute format('create policy %I_update on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t, t);
    execute format('create policy %I_delete on public.%I for delete using (auth.uid() = user_id);', t, t);
  end loop;
end $$;

-- activity_events: read + append only. No update/delete policy => immutable.
drop policy if exists activity_events_select on public.activity_events;
drop policy if exists activity_events_insert on public.activity_events;
create policy activity_events_select on public.activity_events
  for select using (auth.uid() = user_id);
create policy activity_events_insert on public.activity_events
  for insert with check (auth.uid() = user_id);
