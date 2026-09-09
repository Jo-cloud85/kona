import { describe, expect, it } from 'vitest';
import { buildStarter } from '../../src/agent/index';
import type { PlannedSession, Profile } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  usual_sports: ['running', 'swimming'],
  recent_injuries_note: 'left hip tight after long runs',
  onboarded_at: '2026-09-06T00:00:00Z',
};

const NOW = new Date(2026, 8, 9, 8, 0, 0); // Wed 9 Sep 2026, 08:00 local

function planned(over: Partial<PlannedSession>): PlannedSession {
  return {
    id: `p_${Math.random()}`,
    user_id: 'user_demo',
    kind: 'planned',
    sport: 'running',
    intensity: 'easy',
    start_at: '2026-09-10T06:00:00',
    weekly_plan_id: 'w1',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('buildStarter', () => {
  it('introduces itself warmly, by name, without a wall of numbers', () => {
    const s = buildStarter(profile);
    expect(s.greeting).toMatch(/^Hi Joan, I'm Kona/);
    expect(s.greeting).toMatch(/endurance companion/i);
    expect(s.greeting).toMatch(/running, swimming/);
    expect(s.greeting).toMatch(/left hip tight after long runs/);
    // no fuelling numbers in the opener
    expect(s.greeting).not.toMatch(/\d+\s*(g|ml|kcal|mg)\b/);
    expect(s.greeting).not.toMatch(/protein target|sodium per litre/i);
  });

  it('asks what they are working towards when no goal is set', () => {
    const s = buildStarter(profile);
    expect(s.greeting).toMatch(/working towards/i);
  });

  it('acknowledges an existing goal instead of asking', () => {
    const s = buildStarter({ ...profile, goal: { text: 'First half-marathon in March' } });
    expect(s.greeting).toMatch(/working towards: First half-marathon in March/);
    expect(s.greeting).not.toMatch(/What are you working towards/i);
  });

  it('offers three conversation starters that prefill a parseable stub', () => {
    const s = buildStarter(profile);
    expect(s.prompts.map((p) => p.label)).toEqual([
      'My training week',
      "What I'm doing today or tomorrow",
      'My next race',
    ]);
    expect(s.prompts[1]!.prefill).toMatch(/^Tomorrow I'm doing /);
  });

  it('falls back to "there" when there is no username', () => {
    const s = buildStarter({ ...profile, username: undefined });
    expect(s.greeting).toMatch(/^Hi there, I'm Kona/);
  });

  it('leads with a key session coming up in the next few days', () => {
    const s = buildStarter(profile, {
      now: NOW,
      sessions: [
        planned({ sport: 'running', start_at: '2026-09-10T06:00:00', distance_km: 18, is_long: true }),
        planned({ sport: 'swimming', start_at: '2026-09-12T18:00:00', intensity: 'easy' }),
      ],
    });
    expect(s.greeting).toMatch(/coming up tomorrow: your 18 km long running/i);
    expect(s.greeting).toMatch(/real fuelling day|worth getting it right|worth getting right/i);
  });

  it('mentions a non-key session more lightly, and asks for missing detail', () => {
    const s = buildStarter(profile, {
      now: NOW,
      sessions: [planned({ sport: 'cycling', start_at: '2026-09-11T07:00:00', needs_detail: ['duration_or_distance'] })],
    });
    expect(s.greeting).toMatch(/you've got a cycling on friday/i);
    expect(s.greeting).toMatch(/fill me in/i);
  });

  it('stays generic when nothing is coming up soon (or there is no plan)', () => {
    const far = buildStarter(profile, {
      now: NOW,
      sessions: [planned({ start_at: '2026-09-20T06:00:00', distance_km: 10 })],
    });
    expect(far.greeting).not.toMatch(/coming up/i);

    const none = buildStarter(profile, { now: NOW, sessions: [] });
    expect(none.greeting).not.toMatch(/coming up|you've got a/i);
  });
});
