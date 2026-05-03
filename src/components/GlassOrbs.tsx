interface OrbSpec {
  size: number;     // px
  top: string;      // '20%'
  left: string;     // '70%'
  delay: number;    // seconds
  dur: number;      // seconds
}

interface Props {
  orbs?: OrbSpec[];
}

const DEFAULT_ORBS: OrbSpec[] = [
  { size: 220, top: '12%', left: '8%',  delay: 0,  dur: 14 },
  { size: 140, top: '60%', left: '85%', delay: -4, dur: 18 },
  { size: 90,  top: '78%', left: '15%', delay: -7, dur: 12 },
  { size: 180, top: '20%', left: '78%', delay: -2, dur: 16 },
];

/**
 * Floating crystal orbs with the classic Frutiger Aero glass highlight.
 * Decorative-only, sits behind content with z-index: 0.
 */
export default function GlassOrbs({ orbs = DEFAULT_ORBS }: Props) {
  return (
    <div className="glass-orbs" aria-hidden="true">
      {orbs.map((o, i) => (
        <span
          key={i}
          className="glass-orb"
          style={{
            width: `${o.size}px`,
            height: `${o.size}px`,
            top: o.top,
            left: o.left,
            animationDelay: `${o.delay}s`,
            animationDuration: `${o.dur}s`,
          }}
        />
      ))}
    </div>
  );
}
