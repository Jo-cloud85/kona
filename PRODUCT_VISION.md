# KONA — Product Vision & MVP Brief

## Working name
**Kona**

Suggested positioning:
> **Your AI fueling companion for training.**

Possible supporting line:
> Plan your fueling. Tell Kona what actually happened. Let it remember, learn, and help you prepare for the next workout.

## What Kona is
Kona is a chat-first AI companion for recreational athletes who train frequently across one or more sports (running, cycling, swimming, gym/strength, HYROX, triathlon, etc.).

Kona translates messy real-world training stories into structured data, uses a deterministic fueling/recovery engine for calculations, and turns the results into practical conversational recommendations.

## What Kona is NOT
- Not a medical advisor.
- Not a dietitian replacement.
- Not a generic calorie-counting app.
- Not a generic food database.
- Not a Garmin/Strava replacement.
- Not an opaque “AI nutrition expert” that invents precise numbers.

## Core product loop
**Plan → Talk → Do → Check in → Adapt → Remember**

1. User plans a week or a workout.
2. Kona interprets the plan and identifies sessions that deserve more preparation.
3. User trains.
4. User tells Kona what actually happened, in natural language.
5. Kona asks only the minimum useful follow-up questions.
6. Kona compares planned vs actual training and fueling.
7. User reports recovery, fatigue, cramps, pain, sleep, and perceived effort in natural language.
8. Kona provides practical post-workout guidance and preparation suggestions for the next similar session.
9. Kona stores durable, useful memories.
10. Over time, Kona can surface personal patterns without claiming causation.

## Key insight
Humans think in stories, not nutrition tables.

Example:
> “I ran 10km at 5pm and it was really hot. Normally I can do 10–12km at 6am without water, but today I was thirsty by 4km.”

Kona should turn that into structured context such as:
- sport: running
- distance: 10km
- time: 5pm
- environment: hot/humid if known
- comparison: user usually runs at 6am
- symptom: early thirst
- cramps: none reported

The user should not need to manually fill a long form.

## Precision philosophy
Use precision where it is cheap and estimation where precision is annoying.

### Known / exact
- Packaged product nutrition labels
- 750ml bottle
- 24g protein shake
- 1 SIS gel when its nutrition is known

### Estimated / approximate
- Chicken rice
- “A bowl of noodles”
- “About half my bottle”
- “A normal serving of chicken”

Kona should use ranges when appropriate and clearly label estimates.

## Target user
Primary persona:
- Adult recreational athlete
- Usually training 4–8+ times per week
- Often cross-trains
- Wants to perform and recover better
- Understands basic nutrition concepts but does not want to measure every gram
- May experience under-fueling, dehydration, fatigue, cramps, or poor recovery
- Values convenience and remembers what worked before

Psychological statement:
> “I know I should fuel properly. I just don’t want to think about it all the time.”

## Example sports
- Running
- Cycling
- Swimming
- Gym / strength training
- HYROX
- Triathlon
- Other high-volume recreational training

## Primary product differentiation
Kona is not merely a fueling calculator.

It is a longitudinal context and memory layer around the athlete:

**Generic app:** “Here is your fueling target.”

**Kona:** “Last time you did a similar hot evening run, you became thirsty unusually early. You normally tolerate your 6am runs without water. For today, I’d prepare differently.”

## Planned vs actual training
This is core.

A planned 18km run that becomes a 10km run due to hip discomfort must preserve both facts:
- planned: 18km
- actual: 10km
- status: modified
- reason: left hip discomfort

Kona must never silently replace the plan with reality or vice versa.

## Recovery language
Avoid turning the user’s lived experience into meaningless analytics.

Bad:
> “Your fatigue was 28% higher.”

Better:
> “Today sounded much harder than usual.”

Better still:
> “You said both legs cramped badly and you were limping the next day. I’d keep that as a significant event in your training history and avoid assuming nutrition was the only cause.”

Structured severity can still exist in the database, but the primary user interface should speak human.

