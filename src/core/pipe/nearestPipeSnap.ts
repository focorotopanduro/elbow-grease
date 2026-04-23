/**
 * nearestPipeSnap — given a cursor world position and the current
 * pipe set, return the nearest "snap target" within threshold.
 *
 * Two kinds of snap:
 *   • ENDPOINT — the raw (x, y, z) of any pipe's first or last point
 *     if within `endpointEps` feet.
 *   • BODY — perpendicular projection onto any pipe segment, if the
 *     cursor is within `bodyEps` feet of the segment line.
 *
 * Endpoint snap wins over body snap when both are in range, because
 * the user's intent when hovering near an endpoint is almost always
 * "I want to continue THIS run", not "I want to tee here at point
 * 99%-along-the-segment".
 *
 * Pure function, no imports of stores, deterministic. Reusable by:
 *   • DrawInteraction's first-click snap
 *   • A future "place fixture at pipe" mode
 *   • Tests
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import { nearestSegmentOnPolyline } from './polylineMath';

// ── Thresholds (feet) ─────────────────────────────────────────

export const ENDPOINT_SNAP_EPS_FT = 0.6;   // ~7" — generous; endpoint snap is high-value
export const BODY_SNAP_EPS_FT = 0.35;      // ~4" — tighter; body snap easy to trigger by mistake

// ── Return shape ──────────────────────────────────────────────

export interface PipeSnapResult {
  kind: 'endpoint' | 'body';
  position: Vec3;
  pipeId: string;
  /** For endpoint snaps: which end ('start' | 'end'). */
  which?: 'start' | 'end';
  /** For body snaps: segment index + parameter. */
  segmentIdx?: number;
  segmentT?: number;
  /** Straight-line distance cursor → snap position, feet. */
  distanceFt: number;
}

// ── Public API ────────────────────────────────────────────────

export function nearestPipeSnap(
  cursor: Vec3,
  pipes: readonly CommittedPipe[],
  opts?: { endpointEpsFt?: number; bodyEpsFt?: number },
): PipeSnapResult | null {
  const endpointEps = opts?.endpointEpsFt ?? ENDPOINT_SNAP_EPS_FT;
  const bodyEps = opts?.bodyEpsFt ?? BODY_SNAP_EPS_FT;

  // Pass 1: endpoint snap. Walk every pipe's first/last points.
  let bestEndpoint: PipeSnapResult | null = null;
  for (const pipe of pipes) {
    if (!pipe.visible || pipe.points.length < 2) continue;
    const first = pipe.points[0]!;
    const last = pipe.points[pipe.points.length - 1]!;
    const dFirst = distance(cursor, first);
    const dLast = distance(cursor, last);
    if (dFirst <= endpointEps && (!bestEndpoint || dFirst < bestEndpoint.distanceFt)) {
      bestEndpoint = {
        kind: 'endpoint',
        position: first,
        pipeId: pipe.id,
        which: 'start',
        distanceFt: dFirst,
      };
    }
    if (dLast <= endpointEps && (!bestEndpoint || dLast < bestEndpoint.distanceFt)) {
      bestEndpoint = {
        kind: 'endpoint',
        position: last,
        pipeId: pipe.id,
        which: 'end',
        distanceFt: dLast,
      };
    }
  }
  if (bestEndpoint) return bestEndpoint;

  // Pass 2: body projection.
  let bestBody: PipeSnapResult | null = null;
  for (const pipe of pipes) {
    if (!pipe.visible || pipe.points.length < 2) continue;
    const proj = nearestSegmentOnPolyline(pipe.points, cursor);
    if (!proj) continue;
    const d = Math.sqrt(proj.distSq);
    if (d > bodyEps) continue;
    if (bestBody && d >= bestBody.distanceFt) continue;
    bestBody = {
      kind: 'body',
      position: proj.worldPoint,
      pipeId: pipe.id,
      segmentIdx: proj.segmentIdx,
      segmentT: proj.t,
      distanceFt: d,
    };
  }
  return bestBody;
}

// ── Helper ────────────────────────────────────────────────────

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
