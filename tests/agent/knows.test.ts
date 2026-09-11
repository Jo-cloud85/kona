import { describe, expect, it } from 'vitest';
import { buildKnows } from '../../src/agent/index';
import type { ActualSession, PersistedMemory, Profile, RecoveryLog } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'u',
  username: 'Joan',
  usual_sports: ['running', 'cycling'],
  goal: { text: 'First Olympic-distance triathlon in June' },
  onboarded_at: '2026-08-01T00:00:00Z',
};

function mem(key: string, value: string): PersistedMemory {
  return {
    id: `m_${key}`,
    user_id: 'u',
    key,
    value,
    certainty: 'user_reported',
    source: 'conversation',
    proposed_at: '2026-09-01T00:00:00Z',
    status: 'active',
    persisted_at: '2026-09-01T00:00:00Z',
  };
}
let n = 0;
function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${n++}`,
    user_id: 'u',
    kind: 'actual',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-05T07:00:00',
    status: 'completed',
    created_at: '2026-09-05T08:00:00Z',
    ...over,
  };
}

describe('buildKnows', () => {
  it('is empty and honest when there is nothing on record', () => {
    const k = buildKnows({
      profile: { ...profile, goal: undefined },
      memories: [],
      actualSessions: [],
      recoveryLogs: [],
      fuelLogs: [],
    });
    expect(k.has_anything).toBe(false);
    expect(k.insights).toEqual([]);
    expect(k.told).toEqual([]);
    expect(k.recent).toEqual([]);
  });

  it('surfaces the goal and memories as "what you\'ve told Kona", with readable labels', () => {
    const k = buildKnows({
      profile,
      memories: [mem('next_race', 'City 10k on 4 Oct'), mem('prefers_fasted_rides', 'rides easy fasted before breakfast')],
      actualSessions: [],
      recoveryLogs: [],
      fuelLogs: [],
    });
    expect(k.has_anything).toBe(true);
    expect(k.told).toEqual([
      { label: 'Training for', value: 'First Olympic-distance triathlon in June' },
      { label: 'Next race', value: 'City 10k on 4 Oct' },
      { label: 'Preference', value: 'rides easy fasted before breakfast' },
    ]);
  });

  it('lists recent training with how it felt, newest first', () => {
    const k = buildKnows({
      profile: { ...profile, goal: undefined },
      memories: [],
      actualSessions: [
        actual({ start_at: '2026-09-02T07:00:00', distance_km: 6 }),
        actual({ start_at: '2026-09-06T07:00:00', distance_km: 8, status: 'modified' }),
      ],
      recoveryLogs: [
        { id: 'r1', user_id: 'u', logged_at: '2026-09-06T20:00:00Z', free_text: 'cut it short, legs heavy' } as RecoveryLog,
      ],
      fuelLogs: [],
    });
    expect(k.recent.map((r) => r.date)).toEqual(['6 Sep', '2 Sep']);
    expect(k.recent[0]).toMatchObject({ text: '8 km easy running', status: 'modified', felt: 'cut it short, legs heavy' });
  });

  it('includes computed insights when the history supports them', () => {
    const dates = ['2026-09-01', '2026-09-04', '2026-09-08'];
    const sessions = dates.map((d) => actual({ start_at: `${d}T07:00:00`, distance_km: 7 }));

    // frequency alone → a "repeated" fact, no pattern / recommendation
    const freqOnly = buildKnows({ profile, memories: [], actualSessions: sessions, recoveryLogs: [], fuelLogs: [] });
    expect(freqOnly.insights.some((i) => i.kind === 'fact' && i.basis === 'repeated')).toBe(true);
    expect(freqOnly.insights.some((i) => i.kind === 'pattern')).toBe(false);

    // add positive outcomes → an outcome-backed pattern appears
    const recoveryLogs = dates.map(
      (d, i) => ({ id: `rk${i}`, user_id: 'u', logged_at: `${d}T20:00:00Z`, free_text: 'felt great' }) as RecoveryLog,
    );
    const withOutcome = buildKnows({ profile, memories: [], actualSessions: sessions, recoveryLogs, fuelLogs: [] });
    expect(withOutcome.insights.some((i) => i.kind === 'pattern' && i.basis === 'outcome')).toBe(true);
  });

  it('tags each insight with a learning tier — watching vs acting on (M23.2)', () => {
    // a single noted session -> low certainty ("too early") -> still watching
    const oneSession = buildKnows({
      profile,
      memories: [],
      actualSessions: [actual({ sport: 'swimming', start_at: '2026-09-05T07:00:00' })],
      recoveryLogs: [
        { id: 'rw', user_id: 'u', logged_at: '2026-09-05T20:00:00Z', free_text: 'felt strong in the water' } as RecoveryLog,
      ],
      fuelLogs: [],
    });
    const unproven = oneSession.insights.find((i) => /once so far/i.test(i.text));
    expect(unproven?.certainty).toBe('low');
    expect(unproven?.tier).toBe('watching');

    // a recurring, high-certainty fact -> confident enough to act on
    const withPattern = buildKnows({
      profile,
      memories: [],
      actualSessions: [],
      recoveryLogs: [
        { id: 'r1', user_id: 'u', logged_at: '2026-08-20T20:00:00Z', free_text: 'left calf tight' } as RecoveryLog,
        { id: 'r2', user_id: 'u', logged_at: '2026-09-05T20:00:00Z', free_text: 'calf sore again' } as RecoveryLog,
      ],
      fuelLogs: [],
    });
    const calf = withPattern.insights.find((i) => /calf/i.test(i.text));
    expect(calf?.certainty).toBe('high');
    expect(calf?.tier).toBe('acting_on');
  });

  it('renders the activity timeline (newest first), hiding plan noise, tagging Kona-side steps', () => {
    const k = buildKnows({
      profile: { ...profile, goal: undefined },
      memories: [],
      actualSessions: [],
      recoveryLogs: [],
      fuelLogs: [],
      events: [
        { id: 'e3', user_id: 'u', type: 'recommendation_adapted', at: '2026-09-10T09:00:00Z', summary: 'Kona will factor this into your training advice from now on' },
        { id: 'e2', user_id: 'u', type: 'insight_formed', at: '2026-09-10T09:00:00Z', summary: 'Kona spotted — a pattern' },
        { id: 'e1', user_id: 'u', type: 'session_logged', at: '2026-09-06T09:00:00Z', summary: 'You logged 40 km cycling' },
        { id: 'e0', user_id: 'u', type: 'plan_saved', at: '2026-09-05T09:00:00Z', summary: 'You planned your week' },
      ],
    });
    expect(k.has_anything).toBe(true);
    expect(k.timeline.map((t) => t.type)).toEqual(['recommendation_adapted', 'insight_formed', 'session_logged']);
    expect(k.timeline[0]).toMatchObject({ date: '10 Sep', by_kona: true });
    expect(k.timeline.find((t) => t.type === 'session_logged')!.by_kona).toBe(false);
  });
});
