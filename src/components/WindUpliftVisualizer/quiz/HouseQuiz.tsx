import { useEffect, useState } from 'react';
import {
  QUESTIONS,
  scoreQuiz,
  CONFIDENCE_LABEL,
  CONFIDENCE_BLURB,
  type Answers,
  type AnswerKey,
  type QuizResult,
} from './quizLogic';
import { INSTALL_PROFILES, type InstallProfileId } from '../../../physics/resistance';
import './HouseQuiz.css';

interface Props {
  /** Currently active install profile (for the summary view) */
  activeProfile: InstallProfileId;
  /** Apply the recommended profile to the visualizer */
  onApply: (profile: InstallProfileId) => void;
}

const CONFIDENCE_COLOR = {
  low: '#a8421a',
  medium: '#c45a1a',
  high: '#2d6e3f',
} as const;

export default function HouseQuiz({ activeProfile, onApply }: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const [collapsed, setCollapsed] = useState(false);
  const [appliedProfile, setAppliedProfile] = useState<InstallProfileId | null>(null);

  const result: QuizResult | null = scoreQuiz(answers);
  const allAnswered = Boolean(result);

  // Smooth focus to result when it appears
  useEffect(() => {
    if (allAnswered) {
      const el = document.getElementById('hq-result');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [allAnswered]);

  const setAnswer = (id: typeof QUESTIONS[number]['id'], v: AnswerKey) => {
    setAnswers((prev) => ({ ...prev, [id]: v }));
  };

  const apply = () => {
    if (!result) return;
    onApply(result.recommended);
    setAppliedProfile(result.recommended);
    setCollapsed(true);
  };

  const reset = () => {
    setAnswers({});
    setAppliedProfile(null);
    setCollapsed(false);
  };

  if (collapsed && appliedProfile) {
    const p = INSTALL_PROFILES[appliedProfile];
    return (
      <div className="hq hq--collapsed" role="region" aria-label="Roof diagnostic summary">
        <div className="hq__summary">
          <div>
            <p className="hq__summary-eyebrow">Your roof (from the quiz)</p>
            <p className="hq__summary-name">{p.label}</p>
            <p className="hq__summary-sub">
              {result && (
                <>
                  <span
                    className="hq__conf-pill"
                    style={{
                      background: `${CONFIDENCE_COLOR[result.confidence]}1a`,
                      color: CONFIDENCE_COLOR[result.confidence],
                      borderColor: `${CONFIDENCE_COLOR[result.confidence]}55`,
                    }}
                  >
                    {CONFIDENCE_LABEL[result.confidence]}
                  </span>
                  {result.needsInspection && (
                    <span className="hq__insp-pill">
                      Free inspection recommended
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <button type="button" onClick={reset} className="hq__retake">
            Retake quiz <span aria-hidden="true">↻</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hq" role="region" aria-label="Roof diagnostic quiz">
      <header className="hq__head">
        <p className="eyebrow">Lead-magnet diagnostic</p>
        <h3 className="hq__title">
          What does <em>your roof</em> probably have?
        </h3>
        <p className="hq__lead">
          Three questions. Answer to the best of your knowledge — "I'm not sure"
          counts as a real answer and biases the model toward "schedule an
          inspection." Skips ahead to the right install profile in the simulator.
        </p>
      </header>

      <ol className="hq__questions">
        {QUESTIONS.map((q, i) => (
          <li key={q.id} className={`hq__q ${answers[q.id] ? 'is-done' : ''}`}>
            <div className="hq__q-head">
              <span className="hq__q-n" aria-hidden="true">0{i + 1}</span>
              <div>
                <p className="hq__q-prompt">{q.prompt}</p>
                <p className="hq__q-hint">{q.hint}</p>
              </div>
            </div>
            <div className="hq__opts" role="radiogroup" aria-label={q.prompt}>
              {q.options.map((opt) => {
                const active = answers[q.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`hq__opt ${active ? 'is-active' : ''}`}
                    onClick={() => setAnswer(q.id, opt.value)}
                  >
                    <span className="hq__opt-main">{opt.label}</span>
                    {opt.sub && <span className="hq__opt-sub">{opt.sub}</span>}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ol>

      {allAnswered && result && (
        <div id="hq-result" className="hq__result" aria-live="polite">
          <div className="hq__result-head">
            <p className="hq__result-eyebrow">Recommended profile</p>
            <p className="hq__result-name">
              {INSTALL_PROFILES[result.recommended].label}
            </p>
            <p
              className="hq__result-conf"
              style={{ color: CONFIDENCE_COLOR[result.confidence] }}
            >
              {CONFIDENCE_LABEL[result.confidence]}
              <span className="hq__result-blurb">
                {CONFIDENCE_BLURB[result.confidence]}
              </span>
            </p>
          </div>

          <div className="hq__bars" aria-hidden="true">
            <div className="hq__bar">
              <span className="hq__bar-label">Pre-2002 evidence</span>
              <div className="hq__bar-track">
                <span
                  className="hq__bar-fill"
                  style={{ width: `${(result.scores.code_min / 10) * 100}%` }}
                />
              </div>
              <span className="hq__bar-val">{result.scores.code_min}</span>
            </div>
            <div className="hq__bar">
              <span className="hq__bar-label">FBC + WBDR evidence</span>
              <div className="hq__bar-track">
                <span
                  className="hq__bar-fill hq__bar-fill--alt"
                  style={{ width: `${(result.scores.fbc_wbdr / 10) * 100}%` }}
                />
              </div>
              <span className="hq__bar-val">{result.scores.fbc_wbdr}</span>
            </div>
          </div>

          <div className="hq__actions">
            <button
              type="button"
              onClick={apply}
              className="btn btn--primary hq__apply"
              disabled={result.recommended === activeProfile}
            >
              {result.recommended === activeProfile
                ? 'Already applied ✓'
                : 'Apply to simulator →'}
            </button>
            {result.needsInspection && (
              <a
                href="/#contact?utm_source=visualizer&utm_medium=quiz&utm_campaign=wind_uplift_quiz"
                className="hq__cta-secondary"
              >
                Schedule a free inspection →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
