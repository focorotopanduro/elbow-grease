/**
 * RoofSurvivalQuiz — plain-language entry point.
 *
 * Replaces the previous "tune all the technical parameters yourself" UX
 * with six everyday-language questions that map back to the underlying
 * physics inputs. After the user answers, a "Run the storm" button
 * triggers the existing replay engine (auto-ramps wind speed up to a
 * survey peak) and the simulation plays out. When the replay finishes,
 * a verdict reveal tells the user whether their roof survived.
 *
 * Power-user technical controls (HouseConfigPanel, the install toggle,
 * the wind slider) stay in the engineering drawer / sidebar so anyone
 * who wants to override is free to. This panel is the streamlined
 * funnel for the median visitor who just wants the answer.
 *
 * THREE PHASES:
 *   - 'questions' — answering the 6 questions
 *   - 'running'   — wind ramp playing in the simulator
 *   - 'verdict'   — reveal screen with retake link + more-details
 */

import { useEffect, useRef, useState } from 'react';
import type { HouseConfig } from '../../physics/pressure';
import { INSTALL_PROFILES, type InstallProfileId } from '../../physics/resistance';
import type { CascadeResult, StageId } from '../../physics/cascade';
import type { NamedStorm } from '../../data/orlando';
import { scoreQuiz, type Answers as QuizAnswers, type AnswerKey } from './quiz/quizLogic';
import './RoofSurvivalQuiz.css';

/* ─── Plain-language answer types ──────────────────────────────────────── */
type SizeAns = 1 | 2 | 'unsure';
type ShapeAns = 'gable' | 'hip' | 'unsure';
type AreaAns = 'suburb' | 'open' | 'coastal' | 'unsure';
type WindowsAns = 'protected' | 'standard' | 'unsure';
type AgeAns = 'old' | 'middle' | 'modern' | 'unsure';
type ReroofAns = 'yes' | 'no' | 'unsure';

interface Answers {
  size: SizeAns | null;
  shape: ShapeAns | null;
  area: AreaAns | null;
  windows: WindowsAns | null;
  age: AgeAns | null;
  reroof: ReroofAns | null;
}

const EMPTY: Answers = {
  size: null, shape: null, area: null, windows: null, age: null, reroof: null,
};

/* ─── Question definitions — all plain language, no engineering terms ──── */
interface OptionDef<V extends string | number> {
  value: V;
  main: string;
  sub?: string;
}

interface QuestionDef<V extends string | number> {
  id: keyof Answers;
  label: string;
  options: ReadonlyArray<OptionDef<V>>;
}

const Q_SIZE: QuestionDef<SizeAns> = {
  id: 'size',
  label: 'How tall is your house?',
  options: [
    { value: 1,        main: 'One story',  sub: 'Single floor' },
    { value: 2,        main: 'Two story',  sub: 'Has an upstairs' },
    { value: 'unsure', main: "I'm not sure" },
  ],
};

const Q_SHAPE: QuestionDef<ShapeAns> = {
  id: 'shape',
  label: 'What does the roof look like from the street?',
  options: [
    { value: 'gable',  main: 'Pointed in front', sub: 'Triangle gable face' },
    { value: 'hip',    main: 'Sloped on every side', sub: 'No flat triangle face' },
    { value: 'unsure', main: "I'm not sure" },
  ],
};

const Q_AREA: QuestionDef<AreaAns> = {
  id: 'area',
  label: 'Where is your house?',
  options: [
    { value: 'suburb',  main: 'Suburb',         sub: 'Trees + neighbors close by' },
    { value: 'open',    main: 'Open area',      sub: 'Big yards, few trees' },
    { value: 'coastal', main: 'Near the coast', sub: 'Beach or waterfront' },
    { value: 'unsure',  main: "I'm not sure" },
  ],
};

