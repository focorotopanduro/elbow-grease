/**
 * AtmosphericTurbulence — procedural shader-like air using SVG's native
 * `feTurbulence` filter (real fractal noise, GPU-accelerated by every
 * modern browser). Renders as a single full-width rect filtered to look
 * like swirling volumetric haze; CSS translates the layer horizontally
 * so the noise pattern visibly drifts across the sky.
 *
 * Architecture choices that keep it cheap:
 *   - ONE filtered element (not many) — the SVG turbulence cost we hit on
 *     the trust badge backgrounds was 4 simultaneously-visible surfaces.
 *     One surface is fine.
 *   - Filter rasterizes once, cached. The CSS animation translates the
 *     rasterized layer via GPU compositor — no re-filtering per frame.
 *   - **Renders nothing when storm < 0.3** — true zero cost on calm days.
 *   - Reduced-motion users get the noise pattern but no drift animation.
 *
 * Visual response:
 *   - Calm (storm < 0.3): invisible, no DOM render
 *   - Building wind (0.3 → 0.6): faint translucent shimmer above horizon
 *   - Storm (0.6 → 1.0): pronounced atmospheric distortion, max ~55% opacity
 *
 * The opacity ramp + translation speed are the only "live" props — the
 * underlying noise pattern is procedural and adapts to the storm context
 * without per-frame JS.
 */
interface Props {
  /** 0–1 storm intensity */
  storm: number;
  /** prefers-reduced-motion — pauses drift, keeps static noise */
  reduced: boolean;
}

export default function AtmosphericTurbulence({ storm, reduced }: Props) {
  // Opacity ramp: invisible until storm > 0.3, then linear up to 0.40 max.
  // Earlier ceiling (0.55) made edge artifacts visible whenever the rect
  // bounds clipped inside the canvas; a softer ceiling + the much larger
  // rect below keep the haze present without hard edges.
  if (storm < 0.3) return null;
  const opacity = Math.min(0.40, (storm - 0.3) * 0.62);
  // Animation speed accelerates as the storm intensifies (10s → 6s)
  const dur = (10 - storm * 4).toFixed(1);

  // Rect MUST be much larger than the canvas (800×480 viewBox) on every
  // side, because:
  //   - X is animated by translate3d(-333px). Old rect (x=-100, w=1000)
  //     had its right edge at x=900 → after translation x=567, leaving a
  //     233px-wide vertical seam on the canvas right side where the
  //     screen-blend stopped contributing.
  //   - Y is static but the old height=320 cut off mid-canvas at y=320,
  //     producing a horizontal seam right behind the house roofline.
  // New bounds: x=-500..1300 (right edge stays at x=967 even after
  // -333 translation, well past canvas right at x=800), and
  // y=-50..530 (covers the entire 0..480 viewBox with buffer).
  return (
    <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
      <rect
        className={reduced ? '' : 'rh-air-turb'}
        x="-500"
        y="-50"
        width="1800"
        height="580"
        fill="white"
        filter="url(#rh-air-turb)"
        opacity={opacity}
        style={{
          mixBlendMode: 'screen',
          ['--air-dur' as never]: `${dur}s`,
        }}
      />
    </g>
  );
}
