import { describe, expect, it } from 'vitest';
import { goalContext, parseGoalDate } from '../../src/domain/goal';

const NOW = new Date(2026, 2, 15); // 15 Mar 2026

describe('parseGoalDate', () => {
  it('reads an explicit ISO date', () => {
    expect(parseGoalDate('Berlin marathon 2026-09-20', NOW)).toBe('2026-09-20');
  });
  it('reads "<Month> <day>" and picks the next future year', () => {
    expect(parseGoalDate('Olympic-distance tri on June 14', NOW)).toBe('2026-06-14');
    expect(parseGoalDate('10k on Feb 2', NOW)).toBe('2027-02-02'); // Feb already passed
  });
  it('reads "<day> <Month> <year>"', () => {
    expect(parseGoalDate('half marathon 11 Oct 2026', NOW)).toBe('2026-10-11');
  });
  it('reads "in N weeks"', () => {
    expect(parseGoalDate('first race in 8 weeks', NOW)).toBe('2026-05-10');
  });
  it('reads a bare "in <Month>" as the 1st', () => {
    expect(parseGoalDate('First Olympic-distance triathlon in June', NOW)).toBe('2026-06-01');
  });
  it('returns undefined when no date is stated', () => {
    expect(parseGoalDate('just want to stay consistent', NOW)).toBeUndefined();
    expect(parseGoalDate('run a sub-40 10k', NOW)).toBeUndefined();
  });
});

describe('goalContext', () => {
  it('is all-null with no goal', () => {
    expect(goalContext(undefined, NOW).phrase).toBeNull();
  });
  it('has text but no phrase when there is no date', () => {
    const g = goalContext({ text: 'Stay consistent' }, NOW);
    expect(g.text).toBe('Stay consistent');
    expect(g.phrase).toBeNull();
  });
  it('gives a weeks-out line, stripping the trailing date clause from the goal', () => {
    const g = goalContext({ text: 'First Olympic-distance triathlon in June' }, NOW);
    expect(g.weeks_until).toBe(11); // ~15 Mar -> 1 Jun
    expect(g.phrase).toBe('11 weeks to your First Olympic-distance triathlon.');
  });
  it('switches to days, then race week, as it gets close', () => {
    expect(goalContext({ text: 'race', event_date: '2026-03-30' }, NOW).phrase).toBe('15 days to your race.');
    expect(goalContext({ text: 'race', event_date: '2026-03-18' }, NOW).phrase).toMatch(/Race week — race in 3 days/);
    expect(goalContext({ text: 'race', event_date: '2026-03-15' }, NOW).phrase).toBe('Race day — race.');
  });
  it('goes quiet once the event has passed', () => {
    expect(goalContext({ text: 'race', event_date: '2026-03-01' }, NOW).phrase).toBeNull();
  });
});
