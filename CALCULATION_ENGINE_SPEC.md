# KONA — Calculation Engine Specification v0.1

## Status
**MVP implementation baseline — numerical methodology requires expert review before public launch.**

This specification is intentionally conservative. Kona is a training-fueling companion, not a medical or clinical nutrition system. Numerical outputs are estimates/ranges and must never be presented as exact physiological requirements.

## 1. Product principle

Kona should answer the user's practical question:

> **“Given what I’m doing, what should I prepare, what should I do during/after, and what should I learn for next time?”**

Kona should NOT answer:

> “What is the one exact amount of sodium/fluid/carbohydrate this person medically needs?”

The engine therefore produces:
- session classification
- fueling/hydration priorities
- estimated ranges where useful
- confidence
- evidence/methodology version
- practical recommendation inputs

The LLM is responsible for conversation and explanation. The calculation engine is responsible for numerical outputs.

---

# 2. Evidence posture

The calculation layer should be grounded in established sports-nutrition/hydration guidance and updated through versioned methodology.

Important evidence principles:

1. Sweat rate and sweat sodium vary substantially between people and across conditions; individualized monitoring is preferred over universal prescriptions.
2. Fluid plans should avoid both excessive dehydration and overdrinking. A commonly used safety anchor is to avoid gaining body mass during exercise and to limit substantial body-mass loss; exact targets are individualized.
3. For exercise lasting around >60 minutes, carbohydrate can become useful, with classic guidance around 30–60 g/hour for prolonged/intense exercise; higher intakes such as 60–90 g/hour are a later-stage option for prolonged endurance exercise and require individual tolerance/gut training rather than being the default.
4. Sodium should NOT be treated as a universal anti-cramp prescription. Exercise-associated cramps are multifactorial and are not reliably explained by dehydration/electrolyte loss alone.
5. Protein is primarily a daily recovery target. For healthy exercising adults, approximately 1.4–2.0 g/kg/day is a commonly cited range; a practical post-exercise serving can often be represented as approximately 20–40 g or around 0.25 g/kg, depending on context.
6. More aggressive post-exercise rehydration is relevant when rapid recovery is required and meaningful fluid loss occurred; it should not be automatically prescribed after every workout.

Primary reference set for v0.1:
- ACSM Position Stand: Exercise and Fluid Replacement (2007), PubMed PMID 17277604.
- ACSM/Academy of Nutrition and Dietetics/Dietitians of Canada: Nutrition and Athletic Performance (2016), PubMed PMID 26891166.
- International Society of Sports Nutrition: Protein and Exercise (2017 update), PubMed PMID 28642676.
- International Society of Sports Nutrition: Nutrient Timing (2017), PubMed PMID 28919842.
- National Athletic Trainers’ Association Position Statement: Fluid Replacement for the Physically Active (2017), PubMed PMID 28985128.
- Evidence-based review of exercise-associated muscle cramps (2022), PubMed PMID 34185846.
- Baker et al. review of sweating rate and sweat sodium variability (2017), PubMed PMID 28332116.
- McCubbin et al. modelling sodium requirements across exercise scenarios (2022), PubMed PMID 35616504.

---

# 3. Input model

## 3.1 User profile

Required:
- body_weight_kg

Optional:
- usual sports
- usual bottle volume
- typical weekly training frequency
- known sweat rate by environment
- known sweat sodium concentration
- preferred products/foods
- known product nutrition labels

## 3.2 Session input

- sport
- planned_or_actual
- date/time
- duration_minutes
- distance_km (optional)
- intensity: easy | moderate | hard | race
- sequence_index (for multi-session days)
- session_group_id (same-day linked sessions)
- pre_fed_state: fed | fasted | unknown
- notes

## 3.3 Environment

- temperature_c
- humidity_percent
- indoor_outdoor
- sun_exposure (optional)
- heat_acclimatization: unknown | partial | acclimatized

Environment data may be missing. Missing data reduces confidence rather than forcing a guessed value.

## 3.4 Actual intake

Exact known values:
- water/fluid_ml
- sodium_mg
- carbohydrate_g
- protein_g

