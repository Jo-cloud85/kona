# KONA — Technical Architecture

## Architecture principle
**One LLM + deterministic tools + relational database + rules engine.**

Do not train a custom model for V1.

The LLM is the conversational orchestrator.

The code is the source of truth for numerical calculations and business rules.

## Stack recommendation
- Next.js + TypeScript
- Tailwind CSS + shadcn/ui
- Supabase / PostgreSQL
- Supabase Auth
- Stripe
- Vercel
- OpenAI Responses API or equivalent LLM API with tool/function calling

## High-level flow

User message
→ conversation API
→ LLM agent
→ tool calls as required
→ deterministic calculations / database reads and writes
→ LLM converts structured results into natural language
→ response returned to user

## Core components

### 1. Conversation layer
Receives natural-language user messages and image uploads.

### 2. Agent layer
Responsible for:
- understanding user intent
- deciding whether information is missing
- requesting only useful clarifications
- calling tools
- composing the final response
- proposing durable memory updates

### 3. Calculation layer
Responsible for:
- session classification
- hydration estimates
- sodium / electrolyte estimates
- carbohydrate estimates
- protein / recovery estimates
- sweat-rate calculations

The calculation engine must be isolated and independently testable.

### 4. Recommendation rules
Responsible for:
- before-workout preparation
- during-workout priorities
- post-workout recovery priorities
- multi-session / double-session preparation
- environment considerations
- relevant historical reminders

### 5. Memory layer
Stores durable facts such as:
- usual bottle size
- usual sports products
- exact product nutrition
- preferred meal shortcuts
- recurring user-reported patterns
- successful setups
- relevant recurring symptoms

Do not store every conversation detail as a permanent memory.

### 6. Database
Suggested tables:
- profiles
- weekly_plans
- planned_sessions
- sessions
- fuel_logs
- recovery_logs
- conversations
- messages
- personal_memories
- recommendations
- subscriptions
- activity_events

### 6a. Activity log (M19)
`activity_events` is a typed, append-only stream of meaningful events
(`session_logged`, `fuel_logged`, `checkin_done`, `fact_learned`,
`insight_formed`, `recommendation_adapted`, …), each with a pre-computed
human `summary`. It powers the visible **"how Kona's been learning"** timeline
(told → remembered → became relevant → advice changed) and is the clean seam a
future XP/progression layer would consume — see `PRODUCT_VISION.md` "Future
direction". Emitted from the orchestrator after a turn's tools run
(`recordTurnActivity`) and from the check-in path.

## Important design rule
Never pass the entire user history to the LLM on every message.

Build a compact context package containing:
- relevant profile facts
- current week plan
- current session
- similar historical sessions
- recent relevant symptoms
- known products / foods
- important durable memories

## Structured information classes
Each fact should have a provenance / certainty concept where practical:
- known
- user_reported
- estimated
- inferred
- recommended

The UI and prompt should treat these differently.

## Planned vs actual
Planned sessions and actual sessions are separate records.

Actual session may contain:
- completed
- modified
- skipped
- stopped early

Reason is stored separately.

## Suggested tool set

### get_user_profile
Input: user_id

### get_week_plan
Input: user_id, week_start

### save_or_update_plan
Input: user_id, plan object

### calculate_fueling_targets
Input:
- sport
- duration
- distance
- intensity
- body weight
- temperature
- humidity
- sweat rate if known
- session sequence / multi-session context

Returns:
- estimated fluid range
- estimated sodium range
- estimated carbohydrate range
- recovery / protein target where appropriate
- confidence
- methodology version
- notes / factors

### estimate_food
Input:
- user description
- optional image
- optional portion information

Returns:
- identified food
- estimated ranges
- confidence
- clarifying question if valuable

### save_actual_session
Input: user_id + actual session object

### save_recovery
Input: recovery object

### get_relevant_history
Input: user_id + similarity/context filters

Returns only relevant sessions / events.

### propose_memory_update
The AI may propose a memory candidate; application code validates and persists it.

## Context package example

Built by `src/agent/context.ts` and serialized into both the interpret and
compose prompts (`src/agent/anthropic-llm.ts`). Never the whole history — a
compact package the turn plausibly needs.

GOAL
- "First Olympic-distance triathlon in June" (event_date if known)

PROFILE (self-reported)
- weight: 64kg  (may be null — collected contextually)
- sports: running, cycling, swimming, strength
- bottle: 750ml

CURRENT WEEK PLAN + pending_plan_details (sessions still missing effort/length/time)

CURRENT / LAST SESSION
- current_plan (next upcoming) · last_actual_session

HISTORY  (recent, all sports — deeper lookups via get_relevant_history)
- recent_sessions: date, sport, status, distance/duration, intensity, reason
- recent_recovery: date, the athlete's words, coarse severity, symptoms
- recent_fuel: date, items (description, quantity, known label values, certainty)

MEMORIES
- durable facts the athlete has told Kona (next_race, typical_week, preferences)

## Agent loop

1. Receive message.
2. Determine conversation state / user intent.
3. Build relevant context.
4. Decide whether clarification is needed.
5. Call tools as needed.
6. Validate outputs.
7. Compose concise user-facing response.
8. Propose durable memory updates if appropriate.
9. Persist conversation and structured changes.

## No vector database in V1
Structured SQL retrieval is enough initially.

Semantic search can be introduced later if conversation-derived memory becomes large.
