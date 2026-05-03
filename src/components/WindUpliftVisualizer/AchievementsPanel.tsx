import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, TIER_COLOR, type AchievementId } from '../../data/achievements';

interface Props {
  unlocked: Set<AchievementId>;
  onShare?: (id: AchievementId) => void;
}

/**
 * Grid of all 12 achievements. Locked = silhouette emoji + grey out.
 * Unlocked = full color + tier color + share button.
 */
export default function AchievementsPanel({ unlocked, onShare }: Props) {
  const total = ACHIEVEMENT_ORDER.length;
  const got = unlocked.size;
  const pct = (got / total) * 100;

  return (
    <section className="ap" aria-label="Achievements">
      <header className="ap__head">
        <p className="eyebrow">Your achievements</p>
        <h3 className="ap__title">
          {got} of {total} unlocked
        </h3>
        <div className="ap__bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={got}>
          <div className="ap__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <ul className="ap__grid">
        {ACHIEVEMENT_ORDER.map((id) => {
          const a = ACHIEVEMENTS[id];
          const isUnlocked = unlocked.has(id);
          const color = TIER_COLOR[a.tier];
          return (
            <li
              key={id}
              className={`ap__card ${isUnlocked ? 'is-unlocked' : 'is-locked'}`}
              style={{ ['--ap-color' as never]: color }}
            >
              <span className="ap__emoji" aria-hidden="true">
                {isUnlocked ? a.emoji : '🔒'}
              </span>
              <span className="ap__body">
                <span className="ap__name">{a.title}</span>
                <span className="ap__desc">
                  {isUnlocked ? a.description : 'Locked — keep playing.'}
                </span>
                <span className="ap__tier">{a.tier}</span>
              </span>
              {isUnlocked && onShare && (
                <button
                  type="button"
                  className="ap__share"
                  onClick={() => onShare(id)}
                  aria-label={`Share ${a.title}`}
                  title={`Share “${a.title}”`}
                >
                  ↗
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