Estimated values:
- min/max for foods or meals where exact values are unavailable

---

# 4. Session classification

The engine classifies a session before making recommendations.

## 4.1 Duration classes

- SHORT: <60 min
- MODERATE: 60–90 min
- LONG: >90–150 min
- VERY_LONG: >150 min

These are product buckets, not physiological boundaries.

## 4.2 Intensity classes

- EASY
- MODERATE
- HARD
- RACE

For ambiguous natural-language descriptions, the LLM asks a clarification only when it materially changes the recommendation.

## 4.3 Environment classes

- COOL_OR_NORMAL
- WARM
- HOT_HUMID
- UNKNOWN

MVP should use configurable thresholds rather than hard-coding a single global definition of “hot”. Local weather information may later be mapped into these classes.

## 4.4 Session priority

Each session receives 0–3 priority levels for:

- hydration_priority
- carbohydrate_priority
- sodium_priority
- recovery_priority
- preparation_priority

Example:

A 40-minute easy gym session in normal conditions:
- hydration: low
- carbohydrate during: low
- sodium during: low
- recovery: low/moderate
- preparation: low

A 110-minute hard run in hot/humid conditions:
- hydration: high
- carbohydrate during: high
- sodium: moderate/high depending on fluid plan and sweat information
- recovery: high
- preparation: high

---

# 5. Hydration engine

## 5.1 Preferred method: measured sweat rate

When the user has a reasonably trustworthy sweat-rate measurement for similar conditions:

### Sweat rate formula

`Sweat rate (L/h) = (pre_weight_kg - post_weight_kg + fluid_intake_L - urine_output_L) / duration_h`

Food/fluid ingestion and urine output should be included when known.

### Use

The measured rate is treated as a personal starting point for similar sessions, with context adjustment for:
- temperature
- humidity
- intensity
- duration
- acclimatization

Kona should describe this as an estimate, not a fixed prescription.

## 5.2 Fallback when sweat rate is unknown

Do NOT invent a personalized sweat rate.

For sessions where deliberate hydration planning is relevant, Kona may show a **planning range** based on established sports-hydration reference ranges, clearly labelled as a starting point rather than an individualized requirement.

MVP fallback reference range:
- approximately 0.4–0.8 L/hour for prolonged exercise, with higher/lower needs possible depending on the person and environment.

This range should be overridden by measured personal data when available.

## 5.3 Upper safety logic

Kona must never recommend drinking so aggressively that the user would be expected to gain body mass during exercise.

If actual intake suggests weight gain or likely overdrinking, Kona should explicitly flag that more fluid is not automatically better.

## 5.4 Post-workout hydration

If post-workout body-mass loss is known:

`fluid_deficit_L ≈ pre_weight_kg - post_weight_kg` with appropriate adjustment for intake/urine where known.

When rapid recovery is required, evidence supports replacing more than the measured fluid deficit over the recovery window because some ingested fluid is lost in urine. A common research strategy is ~150% of the measured loss, particularly with sodium-containing fluid, but this is an **aggressive recovery scenario**, not a default instruction.

If the user does not know their body-mass change, Kona should give practical guidance rather than invent a rehydration volume.

---

# 6. Sodium / electrolyte engine

## 6.1 Core rule

Do **not** make “sodium target” mandatory for every workout.

Sodium priority increases when one or more of these are present:
- prolonged exercise
- substantial sweating
- hot/humid environment
- high fluid intake during prolonged exercise
- repeated sessions with short recovery
- known high sweat sodium
- previous user-reported pattern that may make electrolytes worth considering

## 6.2 When sweat sodium is known

If the user has a measured sweat sodium concentration:

`estimated sodium loss (mg/h) = sweat_rate_L_per_h × sweat_sodium_mg_per_L`

Kona should show this as an **estimated loss**, not as a target that must be replaced 1:1.

The recommendation layer can suggest discussing/trying a replacement strategy appropriate to the session, with actual intake logged so the system can learn from the individual's response.

## 6.3 When sweat sodium is unknown

