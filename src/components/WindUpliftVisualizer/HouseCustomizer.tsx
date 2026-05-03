import {
  WALL_TONES,
  ROOF_TONES,
  DOOR_COLORS,
  type HouseTheme,
  type WallToneId,
  type RoofToneId,
  type DoorColorId,
} from '../../data/houseThemes';

interface Props {
  theme: HouseTheme;
  onWallChange: (id: WallToneId) => void;
  onRoofChange: (id: RoofToneId) => void;
  onDoorChange: (id: DoorColorId) => void;
  onReset: () => void;
}

/**
 * HouseCustomizer — paint the simulator house in your own colors.
 *
 * Three swatch rows: walls, roof shingles, front door. Each row is a row of
 * round chips; the active chip gets a gold ring. Selection persists via
 * useHouseTheme (localStorage), so the homeowner sees the same house when
 * they reload or share the link.
 *
 * Sits inside the geek-details drawer (or anywhere the parent mounts it).
 * Self-contained — accepts state + setters as props, owns no state of its
 * own.
 */
export default function HouseCustomizer({
  theme,
  onWallChange,
  onRoofChange,
  onDoorChange,
  onReset,
}: Props) {
  return (
    <section className="hcust" aria-labelledby="hcust-title">
      <header className="hcust__head">
        <h3 id="hcust-title" className="hcust__title">
          <span aria-hidden="true">🎨</span> Make it look like <em>your</em> house
        </h3>
        <button type="button" className="hcust__reset" onClick={onReset}>
          Reset
        </button>
      </header>

      <div className="hcust__row">
        <p className="hcust__label">Walls</p>
        <div className="hcust__chips" role="radiogroup" aria-label="Wall color">
          {WALL_TONES.map((t) => {
            const active = t.id === theme.wall;
            const cssRgb = (rgb: [number, number, number]) => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`hcust__chip ${active ? 'is-active' : ''}`}
                onClick={() => onWallChange(t.id)}
                title={t.label}
              >
                <span
                  className="hcust__chip-swatch"
                  style={{
                    background: `linear-gradient(180deg, ${cssRgb(t.topCalm)} 0%, ${cssRgb(t.botCalm)} 100%)`,
                  }}
                  aria-hidden="true"
                />
                <span className="hcust__chip-label">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hcust__row">
        <p className="hcust__label">Roof shingles</p>
        <div className="hcust__chips" role="radiogroup" aria-label="Roof color">
          {ROOF_TONES.map((t) => {
            const active = t.id === theme.roof;
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`hcust__chip ${active ? 'is-active' : ''}`}
                onClick={() => onRoofChange(t.id)}
                title={t.label}
              >
                <span
                  className="hcust__chip-swatch"
                  style={{
                    background: `linear-gradient(180deg, ${t.light} 0%, ${t.mid} 50%, ${t.dark} 100%)`,
                  }}
                  aria-hidden="true"
                />
                <span className="hcust__chip-label">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="hcust__row">
        <p className="hcust__label">Front door</p>
        <div className="hcust__chips" role="radiogroup" aria-label="Door color">
          {DOOR_COLORS.map((c) => {
            const active = c.id === theme.door;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`hcust__chip ${active ? 'is-active' : ''}`}
                onClick={() => onDoorChange(c.id)}
                title={c.label}
              >
                <span
                  className="hcust__chip-swatch"
                  style={{ background: c.fill }}
                  aria-hidden="true"
                />
                <span className="hcust__chip-label">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="hcust__hint">
        Your choices stay saved in this browser. Share the link &mdash; your
        spouse will see the same house.
      </p>
    </section>
  );
}
