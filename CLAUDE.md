# KONA — Instructions for Claude Code

## Role
You are the primary engineering partner for Kona, a side-project web application.

Kona is an AI training-fueling companion for recreational athletes.

You are expected to implement the product, not merely describe implementation, while keeping scope small and maintainable.

## Product source of truth
Read these files before making substantive changes:
- PRODUCT_VISION.md
- ARCHITECTURE.md
- CALCULATION_ENGINE_SPEC.md
- AGENT_SPEC.md

If the codebase conflicts with these documents, explain the conflict and update the relevant documentation before making a large architectural change.

## Working principles
1. Build the smallest complete version of the requested feature.
2. Do not invent product requirements.
3. Do not add integrations or abstractions for hypothetical future requirements.
4. Investigate the existing code before changing it.
5. Keep numerical calculations deterministic and testable.
6. Never let the LLM invent fueling numbers.
7. Never make medical diagnoses.
8. Preserve planned vs actual workouts as separate facts.
9. Treat estimates as estimates.
10. Keep user-facing conversation natural and concise.

## Before substantive work
- Inspect the relevant files.
- Check git status.
- Read the relevant product/spec sections.
- State the implementation target briefly.

## Implementation requirements
- TypeScript with strict typing.
- Clear separation between UI, data access, agent orchestration, calculation engine, and recommendation rules.
- Unit tests for calculations and critical business rules.
- Integration tests for the core conversation loop where practical.
- Validate external/user input at boundaries.
- Never hard-code test-specific results into production logic.
- Use environment variables for secrets.
- Never expose API keys in client-side code.

## Agent behaviour
The LLM is an orchestrator, not the source of truth.

It may:
- interpret natural language
- ask clarifying questions
- choose tools
- explain tool outputs
- propose memory updates

It may not:
- invent numerical fueling targets
- overwrite structured facts based on assumptions
- diagnose medical conditions
- turn estimates into facts

## Testing discipline
Create and maintain a structured acceptance-test file such as `tests/acceptance-scenarios.md` or `tests.json`.

Do not delete or weaken tests simply to make the suite pass.

Run tests after meaningful changes.

For UI changes, run the app and manually verify the primary flow where browser tooling is available.

## State tracking
Maintain `progress.md` with:
- current milestone
- completed work
- known issues
- next recommended task

Use git commits as checkpoints.

## Scope control
Do not build these in V1 unless explicitly requested:
- Garmin
- Strava
- Apple Health
- wearable apps
- food barcode scanning
- social features
- race planner
- marketplace
- native mobile app
- vector database
- multi-agent architecture

## Product quality rule
If a feature can be implemented with one straightforward function, do not create a framework for it.

Prefer simple, direct code over clever abstractions.

## Safety rule
Kona is a wellness/training tool, not a medical device or professional clinical service.

When a user reports potentially concerning symptoms, the assistant should not diagnose the cause. The application should encourage appropriate professional medical evaluation when warranted.

## Current goal
Build a working vertical slice:

User says:
> “Tomorrow I’m doing an 18km run at 6am.”

Kona should:
1. parse the planned session
2. save it
3. calculate relevant fueling guidance via deterministic tools
4. provide practical preparation advice

Then support:
- plan change
- actual workout logging
- food logging
- recovery check-in
- next-session recommendation
- memory update

Do this before expanding scope.