Kona should avoid pretending to know the user's sodium loss.

For prolonged sessions where an electrolyte drink is appropriate, the engine may use a **reference concentration** rather than an exact personal sodium loss target.

Historical ACSM guidance cites approximately 0.5–0.7 g sodium per litre of fluid for prolonged exercise. Use this only as a reference concentration and not as proof of individual sodium requirements.

Therefore the UI should prefer language such as:

> “A sodium-containing drink may be useful for this session.”

or:

> “A reasonable starting point is an electrolyte drink providing roughly 500–700 mg sodium per litre of fluid.”

rather than:

> “You need exactly 650 mg sodium per hour.”

## 6.4 Cramp safety rule

Never say or imply:

> “You cramped because you were low in sodium.”

Exercise-associated muscle cramps are multifactorial. Kona should capture:
- location
- severity
- duration
- exercise context
- fatigue/load
- hydration/fluid intake
- sodium intake if known

and later identify patterns cautiously.

Example:

> “Your last three severe calf-cramp episodes happened after high-fatigue sessions. Your sodium and fluid intake were also lower on two of those sessions. That’s a pattern worth watching, but it doesn’t establish a single cause.”

---

# 7. Carbohydrate engine

## 7.1 Short/easy sessions

For sessions under ~60 minutes, especially easy/moderate sessions:
- no mandatory during-session carbohydrate target
- prioritize normal meals and hydration according to context

## 7.2 Prolonged sessions

For prolonged or harder endurance exercise, MVP reference range:
- approximately 30–60 g carbohydrate/hour

This is consistent with established sports-nutrition guidance for prolonged exercise. cite replacement: PubMed 17277604 / 28919842

## 7.3 Higher carbohydrate intake

60–90 g/hour may be surfaced for sufficiently long endurance sessions when the user is experienced/tolerant and when gut training is relevant.

Do not default users to 90 g/hour simply because the session is long.

Do not surface >90 g/hour in MVP.

## 7.4 Practical translation

Kona should translate targets into food/product actions:

Example:

> “For this 2-hour run, your starting carbohydrate range is around 30–60 g/hour. Since you already tolerate SIS gels, one practical approach is to plan your gels around that range rather than trying to calculate every gram from your breakfast.”

---

# 8. Protein / recovery engine

Protein is treated primarily as a **daily** recovery target, not a mandatory during-workout target.

## 8.1 Daily reference range

For healthy exercising adults:

`protein_daily_g = body_weight_kg × 1.4–2.0 g/kg/day`

The app should explain that actual needs vary with training goals, body composition, energy intake and other factors.

## 8.2 Practical post-workout serving

For many active users, a practical reference serving can be represented as approximately:

`20–40 g protein`

or roughly:

`0.25 g/kg`

Use context rather than automatically issuing a protein prescription after every workout.

## 8.3 Priority increases when

- resistance training
- high-volume day
- repeated same-day sessions
- recent hard endurance session
- inadequate reported daily protein
- the user asks about recovery

---

# 9. Pre-workout / day-before engine

Kona should think in preparation steps, not nutrient lectures.

## Trigger: long session tomorrow

Possible actions:
- normal hydration across the day
- avoid arriving at the workout unusually dehydrated
- prepare fluids/electrolyte option
- prepare carbohydrate source if needed
- have a familiar recovery meal available
- avoid experimenting with several new products at once

## Trigger: double session tomorrow

Priority:
- preparation logistics
- fluids available
- convenient carbohydrate source
- post-first-session meal/snack
- recovery food ready for the second session

## Trigger: early-morning long session

Kona should emphasize practical preparation the night before:
- bottle ready
- gels/food ready
- breakfast decision made
- recovery meal available after

## Trigger: morning session (any) — pre-fuel

Every planned session carries a required `time_of_day` (`morning` /
`afternoon` / `evening`) — from a stated clock time or an explicit word, and
prompted for when missing (alongside type, intensity, and distance-or-duration).

