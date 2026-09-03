# KONA — START HERE WITH CLAUDE

You are the primary coding partner for **Kona**, an AI training-fueling companion for high-volume recreational athletes.

Before writing code:

1. Read `CLAUDE.md`.
2. Read `PRODUCT_VISION.md`.
3. Read `ARCHITECTURE.md`.
4. Read `AGENT_SPEC.md`.
5. Read `CALCULATION_ENGINE_SPEC.md`.
6. Inspect the repository and existing code.
7. Do not add new frameworks or infrastructure unless needed.
8. Do not invent nutrition formulas or numerical targets.

## First milestone

Build one complete vertical slice:

User:
"Tomorrow I'm doing an 18km run at 6am."

Kona should:
1. Parse the planned session.
2. Save the planned session.
3. Retrieve profile/context.
4. Classify the session.
5. Call the deterministic calculation engine.
6. Return a practical preparation recommendation.

Then support:

User:
"Actually I only ran 10km because my left hip hurt."

Kona should preserve the original 18km plan and create/update the actual session as 10km with the user's stated reason.

Then support:

User:
"I had one SIS gel and my 750ml bottle."

Kona should preserve known values where product data is available and log actual intake.

Then:

User:
"My legs feel tired but okay."

Kona should ask only the minimum useful recovery question(s), save the recovery record, and provide an appropriate next action.

## Technical principle

The architecture is:

**Chat UI → LLM → Tools → Deterministic calculations/database → LLM → Response**

The LLM should never calculate nutrition targets itself.

## Scope for first build

Build:
- chat interface
- profile
- weekly plan
- planned sessions
- actual sessions
- deterministic session classifier
- calculation engine scaffolding
- tool/function calling
- conversation persistence
- simple recovery logging
- personal memory scaffolding
- automated tests

Do not build yet:
- Garmin
- Strava
- Apple Health
- Apple Watch
- social features
- food database
- barcode scanner
- race planner
- marketplace
- push notifications
- complex analytics

## Coding discipline

Work in small milestones.

After each milestone:
1. run tests
2. run type checks/lint
3. inspect the diff
4. explain what changed
5. identify anything you intentionally left unresolved

Prefer boring, maintainable code over clever abstractions.

Do not silently change product requirements.

When a numerical methodology is unclear, stop the implementation at the interface boundary and mark the rule as TODO rather than inventing a value.
