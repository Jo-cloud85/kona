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
    const sessions = ['2026-09-01', '2026-09-04', '2026-09-08'].map((d) =>
      actual({ start_at: `${d}T07:00:00`, distance_km: 7 }),
    );
    const k = buildKnows({ profile, memories: [], actualSessions: sessions, recoveryLogs: [], fuelLogs: [] });
    expect(k.insights.some((i) => i.kind === 'pattern')).toBe(true);
  });
});