When `time_of_day = morning`, Kona adds a pre-fuel line: the athlete has likely
NOT had a full breakfast, so suggest something small and easy to digest ~20–30
min before (a banana, a few dates, toast with jam/honey) rather than a full
meal. When `time_of_day = evening`, the athlete has eaten through the day — a
small carb snack ~1 h before is enough if it has been 3+ hours since eating.
These lines are qualitative preparation advice (`src/data/foods.ts` →
`PRE_FUEL_SNACKS`, restriction-filtered on the Home tab); they introduce no new
numbers.

## Trigger: known difficult conditions

Examples:
- hot/humid run
- previous cramp history
- previous dehydration symptoms

Kona should refer to the user's history while avoiding causal certainty.

---

# 10. Actual vs planned logic

This is core to Kona.

Store separately:
- planned_session
- actual_session

Example:

Planned:
- 18km run

Actual:
- 10km run
- stopped because left hip hurt

The post-workout recommendation MUST use the actual 10km session as the completed workout.

The plan should remain intact for historical comparison.

If the reason for modification is pain or injury, Kona should shift attention toward safety and not encourage compensatory training.

---

# 11. Multi-sport / multi-session logic

Sessions on the same day should be linked.

Example:

07:00 Swim 1km
09:00 Breakfast
15:00 Gym/core

The day receives a `multi_session = true` flag.

Recommendations should consider the recovery interval between sessions.

The same principle applies to:
- bike → run
- swim → gym
- run → strength
- multiple gym sessions

---

# 12. Sleep / recovery logic

Sleep is contextual data, not a nutrition diagnosis.

If the user reports poor sleep:

Kona may say:
> “Poor sleep can make a normal session feel harder. I wouldn’t assume fueling is the only reason today felt rough.”

Do not automatically increase calorie/carbohydrate recommendations based solely on poor sleep.

## End-of-day check-in

An optional structured "how did today go?" popup (feel / went-as-planned /
injuries-or-pains / free text). It is stored as a normal recovery log and passes
through the **same safety screen** (§18) as any recovery message. Kona does not
diagnose: a concerning elaboration is pointed at professional care, and "plan
didn't go as planned" is a nudge to describe the actual in chat — it does not
overwrite the planned session.

---

# 13. Menstrual-cycle context

Cycle information is optional user context.

Kona should not apply blanket rules such as:
> “Day 2 of your period means you need X more sodium/protein/carbohydrate.”

Instead:
- acknowledge the user's reported symptoms/energy
- adjust the planned session if the user chooses
- use actual workout duration/intensity and symptoms for fueling recommendations
- encourage professional advice for persistent, unusually severe or concerning menstrual symptoms

---

# 14. Food estimation engine

Food input can be:
- exact branded product
- typed meal
- photo

## Exact branded product

Use known label values.

Example:
`SIS gel → exact carbohydrate amount if the product/variant is known.`

## Ordinary meal

Return ranges.

Example:

`Chicken rice + egg`

→ protein: estimated range
→ carbohydrate: estimated range
→ sodium: estimated range or unknown

Do not create fake precision.

## Photo

The system should:
1. identify likely foods
2. estimate portion size
3. provide a range
4. ask one clarification only if it substantially improves the estimate
5. explicitly label the result as estimated

Example:
> “That looks like a normal bowl of chicken rice with an egg. I’d estimate the protein rather than pretend the photo lets me know the exact amount.”

---

# 15. “Known / Estimated / Reported / Recommended” labels

Every nutritional fact should carry an internal certainty type:

- `KNOWN`
- `ESTIMATED`
- `USER_REPORTED`
- `RECOMMENDED`

This should influence wording.

KNOWN:
> “Your shake contains 24g protein.”

ESTIMATED:
> “That meal likely provided roughly 25–35g protein.”

USER_REPORTED:
> “You reported feeling dehydrated around 4km.”

RECOMMENDED:
> “For your next similar run, I’d prepare a bottle beforehand.”

---

# 16. Confidence model

Every calculation returns:

- `high`
- `moderate`
- `low`

Suggested scoring:

### High
Required inputs known + user-specific measured sweat data or exact product label.

### Moderate
Most important inputs known but some personalization is estimated.

