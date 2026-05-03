interface Props {
  /** Current wind speed in mph */
  V: number;
}

/**
 * WindGauge — videogame-style circular speedometer pinned to the bottom-
 * left of the scene HUD. Always visible (read-only — the slider below the
 * scene is the input control). Three color zones:
 *
 *   - green   60–110 mph (wind speeds with intact roof)
 *   - amber  110–140 mph (shingle field starting to fail)
 *   - red    140–200 mph (sheathing tear / catastrophic territory)
 *
 * Needle rotates from -120° (60 mph) to +120° (200 mph). Numeric readout
 * inside the dial reads the live wind speed; a small caption beneath
 * shows the storm category equivalent.
 */
const MIN = 60;
const MAX = 200;
const ARC_START = -120;
const ARC_END = 120;

function category(V: number): string {
  if (V < 74) return 'TS';
  if (V < 96) return 'CAT 1';
  if (V < 111) return 'CAT 2';
  if (V < 130) return 'CAT 3';
  if (V < 157) return 'CAT 4';
  return 'CAT 5';
}

/** Convert a polar angle (deg, 0=12 o'clock) to a point on a circle. */
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** Build an SVG arc `d` attribute from start angle to end angle. */
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg > startDeg ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export default function WindGauge({ V }: Props) {
  const Vc = Math.max(MIN, Math.min(MAX, V));
  // Map 60..200 → -120..+120
  const needleAngle = ARC_START + ((Vc - MIN) / (MAX - MIN)) * (ARC_END - ARC_START);

  // Threshold-to-angle helper
  const angleAt = (mph: number) => ARC_START + ((Math.max(MIN, Math.min(MAX, mph)) - MIN) / (MAX - MIN)) * (ARC_END - ARC_START);

  const cx = 32;
  const cy = 32;
  const rArc = 24;

  const cat = category(Vc);
  const isDanger = V >= 140;

  return (
    <div className={`hud-gauge ${isDanger ? 'is-danger' : ''}`} aria-label={`Current wind: ${V} mph (${cat})`}>
      <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        {/* Background ring */}
        <circle cx={cx} cy={cy} r={rArc} fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth="3" />

        {/* Color zones (drawn as arc segments) */}
        <path
          d={arcPath(cx, cy, rArc, ARC_START, angleAt(110))}
          stroke="#3aa15a"
          strokeWidth="3"
          fill="none"
          strokeLinecap="butt"
        />
        <path
          d={arcPath(cx, cy, rArc, angleAt(110), angleAt(140))}
          stroke="#e8a03a"
          strokeWidth="3"
          fill="none"
          strokeLinecap="butt"
        />
        <path
          d={arcPath(cx, cy, rArc, angleAt(140), ARC_END)}
          stroke="#d4392a"
          strokeWidth="3"
          fill="none"
          strokeLinecap="butt"
        />

        {/* Tick marks at 80, 100, 120, 140, 160, 180 */}
        {[80, 100, 120, 140, 160, 180].map((mph) => {
          const a = angleAt(mph);
          const [x1, y1] = polar(cx, cy, rArc - 3, a);
          const [x2, y2] = polar(cx, cy, rArc + 1, a);
          return (
            <line
              key={`tick-${mph}`}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke="rgba(255, 255, 255, 0.4)"
              strokeWidth="0.6"
            />
          );
        })}

        {/* Needle — rotates from gauge center */}
        <g
          style={{
            transformOrigin: '32px 32px',
            transform: `rotate(${needleAngle.toFixed(2)}deg)`,
            transition: 'transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          <line
            x1={cx} y1={cy}
            x2={cx} y2={cy - rArc + 4}
            stroke="#f5894d"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r="2.5" fill="#0a0908" stroke="#f5894d" strokeWidth="0.8" />
        </g>

        {/* Numeric readout (mph) — sits below the needle pivot */}
        <text
          x={cx} y={cy + 13}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fontWeight="700"
          fill="#fffbea"
        >
          {Math.round(V)}
        </text>
      </svg>
      <span className="hud-gauge__cat">{cat}</span>
    </div>
  );
}