## Weekly planning
User can tell Kona:
> “Monday gym, Tuesday 8km run, Wednesday swim, Thursday rest, Friday bike + run, Sunday long run.”

Kona should:
1. Parse the plan.
2. Save the plan.
3. Identify double-session days and longer/harder sessions.
4. Calculate relevant fueling priorities.
5. Suggest preparation ahead of key sessions.
6. Remember the plan so later conversations can compare actual vs planned.

Preparation advice is practical, not rigid. Example:
> “Friday is your bigger fueling day because you have a double session. I’d prepare your fluids and an easy carbohydrate option the night before, and have a proper recovery meal available after the second session.”

## Food interaction
Kona should support three levels:

### Lazy mode
> “Had chicken rice.”

Kona estimates a reasonable range and labels it as estimated.

### Assisted mode
> “Had chicken rice, normal portion, extra chicken.”

Kona improves the estimate.

### Exact mode
> “1 SIS gel + 750ml water + protein shake.”

Kona records known product values where available.

## Food photo
User can upload a meal photo.

Kona may:
1. Identify likely foods.
2. Estimate likely portions.
3. Ask at most one or two high-value clarifying questions.
4. Return ranges rather than false precision.
5. Save the meal with a certainty level.

## Fueling categories
Separate categories by context rather than forcing one universal score.

### During training
- Fluid
- Sodium / electrolytes
- Carbohydrate

### Daily recovery
- Protein
- Food / meals
- Sleep
- General recovery

## No magical “Fuel Score” in V1
Avoid implying scientific precision with a single 0–100 score.

Prefer:
- estimated target range
- actual intake
- difference / coverage
- plain-language interpretation

## AI personality
Kona should feel like a calm, experienced, practical training-fueling friend.

Tone:
- calm
- encouraging
- non-judgmental
- practical
- concise
- remembers context

Avoid:
- “fitness bro” language
- excessive emojis
- lectures
- overconfident diagnosis
- fake certainty

## Safety
Kona must not diagnose injury, dehydration, nutrient deficiency, or the cause of symptoms.

It can say:
> “Your logged intake was below the estimated range.”

It should not say:
> “Your cramp was definitely caused by low sodium.”

When concerning symptoms are reported, Kona should move out of normal fueling-advice mode and encourage appropriate professional medical attention.

## Freemium concept
Free:
- Weekly plan
- Basic fueling recommendations
- Basic logging
- 3 workout “check-ins” per week

Pro target:
- Unlimited check-ins
- Longer history
- Personal trends
- Personal memory
- Advanced comparisons
- Food photo analysis
- Weekly summaries
- Saved products / meal shortcuts

Initial hypothesis:
- S$6.90/month
- S$59/year

Do not optimise pricing before validating repeat usage.

## What V1 should NOT build
- Apple Health integration
- Garmin integration
- Strava integration
- Apple Watch app
- Barcode scanning
- Huge food database
- Social feed
- Leaderboards
- Race-day planner
- Marketplace
- Shopping recommendations
- Automated supplement selling
- Native mobile app
- Autonomous notifications

## MVP success signal
The strongest early signal is repeated use:
- User completes first workout conversation.
- User comes back for workout #2.
- User comes back for workout #5.
- User wants Kona to remember their preferences.
- Some active users are willing to pay for ongoing memory and check-ins.

## Core acceptance-test scenarios
1. Planned 18km → actual 10km due to left hip discomfort.
2. Exact product logging: one SIS gel.
3. Vague meal: chicken rice.
4. Meal photo.
5. Hot 5pm run vs normal 6am run.
6. Successful 18km run should be treated as a successful baseline, not automatically criticised.
7. Swim → breakfast → rest → gym should be recognised as one training day with multiple sessions.
8. Bike + run after poor sleep should not automatically be blamed on fueling.
9. Cramp that is severe enough to cause next-day limping should be handled as a significant symptom event.
10. Menstrual-cycle context should be handled respectfully without overgeneralising nutrition claims.
