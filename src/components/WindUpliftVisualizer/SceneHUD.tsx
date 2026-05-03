import { useEffect, useRef, useState } from 'react';
import { TIME_OF_DAY, type TimeOfDayId } from '../../data/timeOfDay';
import type { NamedStorm } from '../../data/orlando';
import type { AchievementId } from '../../data/achievements';
import type { ViewMode } from './useViewMode';
import type { ReplayState } from './effects/useStormReplay';
import WindGauge from './WindGauge';
import StormReplayHUD from './StormReplayHUD';
import AchievementHUD from './AchievementHUD';
import SceneShot from './SceneShot';

const TOD_ICONS: Record<TimeOfDayId, string> = {
  dawn: '🌅',
  midday: '☀',
  dusk: '🌇',
  night: '🌙',
};

interface Props {
  // Time of day
  tod: TimeOfDayId;
  onTodChange: (id: TimeOfDayId) => void;
  cycling: boolean;
  onToggleCycle: () => void;
  // View mode
  viewMode: ViewMode;
  onViewChange: (mode: ViewMode) => void;
  /** Current wind speed (read-only HUD readout) */
  windSpeed: number;
  /** Storm replay state + actions (full state machine) */
  replay: {
    state: ReplayState;
    start: (s: NamedStorm) => void;
    pause: () => void;
    resume: () => void;
    stop: () => void;
    restart: () => void;
  };
  /** Set of unlocked achievement IDs (drives the trophy ribbon at top-center) */
  achievementsUnlocked: Set<AchievementId>;
  /** Optional share-this-achievement handler — opens native share or copies text */
  onShareAchievement?: (id: AchievementId) => void;
  /** Tooltips toggle state (educational labels mode) */
  labelsEnabled: boolean;
  /** Toggle handler */
  onToggleLabels: () => void;
}

/**
 * SceneHUD — minimalist videogame-style HUD pinned inside the scene corners.
 *
 * Pods:
 *   ▴ top-left  : current Time-of-Day icon. Click to expand the full TOD
 *                 picker (4 chips + cycle button) as a popover.
 *   ▸ top-right : current View Mode icon. Click to expand a Front/Iso
 *                 popover.
 *   ▾ bottom-right: cycling indicator (only visible when auto-cycle is on).
 *
 * Closed-state cost: two ~32px icons in opposite corners → spatial
 * symmetry, near-zero visual weight, no chrome above or below the scene.
 * Open-state: floating glass popover with the full controls. Click outside
 * to close. Esc to close.
 */
