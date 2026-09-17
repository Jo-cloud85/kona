import { describe, expect, it } from 'vitest';
import { buildStarter } from '../../src/agent/index';
import type { KonaBriefing } from '../../src/agent/briefing';
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

const NO_TARGET: KonaBriefing = {
  when: null,
  date: null,
  session_label: null,
  headline: 'All quiet',
  action: 'Nothing meaningful coming up in the next week — normal training and fuelling.',
  why: null,
  deviation: null,
  basis: null,
  category: null,
  pending_recommendation: null,
};

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

  it('is explicit it does not sync Strava/Garmin/a watch (M24.6 — no implied integration)', () => {
    const s = buildStarter(profile);
    expect(s.greeting).toMatch(/bring your training plan/i);
    expect(s.greeting).toMatch(/don't sync strava, garmin/i);
  });

  it('asks what they are working towards when no goal is set', () => {
    const s = buildStarter(profile);
    expect(s.greeting).toMatch(/working towards/i);
  });

  it('acknowledges an existing goal instead of asking', () => {
    const s = buildStarter({ ...profile, goals: [{ text: 'First half-marathon in March' }] });
    expect(s.greeting).toMatch(/working towards: First half-marathon in March/);
    expect(s.greeting).not.toMatch(/What are you working towards/i);
  });

  it('with nothing context-specific, falls back to the generic pair (M27 — deterministic, not a fixed list)', () => {
    const s = buildStarter(profile);
    expect(s.prompts.map((p) => p.label)).toEqual(['My training plan', "What I'm doing today or tomorrow"]);
    expect(s.prompts[1]!.prefill).toMatch(/^Tomorrow I'm doing /);
  });

  it('suggests a taper chip when the goal event is within 8 weeks (M27)', () => {
    const near = new Date(2026, 8, 9);
    const s = buildStarter({ ...profile, goals: [{ text: 'Race', event_date: '2026-10-01' }] }, { now: near, sessions: [] });
    expect(s.prompts.map((p) => p.label)).toContain("How's my taper looking?");
  });

  it('does not suggest a taper chip when the goal is months away', () => {
    const s = buildStarter({ ...profile, goals: [{ text: 'Race', event_date: '2027-06-01' }] }, { now: NOW, sessions: [] });
    expect(s.prompts.map((p) => p.label)).not.toContain("How's my taper looking?");
  });

  it('suggests a nutrition chip naming the actual upcoming session when a briefing is given (M27)', () => {
    const briefing: KonaBriefing = { ...NO_TARGET, when: 'Tomorrow', session_label: 'Long run', headline: 'Bring extra fluid' };
    const s = buildStarter(profile, { now: NOW, sessions: [], briefing });
    const chip = s.prompts.find((p) => p.label.startsWith('What should I eat'));
    expect(chip).toBeDefined();
    expect(chip!.prefill.toLowerCase()).toContain('long run');
  });

  it('falls back to "there" when there is no username', () => {
    const s = buildStarter({ ...profile, username: undefined });
    expect(s.greeting).toMatch(/^Hi there, I'm Kona/);
  });

  it('leads with the Kona Briefing when one is given — same judgment as Home (M24.4)', () => {
    const briefing: KonaBriefing = {
      when: 'Tomorrow',
      date: '2026-09-10',
      session_label: 'Long run',
      headline: 'Bring extra fluid',
      action: 'Bring extra fluid — your second bottle if you have one.',
      why: 'Last time you did a similar long run (3 Sep), you said: "got very thirsty".',
      deviation: null,
      basis: 'reported',
      category: 'thirst',
      pending_recommendation: null,
    };
    const s = buildStarter(profile, {
      now: NOW,
      sessions: [planned({ start_at: '2026-09-10T06:00:00', distance_km: 18, is_long: true })],
      briefing,
    });
    expect(s.greeting).toMatch(/Tomorrow · Long run/);
    expect(s.greeting).toMatch(/Bring extra fluid/);
    expect(s.greeting).toMatch(/got very thirsty/);
  });

  it('asks for missing detail when the target session still needs it', () => {
    const briefing: KonaBriefing = {
      when: 'Tomorrow',
      date: '2026-09-10',
      session_label: 'Long run',
      headline: 'Nothing special needed',
      action: 'Nothing special to prepare — normal meals and fluids are fine.',
      why: null,
      deviation: null,
      basis: null,
      category: null,
      pending_recommendation: null,
    };
    const s = buildStarter(profile, {
      now: NOW,
      sessions: [
        planned({ start_at: '2026-09-10T06:00:00', is_long: true, needs_detail: ['duration_or_distance'] }),
      ],
      briefing,
    });
    expect(s.greeting).toMatch(/fill in the rest of the details/i);
  });

  it('stays generic when nothing meaningful is coming up, or no briefing was given at all', () => {
    const withNoTarget = buildStarter(profile, { now: NOW, sessions: [], briefing: NO_TARGET });
    expect(withNoTarget.greeting).not.toMatch(/·/);

    const withoutBriefing = buildStarter(profile, { now: NOW, sessions: [] });
    expect(withoutBriefing.greeting).not.toMatch(/·/);
  });
});
