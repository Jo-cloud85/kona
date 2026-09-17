import { describe, expect, it } from 'vitest';
import { validateProfileInput } from '../../src/domain/profile-input';

// The 2026 reset: onboarding only requires a name + at least one sport.
const onboarding = {
  username: 'joan',
  usual_sports: ['running', 'swimming'],
  goals: [{ text: 'First half-marathon in March' }],
};

describe('validateProfileInput', () => {
  it('accepts a minimal onboarding form (name + sports + goal text)', () => {
    const r = validateProfileInput(onboarding);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      username: 'joan',
      usual_sports: ['running', 'swimming'],
      goals: [{ text: 'First half-marathon in March' }],
    });
    // nothing else is required or invented
    expect(r.data.body_weight_kg).toBeUndefined();
    expect(r.data.gender).toBeUndefined();
  });

  it('accepts no goal at all', () => {
    const r = validateProfileInput({ username: 'sam', usual_sports: ['cycling'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.goals).toBeUndefined();
  });

  it('accepts the fuller settings form and trims / normalises', () => {
    const r = validateProfileInput({
      ...onboarding,
      gender: 'female',
      age: 34,
      body_weight_kg: 58,
      usual_bottle_ml: 750,
      typical_weekly_sessions: 6,
      recent_injuries_note: '  left hip tight after long runs  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      gender: 'female',
      age: 34,
      body_weight_kg: 58,
      usual_bottle_ml: 750,
      typical_weekly_sessions: 6,
      recent_injuries_note: 'left hip tight after long runs',
    });
  });

  it('omits an empty injury note and drops a goal with blank text', () => {
    const r = validateProfileInput({ ...onboarding, goals: [{ text: '   ' }], recent_injuries_note: '   ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect('recent_injuries_note' in r.data).toBe(false);
    expect(r.data.goals).toBeUndefined();
  });

  it('accepts a structured goal with an explicit event date', () => {
    const r = validateProfileInput({ ...onboarding, goals: [{ text: 'Chicago Marathon', event_date: '2026-10-11' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.goals).toEqual([{ text: 'Chicago Marathon', event_date: '2026-10-11' }]);
  });

  it('never infers an event date from free text — only an explicit date is kept (M27.1)', () => {
    const r = validateProfileInput({ ...onboarding, goals: [{ text: 'Race in 3 weeks' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.goals).toEqual([{ text: 'Race in 3 weeks' }]);
  });

  it('caps goals at 3', () => {
    const r = validateProfileInput({
      ...onboarding,
      goals: [{ text: 'Goal 1' }, { text: 'Goal 2' }, { text: 'Goal 3' }, { text: 'Goal 4' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.goals).toEqual([{ text: 'Goal 1' }, { text: 'Goal 2' }, { text: 'Goal 3' }]);
  });

  it.each([
    [{ username: '' }, /username/i],
    [{ username: 'x'.repeat(41) }, /username/i],
    [{ usual_sports: [] }, /at least one/i],
    [{ usual_sports: ['jetski'] }, /at least one/i],
    [{ gender: 'yes' }, /gender/i],
    [{ age: 8 }, /age/i],
    [{ age: 34.5 }, /age/i],
    [{ body_weight_kg: 10 }, /weight/i],
    [{ body_weight_kg: 400 }, /weight/i],
    [{ usual_bottle_ml: 50 }, /bottle/i],
    [{ typical_weekly_sessions: 99 }, /sessions per week/i],
  ])('rejects %o', (patch, message) => {
    const r = validateProfileInput({ ...onboarding, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('rejects a non-object', () => {
    expect(validateProfileInput(null).ok).toBe(false);
    expect(validateProfileInput('hi').ok).toBe(false);
  });

  it('dedupes sports and drops unknown / non-endurance ones', () => {
    const r = validateProfileInput({
      ...onboarding,
      usual_sports: ['running', 'running', 'triathlon', 'climbing', 'bogus'],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.usual_sports).toEqual(['running', 'triathlon']);
  });
});
