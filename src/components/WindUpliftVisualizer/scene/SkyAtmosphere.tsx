import { lerpRgb } from './colors';
import { SceneElement } from './SceneElement';

/**
 * SkyAtmosphere — everything that lives ABOVE the horizon.
 *
 * Render order (back to front):
 *   1. Sky gradient fill (full canvas)
 *   2. CAD blueprint grid overlay (stays visible through every layer)
 *   3. Sun disc + halo
 *   4. Birds (calm-day decorative — fade out above ~90 mph)
 *   5. Three cloud layers (far / mid / near) — drift speeds set in CSS
 *   6. Horizon treeline (silhouette band)
 *   7. Bottom haze gradient (deepens with storm)
 *
 * All cloud + sky drift colors are computed inside this file from the storm
 * intensity, so iterating on weather palette is purely local.
 */
interface Props {
  /** 0–1 storm intensity (parent: (V - 60) / 140) */
  storm: number;
  /** Sun radial opacity (parent: max(0, calm * 0.85)) */
  sunOpacity: number;
  /** Bird group opacity (parent: max(0, (90 - V) / 30)) */
  birdsOpacity: number;
  /** Horizon tree-line color (parent: storm-lerped charcoal) */
  horizonColor: string;
  /** Sun (or moon at night) X position on the SVG canvas */
  sunX?: number;
  /** Sun (or moon at night) Y position on the SVG canvas */
  sunY?: number;
  /** Sun core color (warm at sunset, silver-blue at night) */
  sunCore?: string;
  /** Whether we're in dark mode (night) — shows stars + moon instead of sun */
  isDark?: boolean;
  /** Star opacity (0 in day, ~0.85 at night) */
  starOpacity?: number;
}

/** Deterministic star field (seeded by index, stable across renders). */
const STARS = Array.from({ length: 60 }, (_, i) => {
  const seed = i * 137 + 7;
  return {
    x: (seed * 13) % 800,
    y: ((seed * 29) % 240) + 5,
    r: 0.6 + ((seed % 7) / 7) * 0.9,
    op: 0.55 + ((seed % 5) / 5) * 0.45,
  };
});

/**
 * Static MAMMATUS POUCH coords for the supercell underbelly (storm > 0.72).
 * Hoisted to module scope so the 13-element array isn't reallocated on
 * every render. Each pouch produces 3 SVG ellipses (body + sun-catch +
 * shadow) for true 3D depth, so 39 elements total — each tied to these
 * stable coords.
 */
const MAMMATUS_POUCHES: ReadonlyArray<{ cx: number; cy: number; rx: number; ry: number }> = [
  { cx: 60,  cy: 165, rx: 14, ry: 8 },
  { cx: 110, cy: 170, rx: 12, ry: 7 },
  { cx: 165, cy: 162, rx: 16, ry: 9 },
  { cx: 220, cy: 175, rx: 14, ry: 8 },
  { cx: 280, cy: 168, rx: 18, ry: 10 },
  { cx: 340, cy: 178, rx: 13, ry: 7 },
  { cx: 395, cy: 165, rx: 16, ry: 9 },
  { cx: 455, cy: 172, rx: 15, ry: 8 },
  { cx: 510, cy: 168, rx: 17, ry: 10 },
  { cx: 570, cy: 175, rx: 14, ry: 8 },
  { cx: 630, cy: 167, rx: 16, ry: 9 },
  { cx: 690, cy: 173, rx: 14, ry: 8 },
  { cx: 745, cy: 168, rx: 13, ry: 7 },
];

