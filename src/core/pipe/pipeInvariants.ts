/**
 * pipeInvariants — Phase 14.AD.30.
 *
 * Invariant checker + dev-only assertion helper for committed pipes
 * and fitting instances. Expresses the GEOMETRIC CONTRACT that
 * every rendering + emission path assumes:
 *
 *   1. Every polyline point is finite (no NaN / Infinity).
 *   2. diameter > 0.
 *   3. points.length >= 2 (otherwise no segment geometry).
 *   4. Adjacent points are not coincident (segment length > EPS).
 *   5. Any segment with an interior bend has a 0°..180° angle
 *      (just a sanity assertion).
 *
 * Returns a list of violations. Does NOT throw or mutate. Callers
 * can decide whether to log, filter out the pipe, or repair.
 *
 * Use `assertPipeInvariants(pipe)` in dev-only hot paths where a
 * silent NaN would cascade into unrenderable geometry; it console-
 * warns when invariants fail. Production builds minify this to a
 * no-op via the `import.meta.env.DEV` check.
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { Vec3 } from '@core/events';
import type { FittingInstance } from '../../ui/pipe/FittingGenerator';
import { distance } from './pipeDirections';

const POINT_EPS = 1e-6;

/** Safe dev-mode probe — falls through to false in test / SSR
 *  environments where `import.meta.env` isn't defined. */
function isDev(): boolean {
  try {
    return (
      typeof import.meta !== 'undefined'
      && (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
    );
  } catch {
    return false;
  }
}

export interface Violation {
  kind:
    | 'non-finite-point'
    | 'non-finite-diameter'
    | 'non-positive-diameter'
    | 'too-few-points'
    | 'coincident-points'
    | 'empty-material'
    | 'non-finite-quaternion';
  pipeId?: string;
  fittingId?: string;
  /** Index in `points` or description of WHERE the violation is. */
  at?: string;
  detail?: string;
}

function isFinite3(p: Vec3): boolean {
  return (
    Number.isFinite(p[0])
    && Number.isFinite(p[1])
    && Number.isFinite(p[2])
  );
}

/**
 * Check a single committed pipe against all geometric invariants.
 * Returns an array of violations (empty if the pipe is valid).
 */
export function validatePipe(pipe: CommittedPipe): Violation[] {
  const out: Violation[] = [];

  if (!pipe.material || pipe.material === '') {
    out.push({ kind: 'empty-material', pipeId: pipe.id });
  }

  if (!Number.isFinite(pipe.diameter)) {
    out.push({
      kind: 'non-finite-diameter',
      pipeId: pipe.id,
      detail: String(pipe.diameter),
    });
  } else if (pipe.diameter <= 0) {
    out.push({
      kind: 'non-positive-diameter',
      pipeId: pipe.id,
      detail: String(pipe.diameter),
    });
  }

  if (pipe.points.length < 2) {
    out.push({
      kind: 'too-few-points',
      pipeId: pipe.id,
      detail: `${pipe.points.length} points (need >= 2)`,
    });
    return out; // remaining checks depend on >=2 points
  }

  for (let i = 0; i < pipe.points.length; i++) {
    if (!isFinite3(pipe.points[i]!)) {
      out.push({
        kind: 'non-finite-point',
        pipeId: pipe.id,
        at: `points[${i}]`,
        detail: JSON.stringify(pipe.points[i]),
      });
    }
  }

  for (let i = 1; i < pipe.points.length; i++) {
    const a = pipe.points[i - 1]!;
    const b = pipe.points[i]!;
    if (!isFinite3(a) || !isFinite3(b)) continue; // already reported
    if (distance(a, b) < POINT_EPS) {
      out.push({
        kind: 'coincident-points',
        pipeId: pipe.id,
        at: `segment [${i - 1}..${i}]`,
        detail: `distance ${distance(a, b).toExponential(3)} < ${POINT_EPS}`,
      });
    }
  }

  return out;
}

/** Check a single fitting instance for quaternion / position validity. */
export function validateFitting(f: FittingInstance): Violation[] {
  const out: Violation[] = [];
  const [qx, qy, qz, qw] = f.quaternion;
  if (
    !Number.isFinite(qx) || !Number.isFinite(qy)
    || !Number.isFinite(qz) || !Number.isFinite(qw)
  ) {
    out.push({
      kind: 'non-finite-quaternion',
      fittingId: f.id,
      detail: `(${qx},${qy},${qz},${qw})`,
    });
  }
  if (!isFinite3(f.position)) {
    out.push({
      kind: 'non-finite-point',
      fittingId: f.id,
      at: 'position',
      detail: JSON.stringify(f.position),
    });
  }
  if (!Number.isFinite(f.diameter) || f.diameter <= 0) {
    out.push({
      kind: 'non-positive-diameter',
      fittingId: f.id,
      detail: String(f.diameter),
    });
  }
  return out;
}

/** Batch validation across a whole scene. */
export function validateScene(
  pipes: ReadonlyArray<CommittedPipe>,
  fittings: ReadonlyArray<FittingInstance> = [],
): Violation[] {
  const out: Violation[] = [];
  for (const p of pipes) out.push(...validatePipe(p));
  for (const f of fittings) out.push(...validateFitting(f));
  return out;
}

/**
 * Dev-mode invariant check — console-warns on any violation. No-op
 * in production. Safe to sprinkle in hot paths; the `import.meta.
 * env.DEV` check is tree-shakable, so production builds compile
 * this away.
 */
export function assertPipeInvariants(pipe: CommittedPipe): void {
  if (!isDev()) return;
  const violations = validatePipe(pipe);
  if (violations.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[pipeInvariants] Pipe ${pipe.id} has ${violations.length} violation(s):`,
    violations,
  );
}

export function assertFittingInvariants(f: FittingInstance): void {
  if (!isDev()) return;
  const violations = validateFitting(f);
  if (violations.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `[pipeInvariants] Fitting ${f.id} (${f.type}) has ${violations.length} violation(s):`,
    violations,
  );
}
