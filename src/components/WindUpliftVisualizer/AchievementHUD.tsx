import { useEffect, useRef, useState } from 'react';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_ORDER,
  TIER_COLOR,
  type AchievementId,
} from '../../data/achievements';

interface Props {
  unlocked: Set<AchievementId>;
  onShare?: (id: AchievementId) => void;
}

/**
 * AchievementHUD — top-center ribbon (collapsed) + downward-opening popover
 * with the full trophy grid. Replaces the old `<AchievementsPanel>` row that
 * sat below CompareProfiles, freeing ~140px of vertical space.
 *
 * Three behaviors:
 *
 *   1. RIBBON — small `🏆 N/M` pill pinned at top-center of the scene. Goes
 *      gold when fully unlocked (got === total).
 *   2. CELEBRATE — when `unlocked.size` increases, the ribbon briefly pulses
 *      a gold ring outward + does a 1.2s scale bounce on the count. Layered
 *      ON TOP of the existing AchievementToast (which still fires its own
 *      "achievement unlocked!" notification).
 *   3. POPOVER — click ribbon → glass panel slides down from below the pill,
 *      showing the full 12-tile grid (4 cols × 3 rows). Locked tiles are
 *      grayscale; unlocked tiles get full color + tier accent + a "↗"
 *      share button on hover.
 *
 * Click outside / Esc closes. Owns its own open state (each HUD pod manages
 * its own state independently — clicking a different pod auto-closes this
 * one via the outside-click handler).
 */
export default function AchievementHUD({ unlocked, onShare }: Props) {
  const [open, setOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const ribbonRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef<number>(unlocked.size);

  const total = ACHIEVEMENT_ORDER.length;
  const got = unlocked.size;
  const isComplete = got === total && total > 0;
  const isEmpty = got === 0;

  // Celebrate when count goes up — drives the pulse + count bounce
  useEffect(() => {
    if (got > lastCountRef.current) {
      setCelebrate(true);
      const t = window.setTimeout(() => setCelebrate(false), 1500);
      lastCountRef.current = got;
      return () => window.clearTimeout(t);
    }
    lastCountRef.current = got;
  }, [got]);

  // Click outside / Esc closes the popover
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ribbonRef.current?.contains(e.target as Node)) return;
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

  return (
    <div
      ref={ribbonRef}
      className={[
        'hud-ribbon',
        isComplete ? 'is-complete' : '',
        isEmpty ? 'is-empty' : '',
        celebrate ? 'is-celebrating' : '',
        open ? 'is-open' : '',
      ].filter(Boolean).join(' ')}
    >
      {/* Collapsed ribbon button */}
      <button
        type="button"
        className="hud-ribbon__btn"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Achievements: ${got} of ${total} unlocked. Click to view all.`}
        aria-expanded={open}
      >
        <span className="hud-ribbon__icon" aria-hidden="true">🏆</span>
        <span className="hud-ribbon__count" aria-live="polite">
          <span className={`hud-ribbon__got ${celebrate ? 'is-bumping' : ''}`}>{got}</span>
          <span className="hud-ribbon__sep">/</span>
          <span className="hud-ribbon__total">{total}</span>
        </span>
        {celebrate && <span className="hud-ribbon__halo" aria-hidden="true" />}
      </button>

      {/* Trophy grid popover (opens downward into the scene) */}
      {open && (
        <div className="hud-popover hud-popover--top hud-popover--ribbon" role="menu">
          <div className="hud-popover__head">
            <span className="hud-popover__label">Achievements · {got}/{total}</span>
            <button
              type="button"
              className="hud-ribbon__close"
              onClick={() => setOpen(false)}
              aria-label="Close achievements"
            >
              ×
            </button>
          </div>
          {/* Progress bar mirrors the now-removed AchievementsPanel one */}
          <div
            className="hud-ribbon__progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={got}
          >
            <div className="hud-ribbon__progress-fill" style={{ width: `${(got / total) * 100}%` }} />
          </div>
          {/* Trophy grid — 4 columns × 3 rows */}
          <div className="hud-trophy-grid">
            {ACHIEVEMENT_ORDER.map((id) => {
              const a = ACHIEVEMENTS[id];
              const isUnlocked = unlocked.has(id);
              const color = TIER_COLOR[a.tier];
              return (
                <div
                  key={id}
                  className={`hud-trophy-tile ${isUnlocked ? 'is-unlocked' : 'is-locked'}`}
                  style={{ ['--trophy-color' as never]: color }}
                  title={isUnlocked ? `${a.title} — ${a.description}` : 'Locked — keep playing'}
                >
                  <span className="hud-trophy-tile__emoji" aria-hidden="true">
                    {isUnlocked ? a.emoji : '🔒'}
                  </span>
                  <span className="hud-trophy-tile__name">
                    {isUnlocked ? a.title : '—'}
                  </span>
                  <span className="hud-trophy-tile__tier">{a.tier}</span>
                  {isUnlocked && onShare && (
                    <button
                      type="button"
                      className="hud-trophy-tile__share"
                      onClick={(e) => { e.stopPropagation(); onShare(id); }}
                      aria-label={`Share ${a.title}`}
                      title={`Share "${a.title}"`}
                    >
                      ↗
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
