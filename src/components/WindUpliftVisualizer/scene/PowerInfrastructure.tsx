import { useEffect, useRef, useState } from 'react';

/**
 * PowerInfrastructure — utility pole + two power lines arcing off to the
 * right edge of the scene (suggesting "the rest of the grid"). At extreme
 * wind speeds the lines snap with a spark burst, then the pole falls.
 *
 * Visual states tied to wind speed:
 *   - calm     (V < 100)  — pole upright, lines hang in catenary, subtle
 *   - heavy    (100–140)  — pole leans 1–3°, lines whip with wind sway
 *   - snapping (≥ 140)    — bright spark burst at midpoint, lines fail
 *   - broken   (>140)     — only the pole-side stubs dangle down
 *   - fallen   (≥ 175)    — pole rotates 85° (falls flat), stubs gone
 *
 * Edge-triggered: the snap event is fired ONCE on the false→true transition
 * across V=140, then a setTimeout signals power restored after 2.2s. Drag
 * the slider rapidly back and forth and you don't get rapid spark loops.
 *
 * Calls `onPowerOut(true)` when the line first snaps so the parent can dim
 * interior window glow (real "lights flicker out" Florida storm moment).
 * Calls `onPowerOut(false)` ~2.2s later — power either comes back or stays
 * off depending on whether the pole has fallen.
 */
interface Props {
  /** Wind speed in mph */
  V: number;
  /** prefers-reduced-motion — disables sway + sparks */
  reduced: boolean;
  /** Fired when a line first snaps (true) and ~2.2s later (false) */
  onPowerOut?: (out: boolean) => void;
}

type LineState = 'intact' | 'snapping' | 'broken';

