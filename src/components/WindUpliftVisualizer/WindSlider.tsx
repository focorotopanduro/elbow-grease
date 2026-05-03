import { SLIDER, NAMED_STORMS, HURRICANE_CATEGORIES } from '../../data/orlando';
import Anemometer from './Anemometer';

interface Props {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}

const range = SLIDER.max - SLIDER.min;
const pct = (v: number) => ((v - SLIDER.min) / range) * 100;

export default function WindSlider({ value, onChange, disabled = false }: Props) {
  const designLow = SLIDER.designBand.min;
  const designHigh = SLIDER.designBand.max;
  const cat = HURRICANE_CATEGORIES.find((c) => value >= c.minMph && value <= c.maxMph);

  return (
    <div
      className={`ws ${disabled ? 'ws--disabled' : ''}`}
      role="group"
      aria-label="Wind speed control"
      aria-disabled={disabled}
    >
      <div className="ws__head">
        <Anemometer value={value} />
        <div className="ws__meta">
          {cat ? (
            <>
              <span className="ws__cat-tag">{cat.label}</span>
              <span className="ws__cat-range">
                {cat.minMph}&ndash;{cat.maxMph} mph
              </span>
            </>
          ) : (
            <span className="ws__cat-tag ws__cat-tag--quiet">
              Tropical-storm range
            </span>
          )}
          <p className="ws__hint">Drag the dial or pick a storm below</p>
        </div>
      </div>

      <div className="ws__track-wrap">
        <div
          className="ws__band"
          style={{
            left: `${pct(designLow)}%`,
            width: `${pct(designHigh) - pct(designLow)}%`,
          }}
          aria-hidden="true"
        >
          <span className="ws__band-label">
            FBC Risk Cat II
            <br />
            <strong>{designLow}&ndash;{designHigh} mph</strong>
          </span>
        </div>

        <input
          type="range"
          min={SLIDER.min}
          max={SLIDER.max}
          step={SLIDER.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          aria-label="Basic wind speed in mph"
          aria-valuemin={SLIDER.min}
          aria-valuemax={SLIDER.max}
          aria-valuenow={value}
          className="ws__input"
        />

        <div className="ws__ticks" aria-hidden="true">
          {[60, 80, 100, 120, 140, 160, 180, 200].map((tick) => (
            <span
              key={tick}
              className="ws__tick"
              style={{ left: `${pct(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
      </div>

      <div className="ws__storms">
        <span className="ws__storms-label">Snap to a named storm</span>
        <div className="ws__storms-list">
          {NAMED_STORMS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ws__storm ${value === s.peakMph ? 'is-active' : ''}`}
              onClick={() => !disabled && onChange(s.peakMph)}
              disabled={disabled}
              aria-label={`${s.name} ${s.year} — ${s.peakMph} mph at ${s.landfall}`}
            >
              <span className="ws__storm-row">
                <span className="ws__storm-name">{s.name}</span>
                <span className="ws__storm-year">'{String(s.year).slice(-2)}</span>
              </span>
              <span className="ws__storm-mph">{s.peakMph} mph</span>
              <span className="ws__storm-land">{s.landfall}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