### Low
Important inputs missing and only broad reference assumptions are possible.

The UI should show confidence subtly and should not overwhelm the user.

---

# 17. Recommendation priority system

Every recommendation should include:

`priority = low | medium | high`

and:

`timing = day_before | pre_workout | during | immediately_after | later_today | next_session`

Example:

```json
{
  "priority": "high",
  "timing": "day_before",
  "category": "preparation",
  "action": "Prepare your usual 750ml bottle and an easy carbohydrate source",
  "reason_codes": ["long_session", "early_start"]
}
```

The LLM converts these structured recommendations into natural conversation.

---

# 18. Safety / escalation layer

Kona must have a hard safety layer before and after the LLM.

Potential escalation triggers include:
- chest pain
- fainting / loss of consciousness
- severe or worsening dizziness
- confusion
- severe shortness of breath
- repeated vomiting preventing fluid intake
- severe dehydration symptoms
- severe or persistent pain
- suspected significant injury
- symptoms that persist or worsen after exercise

Kona should not attempt to solve these conditions through fueling recommendations.

For injury-related input, do not recommend “making up” missed training.

---

# 19. Methodology versioning

All calculation outputs must include:

```json
{
  "methodology_version": "0.1.0",
  "calculated_at": "ISO-8601 timestamp",
  "confidence": "moderate",
  "source_ids": ["ACSM_FLUID_2007", "ISSN_CARB_2017"]
}
```

Any change to a numerical rule increments the methodology version.

---

# 20. MVP output contract

The main calculation tool should return:

```json
{
  "session_classification": {
    "duration_class": "LONG",
    "intensity_class": "MODERATE",
    "environment_class": "HOT_HUMID",
    "multi_session": false
  },
  "priorities": {
    "hydration": "HIGH",
    "carbohydrate": "HIGH",
    "sodium": "MODERATE",
    "recovery": "HIGH",
    "preparation": "HIGH"
  },
  "estimates": {
    "fluid_ml_per_hour": {
      "min": 500,
      "max": 800,
      "confidence": "low"
    },
    "carbohydrate_g_per_hour": {
      "min": 30,
      "max": 60,
      "confidence": "moderate"
    },
    "sodium": {
      "mode": "reference_concentration",
      "mg_per_litre": {
        "min": 500,
        "max": 700
      },
      "confidence": "low"
    }
  },
  "recovery": {
    "protein_daily_g_per_kg": {
      "min": 1.4,
      "max": 2.0
    },
    "post_workout_protein_reference_g": {
      "min": 20,
      "max": 40
    }
  },
  "recommendation_inputs": [],
  "warnings": [],
  "methodology_version": "0.1.0"
}
```

The numerical values above are **reference implementation placeholders** for coding/test scaffolding and require expert review before public use. The production engine should be driven from a versioned, reviewable rules table rather than hard-coded UI logic.

> Implementation note (methodology v0.1.0): the `fluid_ml_per_hour` example above shows `min: 500`, but §5.2 gives the fallback planning range as 0.4–0.8 L/hour. The implemented rules table (`src/rules/v0_1_0.ts`) follows §5.2 and uses **400–800 ml/hour**, since §5.2 is the substantive guidance. This example JSON is left unchanged as an illustrative shape only.

---

# 21. Unit tests

Minimum tests:

1. 40-min easy gym session → no mandatory carbohydrate target.
2. 50-min easy run in normal conditions → basic hydration guidance only.
3. 75-min hard run → carbohydrate planning becomes relevant.
4. 110-min moderate run → carbohydrate + hydration preparation.
5. 110-min run in hot/humid conditions → hydration priority increases.
6. Measured sweat rate overrides fallback hydration estimate.
7. Known sweat sodium changes sodium estimation mode from reference concentration to estimated loss.
8. User with no sweat data is never told an exact personal sodium-loss number.
9. Planned 18km but actual 10km → actual session used for post-workout calculation.
10. Swim + gym same day → multi-session logic activates.
11. Poor sleep → context is acknowledged, not interpreted as proof of under-fueling.
12. Severe cramp → symptom captured without causal diagnosis.
13. Exact labelled protein shake → known value preserved.
14. Vague meal → nutrient ranges, not false precision.
15. Photo meal → estimated range + uncertainty.
16. User reports weight gain during workout → no recommendation to increase fluid intake; flag potential overdrinking.
17. High-risk medical symptom → safety escalation.

