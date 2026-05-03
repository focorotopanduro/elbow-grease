import { memo, useEffect, useMemo, useState } from 'react';
import { generateBolt, type BoltSegment } from '../effects/lightning';
import { lerpRgb } from './colors';

/**
 * WeatherEffects — every visual layer driven by the storm itself, not the
 * structure. Five named exports so the parent can drop each piece at the
 * exact z-index it needs:
 *
 *   <WindStreamlines />  → sky-level air flow, between SkyAtmosphere and the house
 *   <GroundShadows />    → cast shadows on the lawn, between background palms and house
 *   <RainSystem />       → top-layer rain, drawn after annotations
 *   <FlyingLeaves />     → top-layer debris, drawn after rain
 *   <Lightning />        → self-contained — owns its own bolt state + scheduler
 *
 * Why split rather than a single <Weather />? Render order matters. Wind
 * needs to feel like atmosphere (sit behind the house). Ground shadows need
 * to anchor the house. Rain/leaves/lightning need to hover above everything
 * so they don't get clipped by walls.
 */

/* ─────────────────────────────────────────────────────────────────────────
 * WIND STREAMLINES — particle system (videogame-style)
 *
 * Each visible "wind streak" is a short line with a gradient stroke
 * (transparent tail → bright head = motion blur). Particles are positioned
 * deterministically by index, then animated left-to-right via CSS transform
 * with multiple Y-wobble keyframe stops so the path reads as sinuous,
 * organic flow rather than a CAD-traced curve.
 *
 * Scaling with storm:
 *   - particle count rises ~3× from calm to heavy
 *   - speed rises (~2.5s → 0.9s per traversal)
 *   - wobble amplitude rises (gentle drift → turbulent swerve)
 *   - a few rare "gust" particles use a brighter gradient for emphasis
 *
 * Performance: each particle is a single <line> + GPU transform; no JS
 * runs per-frame. The animation is `infinite` but each particle pauses
 * via `useIntersectionPause`'s `.is-paused` class on the parent SVG.
 * ───────────────────────────────────────────────────────────────────────── */
interface WindStreamlinesProps {
  /** 0–1 storm intensity */
  storm: number;
  /** Particle multiplier (parent FPS-throttled — passed as quality * base) */
  streamCount: number;
  /** Current gust amplitude — biases speed + opacity */
  windGust: number;
}

interface WindParticle {
  /** Spawn Y in viewBox space (30–260) */
  y: number;
  /** Streak length in px (= motion-blur amount) */
  len: number;
  /** Stroke width */
  w: number;
  /** Animation duration (s) — shorter = faster particle */
  dur: number;
  /** Negative animation-delay so each particle is mid-cycle on render */
  delay: number;
  /** Y-wobble amplitudes at the 25%/50%/75% marks (px) */
  wob1: number;
  wob2: number;
  wob3: number;
  /** Opacity at peak visibility (0.3–0.95) */
  op: number;
  /** Whether this is a rare "gust" particle (uses brighter gradient) */
  burst: boolean;
}

