import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, TIER_COLOR, type AchievementId } from '../../data/achievements';

interface Props {
  id: AchievementId | null;
  onDismiss: () => void;
}

const VISIBLE_MS = 4200;

/**
 * Pop-in toast that announces an achievement.
 * Auto-dismisses after VISIBLE_MS, calls onDismiss to clear the queue.
 */
export default function AchievementToast({ id, onDismiss }: Props) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out' | null>(null);

  useEffect(() => {
    if (!id) return;
    setPhase('in');
    const inTimer = setTimeout(() => setPhase('hold'), 480);
    const outTimer = setTimeout(() => setPhase('out'), VISIBLE_MS - 380);
    const doneTimer = setTimeout(() => {
      setPhase(null);
      onDismiss();
    }, VISIBLE_MS);
    return () => {
      clearTimeout(inTimer);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, [id, onDismiss]);

  if (!id || !phase) return null;
  const a = ACHIEVEMENTS[id];
  const color = TIER_COLOR[a.tier];

  return (
    <div
      className={`atoast atoast--${phase} atoast--${a.tier}`}
      role="status"
      aria-live="polite"
      style={{ ['--atoast-color' as never]: color }}
    >
      <span className="atoast__shimmer" aria-hidden="true" />
      <span className="atoast__emoji">{a.emoji}</span>
      <span className="atoast__body">
        <span className="atoast__eyebrow">Achievement unlocked &middot; {a.tier}</span>
        <strong className="atoast__title">{a.title}</strong>
        <span className="atoast__desc">{a.description}</span>
      </span>
      <button
        type="button"
        className="atoast__close"
        onClick={() => {
          setPhase('out');
          setTimeout(onDismiss, 380);
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