---

# 22. Sources

ACSM. Exercise and Fluid Replacement. Med Sci Sports Exerc. 2007;39(2):377–390. PubMed PMID 17277604.
https://pubmed.ncbi.nlm.nih.gov/17277604/

Thomas DT, Erdman KA, Burke LM. Nutrition and Athletic Performance. Med Sci Sports Exerc. 2016;48(3):543–568. PubMed PMID 26891166.
https://pubmed.ncbi.nlm.nih.gov/26891166/

Jäger R et al. International Society of Sports Nutrition Position Stand: protein and exercise. J Int Soc Sports Nutr. 2017. PubMed PMID 28642676.
https://pubmed.ncbi.nlm.nih.gov/28642676/

Kerksick CM et al. International Society of Sports Nutrition position stand: nutrient timing. J Int Soc Sports Nutr. 2017. PubMed PMID 28919842.
https://pubmed.ncbi.nlm.nih.gov/28919842/

McDermott BP et al. National Athletic Trainers’ Association Position Statement: Fluid Replacement for the Physically Active. J Athl Train. 2017;52(9):877–895. PubMed PMID 28985128.
https://pubmed.ncbi.nlm.nih.gov/28985128/

Miller KC et al. An Evidence-Based Review of the Pathophysiology, Treatment, and Prevention of Exercise-Associated Muscle Cramps. J Athl Train. 2022;57(1):5–15. PubMed PMID 34185846.
https://pubmed.ncbi.nlm.nih.gov/34185846/

Baker LB. Sweating Rate and Sweat Sodium Concentration in Athletes: A Review of Methodology and Intra/Interindividual Variability. Sports Med. 2017;47(Suppl 1):111–128. PubMed PMID 28332116.
https://pubmed.ncbi.nlm.nih.gov/28332116/

McCubbin AJ et al. Modelling sodium requirements of athletes across a variety of exercise scenarios. PubMed PMID 35616504.
https://pubmed.ncbi.nlm.nih.gov/35616504/

---

# 23. Daily-nutrition methodology (v0.2.0 — added post-v0.1)

The v0.1 engine covers **training fuelling** (during/around sessions). A separate,
separately-versioned table (`src/rules/daily_v0_2_0.ts`, methodology `0.2.0`)
adds **whole-day targets** for the "Daily" tab. This broadens Kona past training
fuelling; it is still a wellness tool, not a clinical service, and every output is
a range with a confidence flag.

- **Energy**: Mifflin–St Jeor resting energy (PMID 2305711) × a whole-day
  activity factor (1.2 sedentary → 1.9 extra-active). Reported as a ±8 % range.
  Sex unspecified → the mean of the male/female equation constants (flagged).
- **Protein**: 1.4–2.0 g/kg/day (ISSN 2017).
- **Carbohydrate**: g/kg/day by activity level, 3–5 (light) to 8–10 (extra),
  per ACSM/AND 2016 (PMID 26891166).
- **Fat**: 20–35 % of energy (AMDR).
- **Fibre**: 14 g per 1000 kcal (US Dietary Guidelines / IOM).
- **Fluid**: adequate daily intake from drinks by sex (EFSA 2010: ~2.0 L women,
  ~2.5 L men), plus ~0.4–0.8 L per hour of exercise. Presented as "go by thirst",
  not a fixed number.
- **Sodium**: NOT a computed personal target (§6.4). Guidance only — adequate
  intake ~1.5 g/day, staying under ~2.3 g/day (NASEM 2019); heavy sweaters top up
  around sessions.

Food suggestions are **illustrative examples** of what a target looks like
(`src/data/foods.ts`, rounded reference values), filtered by the user's dietary
restrictions — never a prescribed meal plan.