const Q_WINDOWS: QuestionDef<WindowsAns> = {
  id: 'windows',
  label: 'How are your windows protected during a storm?',
  options: [
    { value: 'protected', main: 'Shutters or impact glass', sub: 'Built to take a hit' },
    { value: 'standard',  main: 'Standard windows',         sub: 'No special protection' },
    { value: 'unsure',    main: "I'm not sure" },
  ],
};

const Q_AGE: QuestionDef<AgeAns> = {
  id: 'age',
  label: 'When was the roof last replaced?',
  options: [
    { value: 'old',    main: 'Before 2002',    sub: 'Pre-modern Florida code' },
    { value: 'middle', main: '2002 – 2010',    sub: 'Older modern code' },
    { value: 'modern', main: 'After 2010',     sub: 'Current code era' },
    { value: 'unsure', main: "I'm not sure" },
  ],
};

const Q_REROOF: QuestionDef<ReroofAns> = {
  id: 'reroof',
  label: 'Was the roof deck re-nailed when it was redone?',
  options: [
    { value: 'yes',    main: 'Yes',           sub: 'New nails, or it’s in the paperwork' },
    { value: 'no',     main: 'No',            sub: 'Old nails left in place' },
    { value: 'unsure', main: "I'm not sure",  sub: 'Most homeowners aren’t' },
  ],
};

const QUESTIONS = [Q_SIZE, Q_SHAPE, Q_AREA, Q_WINDOWS, Q_AGE, Q_REROOF] as const;

/* ─── Mapping plain-language answers → physics inputs ──────────────────── */

/** Conservative defaults when the answer is "I'm not sure": pick the
 *  worse-case interpretation so the verdict doesn't mislead.  */
function mapToConfig(a: Answers): HouseConfig {
  return {
    stories:  a.size  === 2 ? 2 : 1,
    shape:    a.shape === 'hip'    ? 'hip' : 'gable',           // unsure → gable (worse)
    exposure: a.area  === 'coastal' ? 'D'
            : a.area  === 'open'    ? 'C'
            : a.area  === 'suburb'  ? 'B'
            : 'C',                                              // unsure → C (middle)
    enclosed: a.windows === 'protected' ? 'fully' : 'partial',  // unsure → partial (worse)
  };
}

/** Map age + reroof to the existing quiz logic, then score. */
function mapToInstall(a: Answers): InstallProfileId {
  const ageMap: Record<AgeAns, AnswerKey> = {
    old:    'pre_2002',
    middle: 'between',
    modern: 'post_2010',
    unsure: 'unknown',
  };
  const yesNoMap: Record<ReroofAns, AnswerKey> = {
    yes:    'yes',
    no:     'no',
    unsure: 'unsure',
  };
  const quizAns: QuizAnswers = {
    era:       ageMap[a.age ?? 'unsure'],
    sheathing: yesNoMap[a.reroof ?? 'unsure'],
    // Re-nailing usually goes hand in hand with SWB install on modern
    // reroofs — use the reroof answer as a proxy for both.
    swb:       yesNoMap[a.reroof ?? 'unsure'],
  };
  return scoreQuiz(quizAns)?.recommended ?? 'code_min';
}

/** Synthetic NamedStorm so the existing replay engine can run our
 *  survey ramp. Peak is biased by location — coastal hits get a higher
 *  test wind than suburban so the result is honest for that area. */
function buildSurveyStorm(a: Answers): NamedStorm {
  const peakMph =
    a.area === 'coastal' ? 155 :
    a.area === 'open'    ? 145 :
    a.area === 'suburb'  ? 135 :
    140; // unsure → middle
  return {
    id: 'survey_run',
    name: 'Your storm',
    year: new Date().getFullYear(),
    peakMph,
    landfall: 'Your home',
    note: 'A typical major-hurricane wind event for your location.',
  };
}

/* ─── Verdict mapping — the reveal text + tone after replay finishes ──── */
type VerdictTone = 'good' | 'caution' | 'warn' | 'severe';

interface Verdict {
  tone: VerdictTone;
  headline: string;
  body: string;
  cta: string;
}

