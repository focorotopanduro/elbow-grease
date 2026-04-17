/**
 * FloorResolver — pure helpers for mapping geometry to floors.
 *
 * Real buildings have multiple stories. Every pipe, fitting, fixture,
 * and support has a Y elevation. This resolver determines which floor
 * a given piece of geometry belongs to — or if it SPANS multiple floors
 * (as vertical stacks and risers always do).
 *
 * Key operations:
 *
 *   resolveFloorForPoint(y)
 *     — Returns the floor whose elevation range contains Y
 *
 *   resolveFloorsForPipe(pipe)
 *     — Returns ALL floors the pipe touches (may be >1 for risers)
 *
 *   pipeOverlapsFloor(pipe, floor)
 *     — Quick boolean check
 *
 *   pipeIsOnActiveFloor(pipe)
 *     — Does this pipe overlap with the active floor?
 *
 *   segmentOverlapsFloor(a, b, floor)
 *     — For per-segment ghosting (future upgrade)
 *
 *   countPipesPerFloor(pipes)
 *     — Aggregation for the floor selector's count badges
 *
 * Floor assignment uses elevation RANGE OVERLAP, not just midpoint,
 * so a 9-ft vertical pipe sitting at y=7 to y=16 correctly reports as
 * being on BOTH floor_1 (0-9ft) and floor_2 (9-18ft).
 */

import type { Vec3 } from '../events';
import type { CommittedPipe } from '../../store/pipeStore';
import { useFloorStore, type Floor } from '../../store/floorStore';

// ── Core resolvers ──────────────────────────────────────────────

/** Which floor contains this elevation Y? Null if out of all ranges. */
export function resolveFloorForPoint(y: number): Floor | null {
  const floors = Object.values(useFloorStore.getState().floors);
  for (const f of floors) {
    if (y >= f.elevationBase && y < f.elevationTop) return f;
  }
  return null;
}

/** Does the range [yMin, yMax] intersect the floor's elevation range? */
export function rangeOverlapsFloor(yMin: number, yMax: number, floor: Floor): boolean {
  // Overlap iff NOT (range entirely above or entirely below)
  return !(yMax < floor.elevationBase || yMin > floor.elevationTop);
}

/** Does a single point [x, y, z] fall within this floor's elevation? */
export function pointOverlapsFloor(p: Vec3, floor: Floor): boolean {
  return p[1] >= floor.elevationBase && p[1] < floor.elevationTop;
}

/** Does a line segment a→b cross through the floor's elevation slab? */
export function segmentOverlapsFloor(a: Vec3, b: Vec3, floor: Floor): boolean {
  const yMin = Math.min(a[1], b[1]);
  const yMax = Math.max(a[1], b[1]);
  return rangeOverlapsFloor(yMin, yMax, floor);
}

// ── Pipe-level queries ─────────────────────────────────────────

/** Pipe's Y range (min to max across all waypoints). */
export function pipeYRange(pipe: CommittedPipe): { min: number; max: number } {
  if (pipe.points.length === 0) return { min: 0, max: 0 };
  let min = pipe.points[0]![1];
  let max = pipe.points[0]![1];
  for (const p of pipe.points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return { min, max };
}

/** Does this pipe overlap with the given floor's elevation range? */
export function pipeOverlapsFloor(pipe: CommittedPipe, floor: Floor): boolean {
  const { min, max } = pipeYRange(pipe);
  return rangeOverlapsFloor(min, max, floor);
}

/** List of all floors this pipe touches (may be empty or multiple). */
export function resolveFloorsForPipe(pipe: CommittedPipe): Floor[] {
  const floors = Object.values(useFloorStore.getState().floors);
  return floors.filter((f) => pipeOverlapsFloor(pipe, f));
}

/** Primary floor for a pipe (first/lowest floor it overlaps). */
export function primaryFloorForPipe(pipe: CommittedPipe): Floor | null {
  const overlapping = resolveFloorsForPipe(pipe);
  if (overlapping.length === 0) return null;
  return overlapping.reduce((lowest, f) => f.order < lowest.order ? f : lowest, overlapping[0]!);
}

/** Is this pipe entirely within a single floor's range? */
export function pipeIsSingleFloor(pipe: CommittedPipe): boolean {
  return resolveFloorsForPipe(pipe).length === 1;
}

/** Does this pipe overlap the CURRENTLY ACTIVE floor? */
export function pipeIsOnActiveFloor(pipe: CommittedPipe): boolean {
  const { floors, activeFloorId } = useFloorStore.getState();
  const active = floors[activeFloorId];
  if (!active) return true;
  return pipeOverlapsFloor(pipe, active);
}

// ── Multi-floor status for render params ───────────────────────

export type FloorMembership = 'active' | 'inactive' | 'spans';

/**
 * Compute a pipe's relationship to the current active floor.
 *   'active'   — pipe lies entirely on the active floor
 *   'inactive' — pipe does NOT touch the active floor
 *   'spans'    — pipe overlaps active floor AND at least one other
 */
export function pipeFloorMembership(pipe: CommittedPipe): FloorMembership {
  const { floors, activeFloorId } = useFloorStore.getState();
  const active = floors[activeFloorId];
  if (!active) return 'active';

  const floorsTouched = resolveFloorsForPipe(pipe);
  const touchesActive = floorsTouched.some((f) => f.id === activeFloorId);
  if (!touchesActive) return 'inactive';
  if (floorsTouched.length > 1) return 'spans';
  return 'active';
}

// ── Aggregation for the selector UI ────────────────────────────

export interface FloorAggregates {
  floorId: string;
  pipeCount: number;
  fixtureCount: number;
  segmentCount: number;
  totalLengthFt: number;
}

/** Tally pipes per floor. Pipes spanning multiple floors count toward each. */
export function aggregatePipesPerFloor(
  pipes: CommittedPipe[],
): Map<string, FloorAggregates> {
  const floors = Object.values(useFloorStore.getState().floors);
  const map = new Map<string, FloorAggregates>();

  for (const f of floors) {
    map.set(f.id, {
      floorId: f.id,
      pipeCount: 0,
      fixtureCount: 0,
      segmentCount: 0,
      totalLengthFt: 0,
    });
  }

  for (const pipe of pipes) {
    const touched = resolveFloorsForPipe(pipe);
    for (const f of touched) {
      const agg = map.get(f.id);
      if (!agg) continue;
      agg.pipeCount++;
      agg.segmentCount += Math.max(0, pipe.points.length - 1);
      for (let i = 1; i < pipe.points.length; i++) {
        const a = pipe.points[i - 1]!;
        const b = pipe.points[i]!;
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        agg.totalLengthFt += Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
    }
  }

  return map;
}

// ── Floor picker by elevation for drawing new pipes ────────────

/**
 * Given a target Y (e.g. click on ground plane), snap to the active
 * floor's base elevation. Useful for "keep drawing on this floor"
 * drawing mode.
 */
export function snapYToActiveFloor(targetY: number): number {
  const { floors, activeFloorId } = useFloorStore.getState();
  const active = floors[activeFloorId];
  if (!active) return targetY;
  // Clamp within floor range, prefer floor base for horizontal work
  if (targetY < active.elevationBase) return active.elevationBase;
  if (targetY > active.elevationTop) return active.elevationTop;
  return targetY;
}