export default function SceneHUD({
  tod, onTodChange, cycling, onToggleCycle,
  viewMode, onViewChange,
  windSpeed,
  replay,
  achievementsUnlocked,
  onShareAchievement,
  labelsEnabled,
  onToggleLabels,
}: Props) {
  const [open, setOpen] = useState<'tod' | 'view' | null>(null);
  const podLeftRef = useRef<HTMLDivElement>(null);
  const podRightRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (podLeftRef.current?.contains(target)) return;
      if (podRightRef.current?.contains(target)) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      {/* TOP-CENTER — Achievement ribbon */}
      <AchievementHUD unlocked={achievementsUnlocked} onShare={onShareAchievement} />

      {/* TOP-LEFT — Time of Day */}
      <div ref={podLeftRef} className={`hud-pod hud-pod--tl ${open === 'tod' ? 'is-open' : ''}`}>
        <button
          type="button"
          className="hud-pod__btn"
          aria-label={`Time of day: ${TIME_OF_DAY[tod].label}. Click to change.`}
          aria-expanded={open === 'tod'}
          onClick={() => setOpen((o) => (o === 'tod' ? null : 'tod'))}
        >
          <span className="hud-pod__icon" aria-hidden="true">{TOD_ICONS[tod]}</span>
          {cycling && <span className="hud-pod__pulse" aria-hidden="true" />}
        </button>

        {open === 'tod' && (
          <div className="hud-popover hud-popover--tl" role="menu">
            <div className="hud-popover__head">
              <span className="hud-popover__label">Time of day</span>
              {onToggleCycle && (
                <button
                  type="button"
                  className={`hud-cycle ${cycling ? 'is-active' : ''}`}
                  onClick={onToggleCycle}
                  aria-pressed={cycling}
                  title={cycling ? 'Stop the 24-hour demo' : 'Auto-cycle dawn → midday → dusk → night'}
                >
                  {cycling ? '⏸ Stop' : '▶ Cycle'}
                </button>
              )}
            </div>
            <div className="hud-popover__chips" role="radiogroup" aria-label="Time of day">
              {(Object.keys(TIME_OF_DAY) as TimeOfDayId[]).map((id) => {
                const t = TIME_OF_DAY[id];
                const active = tod === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`hud-chip ${active ? 'is-active' : ''}`}
                    onClick={() => { onTodChange(id); setOpen(null); }}
                  >
                    <span aria-hidden="true">{TOD_ICONS[id]}</span> {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM-LEFT — Wind speed gauge (read-only HUD readout) */}
      <div className="hud-pod hud-pod--bl hud-pod--gauge" aria-hidden="true">
        <WindGauge V={windSpeed} />
      </div>

      {/* TOP-RIGHT — View Mode */}
      <div ref={podRightRef} className={`hud-pod hud-pod--tr ${open === 'view' ? 'is-open' : ''}`}>
        <button
          type="button"
          className="hud-pod__btn"
          aria-label={`View mode: ${viewMode === 'iso' ? 'Isometric' : 'Front'}. Click to change.`}
          aria-expanded={open === 'view'}
          onClick={() => setOpen((o) => (o === 'view' ? null : 'view'))}
        >
          <span className="hud-pod__icon" aria-hidden="true">
            {viewMode === 'iso' ? (
              <svg viewBox="0 0 24 16" width="18" height="14">
                <polygon points="2,11 12,5 22,11 12,17" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <line x1="12" y1="5" x2="12" y2="17" stroke="currentColor" strokeWidth="0.8" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 16" width="18" height="14">
                <polygon points="2,8 12,2 22,8" fill="currentColor" opacity="0.55" />
                <rect x="2" y="8" width="20" height="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="10" y="10" width="4" height="4" fill="currentColor" opacity="0.7" />
              </svg>
            )}
          </span>
        </button>

        {open === 'view' && (
          <div className="hud-popover hud-popover--tr" role="menu">
            <div className="hud-popover__head">
              <span className="hud-popover__label">View mode</span>
            </div>
            <div className="hud-popover__chips" role="radiogroup" aria-label="View mode">
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'front'}
                className={`hud-chip ${viewMode === 'front' ? 'is-active' : ''}`}
                onClick={() => { onViewChange('front'); setOpen(null); }}
              >
                Front · Homeowner
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={viewMode === 'iso'}
                className={`hud-chip ${viewMode === 'iso' ? 'is-active' : ''}`}
                onClick={() => { onViewChange('iso'); setOpen(null); }}
              >
                Isometric · Engineer
              </button>
            </div>
            {/* Labels toggle — educational hover layer */}
            <div className="hud-popover__divider" aria-hidden="true" />
            <button
              type="button"
              className={`hud-chip hud-chip--toggle ${labelsEnabled ? 'is-active' : ''}`}
              onClick={onToggleLabels}
              aria-pressed={labelsEnabled}
              title="Toggle educational tooltips on every major scene element"
            >
              <span className="hud-chip__indicator" aria-hidden="true">
                {labelsEnabled ? '●' : '○'}
              </span>
              Labels {labelsEnabled ? 'on' : 'off'}
              <span className="hud-chip__hint">— hover any element</span>
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM-RIGHT — Storm Replay (4-corner symmetry achieved) */}
      <StormReplayHUD
        state={replay.state}
        onStart={replay.start}
        onPause={replay.pause}
        onResume={replay.resume}
        onStop={replay.stop}
        onRestart={replay.restart}
      />

      {/* SCENE SHOT — small camera button left of the StormReplay pod.
          Filename encodes current wind speed + TOD + view for context. */}
      <SceneShot filenameContext={`${Math.round(windSpeed)}mph-${tod}-${viewMode}`} />
    </>
  );
}
