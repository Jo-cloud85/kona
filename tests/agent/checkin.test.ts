import { describe, expect, it } from 'vitest';
import { buildCheckinLog, checkinReflection, similarSessionFlag } from '../../src/agent/index';
import { screenForEscalation } from '../../src/agent/index';
import type { ActualSession, RecoveryLog } from '../../src/domain/types';

describe('buildCheckinLog', () => {
  it('folds the structured answers into a human free-text record', () => {
    const log = buildCheckinLog({
      legs: 'normal',
      went_as_planned: true,
      pains: false,
    });
    expect(log.free_text).toContain('legs felt normal');
    expect(log.free_text).toContain('Went as planned: yes');
    expect(log.free_text).toContain('pains: no');
    expect(log.overall_severity).toBe('low');
    expect(log.reported_symptoms).toBeUndefined();
  });

  it('raises severity and records a symptom when pains are reported', () => {
    const log = buildCheckinLog({
      legs: 'heavy',
      went_as_planned: false,
      pains: true,
      elaborate: 'left calf tightened up on the last km',
    });
    expect(log.free_text).toContain('Notes: left calf tightened up');
    expect(['moderate', 'high']).toContain(log.overall_severity);
    expect(log.reported_symptoms).toEqual(expect.arrayContaining(['calf']));
  });

  it('a "fresh" check-in with nothing wrong stays low-key', () => {
    const log = buildCheckinLog({ legs: 'fresh', went_as_planned: true, pains: false });
    expect(log.overall_severity).toBe('none');
  });

  it('leaves free_text unchanged when the loop question was never asked (M24.5)', () => {
    const log = buildCheckinLog({ legs: 'normal', went_as_planned: true, pains: false });
    expect(log.free_text).not.toMatch(/kona's earlier suggestion/i);
  });

  it('records sleep and mood as their own structured fields, in free_text too', () => {
    const log = buildCheckinLog({
      legs: 'normal',
      went_as_planned: true,
      pains: false,
      sleep_quality: 'poor',
      mood: 'low',
    });
    expect(log.sleep_quality).toBe('poor');
    expect(log.mood).toBe('low');
    expect(log.free_text).toMatch(/sleep: poor/i);
    expect(log.free_text).toMatch(/mood: low/i);
  });

  it('records whether a Kona Briefing recommendation was followed, the outcome, and its category', () => {
    const followedBetter = buildCheckinLog({
      legs: 'fresh',
      went_as_planned: true,
      pains: false,
      followed_recommendation: true,
      recommendation_outcome: 'better',
      category: 'thirst',
    });
    expect(followedBetter.free_text).toMatch(/followed kona's earlier suggestion/i);
    expect(followedBetter.free_text).toMatch(/went well/i);
    expect(followedBetter.followed_category).toBe('thirst');
    expect(followedBetter.followed_outcome).toBe('better');

    const notFollowed = buildCheckinLog({
      legs: 'normal',
      went_as_planned: true,
      pains: false,
      followed_recommendation: false,
    });
    expect(notFollowed.free_text).toMatch(/did not follow kona's earlier suggestion/i);
    expect(notFollowed.followed_category).toBeUndefined();
    expect(notFollowed.followed_outcome).toBeUndefined();
  });

  it("closes the loop end-to-end: a 'worse' outcome today becomes tomorrow's similarSessionFlag evidence", () => {
    const log = buildCheckinLog({
      legs: 'normal',
      went_as_planned: true,
      pains: false,
      followed_recommendation: true,
      recommendation_outcome: 'worse',
      category: 'thirst',
    });
    const today: ActualSession = {
      id: 'a1',
      user_id: 'u',
      kind: 'actual',
      sport: 'running',
      intensity: 'easy',
      is_long: true,
      start_at: '2026-09-14T18:00:00',
      status: 'completed',
      created_at: '2026-09-14T20:00:00Z',
    };
    const recoveryLog: RecoveryLog = {
      id: 'r1',
      user_id: 'u',
      logged_at: '2026-09-14T21:00:00Z',
      free_text: log.free_text,
      overall_severity: log.overall_severity,
    };
    const flag = similarSessionFlag(
      { sport: 'running', is_long: true, intensity: 'easy' },
      { actualSessions: [today], recoveryLogs: [recoveryLog] },
    );
    expect(flag).not.toBeNull(); // the "rough" wording trips TROUBLE_RE, same as any other recovery note
  });
});

describe('checkinReflection', () => {
  const clean = { escalate: false, matched: [] };

  it('is upbeat and non-directive when all is well', () => {
    const msg = checkinReflection({ legs: 'fresh', went_as_planned: true, pains: false }, clean);
    expect(msg).toMatch(/went well/i);
    expect(msg).toMatch(/chat/i); // points further questions to chat
  });

  it('nudges to chat (not a diagnosis) when the plan changed', () => {
    const msg = checkinReflection({ legs: 'normal', went_as_planned: false, pains: false }, clean);
    expect(msg).toMatch(/tell me in chat/i);
    expect(msg).not.toMatch(/because of|caused by|diagnos/i);
  });

  it('is cautious but non-diagnostic about aches, and points to a professional', () => {
    const msg = checkinReflection({ legs: 'heavy', went_as_planned: true, pains: true }, clean);
    expect(msg).toMatch(/looked at|checked/i);
    expect(msg).not.toMatch(/diagnos|it'?s (probably|likely) /i);
  });

  it('escalates when the elaboration trips the safety screen', () => {
    const input = {
      legs: 'heavy' as const,
      went_as_planned: false,
      pains: true,
      elaborate: 'had chest pain and felt faint after',
    };
    const log = buildCheckinLog(input);
    const screen = screenForEscalation(log.free_text);
    expect(screen.escalate).toBe(true);
    const msg = checkinReflection(input, screen);
    expect(msg).toMatch(/medical professional/i);
    expect(msg).toMatch(/urgent care/i);
  });
});
