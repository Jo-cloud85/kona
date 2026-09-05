'use client';

import { useState } from 'react';

const SPORTS: { value: string; label: string }[] = [
  { value: 'running', label: 'Running' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'gym', label: 'Gym' },
  { value: 'climbing', label: 'Climbing' },
];

const GENDERS: { value: string; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

const SCALES: { key: 'sleep_quality' | 'hydration' | 'sweat_level'; label: string; hint: string }[] = [
  { key: 'sleep_quality', label: 'Sleep quality', hint: '5 = excellent' },
  { key: 'hydration', label: 'Hydration', hint: '5 = excellent' },
  { key: 'sweat_level', label: 'Sweat level', hint: '5 = a lot / excessive' },
];

interface FormState {
  username: string;
  gender: string;
  age: string;
  body_weight_kg: string;
  usual_sports: string[];
  typical_weekly_sessions: string;
  recent_injuries_note: string;
  self_perception: { sleep_quality: number; hydration: number; sweat_level: number };
}

const EMPTY: FormState = {
  username: '',
  gender: '',
  age: '',
  body_weight_kg: '',
  usual_sports: [],
  typical_weekly_sessions: '',
  recent_injuries_note: '',
  self_perception: { sleep_quality: 3, hydration: 3, sweat_level: 3 },
};

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [started, setStarted] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleSport = (value: string) =>
    setForm((f) => ({
      ...f,
      usual_sports: f.usual_sports.includes(value)
        ? f.usual_sports.filter((s) => s !== value)
        : [...f.usual_sports, value],
    }));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError('');
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: form.username,
          gender: form.gender,
          age: Number(form.age),
          body_weight_kg: Number(form.body_weight_kg),
          usual_sports: form.usual_sports,
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
      onDone();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!started) {
    return (
      <div className="app">
        <div className="landing">
          <h1>Kona</h1>
          <p className="tagline">Your AI fueling companion for training.</p>
          <p className="blurb">
            Plan your fueling, tell Kona what actually happened, and get practical advice for next time.
            First, a few things so the advice fits you.
          </p>
          <button className="cta" onClick={() => setStarted(true)}>
            Get started
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="landing">
        <h1>A bit about you</h1>
        <p className="blurb">Kona uses this as background — you can refine anything later in conversation.</p>
      </div>

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
          <div className="field">
            <label htmlFor="weight">
              Body weight (kg) <span className="hint">for protein targets</span>
            </label>
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
          <label>Types of workout each week</label>
          <div className="sports">
            {SPORTS.map((s) => (
              <label key={s.value} className={`chip${form.usual_sports.includes(s.value) ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={form.usual_sports.includes(s.value)}
                  onChange={() => toggleSport(s.value)}
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
                    onClick={() =>
                      set('self_perception', { ...form.self_perception, [sc.key]: n })
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="cta" disabled={saving}>
            {saving ? 'Saving…' : 'Start with Kona'}
          </button>
        </div>
      </form>
    </div>
  );
}
