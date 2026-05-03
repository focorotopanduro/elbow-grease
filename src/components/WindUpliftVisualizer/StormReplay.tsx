import { NAMED_STORMS } from '../../data/orlando';
import type { ReplayState } from './effects/useStormReplay';
import type { CascadeResult, StageId } from '../../physics/cascade';

interface Props {
  state: ReplayState;
  onStart: (storm: typeof NAMED_STORMS[number]) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRestart: () => void;
  cascade: CascadeResult;
}

const STAGE_LABEL: Record<StageId, string> = {
  drip_edge: 'Drip',
  field_shingles: 'Shingles',
  underlayment: 'Layer 2',
  sheathing: 'Deck',
};

const STAGE_COLOR: Record<StageId, string> = {
  drip_edge: '#f5894d',
  field_shingles: '#eb6924',
  underlayment: '#c45a1a',
  sheathing: '#a8421a',
};

export default function StormReplay({
  state,
  onStart,
  onPause,
  onResume,
  onStop,
  onRestart,
  cascade,
}: Props) {
  const { isPlaying, isPaused, progress, V, storm, duration, elapsed } = state;

  // Active triggered stages — for the timeline event markers
  const activeStages = cascade.stages.filter((s) => s.triggered).map((s) => s.id as StageId);

  // ARIA-live narration string — screen-reader friendly summary that updates
  // as the storm progresses
  const narration = (() => {
    if (!isPlaying || !storm) return '';
    const phase = progress < 0.3
      ? 'Wind ramping up'
      : progress < 0.6
      ? 'At peak intensity'
      : progress < 0.9
      ? 'Wind decaying'
      : 'Storm passing';
    const top = activeStages[activeStages.length - 1];
    const damage = top
      ? `${STAGE_LABEL[top]} layer has failed.`
      : 'No layer failures yet.';
    return `${storm.name} replay at ${V} miles per hour. ${phase}. ${damage}`;
  })();

  return (
    <section className="sr" aria-label="Storm replay control">
      {/* Screen-reader live narration */}
      <div className="sr__sr-only" aria-live="polite" role="status">
        {narration}
      </div>

      <header className="sr__head">
        <p className="eyebrow">Cinematic mode</p>
        <h3 className="sr__title">
          Storm <em>replay</em>
        </h3>
        <p className="sr__lead">
          Pick a hurricane. Watch the wind climb to peak, plateau in the
          eyewall, and decay — on a real timeline. Track which roof layers
          fail and at what second.
        </p>
      </header>

      {!isPlaying && (
        <div className="sr__choices">
          {NAMED_STORMS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onStart(s)}
              className="sr__choice"
              aria-label={`Replay ${s.name} ${s.year}, peak ${s.peakMph} mph`}
            >
              <span className="sr__choice-play" aria-hidden="true">
                <svg viewBox="0 0 12 12">
                  <path d="M 3 2 L 10 6 L 3 10 Z" fill="currentColor" />
                </svg>
              </span>
              <span className="sr__choice-body">
                <span className="sr__choice-name">
                  <strong>{s.name}</strong> &middot; '{String(s.year).slice(-2)}
                </span>
                <span className="sr__choice-peak">{s.peakMph} mph peak</span>
                <span className="sr__choice-land">{s.landfall}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {isPlaying && storm && (
        <div className="sr__playing">
          <div className="sr__live">
            <div className="sr__live-meta">
              <span className="sr__live-label">Now playing</span>
              <span className="sr__live-name">
                <strong>{storm.name}</strong> '{String(storm.year).slice(-2)} &middot; {storm.landfall}
              </span>
            </div>
            <div className="sr__live-readout">
              <span className="sr__live-v">{V}</span>
              <span className="sr__live-unit">mph</span>
            </div>
          </div>

          {/* Timeline scrub bar with cascade event markers */}
          <div
            className="sr__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={Number(elapsed.toFixed(1))}
          >
            <div className="sr__bar-track">
              <div className="sr__bar-fill" style={{ width: `${progress * 100}%` }} />
              {activeStages.map((id) => (
                <span
                  key={id}
                  className="sr__bar-mark"
                  style={{ left: `${progress * 100}%`, color: STAGE_COLOR[id] }}
                  title={STAGE_LABEL[id]}
                >
                  <span className="sr__bar-mark-dot" />
                </span>
              ))}
            </div>
            <div className="sr__bar-times">
              <span>0:00</span>
              <span>{Math.round(duration)}:00</span>
            </div>
          </div>

          {/* Live cascade ribbon — tiny pills lighting up as stages trigger */}
          <ul className="sr__events">
            {cascade.stages.map((s) => (
              <li
                key={s.id}
                className={`sr__event ${s.triggered ? 'is-on' : ''}`}
                style={s.triggered ? { color: STAGE_COLOR[s.id as StageId] } : {}}
              >
                <span className="sr__event-dot" />
                {STAGE_LABEL[s.id as StageId]}
              </li>
            ))}
          </ul>

          <div className="sr__controls">
            {!isPaused ? (
              <button type="button" onClick={onPause} className="sr__btn sr__btn--secondary">
                <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3" y="2" width="2" height="8" /><rect x="7" y="2" width="2" height="8" /></svg>
                Pause
              </button>
            ) : (
              <button type="button" onClick={onResume} className="sr__btn sr__btn--secondary">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M 3 2 L 10 6 L 3 10 Z" /></svg>
                Resume
              </button>
            )}
            <button type="button" onClick={onRestart} className="sr__btn sr__btn--secondary">
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M 6 2 a 4 4 0 1 1 -3.5 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <path d="M 6 0 L 6 4 L 2 2 Z" fill="currentColor" />
              </svg>
              Restart
            </button>
            <button type="button" onClick={onStop} className="sr__btn sr__btn--ghost">
              Exit replay
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
