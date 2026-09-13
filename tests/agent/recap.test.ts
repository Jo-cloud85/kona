import { describe, expect, it } from 'vitest';
import { buildCheckinLog, buildSessionRecap } from '../../src/agent/index';
import type { ActualSession, FuelLog, PersistedMemory, Profile, RecoveryLog } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'u',
  username: 'Joan',
  body_weight_kg: 62,
  usual_sports: ['running'],
  onboarded_at: '2026-09-01T00:00:00Z',
};

function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: 'a1',
    user_id: 'u',
    kind: 'actual',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-11T18:00:00',
    status: 'completed',
    created_at: '2026-09-11T21:04:00Z',
    ...over,
  };
}

describe('buildSessionRecap', () => {
  it('returns null when nothing was actually logged that day — nothing honest to recap', () => {
    const r = buildSessionRecap({
      profile,
      date: '2026-09-11',
      plannedSessions: [],
      actualSessions: [],
      recoveryLogs: [],
      fuelLogs: [],
      memories: [],
    });
    expect(r).toBeNull();
  });

  it('reads back the real check-in fields — feel, pains, went-as-planned — from free_text (not fabricated)', () => {
    const log = buildCheckinLog({
      workout_feel: 'Solid grind',
      went_as_planned: true,
      pains: true,
      elaborate: 'right calf, mild',
    });
    const recovery: RecoveryLog = {
      id: 'r1',
      user_id: 'u',
      logged_at: '2026-09-11T21:05:00Z',
      free_text: log.free_text,
      overall_severity: log.overall_severity,
      reported_symptoms: log.reported_symptoms,
    };

    const r = buildSessionRecap({
      profile,
      date: '2026-09-11',
      plannedSessions: [],
      actualSessions: [actual({ distance_km: 18.2, duration_minutes: 104 })],
      recoveryLogs: [recovery],
      fuelLogs: [],
      memories: [],
    });

    expect(r).not.toBeNull();
    expect(r!.feel_label).toBe('Solid grind');
    expect(r!.logged.went_as_planned).toBe(true);
    expect(r!.logged.pains).toBe('right calf, mild');
    expect(r!.duration_label).toBe('1:44');
    expect(r!.distance_km).toBe(18.2);
  });

  it('never invents an actual carbs/hr figure — the stat is the planned target or absent, not computed from what was logged', () => {
    const fuelLogs: FuelLog[] = [
      {
        id: 'f1',
        user_id: 'u',
        logged_at: '2026-09-11T18:30:00Z',
        items: [
          { description: 'gel', quantity: 2, certainty: 'user_reported' },
          { description: 'bottle', quantity: 1, certainty: 'user_reported' },
        ],
      },
    ];
    const r = buildSessionRecap({
      profile,
      date: '2026-09-11',
      plannedSessions: [],
      actualSessions: [actual({})],
      recoveryLogs: [],
      fuelLogs,
      memories: [],
    });
    expect(r!.logged.fuel_carried).toBe('2 gel · 1 bottle');
    // No stored weekly plan -> no planned target on file -> the stat is absent, never guessed.
    expect(r!.carb_target_g_per_hour).toBeNull();
  });

  it('links the insight this session was the most recent evidence for, with its real text and evidence — not invented commentary', () => {
    const dates = ['2026-08-20', '2026-09-11'];
    const recoveryLogs: RecoveryLog[] = dates.map(
      (d, i) => ({ id: `r${i}`, user_id: 'u', logged_at: `${d}T20:00:00Z`, free_text: 'left calf tight' }) as RecoveryLog,
    );
    const memories: PersistedMemory[] = [];

    const r = buildSessionRecap({
      profile,
      date: '2026-09-11',
      plannedSessions: [],
      actualSessions: [actual({})],
      recoveryLogs,
      fuelLogs: [],
      memories,
    });

    expect(r!.memory).not.toBeNull();
    expect(r!.memory!.text.toLowerCase()).toContain('calf');
    expect(r!.kona_note).toBe(r!.memory!.text); // the Kona note IS the real insight text, nothing fabricated on top
  });

  it('falls back to a plain, honest acknowledgement when there is no linked insight', () => {
    const r = buildSessionRecap({
      profile,
      date: '2026-09-11',
      plannedSessions: [],
      actualSessions: [actual({})],
      recoveryLogs: [],
      fuelLogs: [],
      memories: [],
    });
    expect(r!.memory).toBeNull();
    expect(r!.kona_note.length).toBeGreaterThan(0);
  });
});
