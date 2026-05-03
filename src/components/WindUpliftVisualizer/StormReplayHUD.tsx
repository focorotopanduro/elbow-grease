import { useEffect, useRef, useState } from 'react';
import { NAMED_STORMS, type NamedStorm } from '../../data/orlando';
import type { ReplayState } from './effects/useStormReplay';

interface Props {
  state: ReplayState;
  onStart: (storm: NamedStorm) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRestart: () => void;
}

/**
 * StormReplayHUD — bottom-right HUD pod that owns the entire storm replay
 * experience. Three states mirror useStormReplay:
 *
 *   IDLE     — large play icon. Click → popover with 4 storm cards.
 *   PLAYING  — pause icon ringed by a gold progress arc. Click → pause.
 *              Tiny caption beneath the pod: "Andrew · 145 mph".
 *   PAUSED   — resume icon + small overflow toolbar with restart + stop.
 *
 * The popover anchors to the pod's top-right and opens upward (since the
 * pod lives at the bottom-right corner). Click outside / Esc closes it.
 *
 * Replaces the standalone <StormReplay /> row that previously consumed
 * ~150px of vertical space below the scene. Now the entire mechanism
 * lives in a single 38px circle with a popover.
 */
export default function StormReplayHUD({
  state, onStart, onPause, onResume, onStop, onRestart,
}: Props) {
  const [open, setOpen] = useState(false);
  const podRef = useRef<HTMLDivElement>(null);

  const { isPlaying, isPaused, storm, progress, V } = state;

  // Click outside / Esc closes the popover
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (podRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Single primary-action handler — the pod's main button does different
  // things depending on current state. Tap-to-toggle.
  const onPrimaryClick = () => {
    if (!isPlaying) {
      setOpen((o) => !o);
    } else if (!isPaused) {
      onPause();
    } else {
      onResume();
    }
  };

  // Progress ring math — circle r=16 inside the 38px pod
  const r = 16;
  const C = 2 * Math.PI * r;
  const dashOffset = C * (1 - progress);

  const primaryAriaLabel = !isPlaying
    ? 'Open storm picker'
    : isPaused
      ? `Resume ${storm?.name ?? 'storm'} replay`
      : `Pause ${storm?.name ?? 'storm'} replay`;

  return (
    <div
      ref={podRef}
      className={[
        'hud-pod',
        'hud-pod--br',
        'hud-pod--replay',
        isPlaying ? 'is-playing' : '',
        isPaused ? 'is-paused' : '',
        open ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Primary action button — play / pause / resume in one place */}
      <button
        type="button"
        className="hud-pod__btn hud-replay__btn"
        onClick={onPrimaryClick}
        aria-label={primaryAriaLabel}
        aria-expanded={!isPlaying && open}
      >
        {/* Progress ring overlay (only when playing) */}
        {isPlaying && (
          <svg className="hud-replay__ring" viewBox="0 0 38 38" aria-hidden="true">
            <circle
              cx="19" cy="19" r={r}
              fill="none"
              stroke="rgba(212, 175, 55, 0.16)"
              strokeWidth="1.6"
            />
            <circle
              cx="19" cy="19" r={r}
              fill="none"
              stroke="var(--gold)"
              strokeWidth="2.2"
              strokeDasharray={C.toFixed(2)}
              strokeDashoffset={dashOffset.toFixed(2)}
              strokeLinecap="round"
              transform="rotate(-90 19 19)"
            />
          </svg>
        )}

        {/* State-driven center icon */}
        <span className="hud-pod__icon hud-replay__icon" aria-hidden="true">
          {!isPlaying ? (
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M 3.5 2 L 10 6 L 3.5 10 Z" fill="currentColor" />
            </svg>
          ) : isPaused ? (
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M 3.5 2 L 10 6 L 3.5 10 Z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 12 12" width="12" height="12">
              <rect x="3" y="2" width="2.2" height="8" fill="currentColor" />
              <rect x="6.8" y="2" width="2.2" height="8" fill="currentColor" />
            </svg>
          )}
        </span>
      </button>

      {/* Caption beneath pod when playing — shows current storm + V */}
      {isPlaying && storm && (
        <div className="hud-replay__caption" aria-live="polite" role="status">
          <strong>{storm.name}</strong>
          <span className="hud-replay__caption-sep">·</span>
          <span className="hud-replay__caption-v">{V} mph</span>
        </div>
      )}

      {/* Paused: tiny overflow toolbar reveals restart + stop next to pod */}
      {isPlaying && isPaused && (
        <div className="hud-replay__paused-tools">
          <button
            type="button"
            className="hud-replay__tool"
            onClick={onRestart}
            title="Restart"
            aria-label="Restart replay"
          >
            <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
              <path d="M 7 2.5 a 4.5 4.5 0 1 1 -4 6.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              <path d="M 7 0 L 7 4.5 L 3 2.5 Z" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="hud-replay__tool hud-replay__tool--danger"
            onClick={onStop}
            title="Exit replay"
            aria-label="Exit replay"
          >
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <rect x="2" y="2" width="8" height="8" fill="currentColor" />
            </svg>
          </button>
        </div>
      )}

      {/* Storm picker popover (idle state only) */}
      {!isPlaying && open && (
        <div className="hud-popover hud-popover--br" role="menu">
          <div className="hud-popover__head">
            <span className="hud-popover__label">Replay a real storm</span>
          </div>
          <div className="hud-replay__cards">
            {NAMED_STORMS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className="hud-storm-card"
                onClick={() => { onStart(s); setOpen(false); }}
                aria-label={`Replay ${s.name} ${s.year}, peak ${s.peakMph} mph`}
              >
                <span className="hud-storm-card__head">
                  <span className="hud-storm-card__name">{s.name}</span>
                  <span className="hud-storm-card__year">'{String(s.year).slice(-2)}</span>
                </span>
                <span className="hud-storm-card__meta">
                  <span className="hud-storm-card__peak">{s.peakMph} mph</span>
                  <span className="hud-storm-card__land">{s.landfall}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