export default function SkyAtmosphere({
  storm,
  sunOpacity,
  birdsOpacity,
  horizonColor,
  sunX = 640,
  sunY = 80,
  sunCore = 'rgba(255, 235, 195, 1)',
  isDark = false,
  starOpacity = 0,
}: Props) {
  // Cloud palette + opacity drifts. Local to this module — change here without
  // touching anything else in the scene.
  const cloudFarColor = lerpRgb([220, 218, 214], [40, 34, 32], storm);
  const cloudFarOpacity = 0.35 + storm * 0.35;
  const cloudMidColor = lerpRgb([176, 172, 170], [22, 20, 22], storm);
  const cloudMidOpacity = 0.45 + storm * 0.4;
  const cloudNearOpacity = storm * 0.7;

  return (
    <>
      {/* SKY */}
      <rect x="0" y="0" width="800" height="480" fill="url(#rh-sky)" />

      {/* CAD blueprint */}
      <rect x="0" y="0" width="800" height="480" fill="url(#rh-blueprint)" pointerEvents="none" />
      <rect x="0" y="0" width="800" height="480" fill="url(#rh-blueprint-major)" pointerEvents="none" />

      {/* STARS — render BEFORE the sun/moon so the body sits on top */}
      {starOpacity > 0 && (
        <g aria-hidden="true" style={{ opacity: starOpacity * (1 - storm * 0.8) }}>
          {STARS.map((s, i) => (
            <circle
              key={`star-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="rgba(240, 245, 255, 1)"
              opacity={s.op}
            />
          ))}
          {/* A few bigger "twinkle" stars */}
          <circle cx="120" cy="50" r="1.4" fill="#fffbea" opacity="0.95" className="rh-star-twinkle" />
          <circle cx="680" cy="40" r="1.2" fill="#fffbea" opacity="0.85" className="rh-star-twinkle rh-star-twinkle--2" />
          <circle cx="380" cy="120" r="1.1" fill="#fffbea" opacity="0.8" className="rh-star-twinkle rh-star-twinkle--3" />
        </g>
      )}

      {/* SUN or MOON — placed at TOD-driven coordinates */}
      <g style={{ opacity: sunOpacity, transition: 'opacity 0.6s ease' }}>
        {isDark ? (
          <>
            {/* Moon — solid disc with subtle craters via radial gradient */}
            <circle cx={sunX} cy={sunY} r="20" fill="url(#rh-moon-surface)" />
            {/* Two crater dimples */}
            <circle cx={sunX - 5} cy={sunY - 4} r="2.2" fill="rgba(150, 165, 195, 0.6)" />
            <circle cx={sunX + 6} cy={sunY + 5} r="1.5" fill="rgba(150, 165, 195, 0.5)" />
            <circle cx={sunX - 2} cy={sunY + 8} r="1.2" fill="rgba(150, 165, 195, 0.4)" />
            {/* Moon glow halo */}
            <circle cx={sunX} cy={sunY} r="60" fill="url(#rh-sun)" />
          </>
        ) : (
          <>
            <circle cx={sunX} cy={sunY} r="22" fill={sunCore} />
            <circle cx={sunX} cy={sunY} r="100" fill="url(#rh-sun)" />
          </>
        )}
      </g>

      {/* CREPUSCULAR RAYS — shafts of light fanning down through gaps
          in the cloud deck. Most dramatic at moderate-to-heavy storm
          (0.45–0.78) when the sun is still visible AND clouds are
          thick enough to create visible gaps. Three ray polygons
          radiating from approximately the sun's position downward. */}
      {!isDark && sunOpacity > 0.4 && storm > 0.45 && storm < 0.82 && (
        <g aria-hidden="true" style={{
          opacity: Math.min(0.7, (storm - 0.45) * 1.8) * (1 - Math.max(0, (storm - 0.7) * 3)),
          mixBlendMode: 'screen',
        }} pointerEvents="none">
          {/* Sun-ray 1 — fanning down-left */}
          <polygon
            points={`${sunX - 4},${sunY + 14} ${sunX + 6},${sunY + 14} ${sunX + 80},480 ${sunX - 50},480`}
            fill="url(#rh-crepuscular-ray)"
          />
          {/* Sun-ray 2 — straight down */}
          <polygon
            points={`${sunX - 8},${sunY + 18} ${sunX + 4},${sunY + 18} ${sunX + 30},480 ${sunX - 80},480`}
            fill="url(#rh-crepuscular-ray)"
            opacity="0.7"
          />
          {/* Sun-ray 3 — fanning down-right */}
          <polygon
            points={`${sunX + 2},${sunY + 14} ${sunX + 10},${sunY + 14} ${sunX + 140},480 ${sunX + 40},480`}
            fill="url(#rh-crepuscular-ray)"
            opacity="0.85"
          />
        </g>
      )}

      {/* BIRDS */}
      {birdsOpacity > 0 && (
        <g style={{ opacity: birdsOpacity * 0.8 }} aria-hidden="true">
          <use href="#rh-bird" x="180" y="100" width="20" height="10" className="rh-bird-fly" />
          <use href="#rh-bird" x="220" y="115" width="14" height="7" className="rh-bird-fly rh-bird-fly--2" />
          <use href="#rh-bird" x="160" y="130" width="16" height="8" className="rh-bird-fly rh-bird-fly--3" />
        </g>
      )}

      {/* CLOUDS */}
      <g style={{ color: cloudFarColor, opacity: cloudFarOpacity }} className="rh-cloud-far" aria-hidden="true">
        <SceneElement id="sky/cloud-bg-1" symbolHref="#rh-cloud" x={-200} y={55} w={320} h={60} />
        <SceneElement id="sky/cloud-bg-2" symbolHref="#rh-cloud" x={220} y={38} w={280} h={55} />
        <SceneElement id="sky/cloud-bg-3" symbolHref="#rh-cloud" x={520} y={72} w={320} h={60} />
        <SceneElement id="sky/cloud-bg-4" symbolHref="#rh-cloud" x={780} y={48} w={260} h={50} />
      </g>
      <g style={{ color: cloudMidColor, opacity: cloudMidOpacity }} className="rh-cloud-mid" aria-hidden="true">
        <SceneElement id="sky/cloud-mid-1" symbolHref="#rh-cloud" x={-100} y={18} w={280} h={55} />
        <SceneElement id="sky/cloud-mid-2" symbolHref="#rh-cloud" x={280} y={-2} w={320} h={60} />
        <SceneElement id="sky/cloud-mid-3" symbolHref="#rh-cloud" x={600} y={28} w={260} h={50} />
      </g>
      <g style={{ color: '#0e0c10', opacity: cloudNearOpacity }} className="rh-cloud-near" aria-hidden="true">
        <SceneElement id="sky/cloud-near-1" symbolHref="#rh-cloud" x={-50} y={-10} w={380} h={60} />
        <SceneElement id="sky/cloud-near-2" symbolHref="#rh-cloud" x={350} y={-15} w={420} h={65} />
        <SceneElement id="sky/cloud-near-3" symbolHref="#rh-cloud" x={700} y={-5} w={320} h={55} />
      </g>

      {/* STORM-CELL UNDERBELLY TINT — at extreme storm intensity, the
          underside of the cloud deck takes on the characteristic cyan-
          green tint that real supercells produce (light scattered
          through ice + heavy water content). Florida residents read
          this color as "tornado warning weather".

          v2 ITERATION: stacked tints + MAMMATUS POUCHES (bumpy cloud
          underside) + WALL CLOUD DESCENT (darker descending lobe) +
          TORNADO FUNNEL at extreme severity (>0.92). */}
      {storm > 0.72 && (
        <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
          {/* Wider mid-tone teal wash across the cloud deck */}
          <rect
            x="0" y="0" width="800" height="180"
            fill="rgba(80, 130, 120, 1)"
            opacity={(storm - 0.72) * 0.85}
            style={{ mixBlendMode: 'multiply' }}
          />
          {/* Denser leading-edge band — sells the "wall cloud" feel */}
          <rect
            x="0" y="100" width="800" height="80"
            fill="rgba(110, 160, 145, 1)"
            opacity={(storm - 0.72) * 0.65}
            style={{ mixBlendMode: 'screen' }}
          />
          {/* Sickly green-yellow underbelly highlight where the sun would
              ordinarily lit the bottom of the clouds */}
          <rect
            x="0" y="140" width="800" height="50"
            fill="rgba(180, 195, 130, 1)"
            opacity={(storm - 0.72) * 0.45}
            style={{ mixBlendMode: 'overlay' }}
          />

          {/* MAMMATUS POUCHES — characteristic bumpy underside of the
              cloud deck that real supercells produce. Each pouch is a
              soft dark ellipse hanging below the main cloud line, with
              a brighter sun-catch on top + deeper shadow on bottom for
              3D depth. ~12 pouches scattered across the deck. */}
          <g style={{ opacity: (storm - 0.72) * 1.4 }} shapeRendering="optimizeSpeed">
            {MAMMATUS_POUCHES.map((p, i) => (
              <g key={`mam-${i}`}>
                {/* Pouch body — dark hanging blob */}
                <ellipse cx={p.cx} cy={p.cy} rx={p.rx} ry={p.ry} fill="rgba(40, 50, 60, 0.78)" />
                {/* Top sun-catch (light still grazes the upper curve) */}
                <ellipse cx={p.cx - p.rx * 0.15} cy={p.cy - p.ry * 0.45} rx={p.rx * 0.65} ry={p.ry * 0.30} fill="rgba(180, 200, 195, 0.32)" />
                {/* Bottom deep shadow (the pouch hangs in shadow) */}
                <ellipse cx={p.cx + p.rx * 0.10} cy={p.cy + p.ry * 0.35} rx={p.rx * 0.70} ry={p.ry * 0.30} fill="rgba(20, 25, 35, 0.55)" />
              </g>
            ))}
          </g>

          {/* WALL CLOUD DESCENT — at storm > 0.82 a darker, lower
              cloud mass descends from the deck (the "wall cloud" that
              precedes a tornado in real meteorology). It's a wider
              dark gradient lobe centered just left of the chimney,
              extending down further than the surrounding cloud base. */}
          {storm > 0.82 && (
            <g style={{ opacity: (storm - 0.82) * 4 }}>
              {/* Outer descended lobe — softer dark blob */}
              <ellipse
                cx="420" cy="178" rx="160" ry="38"
                fill="rgba(28, 36, 48, 0.85)"
              />
              {/* Inner darker core (the lowest, densest part) */}
              <ellipse
                cx="420" cy="186" rx="120" ry="28"
                fill="rgba(15, 22, 32, 0.75)"
              />
              {/* Bottom rim shadow — sells the "hanging" descent */}
              <ellipse
                cx="420" cy="200" rx="80" ry="14"
                fill="rgba(8, 12, 20, 0.55)"
              />
              {/* Sickly green underglow on the right side of the wall
                  cloud (the leading edge that catches what little light
                  still pierces) */}
              <ellipse
                cx="470" cy="190" rx="60" ry="14"
                fill="rgba(140, 165, 110, 0.32)"
                style={{ mixBlendMode: 'screen' }}
              />
              {/* Animated rotation pulse on the wall cloud — slow drift
                  suggesting the rotation of the meso */}
              <ellipse
                cx="420" cy="184" rx="100" ry="22"
                fill="rgba(60, 80, 95, 0.28)"
                className="rh-wall-cloud-rotate"
                style={{ transformOrigin: '420px 184px' }}
              />
            </g>
          )}

          {/* TORNADO FUNNEL — at storm > 0.92 a thin descending funnel
              cloud becomes visible, dropping from the wall cloud
              toward (but not always touching) the ground. Tapered
              cone shape with the classic dark stem + lighter outer
              halo from condensation. Real catastrophic warning sign. */}
          {storm > 0.92 && (
            <g style={{ opacity: (storm - 0.92) * 12.5 }}>
              {/* Outer condensation halo */}
              <polygon
                points="408,200 432,200 446,420 394,420"
                fill="rgba(50, 60, 70, 0.30)"
              />
              {/* Inner darker funnel stem */}
              <polygon
                points="412,202 428,202 438,420 402,420"
                fill="rgba(20, 28, 38, 0.78)"
              />
              {/* Sun-rim on left edge of funnel (light still grazes
                  the leading face) */}
              <line x1="412" y1="202" x2="402" y2="420" stroke="rgba(180, 200, 195, 0.30)" strokeWidth="0.6" />
              {/* Shadow on right edge */}
              <line x1="428" y1="202" x2="438" y2="420" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.6" />
              {/* Debris cloud at the base — the dust-cloud that wraps
                  the bottom of an active tornado */}
              <ellipse cx="420" cy="430" rx="46" ry="12" fill="rgba(60, 50, 38, 0.55)" />
              <ellipse cx="412" cy="425" rx="22" ry="6" fill="rgba(80, 65, 48, 0.42)" />
              <ellipse cx="430" cy="428" rx="26" ry="7" fill="rgba(80, 65, 48, 0.40)" />
              {/* Animated rotation on the funnel — gives the eye the
                  cue that the funnel is spinning */}
              <ellipse
                cx="420" cy="310" rx="14" ry="100"
                fill="rgba(40, 50, 60, 0.18)"
                className="rh-funnel-spin"
                style={{ transformOrigin: '420px 310px' }}
              />
            </g>
          )}

          {/* DISTANT RAINBANDS — vertical curtains of denser rain on
              the horizon, suggesting the storm cell extends across
              the whole sky. Each band is a tilted faint gradient. */}
          {storm > 0.78 && (
            <g style={{ opacity: (storm - 0.78) * 2 }}>
              <path d="M 60 130 L 80 200 L 50 200 L 30 130 Z" fill="rgba(80, 100, 115, 0.42)" />
              <path d="M 720 140 L 740 210 L 710 210 L 690 140 Z" fill="rgba(80, 100, 115, 0.42)" />
              <path d="M 140 145 L 158 215 L 130 215 L 112 145 Z" fill="rgba(60, 80, 95, 0.32)" />
              <path d="M 660 150 L 678 220 L 650 220 L 632 150 Z" fill="rgba(60, 80, 95, 0.32)" />
            </g>
          )}

          {/* v3 MAXIMALIST — ROLL CLOUD on the horizon at storm > 0.82.
              The horizontal cylindrical cloud at the leading edge of
              a gust front. Stretched dark ellipse with a sun-catch top
              edge + deep bottom shadow that sells its rotational form. */}
          {storm > 0.82 && (
            <g style={{ opacity: (storm - 0.82) * 4 }}>
              {/* Roll cloud body — stretched dark ellipse */}
              <ellipse cx="200" cy="156" rx="180" ry="10" fill="rgba(40, 50, 60, 0.85)" />
              <ellipse cx="200" cy="153" rx="160" ry="6" fill="rgba(80, 100, 110, 0.55)" />
              <ellipse cx="200" cy="159" rx="170" ry="5" fill="rgba(20, 28, 38, 0.65)" />
              {/* Right segment of the same roll cloud */}
              <ellipse cx="660" cy="158" rx="140" ry="8" fill="rgba(40, 50, 60, 0.78)" />
              <ellipse cx="660" cy="155" rx="120" ry="5" fill="rgba(80, 100, 110, 0.50)" />
              <ellipse cx="660" cy="161" rx="130" ry="4" fill="rgba(20, 28, 38, 0.60)" />
            </g>
          )}

          {/* v3 MAXIMALIST — INFLOW BANDS streaming into the wall cloud.
              Real supercells have curved feeder bands of cloud spiraling
              into the meso-cyclone center. 5 long curving paths from the
              horizon arcing UP and INWARD toward (420, 184). */}
          {storm > 0.85 && (
            <g style={{ opacity: (storm - 0.85) * 5 }} pointerEvents="none">
              <path
                d="M 30 250 Q 180 220 280 200 Q 360 188 420 184"
                stroke="rgba(60, 78, 88, 0.55)"
                strokeWidth="2.2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 30 250 Q 180 220 280 200 Q 360 188 420 184"
                stroke="rgba(220, 230, 235, 0.20)"
                strokeWidth="0.5"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 60 270 Q 200 240 320 220 Q 380 200 420 188"
                stroke="rgba(60, 78, 88, 0.45)"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 770 245 Q 620 215 520 198 Q 460 190 422 184"
                stroke="rgba(60, 78, 88, 0.55)"
                strokeWidth="2.2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 770 245 Q 620 215 520 198 Q 460 190 422 184"
                stroke="rgba(220, 230, 235, 0.20)"
                strokeWidth="0.5"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 740 270 Q 600 240 500 220 Q 460 205 422 192"
                stroke="rgba(60, 78, 88, 0.42)"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
              {/* Central inflow stream from below */}
              <path
                d="M 420 320 Q 422 260 421 220 Q 420 200 420 188"
                stroke="rgba(60, 78, 88, 0.32)"
                strokeWidth="1.2"
                fill="none"
                strokeLinecap="round"
              />
            </g>
          )}

          {/* v3 MAXIMALIST — PRESSURE WAVE RINGS centered on the wall
              cloud. Concentric expanding ellipses suggesting the
              shockwave-like pressure gradient of an active meso. */}
          {storm > 0.88 && (
            <g style={{ opacity: (storm - 0.88) * 8 }} pointerEvents="none">
              <ellipse
                cx="420" cy="184" rx="100" ry="22"
                fill="none"
                stroke="rgba(180, 200, 195, 0.45)"
                strokeWidth="0.6"
                className="rh-pressure-wave rh-pressure-wave--1"
                style={{ transformOrigin: '420px 184px' }}
              />
              <ellipse
                cx="420" cy="184" rx="100" ry="22"
                fill="none"
                stroke="rgba(180, 200, 195, 0.42)"
                strokeWidth="0.6"
                className="rh-pressure-wave rh-pressure-wave--2"
                style={{ transformOrigin: '420px 184px' }}
              />
              <ellipse
                cx="420" cy="184" rx="100" ry="22"
                fill="none"
                stroke="rgba(180, 200, 195, 0.40)"
                strokeWidth="0.6"
                className="rh-pressure-wave rh-pressure-wave--3"
                style={{ transformOrigin: '420px 184px' }}
              />
            </g>
          )}

          {/* v3 MAXIMALIST — MICROBURST descending column at storm > 0.88.
              A vertical translucent column of descending air slamming
              down to the ground (the dangerous downburst pattern that
              tears off roofs). Lighter at top, darker at bottom (dust +
              debris caught in the column), with horizontal "outflow"
              wings at the base where the air hits the ground. */}
          {storm > 0.88 && (
            <g style={{ opacity: (storm - 0.88) * 6 }} pointerEvents="none">
              {/* Outer column halo */}
              <polygon
                points="220,180 320,180 350,460 190,460"
                fill="rgba(80, 95, 105, 0.25)"
              />
              {/* Inner descending column */}
              <polygon
                points="240,184 304,184 328,455 212,455"
                fill="rgba(50, 65, 78, 0.45)"
              />
              {/* Vertical streak markers showing downward motion */}
              <line x1="252" y1="200" x2="240" y2="450" stroke="rgba(180, 195, 200, 0.35)" strokeWidth="0.5" />
              <line x1="270" y1="200" x2="262" y2="450" stroke="rgba(180, 195, 200, 0.30)" strokeWidth="0.5" />
              <line x1="284" y1="200" x2="282" y2="450" stroke="rgba(180, 195, 200, 0.30)" strokeWidth="0.5" />
              <line x1="298" y1="200" x2="304" y2="450" stroke="rgba(180, 195, 200, 0.35)" strokeWidth="0.5" />
              {/* Horizontal outflow at the base — "the splash" where
                  the descending air hits the ground and fans out */}
              <ellipse cx="270" cy="455" rx="80" ry="6" fill="rgba(60, 75, 85, 0.55)" />
              <ellipse cx="270" cy="455" rx="60" ry="3" fill="rgba(80, 95, 105, 0.35)" />
              {/* Horizontal outflow ARROWS — small chevrons pointing
                  outward to convey the radial gust front */}
              <path d="M 195 455 L 188 452 M 195 455 L 188 458" stroke="rgba(180, 195, 200, 0.55)" strokeWidth="0.5" fill="none" />
              <path d="M 345 455 L 352 452 M 345 455 L 352 458" stroke="rgba(180, 195, 200, 0.55)" strokeWidth="0.5" fill="none" />
            </g>
          )}

          {/* v3 MAXIMALIST — TWIN TORNADO at storm > 0.96. A second
              smaller funnel forms beside the main one (multi-vortex
              tornado event). Real F3+ tornadoes often have multiple
              vortices simultaneously. */}
          {storm > 0.96 && (
            <g style={{ opacity: (storm - 0.96) * 25 }}>
              {/* Smaller twin offset to the right */}
              <polygon
                points="554,240 568,240 580,420 542,420"
                fill="rgba(50, 60, 70, 0.30)"
              />
              <polygon
                points="556,242 566,242 574,420 548,420"
                fill="rgba(20, 28, 38, 0.78)"
              />
              <line x1="556" y1="242" x2="548" y2="420" stroke="rgba(180, 200, 195, 0.30)" strokeWidth="0.5" />
              <line x1="566" y1="242" x2="574" y2="420" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.5" />
              <ellipse cx="561" cy="426" rx="28" ry="7" fill="rgba(60, 50, 38, 0.50)" />
              <ellipse
                cx="561" cy="320" rx="9" ry="80"
                fill="rgba(40, 50, 60, 0.18)"
                className="rh-funnel-spin"
                style={{
                  transformOrigin: '561px 320px',
                  animationDuration: '1.2s',
                }}
              />
            </g>
          )}
        </g>
      )}

      {/* CLOUD-TO-CLOUD LIGHTNING — at night with high storm intensity,
          occasional bright flashes light up the underside of clouds (the
          classic "heat lightning" between clouds you see in real Florida
          night storms). Three pulse points with staggered delays. */}
      {isDark && storm > 0.5 && (
        <g aria-hidden="true" style={{ mixBlendMode: 'screen' }}>
          <ellipse
            cx="180" cy="40" rx="120" ry="22"
            fill="rgba(220, 235, 255, 0.95)"
            className="rh-cc-flash rh-cc-flash--1"
          />
          <ellipse
            cx="500" cy="30" rx="140" ry="24"
            fill="rgba(220, 235, 255, 0.95)"
            className="rh-cc-flash rh-cc-flash--2"
          />
          <ellipse
            cx="720" cy="50" rx="100" ry="20"
            fill="rgba(220, 235, 255, 0.95)"
            className="rh-cc-flash rh-cc-flash--3"
          />
        </g>
      )}

      {/* HORIZON tree line */}
      <g style={{ color: horizonColor }} aria-hidden="true">
        <SceneElement id="sky/treeline-far" symbolHref="#rh-treeline" x={0} y={265} w={800} h={22} style={{ opacity: 0.55 }} />
        <SceneElement id="sky/treeline-near" symbolHref="#rh-treeline" x={0} y={278} w={800} h={22} style={{ opacity: 0.85 }} />
      </g>

      {/* HAZE */}
      <rect x="0" y="280" width="800" height="160" fill="url(#rh-haze)" />
    </>
  );
}
