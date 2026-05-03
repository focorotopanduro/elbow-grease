import { useEffect, useRef, useState } from 'react';
import { SLIDER } from '../../data/orlando';

interface Props {
  value: number;
}

/**
 * Vintage weather-bureau anemometer dial. Needle rotates from -135° at min
 * to +135° at max (270° sweep). Orlando design-wind band gets an orange
 * tinted arc on the rim. Numeric readout tweens smoothly to new value.
 */
export default function Anemometer({ value }: Props) {
  const min = SLIDER.min;
  const max = SLIDER.max;
  const range = max - min;
  const sweep = 270;
  const startAngle = -135;

  const valueToAngle = (v: number) => startAngle + ((v - min) / range) * sweep;
  const needleAngle = valueToAngle(Math.max(min, Math.min(max, value)));

  // Smooth numeric tween
  const [display, setDisplay] = useState(value);
  const startRef = useRef<{ from: number; to: number; t0: number } | null>(null);

  useEffect(() => {
    if (display === value) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplay(value);
      return;
    }
    startRef.current = { from: display, to: value, t0: performance.now() };
    let raf = 0;
    const tick = (now: number) => {
      const s = startRef.current;
      if (!s) return;
      const t = Math.min(1, (now - s.t0) / 380);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(s.from + (s.to - s.from) * eased);
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const polar = (cx: number, cy: number, r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const arcPath = (cx: number, cy: number, r: number, a1: number, a2: number) => {
    const [x1, y1] = polar(cx, cy, r, a1);
    const [x2, y2] = polar(cx, cy, r, a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const cx = 60;
  const cy = 60;
  const rOuter = 52;
  const rTick = 46;
  const rTickInner = 41;

  const ticks = [60, 80, 100, 120, 140, 160, 180, 200];
  const designLow = SLIDER.designBand.min;
  const designHigh = SLIDER.designBand.max;

  return (
    <div className="anem">
      <svg
        className="anem__svg"
        viewBox="0 0 120 120"
        role="img"
        aria-label={`Wind speed dial showing ${value} mph`}
      >
        {/* glass background disc */}
        <defs>
          <radialGradient id="anem-glass" cx="50%" cy="35%" r="60%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.55)" />
          </radialGradient>
          <radialGradient id="anem-shadow" cx="50%" cy="60%" r="55%">
            <stop offset="60%" stopColor="rgba(28,25,22,0)" />
            <stop offset="100%" stopColor="rgba(28,25,22,0.18)" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={rOuter} fill="url(#anem-glass)" stroke="rgba(28,25,22,0.18)" strokeWidth="1" />
        <circle cx={cx} cy={cy} r={rOuter} fill="url(#anem-shadow)" />

        <path d={arcPath(cx, cy, rTick, startAngle, startAngle + sweep)} className="anem__track" fill="none" />
        <path d={arcPath(cx, cy, rTick, valueToAngle(designLow), valueToAngle(designHigh))} className="anem__band" fill="none" />
        <path d={arcPath(cx, cy, rTick, startAngle, needleAngle)} className="anem__progress" fill="none" />

        {ticks.map((t) => {
          const angle = valueToAngle(t);
          const [x1, y1] = polar(cx, cy, rTick + 2, angle);
          const [x2, y2] = polar(cx, cy, rTickInner, angle);
          const [tx, ty] = polar(cx, cy, rTick - 8, angle);
          const isMajor = t % 40 === 0 || t === 60 || t === 200;
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className="anem__tick" />
              {isMajor && (
                <text x={tx} y={ty + 2} className="anem__tick-label" textAnchor="middle">
                  {t}
                </text>
              )}
            </g>
          );
        })}

        <g
          style={{
            transformOrigin: `${cx}px ${cy}px`,
            transform: `rotate(${needleAngle}deg)`,
            transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <line x1={cx} y1={cy} x2={cx} y2={cy - 36} className="anem__needle" />
          <circle cx={cx} cy={cy - 38} r={2} className="anem__needle-tip" />
        </g>

        <circle cx={cx} cy={cy} r={5} className="anem__hub" />
        <circle cx={cx} cy={cy} r={2} className="anem__hub-dot" />

        {/* glass highlight crescent */}
        <path
          d="M 18 38 Q 60 12 102 38"
          fill="none"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>

      <div className="anem__readout">
        <span className="anem__value">{display}</span>
        <span className="anem__unit">mph</span>
      </div>
    </div>
  );
}
