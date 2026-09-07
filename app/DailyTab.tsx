'use client';

import { useEffect, useState } from 'react';

interface Range {
  min: number;
  max: number;
}
interface MacroIdeas {
  macro: string;
  label: string;
  target_g: Range;
  per_kg?: Range;
  items: { name: string; amount_g: number }[];
}
interface DailyPlan {
  nutrition: {
    energy_kcal: Range;
    activity_level: string;
    confidence: string;
    assumptions: string[];
    methodology_version: string;
  };
  macros: MacroIdeas[];
  fluid_text: string;
  sodium_text: string;
  note: string;
}

const UNIT: Record<string, string> = { protein: 'g', carb: 'g', fat: 'g', fibre: 'g' };

export default function DailyTab() {
  const [data, setData] = useState<DailyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/daily')
      .then((r) => r.json())
      .then((d: { daily: DailyPlan | null }) => setData(d.daily))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <div className="dash">
    <p className="dash-msg">Loading…</p>
  </div>;
  if (!data)
    return (
      <div className="dash">
        <p className="dash-msg">Finish onboarding first — the Daily tab is built from your profile.</p>
      </div>
    );

  const kcal = data.nutrition.energy_kcal;

  return (
    <div className="dash">
      <header className="dash-head">
        <h1>Your day</h1>
        <p className="dash-sub">
          activity: {data.nutrition.activity_level.replace('_', ' ')} · confidence: {data.nutrition.confidence} ·
          methodology v{data.nutrition.methodology_version}
        </p>
      </header>

      <div className="kpi-row">
        <div className="kpi">
          <span className="kpi-label">Energy</span>
          <span className="kpi-value">
            {kcal.min.toLocaleString()}–{kcal.max.toLocaleString()}
            <span className="kpi-unit"> kcal</span>
          </span>
          <span className="kpi-note">estimated daily total (Mifflin–St Jeor × activity)</span>
        </div>
      </div>

      {data.macros.map((m) => (
        <section key={m.macro} className="macro">
          <div className="macro-head">
            <span className="macro-name">{m.label}</span>
            <span className="macro-target">
              {m.target_g.min === m.target_g.max ? `~${m.target_g.min}` : `${m.target_g.min}–${m.target_g.max}`}{' '}
              {UNIT[m.macro] ?? 'g'}
              {m.per_kg ? <span className="muted"> · {m.per_kg.min}–{m.per_kg.max} g/kg</span> : null}
            </span>
          </div>
          <ul className="food-list">
            {m.items.map((it) => (
              <li key={it.name}>
                <span>{it.name}</span>
                <span className="food-amt">
                  {it.amount_g} {UNIT[m.macro] ?? 'g'}
                </span>
              </li>
            ))}
          </ul>
          <p className="macro-hint">Mix and match to land near the range — these are examples, not a checklist.</p>
        </section>
      ))}

      <div className="callout">
        <strong>Fluid</strong> — {data.fluid_text}
      </div>
      <div className="callout">
        <strong>Sodium</strong> — {data.sodium_text}
      </div>

      <p className="dash-foot">{data.note}</p>
      {data.nutrition.assumptions.length > 0 && (
        <p className="dash-foot">Assumptions: {data.nutrition.assumptions.join(' ')}</p>
      )}
      <p className="dash-foot">
        Kona is a wellness tool, not a dietitian. If you have medical conditions or specific goals, get individual
        advice.
      </p>
    </div>
  );
}