export function WindStreamlines({ storm, streamCount, windGust }: WindStreamlinesProps) {
  // Particle count scales with quality (streamCount) AND storm intensity.
  // streamCount is already FPS-throttled by the parent (4 calm → ~18 heavy).
  // Halved from the prior 3× multiplier — earlier feedback was the streaks
  // read as glitchy scratches at high counts. Atmospheric turbulence +
  // rain + tree sway already carry most of the wind feel; particles are
  // a subtle accent.
  const particleCount = Math.max(3, Math.round(streamCount * 1.2));

  // Pre-compute all particle params deterministically (seeded by index)
  // — recomputes only when count or storm changes, not every render.
  const particles = useMemo<WindParticle[]>(() => {
    const list: WindParticle[] = [];
    // Wobble amplitude — drastically reduced from the prior 8 + storm*38
    // (max 46px). Linear-interpolated keyframes at high amplitudes
    // produced visible "snap" points where the particle teleports
    // diagonally — read as glitchy scratches. Now max ~10px = smooth
    // sinuous drift that always reads as flow, never as broken segments.
    const wobMax = 2 + storm * 8;
    // Base traversal time shortens with storm
    const baseDur = 2.6 - storm * 1.7;
    for (let i = 0; i < particleCount; i++) {
      const seed = i * 73 + 17;
      // Deterministic pseudo-randoms in [0, 1)
      const r = (n: number) => ((seed * n) % 1000) / 1000;
      const burst = r(11) > (1 - storm * 0.18); // very rare even at peak
      list.push({
        y: 30 + r(13) * 230,
        len: burst
          ? 28 + r(7) * 24       // gusts are longer streaks
          : 12 + r(7) * 18,      // 12–30 px regular streaks
        w: burst ? 1.2 + r(19) * 0.6 : 0.5 + r(19) * 0.6,
        dur: Math.max(1.0, baseDur + r(23) * 0.9),
        delay: -(r(29) * 6),     // -6s..0 stagger so they're already in flight
        wob1: (r(31) - 0.5) * wobMax,
        wob2: (r(37) - 0.5) * wobMax,
        wob3: (r(41) - 0.5) * wobMax,
        // Halved opacity ceiling — particles whisper, not shout
        op: burst ? 0.42 + r(43) * 0.18 : 0.14 + r(43) * 0.22,
        burst,
      });
    }
    return list;
  }, [particleCount, storm]);

  // Apply a slight global gust-driven speed bias so dragging the slider
  // mid-storm causes the particles to noticeably accelerate
  const gustBias = 1 - windGust * 0.18; // 1.0 → ~0.82 at peak gust

  return (
    <g className="rh-wind" aria-hidden="true">
      {particles.map((p, i) => (
        <line
          key={i}
          className={`rh-wind-particle ${p.burst ? 'rh-wind-particle--burst' : ''}`}
          x1={0}    y1={0}
          x2={p.len} y2={0}
          stroke={p.burst ? 'url(#rh-wind-burst)' : 'url(#rh-wind-streak)'}
          strokeWidth={p.w}
          strokeLinecap="round"
          style={{
            ['--p-y' as never]: `${p.y.toFixed(1)}px`,
            ['--p-w1' as never]: `${p.wob1.toFixed(1)}px`,
            ['--p-w2' as never]: `${p.wob2.toFixed(1)}px`,
            ['--p-w3' as never]: `${p.wob3.toFixed(1)}px`,
            ['--p-op' as never]: p.op.toFixed(2),
            animationDuration: `${(p.dur * gustBias).toFixed(2)}s`,
            animationDelay: `${p.delay.toFixed(2)}s`,
          }}
        />
      ))}
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * GROUND SHADOWS — cast onto the lawn, anchor the house in 3D space.
 * Static, no props needed.
 * ───────────────────────────────────────────────────────────────────────── */
export function GroundShadows() {
  return (
    <>
      {/* Primary shadow — angled toward right (sun is upper-left) for 3D feel */}
      <ellipse cx="440" cy="452" rx="400" ry="11" fill="#000" opacity="0.45" />
      {/* Soft secondary shadow extending right (away from light) */}
      <ellipse cx="600" cy="455" rx="280" ry="6" fill="#000" opacity="0.22" />
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * RAIN SYSTEM — procedural CSS-animated drops with 4 depth tiers, motion-
 * blur streak gradient on the foreground hero layer, ground impact
 * splashes (crown + side droplets + ripple ring), and an atmospheric
 * rain haze overlay at high intensity.
 *
 * Why CSS over a JS particle loop:
 *   - 60fps GPU-only translateY/translateX keyframes; no React reconciles
 *   - Hundreds of independent drops with no per-frame JS cost
 *   - Splashes loop on their own staggered cycles so they pop continuously
 *
 * Procedural variance — every drop's duration, length, opacity, and
 * delay are seeded deterministically by index so the field reads as
 * organic chaos rather than a uniform grid pulse. The earlier version
 * shared one duration per layer; the eye picked up the synchronized
 * cycle as a "wave" pattern. Now drops fall on independent timers.
 *
 * Render passes:
 *   1. Atmospheric haze (rect, intensity-gated > 0.5)
 *   2. 96 background drops (3 layers: far/mid/near) — all jittered
 *   3. 14 hero foreground drops with streak-gradient stroke (> 0.25)
 *   4. 24 ground splash bursts (crown + side droplets + ripple) (> 0.30)
 * ───────────────────────────────────────────────────────────────────────── */
interface RainSystemProps {
  /** 0–1 rain density (parent: max(0, (V - 80) / 120)) */
  rainIntensity: number;
  /** prefers-reduced-motion — disables animation entirely */
  reduced: boolean;
  /** Current wind sample — drives drop tilt + system shear */
  windCurrent: number;
}

function RainSystemImpl({ rainIntensity, reduced, windCurrent }: RainSystemProps) {
  if (rainIntensity <= 0 || reduced) return null;

  // Wind blows LEFT-TO-RIGHT in this scene (matches FlyingLeaves +
  // WindStreamlines, both of which spawn off-screen-left and drift
  // right). Rain follows the same convention: streaks tilt down-and-
  // right (dx > 0) and the keyframe drift translates rightward.
  //
  // The earlier values (angle 0.28 + wc*0.4; drift 0 + wc*60) made the
  // streaks LOOK tilted but the actual horizontal travel was tiny —
  // ~5° of motion under a ~30° tilt. The tilt/motion mismatch let the
  // brain pick whichever direction it wanted, and at low wind it often
  // read as right-to-left because the streaks were nearly vertical
  // with no visible drift.
  //
  // Now: angle is steeper, AND the drift baseline is non-zero so even
  // a calm wind has clear rightward travel. Drift roughly matches the
  // tilt vector × the fall distance.
  const angle = 0.32 + windCurrent * 0.5;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  // Hero drops sit closer to the camera, so wind deflection reads
  // more dramatically — push the angle further.
  const heroAngle = 0.38 + windCurrent * 0.65;
  const heroSin = Math.sin(heroAngle);
  const heroCos = Math.cos(heroAngle);
  // Keyframe drift in pixels: 35..180 (was 0..60). 35px baseline at
  // calm wind makes calm-day rain visibly drift right; 180px peak gives
  // hurricane-blown sheets at full storm.
  const driftX = 35 + windCurrent * 145;

  return (
    <g
      className="rh-rain-system"
      aria-hidden="true"
      style={{
        opacity: rainIntensity,
        ['--rain-tilt-x' as never]: `${driftX.toFixed(0)}px`,
      }}
    >
      {/* ATMOSPHERIC HAZE — fades in past 0.5; sells the downpour by
          softening the mid-distance air column. Screen-blended so it
          lifts highlights without crushing background detail. */}
      {rainIntensity > 0.5 && (
        <rect
          className="rh-rain-haze"
          x="0"
          y="180"
          width="800"
          height="300"
          fill="url(#rh-rain-haze-grad)"
          style={{ opacity: (rainIntensity - 0.5) * 1.4 }}
        />
      )}

      {/* BACKGROUND DROPS — 96 in 3 depth layers with per-drop jitter.
          The NEAR layer uses the rh-rain-streak gradient so the motion-
          blur direction (transparent tail → bright head) is unambiguous;
          far/mid layers keep solid strokes for atmospheric depth + cheap
          paint. The earlier all-solid-stroke version left the eye to
          guess motion direction from the static slant alone, which read
          as right-to-left at low wind because the slant was milder than
          the brain's "rain streak" prior. */}
      {Array.from({ length: 96 }).map((_, i) => {
        const seed = i * 73 + 13;
        const x = (seed * 7) % 880 - 40;
        const layer = i % 3;             // 0=far, 1=mid, 2=near
        // Base duration per layer, jittered ±22% per drop so the field
        // doesn't pulse in unison.
        const baseDur = layer === 0 ? 1.4 : layer === 1 ? 1.0 : 0.7;
        const durJitter = ((seed * 17) % 100) / 100;
        const dur = baseDur * (0.78 + durJitter * 0.44);
        const delay = -((seed * 0.13) % dur);
        // Length jittered ±20% so streaks vary in apparent speed.
        const baseLen = layer === 0 ? 7 : layer === 1 ? 12 : 18;
        const lenJitter = ((seed * 19) % 100) / 100;
        const len = baseLen * (0.85 + lenJitter * 0.30);
        const dx = sinA * len;
        const dy = cosA * len;
        // Per-drop opacity multiplier (subtle — keeps the layer feel
        // intact but breaks the uniform brightness).
        const opMul = 0.78 + ((seed * 23) % 100) / 100 * 0.42;
        // Near-layer drops get the gradient stroke; far/mid stay solid.
        // Inline `style.stroke` is required to override the CSS class
        // stroke (SVG attr would lose to CSS specificity).
        const useGradient = layer === 2;
        return (
          <line
            key={i}
            className={`rain-drop rain-drop--${layer}`}
            x1={x}
            y1={0}
            x2={x + dx}
            y2={dy}
            style={{
              animationDuration: `${dur.toFixed(2)}s`,
              animationDelay: `${delay.toFixed(2)}s`,
              opacity: opMul.toFixed(2),
              ...(useGradient ? { stroke: 'url(#rh-rain-streak)' } : null),
            }}
          />
        );
      })}

      {/* HERO FOREGROUND LAYER — 14 large bright drops with motion-blur
          gradient stroke (transparent tail → bright head). These read
          as drops passing right in front of the camera; longer streaks
          + gradient sell the depth. Only fades in past 0.25 intensity
          so drizzle stays subtle. */}
      {rainIntensity > 0.25 &&
        Array.from({ length: 14 }).map((_, i) => {
          const seed = i * 137 + 41;
          const x = (seed * 11) % 880 - 40;
          const dur = 0.42 + ((seed * 7) % 100) / 100 * 0.22; // 0.42..0.64s
          const delay = -((seed * 0.17) % dur);
          const len = 24 + ((seed * 23) % 100) / 100 * 10;    // 24..34px
          const dx = heroSin * len;
          const dy = heroCos * len;
          const sw = 1.6 + ((seed * 13) % 100) / 100 * 0.7;   // 1.6..2.3
          return (
            <line
              key={`hero-${i}`}
              className="rain-drop rain-drop--hero"
              x1={x}
              y1={0}
              x2={x + dx}
              y2={dy}
              stroke="url(#rh-rain-streak)"
              strokeWidth={sw.toFixed(2)}
              strokeLinecap="round"
              style={{
                animationDuration: `${dur.toFixed(2)}s`,
                animationDelay: `${delay.toFixed(2)}s`,
                opacity: ((rainIntensity - 0.25) * 1.35).toFixed(2),
              }}
            />
          );
        })}

      {/* GROUND IMPACT SPLASHES — 24 deterministic positions across the
          lawn, each looping its own crown-and-fade animation on a varied
          timer. From a viewer's perspective: continuous splash density
          even though each is on its own short cycle. Only renders past
          0.30 intensity (real drizzle doesn't make visible crowns).
          Droplets are biased rightward (downwind) — wind carries the
          spray off-axis, so the right-side droplets are larger + further
          out + higher than the upwind side, matching the LTR wind
          convention used elsewhere in the scene. */}
      {rainIntensity > 0.30 &&
        Array.from({ length: 24 }).map((_, i) => {
          const seed = i * 53 + 19;
          const x = (seed * 17) % 800;
          // Slight ground-level y jitter for natural turf roughness
          const y = 458 + ((seed * 7) % 5) - 2;
          const dur = 0.55 + ((seed * 11) % 100) / 100 * 0.30; // 0.55..0.85s
          const delay = -((seed * 0.19) % dur);
          // Wind-bias factor — at calm wind = 1.0 (symmetric crown);
          // at full storm = 1.55 (right side dominates).
          const lean = 1 + windCurrent * 0.55;
          return (
            <g
              key={`splash-${i}`}
              className="rh-rain-splash"
              style={{
                animationDuration: `${dur.toFixed(2)}s`,
                animationDelay: `${delay.toFixed(2)}s`,
                transformOrigin: `${x}px ${y}px`,
                opacity: ((rainIntensity - 0.30) * 1.4).toFixed(2),
              }}
            >
              {/* Crown — small white ellipse offset slightly right so
                  the impact "leans" downwind. The 0.6 * windCurrent
                  shift is sub-pixel at calm and ~0.5px at storm. */}
              <ellipse
                cx={x + windCurrent * 0.6}
                cy={y}
                rx={2.2 + windCurrent * 0.4}
                ry="0.7"
                fill="rgba(232, 244, 252, 0.9)"
              />
              {/* Downwind (right) droplets — larger, further out, higher */}
              <circle
                cx={x + 2.8 * lean}
                cy={y - 1.4 * lean}
                r={0.45 * lean}
                fill="rgba(245, 250, 255, 0.85)"
              />
              <circle
                cx={x + 1.4 * lean}
                cy={y - 2.4 * lean}
                r={0.32 * lean}
                fill="rgba(255, 255, 255, 0.78)"
              />
              {/* Extra downwind droplet at high wind — only visible
                  when wind is strong enough to hurl spray sideways */}
              <circle
                cx={x + 4.5 * lean}
                cy={y - 0.6 * lean}
                r={0.28 * lean}
                fill="rgba(245, 250, 255, 0.70)"
                opacity={Math.min(1, windCurrent * 1.5)}
              />
              {/* Upwind (left) droplets — smaller, closer to the
                  impact, lower (wind pushes them back into the crater) */}
              <circle
                cx={x - 2.2 / lean}
                cy={y - 0.9 / lean}
                r={0.42 / lean}
                fill="rgba(245, 250, 255, 0.85)"
              />
              <circle
                cx={x - 0.9 / lean}
                cy={y - 1.7 / lean}
                r={0.28 / lean}
                fill="rgba(255, 255, 255, 0.78)"
              />
              {/* Outer ripple ring — elongated rightward. Wider rx
                  on the right via offset cx + extended rx. */}
              <ellipse
                cx={x + windCurrent * 1.2}
                cy={y + 0.4}
                rx={3.6 + windCurrent * 1.4}
                ry="1.0"
                fill="none"
                stroke="rgba(220, 235, 248, 0.55)"
                strokeWidth="0.3"
              />
            </g>
          );
        })}
    </g>
  );
}
/** Memoized — drop primitives reconcile on every render otherwise;
 *  wind tilt + rain intensity changes are infrequent enough that
 *  shallow-equal skips are a meaningful win. */
export const RainSystem = memo(RainSystemImpl);

/* ─────────────────────────────────────────────────────────────────────────
 * WIND VORTICES — small spiraling glyphs that appear behind solid
 * obstacles (chimney, porch posts) at high storm. Models the visible
 * von Kármán vortex street that real wind generates downstream of
 * blunt bodies. Pure SVG <path> strokes with CSS-driven rotation.
 * ───────────────────────────────────────────────────────────────────────── */
interface WindVorticesProps {
  /** 0–1 storm intensity — vortices invisible below 0.55 */
  storm: number;
  reduced: boolean;
}

/**
 * Pre-computed vortex anchor pairs — hoisted to module scope. The 14
 * coords are deterministic and never depend on props, so allocating a
 * fresh array of object literals on every render was wasteful.
 *
 * v3 MAXIMALIST — 7 pair-anchors:
 *   chimney downstream, left + right porch posts, right side-wall
 *   extrusion, accent gable, R2 window, garage-left far corner.
 * Each pair is one upper vortex (side 'a' = CW spin) + one lower
 * vortex (side 'b' = CCW spin) — true von Kármán shedding pattern.
 */
type VortexAnchor = { cx: number; cy: number; r: number; dur: string; delay: string; side: 'a' | 'b' };
const VORTEX_PAIRS: ReadonlyArray<VortexAnchor> = [
  { cx: 600, cy: 195, r: 8, dur: '1.2s', delay: '0s',     side: 'a' },
  { cx: 612, cy: 215, r: 7, dur: '1.2s', delay: '0.4s',   side: 'b' },
  { cx: 470, cy: 355, r: 6, dur: '1.4s', delay: '0.3s',   side: 'a' },
  { cx: 480, cy: 372, r: 5, dur: '1.4s', delay: '0.7s',   side: 'b' },
  { cx: 600, cy: 375, r: 7, dur: '1.6s', delay: '0.6s',   side: 'a' },
  { cx: 612, cy: 392, r: 6, dur: '1.6s', delay: '1.0s',   side: 'b' },
  { cx: 750, cy: 315, r: 9, dur: '1.3s', delay: '0.15s',  side: 'a' },
  { cx: 762, cy: 335, r: 8, dur: '1.3s', delay: '0.55s',  side: 'b' },
  { cx: 220, cy: 230, r: 7, dur: '1.5s', delay: '0.20s',  side: 'a' },
  { cx: 232, cy: 250, r: 6, dur: '1.5s', delay: '0.65s',  side: 'b' },
  { cx: 730, cy: 360, r: 6, dur: '1.4s', delay: '0.45s',  side: 'a' },
  { cx: 740, cy: 376, r: 5, dur: '1.4s', delay: '0.85s',  side: 'b' },
  { cx: 60,  cy: 380, r: 7, dur: '1.6s', delay: '0.10s',  side: 'a' },
  { cx: 72,  cy: 400, r: 6, dur: '1.6s', delay: '0.50s',  side: 'b' },
];

function WindVorticesImpl({ storm, reduced }: WindVorticesProps) {
  if (storm < 0.55 || reduced) return null;
  const opacity = Math.min(0.65, (storm - 0.55) * 1.2);
  const largeDebris = storm > 0.78;
  // Larger ground-touchdown vortex at extreme storm
  const groundVortex = storm > 0.85;
  const groundOpacity = Math.min(0.7, (storm - 0.85) * 4.5);
  return (
    <g aria-hidden="true" style={{ opacity, pointerEvents: 'none' }} shapeRendering="optimizeSpeed">
      {VORTEX_PAIRS.map((v, i) => (
        <g key={i}>
          {/* WAKE TURBULENCE STREAK — wavy line trailing downstream
              from each vortex, suggesting the disturbance the
              vortex left in the air behind it */}
          <path
            d={`M ${v.cx + v.r * 1.2} ${v.cy} Q ${v.cx + v.r * 2} ${v.cy + (v.side === 'a' ? -3 : 3)} ${v.cx + v.r * 3} ${v.cy} T ${v.cx + v.r * 5} ${v.cy}`}
            stroke="rgba(228, 236, 246, 0.30)"
            strokeWidth="0.4"
            fill="none"
            strokeLinecap="round"
            className="rh-vortex-wake"
            style={{
              animationDuration: v.dur,
              animationDelay: v.delay,
            }}
          />
          {/* Vortex spiral itself */}
          <g
            className={v.side === 'a' ? 'rh-vortex' : 'rh-vortex rh-vortex--ccw'}
            style={{
              transformOrigin: `${v.cx}px ${v.cy}px`,
              animationDuration: v.dur,
              animationDelay: v.delay,
            }}
          >
            {/* Outer spiral arc */}
            <path
              d={`M ${v.cx + v.r} ${v.cy} A ${v.r} ${v.r} 0 1 1 ${v.cx - v.r * 0.4} ${v.cy + v.r * 0.9}`}
              stroke="rgba(228, 236, 246, 0.55)"
              strokeWidth="0.7"
              fill="none"
              strokeLinecap="round"
            />
            {/* Inner tighter spiral */}
            <path
              d={`M ${v.cx + v.r * 0.5} ${v.cy} A ${v.r * 0.5} ${v.r * 0.5} 0 1 0 ${v.cx - v.r * 0.3} ${v.cy + v.r * 0.4}`}
              stroke="rgba(228, 236, 246, 0.42)"
              strokeWidth="0.5"
              fill="none"
              strokeLinecap="round"
            />
            {/* Innermost tightest spiral (the vortex core) */}
            <path
              d={`M ${v.cx + v.r * 0.25} ${v.cy} A ${v.r * 0.25} ${v.r * 0.25} 0 1 1 ${v.cx - v.r * 0.15} ${v.cy + v.r * 0.2}`}
              stroke="rgba(245, 250, 255, 0.62)"
              strokeWidth="0.4"
              fill="none"
              strokeLinecap="round"
            />
            {/* DEBRIS ORBITING — 2 tiny particles caught in the swirl */}
            <circle cx={v.cx + v.r * 0.7} cy={v.cy - v.r * 0.3} r="0.5" fill="rgba(80, 65, 45, 0.65)" />
            <circle cx={v.cx - v.r * 0.55} cy={v.cy + v.r * 0.55} r="0.4" fill="rgba(80, 65, 45, 0.55)" />
            {/* v3 MAXIMALIST — LARGER DEBRIS (leaf silhouette) caught
                in the swirl at storm > 0.78. Uses the existing rh-leaf
                symbol for true leaf shape rather than a generic dot. */}
            {largeDebris && (
              <use
                href="#rh-leaf"
                x={v.cx + v.r * 0.4}
                y={v.cy - v.r * 0.7}
                width="6"
                height="4"
                style={{ color: 'rgba(120, 80, 30, 0.75)' }}
              />
            )}
          </g>
        </g>
      ))}

      {/* v3 MAXIMALIST — CHIMNEY PRESSURE RING. Concentric arcs around
          the chimney top suggesting a stagnation pressure cell where
          the wind impacts the bluff body. Animated with the same
          pulse as the wall cloud. */}
      <g className="rh-pressure-wave" style={{ transformOrigin: '566px 184px' }}>
        <ellipse cx="566" cy="184" rx="32" ry="9" fill="none" stroke="rgba(220, 230, 235, 0.35)" strokeWidth="0.5" />
        <ellipse cx="566" cy="184" rx="22" ry="6" fill="none" stroke="rgba(220, 230, 235, 0.30)" strokeWidth="0.4" />
      </g>

      {/* GROUND-LEVEL VORTEX — the larger swirl that appears at the
          base of the chimney downstream where wind hits the ground
          and recirculates. Reads as a near-touchdown rotation. */}
      {groundVortex && (
        <g style={{ opacity: groundOpacity }}>
          {/* Outer dust ring */}
          <ellipse cx="660" cy="448" rx="32" ry="6" fill="rgba(80, 65, 45, 0.32)" />
          {/* Spiral debris arc 1 */}
          <g
            className="rh-vortex"
            style={{
              transformOrigin: '660px 442px',
              animationDuration: '1.8s',
              animationDelay: '0s',
            }}
          >
            <path
              d="M 685 442 A 25 14 0 1 1 645 450"
              stroke="rgba(228, 236, 246, 0.55)"
              strokeWidth="0.8"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 678 442 A 18 10 0 1 1 648 448"
              stroke="rgba(228, 236, 246, 0.45)"
              strokeWidth="0.6"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 670 442 A 10 6 0 1 1 654 446"
              stroke="rgba(245, 250, 255, 0.55)"
              strokeWidth="0.5"
              fill="none"
              strokeLinecap="round"
            />
            {/* Orbiting debris in the ground vortex */}
            <circle cx="680" cy="440" r="0.6" fill="rgba(120, 95, 60, 0.75)" />
            <circle cx="640" cy="450" r="0.5" fill="rgba(80, 65, 45, 0.65)" />
            <circle cx="660" cy="436" r="0.4" fill="rgba(80, 65, 45, 0.60)" />
          </g>
        </g>
      )}
    </g>
  );
}
/** Memoized — `storm` updates every sim tick, but the 14 vortex
 *  paths + wake streaks are deterministic; no need to reconcile if
 *  storm hasn't crossed a threshold or changed materially. */
export const WindVortices = memo(WindVorticesImpl);

/* ─────────────────────────────────────────────────────────────────────────
 * HAIL — at extreme storm intensity (>0.85), small white pellets bounce
 * down across the scene. Each pellet has a beveled top-highlight + cast
 * dot-shadow underneath so the hailstone reads as a 3D ice ball, not
 * a flat circle. Animation is a steep diagonal fall + a small bounce
 * stagger so they read as discrete chunks of ice.
 * ───────────────────────────────────────────────────────────────────────── */
interface HailProps {
  /** 0–1 storm intensity — hail invisible below 0.85 */
  storm: number;
  reduced: boolean;
}

/**
 * Pre-computed Hail-pellet base data — deterministic by index, hoisted
 * to module scope so the array isn't reallocated on every render. The
 * three radius variants (normal/large/baseball) are precomputed too;
 * the component picks the active variant per storm tier.
 *
 * PERF: previously this ran 28× Array.from + map + 5 string ops + 4
 * arithmetic ops per render. Now it runs ONCE at module load.
 */
type HailPelletBase = {
  x: number;
  dur: string;
  delay: string;
  rNormal: number;
  rLarge: number;
  rBaseball: number;
};
const HAIL_PELLETS: HailPelletBase[] = Array.from({ length: 28 }, (_, i) => {
  const seed = i * 53 + 11;
  return {
    x: (seed * 11) % 800,
    dur: (1.0 + ((seed * 7) % 100) / 100 * 0.6).toFixed(2),
    delay: (-((seed * 0.13) % 1.6)).toFixed(2),
    rNormal:   1.4 + ((seed * 3) % 100) / 100 * 1.2,
    rLarge:    3.2 + ((seed * 3) % 100) / 100 * 1.3,
    rBaseball: 5.5 + ((seed * 3) % 100) / 100 * 1.5,
  };
});

/** Splash anchor x-positions + delays — also static, hoist out. */
const HAIL_SPLASHES: ReadonlyArray<{ x: number; delay: string }> = [
  { x: 80,  delay: '-0.3s' },
  { x: 240, delay: '-0.8s' },
  { x: 380, delay: '-0.2s' },
  { x: 520, delay: '-1.1s' },
  { x: 660, delay: '-0.5s' },
  { x: 760, delay: '-0.9s' },
];

/** Ground-crater anchor coords — static. */
const HAIL_CRATERS: ReadonlyArray<{ cx: number; cy: number; rx: number }> = [
  { cx: 95,  cy: 462, rx: 2.4 },
  { cx: 145, cy: 458, rx: 1.8 },
  { cx: 195, cy: 464, rx: 2.0 },
  { cx: 255, cy: 460, rx: 2.6 },
  { cx: 320, cy: 466, rx: 1.6 },
  { cx: 365, cy: 462, rx: 2.2 },
  { cx: 425, cy: 464, rx: 2.8 },
  { cx: 478, cy: 460, rx: 1.8 },
  { cx: 545, cy: 466, rx: 2.4 },
  { cx: 615, cy: 462, rx: 2.0 },
  { cx: 670, cy: 466, rx: 2.6 },
  { cx: 725, cy: 460, rx: 1.8 },
];

/** Ground-accumulation visible-stone positions — static. */
const HAIL_ACCUM_STONES = [100, 115, 132, 268, 292, 408, 425, 438, 590, 612, 718, 738];

function HailImpl({ storm, reduced }: HailProps) {
  if (storm < 0.85 || reduced) return null;
  const opacity = Math.min(0.95, (storm - 0.85) * 5);
  const largeHail = storm > 0.92;
  const baseballHail = storm > 0.95;
  const accumulate = storm > 0.90;
  const iceFog = storm > 0.92;
  const groundCraters = storm > 0.92;
  return (
    <g
      aria-hidden="true"
      style={{ opacity, pointerEvents: 'none' }}
      shapeRendering="optimizeSpeed"
    >
      {/* v3 MAXIMALIST — ICE FOG / MIST. At heavy hail (>0.92) a
          translucent atmospheric haze settles across the lower scene
          as the falling ice cools the air column. Soft white-cyan
          gradient that fades from mid-canvas down. */}
      {iceFog && (
        <g style={{ opacity: (storm - 0.92) * 5, mixBlendMode: 'screen' }}>
          <rect x="0" y="280" width="800" height="200" fill="rgba(220, 235, 245, 0.18)" />
          <rect x="0" y="380" width="800" height="100" fill="rgba(200, 225, 240, 0.22)" />
          {/* Wisps of ice mist drifting low across the lawn */}
          <ellipse cx="120" cy="430" rx="80" ry="6" fill="rgba(220, 235, 245, 0.28)" />
          <ellipse cx="380" cy="425" rx="100" ry="7" fill="rgba(220, 235, 245, 0.32)" />
          <ellipse cx="640" cy="432" rx="85" ry="6" fill="rgba(220, 235, 245, 0.28)" />
          <ellipse cx="240" cy="448" rx="60" ry="4" fill="rgba(200, 225, 240, 0.32)" />
          <ellipse cx="500" cy="446" rx="70" ry="4" fill="rgba(200, 225, 240, 0.32)" />
        </g>
      )}

      {/* v3 MAXIMALIST — GROUND IMPACT CRATERS. Small dark dimples
          on the lawn where heavy hail has hit and bruised the turf.
          Beveled: dark recess + sun-catch on top edge of the crater. */}
      {groundCraters && (
        <g style={{ opacity: (storm - 0.92) * 5 }}>
          {HAIL_CRATERS.map((c, i) => (
            <g key={`crater-${i}`}>
              <ellipse cx={c.cx} cy={c.cy} rx={c.rx} ry={c.rx * 0.4} fill="rgba(20, 25, 18, 0.55)" />
              {/* Sun-catch on upper rim of the crater */}
              <path
                d={`M ${c.cx - c.rx} ${c.cy - 0.1} A ${c.rx} ${c.rx * 0.4} 0 0 1 ${c.cx + c.rx} ${c.cy - 0.1}`}
                stroke="rgba(255, 240, 210, 0.32)"
                strokeWidth="0.3"
                fill="none"
              />
              {/* Hailstone still resting in the crater */}
              <circle cx={c.cx + c.rx * 0.2} cy={c.cy - 0.3} r={c.rx * 0.5} fill="rgba(245, 250, 255, 0.85)" />
              <circle cx={c.cx + c.rx * 0.05} cy={c.cy - 0.5} r={c.rx * 0.18} fill="rgba(255, 255, 255, 0.95)" />
            </g>
          ))}
        </g>
      )}

      {/* GROUND ACCUMULATION — small white drift patches collecting
          on the lawn surface as hail builds up at extreme storm */}
      {accumulate && (
        <g style={{ opacity: Math.min(0.85, (storm - 0.90) * 8) }}>
          <ellipse cx="120" cy="455" rx="22" ry="3" fill="rgba(245, 250, 255, 0.65)" />
          <ellipse cx="120" cy="454.5" rx="14" ry="1.6" fill="rgba(255, 255, 255, 0.85)" />
          <ellipse cx="280" cy="458" rx="18" ry="2.5" fill="rgba(245, 250, 255, 0.55)" />
          <ellipse cx="280" cy="457.5" rx="11" ry="1.4" fill="rgba(255, 255, 255, 0.78)" />
          <ellipse cx="420" cy="460" rx="26" ry="3" fill="rgba(245, 250, 255, 0.62)" />
          <ellipse cx="420" cy="459.5" rx="16" ry="1.7" fill="rgba(255, 255, 255, 0.82)" />
          <ellipse cx="600" cy="458" rx="20" ry="2.8" fill="rgba(245, 250, 255, 0.55)" />
          <ellipse cx="600" cy="457.5" rx="12" ry="1.5" fill="rgba(255, 255, 255, 0.78)" />
          <ellipse cx="730" cy="455" rx="18" ry="2.5" fill="rgba(245, 250, 255, 0.55)" />
          <ellipse cx="730" cy="454.5" rx="11" ry="1.4" fill="rgba(255, 255, 255, 0.78)" />
          {/* Individual stones visible on top of the drifts — gives
              the accumulation actual texture */}
          {HAIL_ACCUM_STONES.map((cx, i) => (
            <circle key={`acc-${i}`} cx={cx} cy={455 + ((cx * 7) % 5)} r="1.4" fill="rgba(255, 255, 255, 0.88)" />
          ))}
        </g>
      )}

      {HAIL_PELLETS.map((base, i) => {
        // Variant selection per current storm tier — picks the
        // pre-computed radius rather than recomputing.
        const isBaseball = baseballHail && i % 10 === 0;
        const isLarge = (largeHail && i % 5 === 0) && !isBaseball;
        const r = isBaseball ? base.rBaseball : isLarge ? base.rLarge : base.rNormal;
        const p = { x: base.x, dur: base.dur, delay: base.delay, r, isLarge, isBaseball };
        return (
        <g
          key={i}
          className="rh-hail-pellet"
          style={{
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
          transform={`translate(${p.x} 0)`}
        >
          {/* MOTION-BLUR STREAK — vertical white line trailing the
              falling stone. Faster/larger pellets get a longer streak. */}
          <line
            x1="0"
            y1={-p.r * 4 - (p.isLarge ? 8 : 4)}
            x2="0"
            y2={-p.r * 1.2}
            stroke={p.isLarge ? 'rgba(255, 255, 255, 0.55)' : 'rgba(245, 250, 255, 0.32)'}
            strokeWidth={p.isLarge ? 0.8 : 0.4}
            strokeLinecap="round"
          />
          {/* Hailstone main body (white ice) */}
          <circle cx="0" cy="0" r={p.r} fill="rgba(245, 250, 255, 0.92)" />
          {/* Bevel: top-left specular highlight (sun catches the ice) */}
          <circle cx={-p.r * 0.35} cy={-p.r * 0.35} r={p.r * 0.4} fill="rgba(255, 255, 255, 0.9)" />
          {/* Bottom-right shadow (the ice ball is curved away from sun) */}
          <path
            d={`M ${p.r * 0.7} ${-p.r * 0.2} A ${p.r} ${p.r} 0 0 1 ${-p.r * 0.2} ${p.r * 0.7}`}
            stroke="rgba(140, 165, 195, 0.65)"
            strokeWidth="0.3"
            fill="none"
          />
          {/* Tiny pinhole specular at the top (hot sun-catch) */}
          <circle cx={-p.r * 0.3} cy={-p.r * 0.5} r={p.r * 0.15} fill="rgba(255, 255, 255, 1)" />
          {/* LARGE HAIL FACETS — irregular icy facet lines on
              golf-ball-class stones. Real hailstones aren't smooth. */}
          {(p.isLarge || p.isBaseball) && (
            <g>
              {/* Facet seams */}
              <path
                d={`M ${-p.r * 0.6} ${-p.r * 0.1} Q 0 ${-p.r * 0.4} ${p.r * 0.7} ${p.r * 0.05}`}
                stroke="rgba(140, 175, 205, 0.45)"
                strokeWidth="0.3"
                fill="none"
              />
              <path
                d={`M ${-p.r * 0.2} ${-p.r * 0.7} Q ${p.r * 0.1} 0 ${-p.r * 0.3} ${p.r * 0.6}`}
                stroke="rgba(140, 175, 205, 0.40)"
                strokeWidth="0.3"
                fill="none"
              />
              {/* Secondary specular pinhole on opposite face */}
              <circle cx={p.r * 0.45} cy={-p.r * 0.15} r={p.r * 0.10} fill="rgba(255, 255, 255, 0.85)" />
              {/* Outer rim shadow ring (cold core ice) */}
              <circle cx="0" cy="0" r={p.r - 0.1} fill="none" stroke="rgba(150, 175, 200, 0.30)" strokeWidth="0.3" />
            </g>
          )}

          {/* v3 MAXIMALIST — BASEBALL HAIL extras: cracked-ice surface
              pattern (concentric layered rings = real hail growth
              layers), 3rd specular highlight, and ICE FRAGMENT SHARDS
              flying off (small triangular ice chips trailing behind). */}
          {p.isBaseball && (
            <g>
              {/* Concentric growth rings — real baseball hail forms
                  in alternating layers of clear + opaque ice */}
              <circle cx="0" cy="0" r={p.r * 0.7} fill="none" stroke="rgba(180, 205, 225, 0.40)" strokeWidth="0.25" />
              <circle cx="0" cy="0" r={p.r * 0.45} fill="none" stroke="rgba(180, 205, 225, 0.45)" strokeWidth="0.25" />
              {/* Cracked-ice radial fractures on the surface */}
              <line x1={-p.r * 0.85} y1={-p.r * 0.1} x2={p.r * 0.85} y2={p.r * 0.05} stroke="rgba(120, 145, 170, 0.55)" strokeWidth="0.3" />
              <line x1={p.r * 0.1} y1={-p.r * 0.85} x2={-p.r * 0.05} y2={p.r * 0.85} stroke="rgba(120, 145, 170, 0.55)" strokeWidth="0.3" />
              <line x1={-p.r * 0.65} y1={-p.r * 0.55} x2={p.r * 0.55} y2={p.r * 0.65} stroke="rgba(120, 145, 170, 0.45)" strokeWidth="0.25" />
              {/* 3rd specular at the very bottom (catches reflected
                  light from below — ice is highly refractive) */}
              <circle cx={p.r * 0.2} cy={p.r * 0.5} r={p.r * 0.10} fill="rgba(255, 255, 255, 0.65)" />
              {/* ICE FRAGMENT SHARDS — small ice chips spalling off
                  the baseball-class hailstone as it tumbles */}
              <polygon
                points={`${p.r * 1.1},${-p.r * 0.4} ${p.r * 1.6},${-p.r * 0.6} ${p.r * 1.4},${-p.r * 0.2}`}
                fill="rgba(220, 235, 245, 0.85)"
                stroke="rgba(180, 205, 225, 0.65)"
                strokeWidth="0.2"
              />
              <polygon
                points={`${-p.r * 1.2},${p.r * 0.3} ${-p.r * 1.7},${p.r * 0.1} ${-p.r * 1.5},${p.r * 0.6}`}
                fill="rgba(220, 235, 245, 0.85)"
                stroke="rgba(180, 205, 225, 0.65)"
                strokeWidth="0.2"
              />
              <polygon
                points={`${p.r * 0.9},${p.r * 1.2} ${p.r * 1.3},${p.r * 1.5} ${p.r * 0.7},${p.r * 1.6}`}
                fill="rgba(220, 235, 245, 0.78)"
                stroke="rgba(180, 205, 225, 0.55)"
                strokeWidth="0.2"
              />
              {/* Visible motion trail BLUR — extra-thick streak above
                  baseball hail showing it's falling fast */}
              <line
                x1="0"
                y1={-p.r * 6}
                x2="0"
                y2={-p.r * 1.4}
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth={p.r * 0.45}
                strokeLinecap="round"
                opacity="0.65"
              />
            </g>
          )}
        </g>
        );
      })}

      {/* IMPACT SPLASH PUFFS — small bursts at the bottom edge of
          the canvas where pellets "land". Animated with their own
          stagger so they pop independently. */}
      <g>
        {HAIL_SPLASHES.map((s, i) => (
          <g
            key={`splash-${i}`}
            className="rh-hail-splash"
            style={{
              animationDelay: s.delay,
              transformOrigin: `${s.x}px 460px`,
            }}
          >
            {/* Splash body — small puff of white droplets */}
            <ellipse cx={s.x} cy="460" rx="6" ry="2" fill="rgba(245, 250, 255, 0.65)" />
            {/* Side droplets fanning out */}
            <circle cx={s.x - 5} cy="458" r="0.6" fill="rgba(255, 255, 255, 0.75)" />
            <circle cx={s.x - 3} cy="455" r="0.5" fill="rgba(255, 255, 255, 0.65)" />
            <circle cx={s.x + 3} cy="455" r="0.5" fill="rgba(255, 255, 255, 0.65)" />
            <circle cx={s.x + 5} cy="458" r="0.6" fill="rgba(255, 255, 255, 0.75)" />
            {/* Top droplet (the highest splash particle) */}
            <circle cx={s.x} cy="452" r="0.4" fill="rgba(255, 255, 255, 0.55)" />
          </g>
        ))}
      </g>
    </g>
  );
}
/**
 * `Hail` is exported as a memoized wrapper so it skips re-render when
 * its `storm` + `reduced` props are shallow-equal to the previous tick.
 * The simulation loop in the parent updates `storm` every frame even
 * when the value doesn't visibly change; without memo the entire
 * 28-pellet × multi-element subtree reconciles 60×/sec.
 */
export const Hail = memo(HailImpl);

/* ─────────────────────────────────────────────────────────────────────────
 * FLYING LEAVES — amber debris carried left-to-right by the wind.
 * ───────────────────────────────────────────────────────────────────────── */
interface FlyingLeavesProps {
  /** 0–1 storm intensity */
  storm: number;
  /** Number of leaves to draw (parent FPS-throttled) */
  debrisCount: number;
}

function FlyingLeavesImpl({ storm, debrisCount }: FlyingLeavesProps) {
  if (debrisCount <= 0) return null;
  return (
    <g
      style={{ color: lerpRgb([196, 140, 50], [156, 110, 40], storm) }}
      aria-hidden="true"
    >
      {Array.from({ length: debrisCount }).map((_, i) => {
        const y = 50 + ((i * 41) % 340);
        const dur = 1.8 - storm * 0.7 + (i % 3) * 0.25;
        const delay = -((i * 0.7) % 4);
        const size = 10 + (i % 3) * 5;
        return (
          <use
            key={i}
            href="#rh-leaf"
            x="-60"
            y={y}
            width={size}
            height={(size * 8) / 12}
            className="rh-leaf"
            style={{
              animation: `rh-leaf-fly ${dur.toFixed(2)}s linear infinite`,
              animationDelay: `${delay.toFixed(2)}s`,
              opacity: 0.7 + storm * 0.3,
              filter: 'drop-shadow(0 0 3px rgba(244, 215, 122, 0.4))',
            }}
          />
        );
      })}
    </g>
  );
}
/** Memoized — debrisCount is FPS-throttled by the parent and storm
 *  changes are usually small; the heavy debrisCount × <use> mapping
 *  shouldn't repeat every frame when state hasn't actually changed. */
export const FlyingLeaves = memo(FlyingLeavesImpl);

/* ─────────────────────────────────────────────────────────────────────────
 * LIGHTNING — self-contained. Owns its own bolt state + scheduler so the
 * parent doesn't have to thread a useState/useEffect just for visuals.
 *
 * Renders nothing below 130 mph. Above 130 mph schedules a fresh L-system
 * bolt every 1.5–12s (faster as the storm intensifies). Each bolt fires a
 * white flash + glowing fork over the entire scene.
 * ───────────────────────────────────────────────────────────────────────── */
interface LightningProps {
  /** Wind speed in mph — gates the schedule (≥130 mph) */
  V: number;
  /** 0–1 storm intensity — shortens wait between bolts */
  storm: number;
  /** Off-screen / visibility-paused — halts the scheduler */
  paused: boolean;
  /** prefers-reduced-motion — disables lightning entirely */
  reduced: boolean;
  /** Optional callback fired the moment a new bolt is generated — lets the
   *  parent trigger interior-flash effects on windows, sound, vibration, etc. */
  onBoltFire?: () => void;
}

export function Lightning({ V, storm, paused, reduced, onBoltFire }: LightningProps) {
  const [bolt, setBolt] = useState<{ segs: BoltSegment[]; key: number } | null>(null);

  useEffect(() => {
    if (V < 130 || paused || reduced) return;
    let timer: number;
    const schedule = () => {
      const wait = 1500 + Math.random() * (12000 - storm * 8000);
      timer = window.setTimeout(() => {
        const seed = Math.floor(Math.random() * 1e9);
        const segs = generateBolt(seed, { startX: 200 + Math.random() * 400 });
        setBolt({ segs, key: seed });
        if (onBoltFire) onBoltFire();
        schedule();
      }, wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [V, storm, paused, reduced, onBoltFire]);

  if (V <= 130 || !bolt) return null;
  return (
    <g key={bolt.key} pointerEvents="none">
      {/* Outer glow (wide, soft) — sells the high-energy plasma look */}
      {bolt.segs.map((s, i) => (
        <path
          key={`go${i}`}
          d={s.d}
          stroke="rgba(180, 220, 255, 1)"
          strokeWidth={s.width * 4}
          strokeOpacity={s.opacity * 0.55}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#rh-bolt-glow)"
          className="rh-bolt-glow"
        />
      ))}
      {/* Inner glow (warm white) */}
      {bolt.segs.map((s, i) => (
        <path
          key={`g${i}`}
          d={s.d}
          stroke="#fffbea"
          strokeWidth={s.width * 2}
          strokeOpacity={s.opacity}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#rh-bolt-glow)"
          className="rh-bolt-glow"
        />
      ))}
      {/* Hot core (pure white) */}
      {bolt.segs.map((s, i) => (
        <path
          key={`b${i}`}
          d={s.d}
          stroke="#ffffff"
          strokeWidth={s.width}
          strokeOpacity={s.opacity}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="rh-bolt"
        />
      ))}
      {/* Scene-wide white flash — punched harder than before, with two
          rects overlaid at different opacity ramps for a more nuclear feel */}
      <rect x="0" y="0" width="800" height="480" fill="#ffffff" className="rh-flash" />
      <rect x="0" y="0" width="800" height="480" fill="rgba(220, 235, 255, 0.85)" className="rh-flash rh-flash--cool" />
    </g>
  );
}
