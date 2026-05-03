/**
 * Damped harmonic sway computation.
 *
 * For an organic-feeling tree/foliage motion, we superpose two harmonics
 * (trunk slow + frond fast) and add a wind-gust impulse response.
 *
 *   θ(t) = A1·sin(ω1·t + φ1) + A2·sin(ω2·t + φ2) + Gust·decay
 *
 * Pure function so the SVG component can call it during render.
 *
 * @param t        time seconds
 * @param baseline wind baseline 0-1
 * @param gust     current gust 0-1
 * @param noise    noise -1..+1 from wind engine
 * @param phase    per-element phase offset (so trees don't move in lockstep)
 * @returns sway angle in degrees
 */
export function computeSway(
  t: number,
  baseline: number,
  gust: number,
  noise: number,
  phase: number,
): number {
  const idleAmp = 1.5 + baseline * 6;
  const idleFreq = 0.6 + baseline * 0.4;
  const fastAmp = 0.8 + baseline * 2;
  const fastFreq = 1.6 + baseline * 0.6;

  return (
    idleAmp * Math.sin(idleFreq * t + phase) +
    fastAmp * Math.sin(fastFreq * t + phase * 1.7) +
    gust * 12 +
    noise * (1 + baseline * 2)
  );
}
