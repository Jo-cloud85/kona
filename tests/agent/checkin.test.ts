import { describe, expect, it } from 'vitest';
import { buildCheckinLog, checkinReflection } from '../../src/agent/index';
import { screenForEscalation } from '../../src/agent/index';

describe('buildCheckinLog', () => {
  it('folds the structured answers into a human free-text record', () => {
    const log = buildCheckinLog({
      workout_feel: 'Solid grind',
      went_as_planned: true,
      pains: false,
    });
    expect(log.free_text).toContain('workout felt: "Solid grind"');
    expect(log.free_text).toContain('Went as planned: yes');
    expect(log.free_text).toContain('pains: no');
    expect(log.overall_severity).toBe('low');
    expect(log.reported_symptoms).toBeUndefined();
  });

  it('raises severity and records a symptom when pains are reported', () => {
    const log = buildCheckinLog({
      workout_feel: 'Dying...',
      went_as_planned: false,
      pains: true,
      elaborate: 'left calf tightened up on the last km',
    });
    expect(log.free_text).toContain('Notes: left calf tightened up');
    expect(['moderate', 'high']).toContain(log.overall_severity);
    expect(log.reported_symptoms).toEqual(expect.arrayContaining(['calf']));
  });

  it('a "great" check-in with nothing wrong stays low-key', () => {
    const log = buildCheckinLog({ workout_feel: 'Feeling great!', went_as_planned: true, pains: false });
    expect(log.overall_severity).toBe('none');
  });
});

describe('checkinReflection', () => {
  const clean = { escalate: false, matched: [] };

  it('is upbeat and non-directive when all is well', () => {
    const msg = checkinReflection({ workout_feel: 'Feeling great!', went_as_planned: true, pains: false }, clean);
    expect(msg).toMatch(/went well/i);
    expect(msg).toMatch(/chat/i); // points further questions to chat
  });

  it('nudges to chat (not a diagnosis) when the plan changed', () => {
    const msg = checkinReflection({ workout_feel: 'Survived', went_as_planned: false, pains: false }, clean);
    expect(msg).toMatch(/tell me in chat/i);
    expect(msg).not.toMatch(/because of|caused by|diagnos/i);
  });

  it('is cautious but non-diagnostic about aches, and points to a professional', () => {
    const msg = checkinReflection({ workout_feel: 'Dying...', went_as_planned: true, pains: true }, clean);
    expect(msg).toMatch(/looked at|checked/i);
    expect(msg).not.toMatch(/diagnos|it'?s (probably|likely) /i);
  });

  it('escalates when the elaboration trips the safety screen', () => {
    const input = {
      workout_feel: 'Dying...',
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
