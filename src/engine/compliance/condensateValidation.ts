/**
 * condensateValidation — Phase 14.AA.3
 *
 * Enforces the R-014 code rule ported from the original Elbow
 * Grease compliance catalog:
 *
 *   **FBC 2023 § 314.2.1.1 / IPC 2021 § 314.2.1.1**
 *   "HVAC equipment condensate discharge shall not be directly
 *    connected to the DWV system. Condensate shall discharge to
 *    an approved receptor — floor drain, hub drain, trapped and
 *    vented receptor, or an air-gap device."
 *
 * Why it matters: condensate IS wastewater, but it's LOW-flow,
 * intermittent, and not pressurized. Plumbing it directly into a
 * drainage pipe lets sewer gases migrate back up the condensate
 * line into the air handler. The receptor (typically a floor
 * drain or a hub drain with a p-trap) breaks that path with an
 * air gap.
 *
 * Pure module — no React, no Zustand, no Three. Takes pipes +
 * fixtures, returns violations the compliance panel can display.
 *
 * Detection:
 *   For every pipe whose `system === 'condensate'`, check its
 *   endpoints. Each endpoint that sits at the endpoint of a
 *   `waste` / `storm` pipe (within JUNCTION_TOL) is a violation
 *   — UNLESS an "approved receptor" fixture is also at that
 *   point.
 *
 * Approved receptors (what breaks the direct-connection rule):
 *   - floor_drain
 *   - cleanout_access (hub cleanout can serve as a receptor in
 *     some jurisdictions; accepted here)
 *   - utility_sink / mop_sink (often used for condensate discharge
 *     in commercial work with an air gap)
 *   - laundry_tub (residential receptor pattern)
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';
import type { FixtureSubtype } from '../graph/GraphNode';
import { getFixtureGeometry } from '@core/fixtures/ConnectionPoints';
import { fixtureLocalToWorld } from '@core/fixtures/autoRouteFixture';
import { JUNCTION_TOLERANCE_FT, JUNCTION_TOLERANCE_FT_SQ } from '@core/pipe/junctionConstants';

// ── Constants ────────────────────────────────────────────────

// Phase 14.AD.14 — single source via junctionConstants.
const JUNCTION_TOL = JUNCTION_TOLERANCE_FT;
const JUNCTION_TOL_SQ = JUNCTION_TOLERANCE_FT_SQ;

/**
 * Fixtures that count as an approved receptor for condensate
 * discharge (per FBC 314.2.1.1 language + field practice).
 */
const APPROVED_RECEPTORS: ReadonlySet<FixtureSubtype> = new Set([
  'floor_drain',
  'cleanout_access',
  'utility_sink',
  'mop_sink',
  'laundry_tub',
]);

// ── Types ────────────────────────────────────────────────────

export type CondensateViolationKind = 'direct_to_dwv';

export interface CondensateViolation {
  kind: CondensateViolationKind;
  /** The offending condensate pipe id. */
  condensatePipeId: string;
  /** The waste/storm pipe it connects to. */
  targetPipeId: string;
  /** The endpoint position where the illegal connection happens. */
  position: Vec3;
  /** Human-readable message for the compliance panel. */
  message: string;
  /** Code reference ("FBC 314.2.1.1 / IPC 314.2.1.1"). */
  codeRef: string;
  severity: 'critical';
}

// ── Helpers ───────────────────────────────────────────────────

function pointsNear(a: Vec3, b: Vec3): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz < JUNCTION_TOL_SQ;
}

function endpointsOf(p: CommittedPipe): readonly Vec3[] {
  return [p.points[0]!, p.points[p.points.length - 1]!];
}

/**
 * Is there an approved receptor within JUNCTION_TOL of `point`?
 * "Receptor" here means the fixture's OUTLET connection point —
 * for floor drains that's the drain port; for sinks that's the
 * drain tailpiece. Using the existing fixture geometry registry
 * so a rotated fixture still reports the world position of its
 * drain.
 */
function hasReceptorAt(
  point: Vec3,
  fixtures: readonly FixtureInstance[],
): boolean {
  for (const f of fixtures) {
    if (!APPROVED_RECEPTORS.has(f.subtype)) continue;
    // Check fixture origin first (cheap XZ radius), then the
    // actual drain-port world position.
    const quickDx = f.position[0] - point[0];
    const quickDz = f.position[2] - point[2];
    const quickDist = Math.sqrt(quickDx * quickDx + quickDz * quickDz);
    if (quickDist > 5) continue; // > 5 ft XZ — can't be the same point
    // Get the geometry's connection points and test each
    const geo = getFixtureGeometry(f.subtype, f.params);
    for (const port of geo.points) {
      if (port.role !== 'drain') continue;
      const world = fixtureLocalToWorld(f, port.position);
      if (pointsNear(world, point)) return true;
    }
  }
  return false;
}

// ── Main detector ─────────────────────────────────────────────

/**
 * Walk every condensate pipe in the scene. For each endpoint,
 * flag a violation if it touches a `waste` or `storm` pipe
 * endpoint without an approved receptor at the same point.
 *
 * Complexity: O(C × D + C × F) where C = condensate pipes,
 * D = drain pipes, F = fixtures. Typical scenes C ≤ 10,
 * negligible cost.
 */
export function validateCondensateDischarge(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): CondensateViolation[] {
  const out: CondensateViolation[] = [];
  const condensatePipes = pipes.filter((p) => p.system === 'condensate' && p.visible);
  if (condensatePipes.length === 0) return out;

  const drainagePipes = pipes.filter(
    (p) => (p.system === 'waste' || p.system === 'storm') && p.visible,
  );

  for (const c of condensatePipes) {
    for (const cEnd of endpointsOf(c)) {
      // Skip if an approved receptor breaks the direct connection
      if (hasReceptorAt(cEnd, fixtures)) continue;

      // Check every drainage pipe's endpoints
      for (const d of drainagePipes) {
        for (const dEnd of endpointsOf(d)) {
          if (!pointsNear(cEnd, dEnd)) continue;
          out.push({
            kind: 'direct_to_dwv',
            condensatePipeId: c.id,
            targetPipeId: d.id,
            position: [cEnd[0], cEnd[1], cEnd[2]],
            message:
              'HVAC condensate line connects directly to drainage system '
              + `(pipe ${d.id}, system ${d.system}). `
              + 'FBC 314.2.1.1 requires an approved receptor '
              + '(floor drain, hub drain, or air-gap device). '
              + 'Insert a receptor fixture or reroute to an existing one.',
            codeRef: 'FBC 314.2.1.1 / IPC 314.2.1.1',
            severity: 'critical',
          });
          // One violation per condensate endpoint is enough; stop
          // after the first drain-pipe hit
          break;
        }
      }
    }
  }

  return out;
}

// ── Reporting ────────────────────────────────────────────────

export interface CondensateReport {
  violationCount: number;
  violations: CondensateViolation[];
  passesCode: boolean;
}

export function reportCondensate(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): CondensateReport {
  const violations = validateCondensateDischarge(pipes, fixtures);
  return {
    violationCount: violations.length,
    violations,
    passesCode: violations.length === 0,
  };
}