function buildVerdict(stage: StageId | null, peakMph: number): Verdict {
  if (!stage || stage === 'drip_edge') {
    return {
      tone: 'good',
      headline: 'Your roof would hold.',
      body:    `At ${peakMph} mph, only the drip edge takes any strain. Shingles, deck, and interior all stay dry.`,
      cta:     'See the engineering breakdown',
    };
  }
  if (stage === 'field_shingles') {
    return {
      tone: 'caution',
      headline: 'Shingles would lift.',
      body:    `At ${peakMph} mph, the field-shingle adhesive strip fails at the corners and edges. Exposed underlayment + visible damage from the street, but the deck itself stays attached.`,
      cta:     'Schedule a free wind-uplift inspection',
    };
  }
  if (stage === 'underlayment') {
    return {
      tone: 'warn',
      headline: 'Water gets in.',
      body:    `At ${peakMph} mph, the underlayment also gives. Water reaches the deck and finds its way into ceilings, drywall, and insulation. Insurance claim almost certain.`,
      cta:     'Get a hardening estimate',
    };
  }
  return {
    tone: 'severe',
    headline: 'Catastrophic failure.',
    body:    `At ${peakMph} mph, sheathing nails withdraw and full panels can lift off the trusses. This is the worst-case outcome — full structural exposure to wind + rain.`,
    cta:     'Talk to us today',
  };
}

/* ─── Component ────────────────────────────────────────────────────────── */
interface Props {
  cascade: CascadeResult;
  isReplaying: boolean;
  onApply: (next: { config: HouseConfig; install: InstallProfileId; storm: NamedStorm }) => void;
  ctaHref?: string;
}

