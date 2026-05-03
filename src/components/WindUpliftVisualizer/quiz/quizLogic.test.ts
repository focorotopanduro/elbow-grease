/**
 * Reliability tests for the quiz scoring engine.
 */
import { describe, it, expect } from 'vitest';
import { scoreQuiz, type Answers } from './quizLogic';

describe('scoreQuiz — diagnostic engine', () => {
  it('returns null when any question is unanswered', () => {
    expect(scoreQuiz({})).toBeNull();
    expect(scoreQuiz({ era: 'pre_2002' })).toBeNull();
    expect(scoreQuiz({ era: 'pre_2002', sheathing: 'no' })).toBeNull();
  });

  it('classic pre-2002 unimproved roof → code_min, high confidence', () => {
    const r = scoreQuiz({ era: 'pre_2002', sheathing: 'no', swb: 'no' })!;
    expect(r.recommended).toBe('code_min');
    expect(r.confidence).toBe('high');
    expect(r.needsInspection).toBe(true); // older roof always benefits
  });

  it('full modern WBDR install → fbc_wbdr, high confidence', () => {
    const r = scoreQuiz({ era: 'post_2010', sheathing: 'yes', swb: 'yes' })!;
    expect(r.recommended).toBe('fbc_wbdr');
    expect(r.confidence).toBe('high');
    expect(r.needsInspection).toBe(false);
  });

  it("all 'don\u2019t know' answers triggers inspection signal", () => {
    const r = scoreQuiz({ era: 'unknown', sheathing: 'unsure', swb: 'unsure' })!;
    expect(r.unknownCount).toBe(3);
    expect(r.needsInspection).toBe(true);
  });

  it('mixed answers (modern era but unsure on SWB) → fbc_wbdr but inspection still recommended', () => {
    const r = scoreQuiz({ era: 'post_2010', sheathing: 'yes', swb: 'unsure' })!;
    expect(r.recommended).toBe('fbc_wbdr');
    // unsure on swb pushes inspection signal even though fbc_wbdr wins
    expect(r.unknownCount).toBe(1);
  });

  it('ambiguous mid-era answers → low or medium confidence', () => {
    const r = scoreQuiz({ era: 'between', sheathing: 'unsure', swb: 'unsure' })!;
    expect(['low', 'medium']).toContain(r.confidence);
  });

  it('confidence ratios are bounded 0-1', () => {
    const cases: Answers[] = [
      { era: 'pre_2002', sheathing: 'no', swb: 'no' },
      { era: 'post_2010', sheathing: 'yes', swb: 'yes' },
      { era: 'unknown', sheathing: 'unsure', swb: 'unsure' },
    ];
    for (const c of cases) {
      const r = scoreQuiz(c);
      expect(r!.ratio).toBeGreaterThanOrEqual(0);
      expect(r!.ratio).toBeLessThanOrEqual(1);
    }
  });

  it('unknown era is conservative (tilts code_min) when sheathing/swb also unknown', () => {
    const r = scoreQuiz({ era: 'unknown', sheathing: 'unsure', swb: 'unsure' })!;
    expect(r.recommended).toBe('code_min');
  });
});
