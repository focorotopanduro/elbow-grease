/**
 * springArm — pure multi-raycast collision clamp for a camera boom.
 *
 * Runs as a post-process after OrbitControls has placed the camera.
 * Casts five parallel rays from the orbit `target` toward the current
 * camera position — a center ray plus four perpendicular-offset rays
 * that cover the camera's physical volume — and returns a clamped
 * distance that prevents the camera from intersecting scene geometry.
 *
 * The five-ray topology is adapted from the "Architectural Synthesis"
 * design doc: a single center ray misses thin obstructions that slip
 * between the target and the camera's volume corners (bookcase legs,
 * wall edges, pipe elbows). Four perpendicular-offset rays sweep a
 * rectangular tube approximating the camera body.
 *
 * Pure function; a raycast callback is injected so this module has no
 * Three.js dependency. The R3F component (`SpringArmController`)
 * provides the callback via `THREE.Raycaster.intersectObjects`.
 *
 * Smoothing is NOT done here. This returns the *target* clamped
 * distance for the current frame; the controller applies a lerp so
 * the camera eases in/out of clamps rather than snapping.
 */

// ── Types ──────────────────────────────────────────────────────

/** 3D vector as a plain tuple — no Three.js import. */
export type Vec3 = readonly [x: number, y: number, z: number];

export interface SpringArmInput {
  /** Orbit target point. Spring arm extends FROM here TOWARD the camera. */
  target: Vec3;
  /** Current camera position (post-OrbitControls). */
  cameraPosition: Vec3;
  /**
   * Minimum clamped distance. Even inside a wall the camera stays at
   * least this far from target so the near plane doesn't go negative.
   * Typical: 0.5 ft.
   */
  minDistance: number;
  /**
   * Pullback fraction from the hit point. If the clamp lands a camera
   * at the exact collision point, the near clipping plane would still
   * penetrate the surface. 0.05 (5%) feels right for standard CAD
   * scales. Applied as `hitDistance - padding * desiredDistance`.
   */
  padding: number;
  /**
   * Perpendicular ray offset in world units — how far the four corner
   * rays fly off-axis from the center ray. Approximates the camera's
   * physical radius. Default ~0.1 ft (~1.2 in) keeps the spring arm
   * snug without overshoot.
   */
  perpOffset?: number;
}

export interface SpringArmResult {
  /** The distance the camera SHOULD be from target this frame. */
  clampedDistance: number;
  /** Did any of the five rays hit an obstruction? */
  hit: boolean;
  /** Raw desired distance — what the camera would be at with no clamp. */
  desiredDistance: number;
  /** Index of the ray that reported the closest hit, or -1. */
  rayIndex: number;
}

/**
 * Raycast callback shape. Returns the distance to the nearest hit or
 * null/undefined if the ray didn't hit anything within maxDistance.
 * The caller is responsible for building the scene object list + the
 * underlying THREE.Raycaster.
 */
export type RaycastFn = (
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
) => number | null;

// ── Main ──────────────────────────────────────────────────────

const DEFAULT_PERP_OFFSET = 0.1; // feet

export function computeSpringArm(
  input: SpringArmInput,
  raycast: RaycastFn,
): SpringArmResult {
  const desiredDistance = distance(input.target, input.cameraPosition);

  // Degenerate: camera is on top of target. Nothing to clamp — OrbitControls
  // already enforces its own minDistance. Return desired unchanged.
  if (desiredDistance < 1e-4) {
    return {
      clampedDistance: Math.max(input.minDistance, desiredDistance),
      hit: false,
      desiredDistance,
      rayIndex: -1,
    };
  }

  const direction = normalize(sub(input.cameraPosition, input.target));

  // Build a pair of perpendicular basis vectors to direction, to offset
  // the four corner rays into a rectangular "tube" around the center ray.
  // The pair must span the plane perpendicular to direction; picking any
  // non-parallel reference axis and cross-producting works.
  const ref: Vec3 = Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const basisA = normalize(cross(direction, ref));
  const basisB = normalize(cross(direction, basisA));

  const perp = input.perpOffset ?? DEFAULT_PERP_OFFSET;

  // Five rays: center + 4 corners offset by ±perp along both basis vectors.
  // Each "ray" is defined by its origin offset from target (same as the
  // end-point offset, producing parallel rays that run through the
  // camera's volume).
  const rayOffsets: Vec3[] = [
    [0, 0, 0],
    combine(basisA, +perp, basisB, +perp),
    combine(basisA, +perp, basisB, -perp),
    combine(basisA, -perp, basisB, +perp),
    combine(basisA, -perp, basisB, -perp),
  ];

  let bestHit = desiredDistance;
  let hitRay = -1;

  for (let i = 0; i < rayOffsets.length; i++) {
    const offset = rayOffsets[i]!;
    const origin: Vec3 = [
      input.target[0] + offset[0],
      input.target[1] + offset[1],
      input.target[2] + offset[2],
    ];
    // Same direction for every ray (parallel tube). Max distance is the
    // desired distance — we don't care about hits beyond the camera.
    const hit = raycast(origin, direction, desiredDistance);
    if (hit !== null && hit !== undefined && hit < bestHit) {
      bestHit = hit;
      hitRay = i;
    }
  }

  if (hitRay < 0) {
    // No collision — camera stays at its desired distance.
    return {
      clampedDistance: Math.max(input.minDistance, desiredDistance),
      hit: false,
      desiredDistance,
      rayIndex: -1,
    };
  }

  // Collision: pull camera back from hit point by padding * desired.
  const paddingAbs = input.padding * desiredDistance;
  const clamped = Math.max(input.minDistance, bestHit - paddingAbs);

  return {
    clampedDistance: clamped,
    hit: true,
    desiredDistance,
    rayIndex: hitRay,
  };
}

// ── Lerp helper for the smoothing step (controller uses this) ───

/**
 * Exponential-ease lerp toward target. `alpha` should be time-based:
 * alpha = 1 - exp(-dt / timeConstant). A time constant of ~0.15s
 * produces a snappy but non-jittery spring-arm feel.
 *
 * Pure function; no Three.js.
 */
export function lerpDistance(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha;
}

/**
 * Given a dt (seconds) and a time constant (seconds), produce the alpha
 * argument for `lerpDistance`. `timeConstant` is the time it takes to
 * decay 63% of the distance-to-target; smaller = snappier.
 */
export function easeAlpha(dtSec: number, timeConstant: number): number {
  if (timeConstant <= 0) return 1;
  return 1 - Math.exp(-dtSec / timeConstant);
}

// ── Vector helpers (no Three.js dep) ──────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-9) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** `a * sa + b * sb` as a new Vec3. */
function combine(a: Vec3, sa: number, b: Vec3, sb: number): Vec3 {
  return [
    a[0] * sa + b[0] * sb,
    a[1] * sa + b[1] * sb,
    a[2] * sa + b[2] * sb,
  ];
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  DEFAULT_PERP_OFFSET,
};
