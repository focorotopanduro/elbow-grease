/**
 * Quiz scoring engine — pure functions, fully testable.
 *
 * Three diagnostic questions that map a homeowner's knowledge of their
 * roof to one of the two install profiles (code_min vs fbc_wbdr) plus
 * a confidence indicator.
 *
 * Scoring approach: each answer awards weighted points to one of the two
 * profiles. Final result is whichever profile scored higher; confidence
 * = |diff| / max-possible-diff, expressed as low/medium/high.
 */

import type { InstallProfileId } from '../../../physics/resistance';

export type AnswerKey = 'pre_2002' | 'between' | 'post_2010' | 'unknown'
                      | 'yes' | 'no' | 'unsure';

export interface Question {
  id: 'era' | 'sheathing' | 'swb';
  prompt: string;
  hint: string;
  options: Array<{ value: AnswerKey; label: string; sub?: string }>;
}

export const QUESTIONS: Question[] = [
  {
    id: 'era',
    prompt: 'When was your roof last replaced?',
    hint: 'The Florida Building Code rewrite after Hurricane Andrew (2001) is the dividing line.',
    options: [
      { value: 'pre_2002',  label: 'Before 2002',  sub: 'Original to most pre-FBC homes' },
      { value: 'between',   label: '2002 \u2013 2010', sub: 'Early FBC era' },
      { value: 'post_2010', label: 'After 2010',   sub: 'Modern FBC + WBDR' },
      { value: 'unknown',   label: "I'm not sure", sub: 'Most common honest answer' },
    ],
  },
  {
    id: 'sheathing',
    prompt: 'Was the roof sheathing re-nailed during your last reroof?',
    hint: 'FBC 708.7 has required this for every reroof in WBDR since the 2001 rewrite.',
    options: [
      { value: 'yes',    label: 'Yes',           sub: 'Documented or visible new fasteners' },
      { value: 'no',     label: 'No',            sub: 'Original 6d nails left in place' },
      { value: 'unsure', label: "I'm not sure",  sub: 'Best to inspect' },
    ],
  },
  {
    id: 'swb',
    prompt: 'Is there a secondary water barrier (SWB) installed under the shingles?',
    hint: 'Self-adhered membrane that sticks to the deck. FBC requires it for any new reroof permit.',
    options: [
      { value: 'yes',    label: 'Yes',           sub: 'Stated on permit or visible at attic' },
      { value: 'no',     label: 'No',            sub: 'Just standard #15 felt' },
      { value: 'unsure', label: "I'm not sure",  sub: 'Most homeowners aren\u2019t' },
    ],
  },
];

export type Answers = Partial<Record<Question['id'], AnswerKey>>;

const SCORE: Record<Question['id'], Partial<Record<AnswerKey, { code_min: number; fbc_wbdr: number }>>> = {
  era: {
    pre_2002:  { code_min: 4, fbc_wbdr: 0 },
    between:   { code_min: 2, fbc_wbdr: 1 },
    post_2010: { code_min: 0, fbc_wbdr: 4 },
    unknown:   { code_min: 2, fbc_wbdr: 0 }, // tilt toward older — most likely truth
  },
  sheathing: {
    yes:    { code_min: 0, fbc_wbdr: 3 },
    no:     { code_min: 3, fbc_wbdr: 0 },
    unsure: { code_min: 1, fbc_wbdr: 0 },
  },
  swb: {
    yes:    { code_min: 0, fbc_wbdr: 3 },
    no:     { code_min: 3, fbc_wbdr: 0 },
    unsure: { code_min: 1, fbc_wbdr: 0 },
  },
};

export type Confidence = 'low' | 'medium' | 'high';

export interface QuizResult {
  recommended: InstallProfileId;
  confidence: Confidence;
  scores: { code_min: number; fbc_wbdr: number };
  ratio: number;             // 0-1 — strength of the lean
  unknownCount: number;      // how many "I'm not sure" answers
  needsInspection: boolean;  // strong CTA when true
}

/** Total possible points across all questions (for normalization) */
const MAX_POSSIBLE = 4 + 3 + 3;

/**
 * Score the user's answers and return a recommended install profile + confidence.
 */
export function scoreQuiz(answers: Answers): QuizResult | null {
  const required: Question['id'][] = ['era', 'sheathing', 'swb'];
  if (!required.every((q) => answers[q])) return null;

  let codeMin = 0;
  let fbcWbdr = 0;
  let unknownCount = 0;

  for (const q of required) {
    const a = answers[q]!;
    const s = SCORE[q][a];
    if (s) {
      codeMin += s.code_min;
      fbcWbdr += s.fbc_wbdr;
    }
    if (a === 'unknown' || a === 'unsure') unknownCount++;
  }

  const recommended: InstallProfileId = fbcWbdr > codeMin ? 'fbc_wbdr' : 'code_min';
  const diff = Math.abs(codeMin - fbcWbdr);
  const ratio = diff / MAX_POSSIBLE;

  const confidence: Confidence =
    ratio >= 0.45 ? 'high' :
    ratio >= 0.2  ? 'medium' :
    'low';

  // Strong inspection signal: lots of "don't know" answers, or low confidence,
  // or recommended code_min (older / unknown homes always benefit from inspection)
  const needsInspection = unknownCount >= 2 || confidence === 'low' || recommended === 'code_min';

  return {
    recommended,
    confidence,
    scores: { code_min: codeMin, fbc_wbdr: fbcWbdr },
    ratio,
    unknownCount,
    needsInspection,
  };
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low:    'Low confidence',
  medium: 'Medium confidence',
  high:   'High confidence',
};

export const CONFIDENCE_BLURB: Record<Confidence, string> = {
  low:    'Your answers are inconclusive — a free inspection will give you the real picture in 30 minutes.',
  medium: 'Your answers point to a clear profile, though some details would benefit from verification on site.',
  high:   'Your answers strongly suggest this profile. The visualizer below is a faithful approximation.',
};
