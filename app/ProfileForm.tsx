'use client';

import { useState } from 'react';

const SPORTS: { value: string; label: string }[] = [
  { value: 'running', label: 'Running' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'gym', label: 'Gym' },
  { value: 'climbing', label: 'Climbing' },
  { value: 'skating', label: 'Skating' },
  { value: 'combat_sports', label: 'Combat sports' },
  { value: 'hyrox', label: 'HYROX' },
];

const GENDERS: { value: string; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const ACTIVITY: { value: string; label: string; hint: string }[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'little or no exercise' },
  { value: 'light', label: 'Lightly active', hint: '1–3 sessions / week' },
  { value: 'moderate', label: 'Moderately active', hint: '3–5 sessions / week' },
  { value: 'very_active', label: 'Very active', hint: '6–7 sessions / week' },
  { value: 'extra_active', label: 'Extra active', hint: 'hard training daily / physical job' },
];

const DIET: { value: string; label: string }[] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'pescatarian', label: 'Pescatarian' },
  { value: 'no_beef', label: 'No beef' },
  { value: 'no_pork', label: 'No pork' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
  { value: 'dairy_free', label: 'Dairy-free' },
  { value: 'lactose_intolerant', label: 'Lactose-intolerant' },
  { value: 'gluten_free', label: 'Gluten-free' },
  { value: 'nut_allergy', label: 'Nut allergy' },
  { value: 'egg_free', label: 'Egg-free' },
  { value: 'soy_free', label: 'Soy-free' },
  { value: 'shellfish_allergy', label: 'Shellfish allergy' },
];

const SCALES: { key: 'sleep_quality' | 'hydration' | 'sweat_level'; label: string; hint: string }[] = [
  { key: 'sleep_quality', label: 'Sleep quality', hint: '5 = excellent' },
  { key: 'hydration', label: 'Hydration', hint: '5 = excellent' },
  { key: 'sweat_level', label: 'Sweat level', hint: '5 = a lot / excessive' },
];

export interface ProfileValues {
  username?: string;
  gender?: string;
  age?: number;
  height_cm?: number;
  body_weight_kg?: number;
  activity_level?: string;
  usual_sports?: string[];
  dietary_restrictions?: string[];
  typical_weekly_sessions?: number;
  recent_injuries_note?: string;
  self_perception?: { sleep_quality: number; hydration: number; sweat_level: number };
}

interface FormState {
  username: string;
  gender: string;
  age: string;
  height_cm: string;
  body_weight_kg: string;
  activity_level: string;
  usual_sports: string[];
  dietary_restrictions: string[];
  typical_weekly_sessions: string;
  recent_injuries_note: string;
  self_perception: { sleep_quality: number; hydration: number; sweat_level: number };
}

function toState(v: ProfileValues): FormState {
  return {
    username: v.username ?? '',
    gender: v.gender ?? '',
    age: v.age?.toString() ?? '',
    height_cm: v.height_cm?.toString() ?? '',
    body_weight_kg: v.body_weight_kg?.toString() ?? '',
    activity_level: v.activity_level ?? '',
    usual_sports: v.usual_sports ?? [],
    dietary_restrictions: v.dietary_restrictions ?? [],
    typical_weekly_sessions: v.typical_weekly_sessions?.toString() ?? '',
    recent_injuries_note: v.recent_injuries_note ?? '',
    self_perception: v.self_perception ?? { sleep_quality: 3, hydration: 3, sweat_level: 3 },
  };
}

export default function ProfileForm({
  initial = {},
  submitLabel,
  onSaved,
}: {
  initial?: ProfileValues;
  submitLabel: string;
  onSaved: (profile: ProfileValues) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toState(initial));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggle = (key: 'usual_sports' | 'dietary_restrictions', value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((s) => s !== value) : [...f[key], value],
    }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    setSavedMsg('');
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          gender: form.gender,
          age: Number(form.age),
          height_cm: Number(form.height_cm),
          body_weight_kg: Number(form.body_weight_kg),
          activity_level: form.activity_level,
          usual_sports: form.usual_sports,
          dietary_restrictions: form.dietary_restrictions,
          typical_weekly_sessions: Number(form.typical_weekly_sessions),
          recent_injuries_note: form.recent_injuries_note,
          self_perception: form.self_perception,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong — please check the form.');
        return;
      }
      setSavedMsg('Saved.');
      onSaved(data.profile);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          maxLength={40}
          required
          autoComplete="off"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="gender">Gender</label>
          <select id="gender" value={form.gender} onChange={(e) => set('gender', e.target.value)} required>
            <option value="" disabled>
              Choose…
            </option>
            {GENDERS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="age">Age</label>
          <input
            id="age"
            type="number"
            inputMode="numeric"
            min={12}
            max={100}
            value={form.age}
            onChange={(e) => set('age', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="height">Height (cm)</label>
          <input
            id="height"
            type="number"
            inputMode="numeric"
            min={120}
            max={230}
            value={form.height_cm}
            onChange={(e) => set('height_cm', e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="weight">Body weight (kg)</label>
          <input
            id="weight"
            type="number"
            inputMode="decimal"
            min={25}
            max={250}
            step="0.1"
            value={form.body_weight_kg}
            onChange={(e) => set('body_weight_kg', e.target.value)}
            required
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="activity">
          Activity level <span className="hint">for the daily energy estimate</span>
        </label>
        <select id="activity" value={form.activity_level} onChange={(e) => set('activity_level', e.target.value)} required>
          <option value="" disabled>
            Choose…
          </option>
          {ACTIVITY.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label} — {a.hint}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Types of workout each week</label>
        <div className="sports">
          {SPORTS.map((s) => (
            <label key={s.value} className={`chip${form.usual_sports.includes(s.value) ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={form.usual_sports.includes(s.value)}
                onChange={() => toggle('usual_sports', s.value)}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="sessions">Sessions per week (average)</label>
        <input
          id="sessions"
          type="number"
          inputMode="numeric"
          min={0}
          max={40}
          value={form.typical_weekly_sessions}
          onChange={(e) => set('typical_weekly_sessions', e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label>
          Dietary restrictions or preferences <span className="hint">optional — filters food suggestions</span>
        </label>
        <div className="sports">
          {DIET.map((d) => (
            <label key={d.value} className={`chip${form.dietary_restrictions.includes(d.value) ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={form.dietary_restrictions.includes(d.value)}
                onChange={() => toggle('dietary_restrictions', d.value)}
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="injuries">
          Any injuries or cramps in the last month? <span className="hint">optional</span>
        </label>
        <textarea
          id="injuries"
          rows={2}
          maxLength={500}
          placeholder="e.g. left hip tight after long runs, calf cramp on a hot day — or leave blank"
          value={form.recent_injuries_note}
          onChange={(e) => set('recent_injuries_note', e.target.value)}
        />
      </div>

      <div className="field">
        <label>On average, how would you rate…</label>
        {SCALES.map((sc) => (
          <div key={sc.key} className="scale-row">
            <span className="scale-label">
              {sc.label} <span className="hint">{sc.hint}</span>
            </span>
            <div className="scale" role="radiogroup" aria-label={sc.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={form.self_perception[sc.key] === n ? 'on' : ''}
                  aria-pressed={form.self_perception[sc.key] === n}
                  onClick={() => set('self_perception', { ...form.self_perception, [sc.key]: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      {savedMsg && <p className="form-saved">{savedMsg}</p>}

      <div className="form-actions">
        <button type="submit" className="cta" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
