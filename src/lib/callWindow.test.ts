/**
 * callWindow.ts — contract tests.
 *
 * Locks the day-of-week + hour-of-day decision tree that drives the
 * "we'll call you by X" promise on the success card. Each clause in
 * `getCallWindowText` corresponds to a real office-hours assumption
 * (Mon-Fri 8am-6pm, Sat 9am-2pm, Sun closed) — these tests pin the
 * assumption so future scheduling changes can't silently regress.
 */
import { describe, it, expect } from 'vitest';
import { getCallWindowText } from './callWindow';

/** Build a Date for a known weekday/hour without timezone surprises. */
function dateFor(year: number, month: number, day: number, hour: number): Date {
  return new Date(year, month - 1, day, hour, 0, 0);
}

// 2024 calendar references — pick days where weekday is unambiguous.
// April 1, 2024 = Monday; April 2 = Tuesday; ... April 7 = Sunday.

describe('getCallWindowText', () => {
  describe('Sunday', () => {
    it('promises Monday morning regardless of hour', () => {
      const sunMorning = dateFor(2024, 4, 7, 9);
      const sunEvening = dateFor(2024, 4, 7, 22);
      expect(getCallWindowText(sunMorning)).toMatch(/Monday morning/i);
      expect(getCallWindowText(sunEvening)).toMatch(/Monday morning/i);
    });
  });

  describe('Saturday', () => {
    it('before 2pm: same-day promise', () => {
      const satNoon = dateFor(2024, 4, 6, 11);
      expect(getCallWindowText(satNoon)).toMatch(/today/i);
    });

    it('after 2pm: Monday morning', () => {
      const satEvening = dateFor(2024, 4, 6, 16);
      expect(getCallWindowText(satEvening)).toMatch(/Monday morning/i);
    });
  });

  describe('Weekday before office opens (< 8am)', () => {
    it('promises 8am open', () => {
      const monEarly = dateFor(2024, 4, 1, 6);
      expect(getCallWindowText(monEarly)).toMatch(/open at 8am/i);
    });
  });

  describe('Weekday morning (8am - 2pm)', () => {
    it('promises within hours, today', () => {
      const wedMorning = dateFor(2024, 4, 3, 10);
      expect(getCallWindowText(wedMorning)).toMatch(/today/i);
    });
  });

  describe('Weekday afternoon (2pm - 6pm)', () => {
    it('promises before-close-or-tomorrow on Mon-Thu', () => {
      const tueAfternoon = dateFor(2024, 4, 2, 15);
      expect(getCallWindowText(tueAfternoon)).toMatch(/before close.*tomorrow/i);
    });

    it('promises before-close-or-Monday on Friday', () => {
      const friAfternoon = dateFor(2024, 4, 5, 15);
      expect(getCallWindowText(friAfternoon)).toMatch(/before close.*Monday/i);
    });
  });

  describe('Weekday after hours (>= 6pm)', () => {
    it('Mon-Thu evening promises tomorrow', () => {
      const wedEvening = dateFor(2024, 4, 3, 19);
      expect(getCallWindowText(wedEvening)).toMatch(/tomorrow morning/i);
    });

    it('Friday evening promises Monday morning', () => {
      const friEvening = dateFor(2024, 4, 5, 19);
      expect(getCallWindowText(friEvening)).toMatch(/Monday morning/i);
    });
  });

  describe('boundary: 8am Monday opens office', () => {
    it('exactly 8am is treated as office hours', () => {
      const monOpen = dateFor(2024, 4, 1, 8);
      expect(getCallWindowText(monOpen)).toMatch(/today/i);
    });
  });

  describe('boundary: 6pm Friday closes week', () => {
    it('exactly 6pm Friday hands off to Monday', () => {
      const friClose = dateFor(2024, 4, 5, 18);
      expect(getCallWindowText(friClose)).toMatch(/Monday morning/i);
    });
  });
});
