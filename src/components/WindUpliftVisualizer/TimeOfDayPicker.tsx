import { TIME_OF_DAY, type TimeOfDayId } from '../../data/timeOfDay';

interface Props {
  value: TimeOfDayId;
  onChange: (id: TimeOfDayId) => void;
  /** Whether auto-cycle demo mode is active */
  cycling?: boolean;
  /** Toggle auto-cycle on/off */
  onToggleCycle?: () => void;
}

const ICONS: Record<TimeOfDayId, string> = {
  dawn: '🌅',
  midday: '☀️',
  dusk: '🌇',
  night: '🌙',
};

/**
 * TimeOfDayPicker — four-pill row that swaps the entire scene's lighting
 * palette. Lives inside the geek-details drawer.
 */
export default function TimeOfDayPicker({ value, onChange, cycling = false, onToggleCycle }: Props) {
  const ids = Object.keys(TIME_OF_DAY) as TimeOfDayId[];
  return (
    <section className="todp" aria-labelledby="todp-title">
      <header className="todp__head">
        <h3 id="todp-title" className="todp__title">
          <span aria-hidden="true">⏱</span> Time of day
          <span className="todp__hint">— sun moves, sky changes, shadows shift</span>
        </h3>
        {onToggleCycle && (
          <button
            type="button"
            className={`todp__cycle ${cycling ? 'is-active' : ''}`}
            onClick={onToggleCycle}
            aria-pressed={cycling}
            title={cycling ? 'Stop the 24-hour demo' : 'Auto-cycle dawn → midday → dusk → night'}
          >
            <span aria-hidden="true">{cycling ? '⏸' : '▶'}</span>
            {cycling ? 'Stop cycle' : 'Cycle 24h'}
          </button>
        )}
      </header>
      <div className="todp__chips" role="radiogroup" aria-label="Time of day">
        {ids.map((id) => {
          const t = TIME_OF_DAY[id];
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`todp__chip ${active ? 'is-active' : ''}`}
              onClick={() => onChange(id)}
              title={t.label}
            >
              <span className="todp__chip-icon" aria-hidden="true">{ICONS[id]}</span>
              <span className="todp__chip-label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