export default function PowerInfrastructure({ V, reduced, onPowerOut }: Props) {
  const [lineState, setLineState] = useState<LineState>('intact');
  const [poleFallen, setPoleFallen] = useState(false);
  const prevV = useRef(V);
  const snapTimer = useRef<number | null>(null);
  const restoreTimer = useRef<number | null>(null);

  useEffect(() => {
    const wasBelow = prevV.current < 140;
    const isAbove = V >= 140;

    // Edge: line snaps for the first time
    if (wasBelow && isAbove && lineState === 'intact') {
      setLineState('snapping');
      onPowerOut?.(true);
      // After 700ms of sparks, transition to "broken" stubs only
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        setLineState('broken');
      }, 700);
      // After 2.2s total, signal power restored (or it stays off if pole fell)
      if (restoreTimer.current) window.clearTimeout(restoreTimer.current);
      restoreTimer.current = window.setTimeout(() => {
        onPowerOut?.(false);
      }, 2200);
    }

    // Pole falls at catastrophic winds
    if (V >= 175 && !poleFallen) {
      setPoleFallen(true);
    }

    // Reset if user drags slider back to safe range
    if (V < 130) {
      if (lineState !== 'intact') setLineState('intact');
      if (poleFallen) setPoleFallen(false);
    }

    prevV.current = V;

    return () => {
      // Cleanup is handled at unmount; per-effect we leave the timers running
    };
  }, [V, lineState, poleFallen, onPowerOut]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      if (snapTimer.current) window.clearTimeout(snapTimer.current);
      if (restoreTimer.current) window.clearTimeout(restoreTimer.current);
    };
  }, []);

  // Pole sway angle (degrees) — small lean above 100 mph, larger near snap
  const leanAngle = poleFallen
    ? 85
    : V > 100
      ? -1 - Math.min(4, (V - 100) / 22)
      : 0;

  // Line sag amplitude — adds a subtle vertical shift in the catenary so
  // the lines visibly whip in heavy wind (not animated; static per render)
  const sagShift = V > 100 ? Math.min(8, (V - 100) / 12) : 0;

  return (
    <g aria-hidden="true" className="rh-power" data-label="power-pole">
      {/* Wood pole — group transforms together when leaning/falling */}
      <g
        style={{
          transformOrigin: '14px 440px',
          transform: `rotate(${leanAngle.toFixed(2)}deg)`,
          transition: poleFallen
            ? 'transform 1.4s cubic-bezier(0.55, 0.06, 0.68, 1.6)'
            : 'transform 0.6s ease',
        }}
      >
        {/* Pole shaft (wood-tone) */}
        <rect
          x="12" y="200" width="4" height="240"
          fill="#5a3c20"
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Pole face shading — vertical depth gradient */}
        <rect
          x="12" y="200" width="4" height="240"
          fill="url(#rh-side-shadow)"
          opacity="0.45"
          pointerEvents="none"
        />
        {/* Cross-arm (horizontal beam) */}
        <rect
          x="4" y="207" width="20" height="3"
          fill="#3a2818"
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Insulator pegs — porcelain knobs at each cross-arm end */}
        <circle cx="6" cy="206" r="1.3" fill="#d4cec5" stroke="#1a1612" strokeWidth="0.3" />
        <circle cx="22" cy="206" r="1.3" fill="#d4cec5" stroke="#1a1612" strokeWidth="0.3" />
        {/* Pole top cap */}
        <rect x="11.5" y="198" width="5" height="2" fill="#3a2818" />
        {/* Climbing pegs — metal nubs sticking out at intervals */}
        {[260, 300, 340, 380].map((y) => (
          <rect key={`peg-${y}`} x="9" y={y} width="2" height="0.8" fill="#3a3128" />
        ))}
      </g>

      {/* Power lines — visible only when intact or in the moment of snapping */}
      {(lineState === 'intact' || lineState === 'snapping') && (
        <g
          className={V > 100 ? 'rh-power-lines rh-power-lines--whipping' : 'rh-power-lines'}
          style={{
            opacity: lineState === 'snapping' ? 0.4 : 1,
            transition: 'opacity 0.4s ease',
          }}
        >
          {/* Top line (from upper insulator) — arcs UP-RIGHT to exit edge */}
          <path
            d={`M 6 206 Q 280 ${175 + sagShift * 1.5} 800 ${165 + sagShift}`}
            stroke="rgba(20, 18, 16, 0.85)"
            strokeWidth="0.85"
            fill="none"
            strokeLinecap="round"
          />
          {/* Bottom line (from lower insulator) — slightly steeper sag */}
          <path
            d={`M 22 206 Q 290 ${190 + sagShift * 1.6} 800 ${175 + sagShift}`}
            stroke="rgba(20, 18, 16, 0.85)"
            strokeWidth="0.85"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Broken stubs — pole-side halves dangle down post-snap */}
      {(lineState === 'broken') && !poleFallen && (
        <g className="rh-power-broken" aria-hidden="true">
          {/* Top stub — gravity pulls it down */}
          <path
            d={`M 6 206 Q 80 280 60 380`}
            stroke="rgba(20, 18, 16, 0.85)"
            strokeWidth="0.85"
            fill="none"
            strokeLinecap="round"
          />
          {/* Bottom stub */}
          <path
            d={`M 22 206 Q 100 290 75 395`}
            stroke="rgba(20, 18, 16, 0.85)"
            strokeWidth="0.85"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* SPARK BURST — at the snap moment, fires at the line's mid-arc */}
      {lineState === 'snapping' && !reduced && (
        <g className="rh-power-spark" aria-hidden="true">
          {/* Bright central flash */}
          <circle
            cx="280" cy="180" r="14"
            fill="rgba(255, 245, 180, 0.95)"
            filter="url(#rh-glow)"
            className="rh-spark-flash"
          />
          {/* Inner core (whiter) */}
          <circle
            cx="280" cy="180" r="5"
            fill="#fffbea"
            className="rh-spark-flash"
          />
          {/* Particles flying outward in 8 directions */}
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const dx = Math.cos(angle) * 38;
            const dy = Math.sin(angle) * 38;
            return (
              <circle
                key={`spark-${i}`}
                cx="280" cy="180"
                r={1.4 + (i % 3) * 0.4}
                fill="#ffec80"
                className="rh-spark-particle"
                style={{
                  ['--spark-dx' as never]: `${dx.toFixed(1)}px`,
                  ['--spark-dy' as never]: `${dy.toFixed(1)}px`,
                  animationDelay: `${(i * 0.018).toFixed(3)}s`,
                }}
              />
            );
          })}
          {/* Trailing wisps — small streaks for kinetic feel */}
          {Array.from({ length: 4 }).map((_, i) => {
            const angle = (i / 4) * Math.PI * 2 + 0.4;
            const x2 = 280 + Math.cos(angle) * 28;
            const y2 = 180 + Math.sin(angle) * 28;
            return (
              <line
                key={`trail-${i}`}
                x1="280" y1="180" x2={x2} y2={y2}
                stroke="rgba(255, 220, 130, 0.8)"
                strokeWidth="0.6"
                strokeLinecap="round"
                className="rh-spark-trail"
              />
            );
          })}
        </g>
      )}
    </g>
  );
}
