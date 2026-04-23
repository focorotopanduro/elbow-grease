/**
 * SectorPredictor — "where is the cursor headed?" heuristic for the
 * radial menu.
 *
 * Problem: even on a snappy wheel, there's a ~3-frame (~50ms) window
 * between the cursor crossing a sector boundary and the user's eye
 * registering the highlight. On short flicks, the wheel committing on
 * click can feel like it "ate" the motion — you aimed for the sector,
 * the wheel closed, but the highlight hadn't arrived yet.
 *
 * Solution: watch the cursor's velocity and project forward
 * `LOOKAHEAD_MS` (default 90ms). If the projection lands in a sector,
 * preview that sector's highlight NOW — about 3 frames before the
 * cursor physically arrives.
 *
 * Invariants:
 *   • Commit always uses the ACTUALLY-hit sector at click time. If the
 *     user corrects mid-flight, the prediction is silently overridden
 *     by the real hit-test; no wrong commits.
 *   • Prediction is GATED on velocity. A stationary cursor makes no
 *     prediction (returns null). This avoids the "twitchy" failure
 *     mode where a slight shake looks like a flick.
 *   • No dependencies. Pure math + an array. Tree-shakes cleanly.
 *
 * Usage:
 *   const predictor = new SectorPredictor();
 *   on pointermove: predictor.addSample(clientX - cx, cy - clientY, now);
 *   every frame/sample:
 *     const predicted = predictor.predict({ baseSectors, innerRadius, lookahead: 90 });
 *     const hit = sectorAtAngle(currentAngle, baseSectors);
 *     setHighlighted(hit ?? predicted);   // prediction fills the gap
 */

export interface Sample {
  /** Cursor x relative to wheel center (not page coords). */
  x: number;
  /** Cursor y relative to wheel center; SAME sign convention as
   *  Math.atan2 uses: "up" is negative, matching the geometry the
   *  RadialMenu normalizes into (-dy in its atan2 call). */
  y: number;
  /** performance.now() ms. */
  t: number;
}

export interface BaseSector {
  id: string;
  centerAngleRad: number;
  halfWidthRad: number;
}

export interface PredictArgs {
  baseSectors: readonly BaseSector[];
  /** Wheel inner radius — below this the cursor is in the dead zone. */
  innerRadius: number;
  /** Wheel outer radius — beyond this, no sector applies. */
  outerRadius: number;
  /** Project position this many ms ahead. Default 90. */
  lookaheadMs?: number;
  /** Minimum per-ms pixel speed below which no prediction is emitted.
   *  Default 0.15 px/ms (≈ 150 px/s). Below this, the cursor is
   *  "drifting" and predictions would be noise. */
  minSpeedPxPerMs?: number;
}

const DEFAULT_SAMPLES = 4;
const DEFAULT_LOOKAHEAD_MS = 90;
const DEFAULT_MIN_SPEED = 0.15;

export class SectorPredictor {
  private samples: Sample[] = [];
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_SAMPLES) {
    this.capacity = Math.max(2, capacity);
  }

  /** Reset the buffer — call on wheel close. */
  clear(): void {
    this.samples.length = 0;
  }

  /**
   * Feed a cursor sample. Coordinates are RELATIVE TO WHEEL CENTER.
   * Timestamps should be monotonic (performance.now()).
   */
  addSample(x: number, y: number, t: number): void {
    // Guard against stale / out-of-order samples from weird input sources.
    const last = this.samples[this.samples.length - 1];
    if (last && t <= last.t) return;

    this.samples.push({ x, y, t });
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /** How many valid samples the buffer currently holds. */
  get sampleCount(): number {
    return this.samples.length;
  }

  /**
   * Return the predicted sector id, or null if:
   *   • the cursor is too slow (below minSpeedPxPerMs)
   *   • fewer than 2 samples are available
   *   • the projected position lands OUTSIDE the wheel annulus
   *   • no base sector contains the projected angle
   */
  predict(args: PredictArgs): string | null {
    const { baseSectors, innerRadius, outerRadius } = args;
    const lookaheadMs = args.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS;
    const minSpeed = args.minSpeedPxPerMs ?? DEFAULT_MIN_SPEED;

    if (this.samples.length < 2) return null;

    const newest = this.samples[this.samples.length - 1]!;
    const oldest = this.samples[0]!;
    const dt = newest.t - oldest.t;
    if (dt <= 0) return null;

    // Average velocity over the buffer window. Using the full window
    // (not just the last two samples) smooths out single-frame jitter.
    const vx = (newest.x - oldest.x) / dt;
    const vy = (newest.y - oldest.y) / dt;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < minSpeed) return null;

    // Project forward from the MOST RECENT sample.
    const px = newest.x + vx * lookaheadMs;
    const py = newest.y + vy * lookaheadMs;
    const pr = Math.sqrt(px * px + py * py);

    // Outside the wheel annulus → no sector.
    if (pr < innerRadius || pr > outerRadius) return null;

    // Atan2 with the Y sign flip matches the RadialMenu's convention:
    // "up on screen" → positive angle. Callers feed samples in the
    // same convention (see header comment).
    let angle = Math.atan2(py, px);
    // Normalize to [0, 2π).
    const twoPi = Math.PI * 2;
    angle = ((angle % twoPi) + twoPi) % twoPi;

    return findSectorAtAngle(angle, baseSectors);
  }
}

/**
 * Find the sector whose angular range contains `angle`. Exported for
 * tests; the RadialMenu uses a similar function from its store.
 *
 * Boundary behavior: inclusive on the clockwise edge, exclusive on
 * the counter-clockwise edge, matching the live hit-tester.
 */
export function findSectorAtAngle(
  angle: number,
  sectors: readonly BaseSector[],
): string | null {
  const twoPi = Math.PI * 2;
  for (const s of sectors) {
    let delta = angle - s.centerAngleRad;
    // Wrap into [-π, π]
    while (delta < -Math.PI) delta += twoPi;
    while (delta > Math.PI) delta -= twoPi;
    if (Math.abs(delta) <= s.halfWidthRad) return s.id;
  }
  return null;
}
