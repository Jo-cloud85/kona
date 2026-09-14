import { describe, expect, it } from 'vitest';
import { computeArcProgress, computeMilestones } from '../../src/agent/index';
import type { ActivityEvent, ActualSession } from '../../src/domain/types';

let n = 0;
function actual(over: Partial<ActualSession>): ActualSession {
  return {
    id: `a_${n++}`,
    user_id: 'u',
    kind: 'actual',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-01-05T07:00:00',
    status: 'completed',
    created_at: '2026-01-05T07:30:00Z',
    ...over,
  };
}
function event(over: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: `e_${n++}`,
    user_id: 'u',
    type: 'recovery_logged',
    at: '2026-01-05T20:00:00Z',
    summary: '',
    ...over,
  };
}

describe('computeMilestones', () => {
  it('no sessions — every milestone unachieved, no invented dates', () => {
    const out = computeMilestones([]);
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) {
      expect(m.achieved).toBe(false);
      expect(m.date).toBeNull();
    }
  });

  it('first qualifying session sets achieved + its date', () => {
    const s = actual({ distance_km: 5.2, start_at: '2026-03-01T07:00:00' });
    const out = computeMilestones([s]);
    const m = out.find((x) => x.id === 'first_5k_run')!;
    expect(m.achieved).toBe(true);
    expect(m.date).toBe('2026-03-01');
  });

  it('multiple qualifying sessions — earliest wins, not most recent', () => {
    const later = actual({ distance_km: 6, start_at: '2026-04-10T07:00:00' });
    const earlier = actual({ distance_km: 5.5, start_at: '2026-02-01T07:00:00' });
    const out = computeMilestones([later, earlier]);
    const m = out.find((x) => x.id === 'first_5k_run')!;
    expect(m.date).toBe('2026-02-01');
  });

  it('a session just under the threshold does not qualify', () => {
    const s = actual({ distance_km: 4.9 });
    const out = computeMilestones([s]);
    expect(out.find((x) => x.id === 'first_5k_run')!.achieved).toBe(false);
  });

  it('a skipped session does not qualify even if the distance matches', () => {
    const s = actual({ distance_km: 5, status: 'skipped' });
    const out = computeMilestones([s]);
    expect(out.find((x) => x.id === 'first_5k_run')!.achieved).toBe(false);
  });

  it('first triathlon — direct sport, or a multi-sport session_group_id', () => {
    const direct = computeMilestones([actual({ sport: 'triathlon', start_at: '2026-05-01T07:00:00' })]);
    expect(direct.find((x) => x.id === 'first_triathlon')!.achieved).toBe(true);

    const brick = computeMilestones([
      actual({ sport: 'cycling', session_group_id: 'g1', start_at: '2026-06-01T07:00:00' }),
      actual({ sport: 'running', session_group_id: 'g1', start_at: '2026-06-01T08:00:00' }),
    ]);
    expect(brick.find((x) => x.id === 'first_triathlon')!.achieved).toBe(true);

    const singleSportGroup = computeMilestones([
      actual({ sport: 'cycling', session_group_id: 'g2', start_at: '2026-06-01T07:00:00' }),
      actual({ sport: 'cycling', session_group_id: 'g2', start_at: '2026-06-01T08:00:00' }),
    ]);
    expect(singleSportGroup.find((x) => x.id === 'first_triathlon')!.achieved).toBe(false);
  });
});

describe('computeArcProgress', () => {
  it('zero history — Foundation, all metrics 0', () => {
    const out = computeArcProgress({ actualSessions: [], activityEvents: [] });
    expect(out.stage).toBe('Foundation');
    expect(out.stage_index).toBe(0);
    expect(out.metrics).toEqual({ consistent_weeks: 0, checkins_logged: 0, adaptations_applied: 0 });
  });

  it('exactly-at-boundary values land in the higher stage, not the lower one', () => {
    const sessions = [
      actual({ start_at: '2026-01-05T07:00:00' }), // week A
      actual({ start_at: '2026-01-12T07:00:00' }), // week B — 2 consistent weeks
    ];
    const events = [event({ type: 'recovery_logged', at: '2026-01-05T20:00:00Z' })]; // 1 check-in
    const out = computeArcProgress({ actualSessions: sessions, activityEvents: events });
    expect(out.metrics.consistent_weeks).toBe(2);
    expect(out.stage).toBe('Rhythm');
  });

  it('is monotonic — more qualifying weeks/check-ins never regresses a stage', () => {
    const base = computeArcProgress({
      actualSessions: [actual({ start_at: '2026-01-05T07:00:00' }), actual({ start_at: '2026-01-12T07:00:00' })],
      activityEvents: [event({ at: '2026-01-05T20:00:00Z' })],
    });
    const more = computeArcProgress({
      actualSessions: [
        actual({ start_at: '2026-01-05T07:00:00' }),
        actual({ start_at: '2026-01-12T07:00:00' }),
        actual({ start_at: '2026-01-19T07:00:00' }),
      ],
      activityEvents: [event({ at: '2026-01-05T20:00:00Z' }), event({ at: '2026-01-12T20:00:00Z' })],
    });
    const baseIdx = ['Foundation', 'Rhythm', 'Judgment', 'Composure', 'Command'].indexOf(base.stage);
    const moreIdx = ['Foundation', 'Rhythm', 'Judgment', 'Composure', 'Command'].indexOf(more.stage);
    expect(moreIdx).toBeGreaterThanOrEqual(baseIdx);
  });

  it('an adaptation event alone, with no consistent weeks, does not skip straight to Composure', () => {
    const out = computeArcProgress({
      actualSessions: [],
      activityEvents: [event({ type: 'recommendation_adapted', at: '2026-01-05T20:00:00Z' })],
    });
    expect(out.stage).toBe('Foundation');
    expect(out.metrics.adaptations_applied).toBe(1);
  });
});