export default function RoofSurvivalQuiz({ cascade, isReplaying, onApply, ctaHref = '/#contact' }: Props) {
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [phase, setPhase] = useState<'questions' | 'running' | 'verdict'>('questions');
  const [showDetails, setShowDetails] = useState(false);
  const [stormPeak, setStormPeak] = useState<number>(140);

  const allAnswered = QUESTIONS.every((q) => answers[q.id] !== null);

  /** Detect replay-end transition (was running → not running) → flip to verdict */
  const wasReplayingRef = useRef(false);
  useEffect(() => {
    if (wasReplayingRef.current && !isReplaying && phase === 'running') {
      setPhase('verdict');
    }
    wasReplayingRef.current = isReplaying;
  }, [isReplaying, phase]);

  const setAnswer = <K extends keyof Answers>(id: K, value: Answers[K]) =>
    setAnswers((p) => ({ ...p, [id]: value }));

  const run = () => {
    const config = mapToConfig(answers);
    const install = mapToInstall(answers);
    const storm = buildSurveyStorm(answers);
    setStormPeak(storm.peakMph);
    onApply({ config, install, storm });
    setPhase('running');
  };

  const reset = () => {
    setAnswers(EMPTY);
    setPhase('questions');
    setShowDetails(false);
  };

  /* ─── PHASE: running ─── (compact "we're playing your storm" banner) */
  if (phase === 'running') {
    return (
      <div className="rsq rsq--running" role="status" aria-live="polite">
        <p className="rsq__running-eyebrow">Running your storm</p>
        <p className="rsq__running-headline">Watch the simulation →</p>
        <p className="rsq__running-body">
          Wind ramping up to {stormPeak} mph. The verdict appears here when the gust finishes.
        </p>
      </div>
    );
  }

  /* ─── PHASE: verdict ─── (the survive/damage/catastrophe reveal) */
  if (phase === 'verdict') {
    const verdict = buildVerdict(cascade.highestStageReached, stormPeak);
    return (
      <div className={`rsq rsq--verdict rsq--${verdict.tone}`} role="region" aria-label="Survival verdict">
        <p className="rsq__verdict-eyebrow">Verdict</p>
        <h3 className="rsq__verdict-headline">{verdict.headline}</h3>
        <p className="rsq__verdict-body">{verdict.body}</p>

        <div className="rsq__verdict-actions">
          <a href={ctaHref} className="btn btn--primary rsq__verdict-cta">
            {verdict.cta} →
          </a>
          <button type="button" onClick={reset} className="rsq__retake">
            Retake quiz <span aria-hidden="true">↻</span>
          </button>
        </div>

        {/* MORE DETAILS — collapsed by default; the "if the viewer
            wants" path. Reveals the technical translation of the
            plain-language answers, plus the cascade physics. */}
        <details className="rsq__details" open={showDetails} onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}>
          <summary className="rsq__details-summary">
            <span>More details</span>
            <span aria-hidden="true" className="rsq__details-icon">+</span>
          </summary>
          <div className="rsq__details-body">
            <p className="rsq__details-eyebrow">How we read your answers</p>
            <ul className="rsq__details-list">
              <li><strong>House:</strong> {cascade.config.stories}-story, {cascade.config.shape}-roof, exposure {cascade.config.exposure}, {cascade.config.enclosed}-enclosed</li>
              <li><strong>Test wind:</strong> {stormPeak} mph (peak gust) — adjusted for your location</li>
              <li><strong>Install profile:</strong> {INSTALL_PROFILES[mapToInstall(answers)].label}</li>
              <li><strong>Shingle uplift capacity:</strong> {cascade.resistance.shingleCapPsf.toFixed(1)} psf</li>
              <li><strong>Field/edge/corner uplift at peak:</strong>{' '}
                {cascade.uplift.field.toFixed(0)} / {cascade.uplift.edge.toFixed(0)} / {cascade.uplift.corner.toFixed(0)} psf
              </li>
            </ul>
            <p className="rsq__details-note">
              Want the full math, code citations, and per-zone breakdown?
              Open the engineering drawer at the bottom of the page.
            </p>
          </div>
        </details>
      </div>
    );
  }

  /* ─── PHASE: questions ─── (the entry quiz) */
  return (
    <div className="rsq" role="region" aria-label="Roof survival quiz">
      <header className="rsq__head">
        <p className="rsq__eyebrow">Will my roof survive?</p>
        <h3 className="rsq__title">
          Six quick questions, then we'll <em>show</em> you.
        </h3>
        <p className="rsq__lead">
          Plain language. No engineering jargon. Pick the closest answer — "I'm not
          sure" is fine and bias the model toward a free inspection.
        </p>
      </header>

      <ol className="rsq__questions">
        {QUESTIONS.map((q, i) => (
          <QuestionRow
            key={q.id}
            n={i + 1}
            q={q as QuestionDef<string | number>}
            value={answers[q.id]}
            onSelect={(v) => setAnswer(q.id, v as never)}
          />
        ))}
      </ol>

      <div className="rsq__cta-row">
        <button
          type="button"
          className="btn btn--primary rsq__run"
          disabled={!allAnswered}
          onClick={run}
        >
          {allAnswered ? 'Run the storm →' : `Answer all ${QUESTIONS.length} questions to continue`}
        </button>
      </div>
    </div>
  );
}

/* ─── Single-question row (extracted for clarity) ──────────────────────── */
function QuestionRow({
  n,
  q,
  value,
  onSelect,
}: {
  n: number;
  q: QuestionDef<string | number>;
  value: string | number | null;
  onSelect: (v: string | number) => void;
}) {
  const done = value !== null;
  return (
    <li className={`rsq__q ${done ? 'is-done' : ''}`}>
      <div className="rsq__q-head">
        <span className="rsq__q-n" aria-hidden="true">0{n}</span>
        <p className="rsq__q-prompt">{q.label}</p>
      </div>
      <div className="rsq__opts" role="radiogroup" aria-label={q.label}>
        {q.options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={String(opt.value)}
              type="button"
              role="radio"
              aria-checked={active}
              className={`rsq__opt ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(opt.value)}
            >
              <span className="rsq__opt-main">{opt.main}</span>
              {opt.sub && <span className="rsq__opt-sub">{opt.sub}</span>}
            </button>
          );
        })}
      </div>
    </li>
  );
}
