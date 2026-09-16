import { describe, it, expect } from 'vitest';
import {
  tierFor, gatherWindowMinutes, rankCandidates, batchesOf, deferMinutesForQuietHours,
  SEQUENTIAL_LEAD_MINUTES,
} from '../coverTiers';

describe('tierFor', () => {
  it('treats a shift already under way as immediate', () => {
    expect(tierFor(0)).toBe('immediate');
    expect(tierFor(-45)).toBe('immediate'); // 45 minutes in, nobody turned up
  });

  it('is immediate when there is not even time to gather', () => {
    expect(tierFor(29)).toBe('immediate');
  });

  it('gathers from 30 minutes out up to two days', () => {
    expect(tierFor(30)).toBe('gather');
    expect(tierFor(4 * 60)).toBe('gather');
    expect(tierFor(SEQUENTIAL_LEAD_MINUTES - 1)).toBe('gather');
  });

  it('goes one at a time from two days out', () => {
    expect(tierFor(SEQUENTIAL_LEAD_MINUTES)).toBe('sequential');
    expect(tierFor(7 * 24 * 60)).toBe('sequential');
  });
});

describe('gatherWindowMinutes', () => {
  it('scales the window with how much notice there is', () => {
    expect(gatherWindowMinutes(50)).toBe(30);   // under an hour
    expect(gatherWindowMinutes(90)).toBe(60);   // ~2 hours
    expect(gatherWindowMinutes(150)).toBe(90);  // ~3 hours
    expect(gatherWindowMinutes(240)).toBe(120); // 4+ hours
  });

  it('caps at two hours no matter how far out the shift is', () => {
    expect(gatherWindowMinutes(3 * 24 * 60)).toBe(120);
  });

  it('never runs the window up to the shift itself', () => {
    // 35 minutes out: a full 30-minute window would leave 5 minutes to get there.
    expect(gatherWindowMinutes(35)).toBe(25);
  });

  it('keeps a usable window even at the very edge', () => {
    expect(gatherWindowMinutes(30)).toBe(20);
    expect(gatherWindowMinutes(12)).toBe(5);
  });
});

describe('rankCandidates', () => {
  const person = (name: string, shift_cost: number | null, reliability_score: number) =>
    ({ name, shift_cost, reliability_score });

  it('puts the cheapest first', () => {
    const ranked = rankCandidates([
      person('Expensive', 300, 90),
      person('Cheap', 150, 50),
      person('Middling', 220, 70),
    ]);
    expect(ranked.map(p => p.name)).toEqual(['Cheap', 'Middling', 'Expensive']);
  });

  it('breaks a tie on cost with reliability', () => {
    const ranked = rankCandidates([
      person('Same cost, less reliable', 200, 40),
      person('Same cost, more reliable', 200, 95),
    ]);
    expect(ranked[0].name).toBe('Same cost, more reliable');
  });

  it('sorts anyone without a rate last rather than treating them as free', () => {
    const ranked = rankCandidates([
      person('No rate', null, 100),
      person('Dearest', 500, 10),
    ]);
    expect(ranked.map(p => p.name)).toEqual(['Dearest', 'No rate']);
  });

  it('falls back to reliability among people who all lack a rate', () => {
    const ranked = rankCandidates([
      person('Unreliable', null, 20),
      person('Reliable', null, 80),
    ]);
    expect(ranked.map(p => p.name)).toEqual(['Reliable', 'Unreliable']);
  });

  it('does not mutate the list it was given', () => {
    const original = [person('B', 200, 50), person('A', 100, 50)];
    const copy = [...original];
    rankCandidates(original);
    expect(original).toEqual(copy);
  });
});

describe('batchesOf', () => {
  it('splits into pairs for the immediate tier', () => {
    expect(batchesOf(['a', 'b', 'c', 'd', 'e'])).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('handles an empty list', () => {
    expect(batchesOf([])).toEqual([]);
  });

  it('rejects a nonsense batch size rather than looping forever', () => {
    expect(() => batchesOf(['a'], 0)).toThrow();
  });
});

describe('deferMinutesForQuietHours', () => {
  const overnight = { start: '21:00', end: '07:00' };

  it('sends straight away during the day', () => {
    expect(deferMinutesForQuietHours('14:00', overnight)).toBe(0);
  });

  it('waits until morning for a late-evening step', () => {
    expect(deferMinutesForQuietHours('22:00', overnight)).toBe(9 * 60); // to 07:00
  });

  it('waits the remainder when it is already past midnight', () => {
    expect(deferMinutesForQuietHours('02:30', overnight)).toBe(4.5 * 60);
  });

  it('sends at the moment quiet hours end', () => {
    expect(deferMinutesForQuietHours('07:00', overnight)).toBe(0);
  });

  it('defers from the first minute of quiet hours', () => {
    expect(deferMinutesForQuietHours('21:00', overnight)).toBe(10 * 60);
  });

  it('never defers when no quiet hours are configured', () => {
    expect(deferMinutesForQuietHours('03:00', null)).toBe(0);
  });

  it('handles a same-day window that does not wrap midnight', () => {
    const daytime = { start: '12:00', end: '13:00' };
    expect(deferMinutesForQuietHours('12:30', daytime)).toBe(30);
    expect(deferMinutesForQuietHours('11:00', daytime)).toBe(0);
    expect(deferMinutesForQuietHours('13:00', daytime)).toBe(0);
  });
});
