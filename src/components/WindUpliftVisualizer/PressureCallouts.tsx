import type { CascadeResult } from '../../physics/cascade';

interface Props {
  cascade: CascadeResult;
}

const fmtPsf = (n: number) => `${n.toFixed(1)} psf`;

export default function PressureCallouts({ cascade }: Props) {
  const rows: Array<{
    zone: 'corner' | 'edge' | 'field';
    label: string;
    sub: string;
    uplift: number;
    capacity: number;
    margin: number;
  }> = [
    {
      zone: 'corner',
      label: 'Zone 3 — Corner',
      sub: 'Worst suction. Where failures start.',
      uplift: cascade.uplift.corner,
      capacity: cascade.resistance.corner,
      margin: cascade.marginPsf.corner,
    },
    {
      zone: 'edge',
      label: 'Zone 2 — Edge',
      sub: 'Perimeter strip, 4 ft wide along eaves and rakes.',
      uplift: cascade.uplift.edge,
      capacity: cascade.resistance.edge,
      margin: cascade.marginPsf.edge,
    },
    {
      zone: 'field',
      label: 'Zone 1 — Field',
      sub: 'Interior of the roof. Lowest suction.',
      uplift: cascade.uplift.field,
      capacity: cascade.resistance.field,
      margin: cascade.marginPsf.field,
    },
  ];

  return (
    <div className="pc">
      <header className="pc__head">
        <p className="pc__eyebrow">Net uplift pressure</p>
        <h3 className="pc__title">
          What the wind is doing to each zone of the roof
        </h3>
        <p className="pc__q">
          q = <strong>{cascade.uplift.q.toFixed(2)} psf</strong> at{' '}
          <strong>{cascade.windSpeed} mph</strong>
        </p>
      </header>

      <ul className="pc__rows">
        {rows.map((r) => {
          const ratio = r.uplift / r.capacity;
          const overload = ratio > 1;
          return (
            <li
              key={r.zone}
              className={`pc__row pc__row--${r.zone} ${overload ? 'is-failed' : ''}`}
            >
              <div className="pc__row-head">
                <span className={`pc__zone-dot pc__zone-dot--${r.zone}`} aria-hidden="true" />
                <div>
                  <p className="pc__row-label">{r.label}</p>
                  <p className="pc__row-sub">{r.sub}</p>
                </div>
              </div>

              <div className="pc__numbers">
                <div className="pc__num-block">
                  <span className="pc__num-label">Uplift</span>
                  <strong>{fmtPsf(r.uplift)}</strong>
                </div>
                <div className="pc__num-sep" aria-hidden="true">
                  vs
                </div>
                <div className="pc__num-block">
                  <span className="pc__num-label">Capacity</span>
                  <strong>{fmtPsf(r.capacity)}</strong>
                </div>
                <div className="pc__num-block pc__num-block--margin">
                  <span className="pc__num-label">Margin</span>
                  <strong className={overload ? 'pc__neg' : 'pc__pos'}>
                    {overload ? '−' : '+'}
                    {Math.abs(r.margin).toFixed(1)}
                  </strong>
                </div>
              </div>

              <div className="pc__bar" aria-hidden="true">
                <span
                  className="pc__bar-fill"
                  style={{ width: `${Math.min(140, ratio * 100)}%` }}
                />
                <span className="pc__bar-line" />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
