import { describe, expect, it } from 'vitest';
import { buildStarter } from '../../src/agent/index';
import type { Profile } from '../../src/domain/types';

const profile: Profile = {
  user_id: 'user_demo',
  username: 'Joan',
  usual_sports: ['running', 'swimming'],
  recent_injuries_note: 'left hip tight after long runs',
  onboarded_at: '2026-09-06T00:00:00Z',
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
});
