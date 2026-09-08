'use client';

import { useState } from 'react';

const SPORTS: { value: string; label: string }[] = [
  { value: 'running', label: 'Running' },
  { value: 'cycling', label: 'Cycling' },
  { value: 'swimming', label: 'Swimming' },
  { value: 'triathlon', label: 'Triathlon' },
  { value: 'gym', label: 'Strength' },
];

const GENDERS: { value: string; label: string }[] = [
  { value: '', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
];

export interface ProfileValues {
  username?: string;
  goal?: { text: string; event_date?: string };
  gender?: string;
  age?: number;
  body_weight_kg?: number;
  usual_bottle_ml?: number;
  usual_sports?: string[];
  typical_weekly_sessions?: number;
  recent_injuries_note?: string;
}

interface FormState {
  username: string;
  goal_text: string;
  gender: string;
  age: string;
  body_weight_kg: string;
  usual_bottle_ml: string;
  usual_sports: string[];
  typical_weekly_sessions: string;
  recent_injuries_note: string;
}

function toState(v: ProfileValues): FormState {
  return {
    username: v.username ?? '',
    goal_text: v.goal?.text ?? '',
    gender: v.gender ?? '',
    age: v.age?.toString() ?? '',
    body_weight_kg: v.body_weight_kg?.toString() ?? '',
    usual_bottle_ml: v.usual_bottle_ml?.toString() ?? '',
    usual_sports: v.usual_sports ?? [],
    typical_weekly_sessions: v.typical_weekly_sessions?.toString() ?? '',
    recent_injuries_note: v.recent_injuries_note ?? '',
  };
}

export default function ProfileForm({
  mode = 'settings',
  initial = {},
  submitLabel,
  onSaved,
}: {
  mode?: 'onboard' | 'settings';
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
    setSavedMsg('');
    setSaving(true);

    const body: Record<string, unknown> = {
      username: form.username,
      usual_sports: form.usual_sports,
      goal: form.goal_text.trim() || undefined,
    };
    if (mode === 'settings') {
      body.gender = form.gender || undefined;
      body.age = form.age ? Number(form.age) : undefined;
      body.body_weight_kg = form.body_weight_kg ? Number(form.body_weight_kg) : undefined;
      body.usual_bottle_ml = form.usual_bottle_ml ? Number(form.usual_bottle_ml) : undefined;
      body.typical_weekly_sessions = form.typical_weekly_sessions
        ? Number(form.typical_weekly_sessions)
        : undefined;
      body.recent_injuries_note = form.recent_injuries_note || undefined;
    }

    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
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
        <label htmlFor="username">Your name</label>
        <input
          id="username"
          value={form.username}
          onChange={(e) => set('username', e.target.value)}
          maxLength={40}
          required
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Which do you train?</label>
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
        <label htmlFor="goal">
          What are you working towards? <span className="hint">a race, an event, or just staying consistent</span>
        </label>
        <input
          id="goal"
          value={form.goal_text}
          onChange={(e) => set('goal_text', e.target.value)}
          maxLength={200}
          placeholder="e.g. First half-marathon in March — or just keeping the habit"
          autoComplete="off"
        />
      </div>

      {mode === 'settings' && (
        <>
          <div className="field-row">
            <div className="field">
              <label htmlFor="weight">
                Body weight (kg) <span className="hint">optional</span>
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
              />
            </div>
            <div className="field">
              <label htmlFor="bottle">
                Usual bottle (ml) <span className="hint">optional</span>
              </label>
              <input
                id="bottle"
                type="number"
                inputMode="numeric"
                min={100}
                max={3000}
                value={form.usual_bottle_ml}
                onChange={(e) => set('usual_bottle_ml', e.target.value)}
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="sessions">
                Sessions / week <span className="hint">optional</span>
              </label>
              <input
                id="sessions"
                type="number"
                inputMode="numeric"
                min={0}
                max={40}
                value={form.typical_weekly_sessions}
                onChange={(e) => set('typical_weekly_sessions', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="age">
                Age <span className="hint">optional</span>
              </label>
              <input
                id="age"
                type="number"
                inputMode="numeric"
                min={12}
                max={100}
                value={form.age}
                onChange={(e) => set('age', e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="gender">
              Gender <span className="hint">optional</span>
            </label>
            <select id="gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="injuries">
              Any injuries or niggles right now? <span className="hint">optional</span>
            </label>
            <textarea
              id="injuries"
              rows={2}
              maxLength={500}
              placeholder="e.g. left hip tight after long runs — or leave blank"
              value={form.recent_injuries_note}
              onChange={(e) => set('recent_injuries_note', e.target.value)}
            />
          </div>
        </>
      )}

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
