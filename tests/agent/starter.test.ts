import { describe, expect, it } from 'vitest';
import { buildStarter } from '../../src/agent/index';
import type { Profile } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  gender: 'female',
  age: 34,
  body_weight_kg: 58,
  usual_sports: ['running', 'swimming', 'climbing'],
  typical_weekly_sessions: 6,
  recent_injuries_note: 'left hip tight after long runs',
  self_perception: { sleep_quality: 4, hydration: 3, sweat_level: 5 },
  onboarded_at: '2026-09-06T00:00:00Z',
};

describe('buildStarter', () => {
  it('greets by name and echoes the form back', () => {
    const s = buildStarter(profile);
    expect(s.greeting).toMatch(/^Hi Joan, I'm Kona/);
    expect(s.greeting).toMatch(/58 kg/);
    expect(s.greeting).toMatch(/running, swimming, climbing/);
    expect(s.greeting).toMatch(/about 6 sessions a week/);
    expect(s.greeting).toMatch(/sleep 4\/5, hydration 3\/5, sweat 5\/5/);
    expect(s.greeting).toMatch(/left hip tight after long runs/);
  });

  it('summarises the daily protein target from the engine, and flags fluid/sodium as per-session', () => {
    const s = buildStarter(profile);
    // 58 kg * 1.4-2.0 => 81-116 g
    expect(s.greeting).toMatch(/81–116 g/);
    expect(s.greeting).toMatch(/20–40 g in the meal after/);
    expect(s.greeting).toMatch(/aren't a fixed daily number/);
    expect(s.greeting).toMatch(/400–800 ml/);
    expect(s.greeting).toMatch(/500–700 mg sodium per litre/);
    expect(s.greeting).toMatch(/starting ranges from general guidance, not exact targets/);
  });

  it('offers three conversation starters that prefill a parseable stub', () => {
    const s = buildStarter(profile);
    expect(s.prompts.map((p) => p.label)).toEqual([
      'My typical training week',
      "What I'm doing today or tomorrow",
      'My next race',
    ]);
    expect(s.prompts[1]!.prefill).toMatch(/^Tomorrow I'm doing /);
  });

  it('falls back to "there" when there is no username', () => {
    const s = buildStarter({ ...profile, username: undefined });
    expect(s.greeting).toMatch(/^Hi there, I'm Kona/);
  });
});
