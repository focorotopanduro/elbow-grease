import { useMemo } from 'react';
import { SLIDER } from '../../data/orlando';
import { orlandoUpliftProfile } from '../../physics/pressure';
import type { CascadeResult } from '../../physics/cascade';
import type { ResistanceProfile } from '../../physics/resistance';

interface Props {
  cascade: CascadeResult;
  resistance: ResistanceProfile;
}

/**
 * Capacity vs uplift, drawn as a small SVG chart. Shows the parabolic
 * suction curves for the three roof zones along with the install profile's
 * shingle and sheathing capacities as horizontal "ceilings". The current
 * wind speed is marked. Where a curve crosses a ceiling = failure threshold.
 *
 * Pure SVG, no chart library. Curves are sampled once per render and memoised.
 */
export default function UpliftChart({ cascade, resistance }: Props) {
  const W = 480;
  const H = 220;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const Vmin = SLIDER.min;
  const Vmax = SLIDER.max;
  // y-axis upper bound — pick the larger of the worst uplift at Vmax and
  // the sheathing capacity, so the highest capacity line is always visible
  const yMax = useMemo(() => {
    const corner = orlandoUpliftProfile(Vmax).corner;
    return Math.ceil(Math.max(corner, resistance.sheathing.corner) / 20) * 20;
  }, [Vmax, resistance]);

  const xScale = (V: number) => padL + ((V - Vmin) / (Vmax - Vmin)) * innerW;
  const yScale = (psf: number) => padT + innerH - (psf / yMax) * innerH;

  const samples = useMemo(() => {
    const arr: { V: number; field: number; edge: number; corner: number }[] = [];
    for (let V = Vmin; V <= Vmax; V += 5) {
      const p = orlandoUpliftProfile(V);
      arr.push({ V, field: p.field, edge: p.edge, corner: p.corner });
    }
    return arr;
  }, [Vmin, Vmax]);

  const path = (key: 'field' | 'edge' | 'corner') =>
    samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'} ${xScale(s.V).toFixed(1)} ${yScale(s[key]).toFixed(1)}`)
      .join(' ');

  const yTicks = [0, Math.round(yMax / 4), Math.round(yMax / 2), Math.round((3 * yMax) / 4), yMax];

  const curV = cascade.windSpeed;

  return (
    <figure className="uc">
      <figcaption className="uc__caption">
        <p className="eyebrow">The math, drawn</p>
        <h3 className="uc__title">Uplift vs capacity across wind speed</h3>
        <p className="uc__sub">
          Each curve climbs as the square of wind speed. Where a curve crosses a
          dashed capacity line, that layer fails. Your current wind speed is the
          vertical marker.
        </p>
      </figcaption>

      <svg viewBox={`0 0 ${W} ${H}`} className="uc__svg" role="img" aria-label="Uplift versus capacity chart">
        {/* y grid */}
        {yTicks.map((y) => (
          <g key={y}>
            <line
              x1={padL}
              y1={yScale(y)}
              x2={W - padR}
              y2={yScale(y)}
              className="uc__grid"
            />
            <text x={padL - 8} y={yScale(y) + 3} className="uc__tick" textAnchor="end">
              {y}
            </text>
          </g>
        ))}

        {/* x ticks */}
        {[60, 100, 140, 180].map((V) => (
          <g key={V}>
            <line x1={xScale(V)} y1={padT + innerH} x2={xScale(V)} y2={padT + innerH + 4} className="uc__grid" />
            <text x={xScale(V)} y={padT + innerH + 16} className="uc__tick" textAnchor="middle">
              {V}
            </text>
          </g>
        ))}

        <text x={W / 2} y={H - 4} className="uc__axis" textAnchor="middle">
          Wind speed (mph)
        </text>
        <text
          x={10}
          y={padT + innerH / 2}
          className="uc__axis"
          textAnchor="middle"
          transform={`rotate(-90 10 ${padT + innerH / 2})`}
        >
          Pressure (psf)
        </text>

        {/* Orlando design band */}
        <rect
          x={xScale(SLIDER.designBand.min)}
          y={padT}
          width={xScale(SLIDER.designBand.max) - xScale(SLIDER.designBand.min)}
          height={innerH}
          className="uc__band"
        />

        {/* Capacity ceilings */}
        <line
          x1={padL}
          y1={yScale(resistance.shingleCapPsf)}
          x2={W - padR}
          y2={yScale(resistance.shingleCapPsf)}
          className="uc__cap uc__cap--shingle"
        />
        <text
          x={W - padR - 4}
          y={yScale(resistance.shingleCapPsf) - 4}
          className="uc__cap-label"
          textAnchor="end"
        >
          Shingle cap · {resistance.shingleCapPsf.toFixed(0)} psf
        </text>

        <line
          x1={padL}
          y1={yScale(resistance.sheathing.corner)}
          x2={W - padR}
          y2={yScale(resistance.sheathing.corner)}
          className="uc__cap uc__cap--sheathing"
        />
        <text
          x={W - padR - 4}
          y={yScale(resistance.sheathing.corner) - 4}
          className="uc__cap-label uc__cap-label--quiet"
          textAnchor="end"
        >
          Sheathing cap (corner) · {resistance.sheathing.corner.toFixed(0)} psf
        </text>

        {/* Uplift curves */}
        <path d={path('field')} className="uc__curve uc__curve--field" />
        <path d={path('edge')} className="uc__curve uc__curve--edge" />
        <path d={path('corner')} className="uc__curve uc__curve--corner" />

        {/* Current V marker */}
        <line
          x1={xScale(curV)}
          y1={padT}
          x2={xScale(curV)}
          y2={padT + innerH}
          className="uc__marker"
        />
        <circle cx={xScale(curV)} cy={yScale(cascade.uplift.field)} r="3" className="uc__dot uc__dot--field" />
        <circle cx={xScale(curV)} cy={yScale(cascade.uplift.edge)} r="3" className="uc__dot uc__dot--edge" />
        <circle cx={xScale(curV)} cy={yScale(cascade.uplift.corner)} r="3.5" className="uc__dot uc__dot--corner" />

        <text
          x={xScale(curV) + 6}
          y={padT + 12}
          className="uc__marker-label"
        >
          {curV} mph
        </text>
      </svg>

      <ul className="uc__legend">
        <li><span className="uc__sw uc__sw--field" /> Field uplift</li>
        <li><span className="uc__sw uc__sw--edge" /> Edge uplift</li>
        <li><span className="uc__sw uc__sw--corner" /> Corner uplift</li>
      </ul>
    </figure>
  );
}
