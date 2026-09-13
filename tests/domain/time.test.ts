import { describe, expect, it } from 'vitest';
import { athleteNow, localDateOf, safeTz } from '../../src/domain/time';

describe('safeTz', () => {
  it('passes through a valid IANA zone', () => {
    expect(safeTz('Asia/Singapore')).toBe('Asia/Singapore');
    expect(safeTz('America/New_York')).toBe('America/New_York');
  });

  it('falls back to UTC for missing or invalid input, never throws', () => {
    expect(safeTz(undefined)).toBe('UTC');
    expect(safeTz(null)).toBe('UTC');
    expect(safeTz('')).toBe('UTC');
    expect(safeTz('not/a/real/zone')).toBe('UTC');
    expect(safeTz('<script>')).toBe('UTC');
  });
});

describe('athleteNow', () => {
  it('reproduces the exact live bug: 00:20 SGT is still 2026-09-13 in UTC, but is 2026-09-14 for the athlete', () => {
    // 2026-09-13T16:20:00Z == 2026-09-14T00:20:00+08:00.
    const realInstant = new Date('2026-09-13T16:20:00.000Z');

    const utcToday = realInstant.toISOString().slice(0, 10);
    expect(utcToday).toBe('2026-09-13'); // the bug: naive UTC read gives the wrong day

    const athleteLocal = athleteNow('Asia/Singapore', realInstant);
    expect(athleteLocal.getFullYear()).toBe(2026);
    expect(athleteLocal.getMonth()).toBe(8); // 0-based: September
    expect(athleteLocal.getDate()).toBe(14);
    expect(athleteLocal.getHours()).toBe(0);
    expect(athleteLocal.getMinutes()).toBe(20);
  });

  it('round-trips correctly for a timezone behind UTC too (negative offset)', () => {
    // 2026-09-13T23:40:00Z == 2026-09-13T19:40:00-04:00 (America/New_York, EDT).
    const realInstant = new Date('2026-09-13T23:40:00.000Z');
    const local = athleteNow('America/New_York', realInstant);
    expect(local.getDate()).toBe(13);
    expect(local.getHours()).toBe(19);
    expect(local.getMinutes()).toBe(40);
  });

  it('an invalid timezone falls back to UTC instead of throwing', () => {
    const realInstant = new Date('2026-09-13T16:20:00.000Z');
    const local = athleteNow('not/a/real/zone', realInstant);
    expect(local.getDate()).toBe(13); // UTC date, the safe fallback
    expect(local.getHours()).toBe(16);
  });

  it('what buildHome/buildWeek actually consume — local getters — agree with the athlete’s wall clock', () => {
    const realInstant = new Date('2026-09-13T16:20:00.000Z');
    const local = athleteNow('Asia/Singapore', realInstant);
    // Same pattern src/agent/home.ts's isoDate() uses.
    const isoDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(isoDate).toBe('2026-09-14');
  });
});

describe('localDateOf', () => {
  it('buckets a stored UTC instant by the athlete’s local calendar day, not the UTC day', () => {
    const stored = '2026-09-13T16:20:00.000Z'; // logged_at, e.g. a recovery log
    expect(localDateOf(stored, 'Asia/Singapore')).toBe('2026-09-14');
    expect(localDateOf(stored, 'UTC')).toBe('2026-09-13');
  });

  it('matches what athleteNow computes for "today", so recap date-matching stays consistent', () => {
    const real = new Date('2026-09-13T16:20:00.000Z');
    const today = athleteNow('Asia/Singapore', real);
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    // A recovery log saved at this same real instant, on the same day, from the athlete's POV.
    const loggedAt = real.toISOString();
    expect(localDateOf(loggedAt, 'Asia/Singapore')).toBe(todayStr);
  });
});
