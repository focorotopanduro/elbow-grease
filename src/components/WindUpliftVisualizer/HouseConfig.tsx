import type { HouseConfig as Config } from '../../physics/pressure';

interface Props {
  value: Config;
  onChange: (next: Config) => void;
}

interface Row<K extends keyof Config> {
  key: K;
  label: string;
  options: Array<{ value: Config[K]; label: string; sub?: string }>;
}

const ROWS: Array<Row<keyof Config>> = [
  {
    key: 'stories',
    label: 'Stories',
    options: [
      { value: 1 as Config['stories'], label: '1 story', sub: 'h = 12 ft' },
      { value: 2 as Config['stories'], label: '2 story', sub: 'h = 25 ft' },
    ],
  } as Row<'stories'>,
  {
    key: 'shape',
    label: 'Roof shape',
    options: [
      { value: 'gable', label: 'Gable', sub: '2 slopes' },
      { value: 'hip', label: 'Hip', sub: '4 slopes — calmer corners' },
    ],
  } as Row<'shape'>,
  {
    key: 'exposure',
    label: 'Site exposure',
    options: [
      { value: 'B', label: 'Suburban', sub: 'Trees, neighbors' },
      { value: 'C', label: 'Open', sub: 'Sparse' },
      { value: 'D', label: 'Coastal', sub: 'Waterfront' },
    ],
  } as Row<'exposure'>,
  {
    key: 'enclosed',
    label: 'Impact-rated openings',
    options: [
      { value: 'fully', label: 'Yes — fully enclosed', sub: 'GCpi ±0.18' },
      { value: 'partial', label: 'No — partially enclosed', sub: 'GCpi ±0.55' },
    ],
  } as Row<'enclosed'>,
];

export default function HouseConfigPanel({ value, onChange }: Props) {
  return (
    <fieldset className="hc">
      <legend className="hc__legend">
        <span>Your house</span>
        <span className="hc__legend-sub">Tune to match your home — every change updates the physics live</span>
      </legend>

      {ROWS.map((row) => (
        <div key={row.key} className="hc__row">
          <span className="hc__row-label">{row.label}</span>
          <div className="hc__opts" role="radiogroup">
            {row.options.map((opt) => {
              const active = value[row.key] === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`hc__opt ${active ? 'is-active' : ''}`}
                  onClick={() =>
                    onChange({ ...value, [row.key]: opt.value } as Config)
                  }
                >
                  <span className="hc__opt-main">{opt.label}</span>
                  {opt.sub && <span className="hc__opt-sub">{opt.sub}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
