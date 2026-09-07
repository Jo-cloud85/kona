import { describe, expect, it } from 'vitest';
import { validateProfileInput } from '../../src/domain/profile-input';

const valid = {
  username: 'joan',
  gender: 'female',
  age: 34,
  height_cm: 168,
  body_weight_kg: 58,
  activity_level: 'moderate',
  usual_sports: ['running', 'swimming', 'gym'],
  dietary_restrictions: ['lactose_intolerant', 'no_beef'],
  typical_weekly_sessions: 6,
  recent_injuries_note: '  left hip tight after long runs  ',
  self_perception: { sleep_quality: 4, hydration: 3, sweat_level: 5 },
};

describe('validateProfileInput', () => {
  it('accepts a complete form and trims / normalises', () => {
    const r = validateProfileInput(valid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({
      username: 'joan',
      gender: 'female',
      age: 34,
      height_cm: 168,
      body_weight_kg: 58,
      activity_level: 'moderate',
      typical_weekly_sessions: 6,
      recent_injuries_note: 'left hip tight after long runs',
      self_perception: { sleep_quality: 4, hydration: 3, sweat_level: 5 },
    });
    expect(r.data.usual_sports).toEqual(['running', 'swimming', 'gym']);
    expect(r.data.dietary_restrictions).toEqual(['lactose_intolerant', 'no_beef']);
  });

  it('omits an empty injury note', () => {
    const r = validateProfileInput({ ...valid, recent_injuries_note: '   ' });
    expect(r.ok && 'recent_injuries_note' in r.data).toBe(false);
  });

  it.each([
    [{ username: '' }, /username/i],
    [{ username: 'x'.repeat(41) }, /username/i],
    [{ gender: 'yes' }, /gender/i],
    [{ age: 8 }, /age/i],
    [{ age: 34.5 }, /age/i],
    [{ height_cm: 90 }, /height/i],
    [{ height_cm: undefined }, /height/i],
    [{ activity_level: 'couch' }, /activity level/i],
    [{ activity_level: undefined }, /activity level/i],
    [{ body_weight_kg: 10 }, /weight/i],
    [{ body_weight_kg: 400 }, /weight/i],
    [{ usual_sports: [] }, /at least one/i],
    [{ usual_sports: ['jetski'] }, /at least one/i],
    [{ typical_weekly_sessions: 99 }, /sessions per week/i],
    [{ self_perception: { sleep_quality: 4, hydration: 3, sweat_level: 6 } }, /1 to 5/i],
    [{ self_perception: { sleep_quality: 4, hydration: 3 } }, /1 to 5/i],
  ])('rejects %o', (patch, message) => {
    const r = validateProfileInput({ ...valid, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });

  it('rejects a non-object', () => {
    expect(validateProfileInput(null).ok).toBe(false);
    expect(validateProfileInput('hi').ok).toBe(false);
  });

  it('dedupes sports and drops unknown ones', () => {
    const r = validateProfileInput({ ...valid, usual_sports: ['running', 'running', 'gym', 'bogus'] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.usual_sports).toEqual(['running', 'gym']);
  });
});
