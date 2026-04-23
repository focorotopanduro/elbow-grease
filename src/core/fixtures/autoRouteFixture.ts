/**
 * autoRouteFixture — Phase 14.Y.3
 *
 * Given a placed fixture + the current scene (other fixtures + pipes
 * + the fixture's floor + ceiling elevation), generate the pipe
 * routes that connect every one of the fixture's connection points
 * to the nearest legal target:
 *
 *   cold        → nearest cold_supply pipe endpoint, OR water-heater
 *                 cold inlet, OR a default stub if none exist
 *   hot         → nearest hot_supply pipe endpoint, OR water-heater
 *                 HOT OUTLET (preferred — water heater IS the source),
 *                 OR a default stub
 *   drain       → nearest waste/storm pipe endpoint, OR a vertical drop
 *                 to slab (underground phase will pick it up)
 *   vent        → nearest vent pipe endpoint, OR a vertical rise to
 *                 the ceiling
 *   gas         → nearest gas-tagged pipe, else warning
 *   overflow    → nearest waste pipe endpoint (T&P relief → floor drain)
 *   inline/ref  → skipped (not routing endpoints)
 *
 * Route SHAPE: each generated pipe is a 3-point Manhattan route:
 *
 *   (fixture port) → rise to (typical interior run height) →
 *   horizontal at that height → drop (or rise) to (target)
 *
 * That produces two legal bends (both 90°) which `generateBendFittings`
 * will render as proper elbows. Simple but consistent.
 *
 * This module is PURE — no React, no Zustand, no Three. Callers
 * commit the returned `ProposedPipe[]` through `pipeStore.addPipe`.
 * Unit tests drive the math + target selection directly.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType, FixtureSubtype } from '../../engine/graph/GraphNode';
import { SUPPLY_TABLE, DFU_TABLE } from '../../engine/graph/GraphNode';
import {
  getFixtureGeometry,
  type ConnectionPoint,
} from './ConnectionPoints';

// ── Types ─────────────────────────────────────────────────────

export interface ProposedPipe {
  points: Vec3[];
  diameter: number;
  material: PipeMaterial;
  system: SystemType;
  /** Which connection point on the source fixture this serves. */
  forConnectionId: string;
  /** Role the route fulfills (cold / hot / drain / vent / overflow / gas). */
  role: ConnectionPoint['role'];
}

export interface AutoRouteInput {
  /** The fixture to auto-route. */
  fixture: FixtureInstance;
  /** All other fixtures in the scene (so water heaters can be
   *  found as hot-supply sources). */
  otherFixtures: readonly FixtureInstance[];
  /** All committed pipes (so we can find nearest matching mains). */
  pipes: readonly CommittedPipe[];
  /** Floor Y elevation (slab). */
  floorY: number;
  /** Ceiling Y elevation (top of joist bay / typical route height). */
  ceilingY: number;
}

export interface AutoRouteResult {
  /** One `ProposedPipe` per satisfied connection point. */
  proposed: ProposedPipe[];
  /** Human-readable notes per skipped / problematic connection. */
  warnings: string[];
}

// ── Vector helpers ────────────────────────────────────────────

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function distanceXZ(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Apply the fixture's rotation (degrees around Y) to a local point
 * and translate into world space.
 */
export function fixtureLocalToWorld(
  fixture: FixtureInstance,
  local: Vec3,
): Vec3 {
  const rotDeg = Number(fixture.params?.rotationDeg ?? 0);
  const rad = (rotDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = local[0] * c - local[2] * s;
  const rz = local[0] * s + local[2] * c;
  return add(fixture.position, [rx, local[1], rz]);
}

// ── Target resolution ────────────────────────────────────────

interface Target {
  /** World-space point the route terminates at. */
  point: Vec3;
  /** Source of this target (for debug + future logic). */
  source: 'pipe_endpoint' | 'water_heater_inlet' | 'water_heater_outlet' | 'stub';
}

/**
 * Find the nearest pipe endpoint matching the given system filter,
 * measured in XZ distance from `from`. Returns null if none found.
 */
function nearestPipeEndpoint(
  from: Vec3,
  pipes: readonly CommittedPipe[],
  systemFilter: (sys: SystemType) => boolean,
): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const p of pipes) {
    if (!p.visible) continue;
    if (!systemFilter(p.system)) continue;
    const ends: Vec3[] = [p.points[0]!, p.points[p.points.length - 1]!];
    for (const end of ends) {
      const d = distanceXZ(from, end);
      if (d < bestDist) {
        bestDist = d;
        best = { point: [end[0], end[1], end[2]], source: 'pipe_endpoint' };
      }
    }
  }
  return best;
}

/**
 * Find the nearest water heater fixture + return its hot-outlet
 * world position. Critical for 14.Y.4's hot-supply propagation —
 * hot-supply routes should ALWAYS originate at the water heater
 * when one exists, so the `hot_supply` classification flows
 * downstream correctly.
 */
function nearestWaterHeaterHot(
  from: Vec3,
  otherFixtures: readonly FixtureInstance[],
): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const f of otherFixtures) {
    if (f.subtype !== 'water_heater' && f.subtype !== 'tankless_water_heater') continue;
    const geo = getFixtureGeometry(f.subtype, f.params);
    const hotPort = geo.points.find((p) => p.role === 'hot');
    if (!hotPort) continue;
    const world = fixtureLocalToWorld(f, hotPort.position);
    const d = distanceXZ(from, world);
    if (d < bestDist) {
      bestDist = d;
      best = { point: world, source: 'water_heater_outlet' };
    }
  }
  return best;
}

/**
 * Nearest water heater COLD INLET — rarely useful directly
 * (supply mains feed the water heater, not other fixtures), but
 * when there's no cold main the water heater's inlet is the
 * closest "cold-supply anchor" we have.
 */
function nearestWaterHeaterCold(
  from: Vec3,
  otherFixtures: readonly FixtureInstance[],
): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const f of otherFixtures) {
    if (f.subtype !== 'water_heater' && f.subtype !== 'tankless_water_heater') continue;
    const geo = getFixtureGeometry(f.subtype, f.params);
    const coldPort = geo.points.find((p) => p.role === 'cold');
    if (!coldPort) continue;
    const world = fixtureLocalToWorld(f, coldPort.position);
    const d = distanceXZ(from, world);
    if (d < bestDist) {
      bestDist = d;
      best = { point: world, source: 'water_heater_inlet' };
    }
  }
  return best;
}

// ── Target resolution per role ────────────────────────────────

function resolveTarget(
  role: ConnectionPoint['role'],
  from: Vec3,
  input: AutoRouteInput,
): Target | null {
  const { otherFixtures, pipes, floorY, ceilingY } = input;

  switch (role) {
    case 'cold': {
      // Prefer an existing cold-supply endpoint.
      const pipe = nearestPipeEndpoint(from, pipes, (s) => s === 'cold_supply');
      if (pipe) return pipe;
      // Then a water heater's cold inlet (acts as supply anchor).
      const wh = nearestWaterHeaterCold(from, otherFixtures);
      if (wh) return wh;
      // Default stub — terminate 2 ft toward +X at ceiling so we have
      // a deterministic, visible endpoint the user can extend.
      return {
        point: [from[0] + 2, ceilingY, from[2]],
        source: 'stub',
      };
    }
    case 'hot': {
      // Prefer the water heater's hot outlet (drives hot-supply
      // propagation in 14.Y.4).
      const wh = nearestWaterHeaterHot(from, otherFixtures);
      if (wh) return wh;
      // Then any existing hot-supply pipe endpoint.
      const pipe = nearestPipeEndpoint(from, pipes, (s) => s === 'hot_supply');
      if (pipe) return pipe;
      // Default stub at ceiling height.
      return {
        point: [from[0] - 2, ceilingY, from[2]],
        source: 'stub',
      };
    }
    case 'drain': {
      // Prefer an existing waste/storm endpoint.
      const pipe = nearestPipeEndpoint(from, pipes, (s) => s === 'waste' || s === 'storm');
      if (pipe) return pipe;
      // Default stub: drop straight to slab ("home-run to underground").
      return {
        point: [from[0], floorY, from[2]],
        source: 'stub',
      };
    }
    case 'vent': {
      const pipe = nearestPipeEndpoint(from, pipes, (s) => s === 'vent');
      if (pipe) return pipe;
      return {
        point: [from[0], ceilingY, from[2]],
        source: 'stub',
      };
    }
    case 'overflow': {
      // T&P relief discharges to floor drain / waste.
      const pipe = nearestPipeEndpoint(from, pipes, (s) => s === 'waste');
      if (pipe) return pipe;
      return {
        point: [from[0], floorY, from[2]],
        source: 'stub',
      };
    }
    case 'ref':
      return null; // Not a routeable port
  }
}

// ── Route shape generation ────────────────────────────────────

/**
 * Build a 3-vertex Manhattan route from `from` to `to`:
 *
 *   1. From → rise vertically to `runY`
 *   2. Across to XZ position of target at `runY`
 *   3. Drop (or rise) to target Y
 *
 * Produces two 90° bends which generate two legal elbow fittings.
 * If `from` and `to` are already at the same elevation, the route
 * collapses to a straight horizontal line (2 points).
 */
function buildManhattanRoute(
  from: Vec3,
  to: Vec3,
  runY: number,
): Vec3[] {
  const sameXZ = Math.abs(from[0] - to[0]) < 1e-6 && Math.abs(from[2] - to[2]) < 1e-6;

  if (sameXZ) {
    // Pure vertical — skip the Manhattan detour.
    if (Math.abs(from[1] - to[1]) < 1e-6) return [from, to]; // degenerate
    return [from, to];
  }

  // If `runY` is between `from` and `to` in Y, or if from/to are
  // already at the runY plane, collapse to a simpler shape.
  const pts: Vec3[] = [];
  pts.push([from[0], from[1], from[2]]);
  // Rise to runY (only if from is not already at runY)
  if (Math.abs(from[1] - runY) > 1e-6) {
    pts.push([from[0], runY, from[2]]);
  }
  // Move horizontally to above target
  pts.push([to[0], runY, to[2]]);
  // Drop/rise to target (only if target is not already at runY)
  if (Math.abs(to[1] - runY) > 1e-6) {
    pts.push([to[0], to[1], to[2]]);
  } else if (pts[pts.length - 1]![0] !== to[0] || pts[pts.length - 1]![2] !== to[2] || pts[pts.length - 1]![1] !== to[1]) {
    pts.push([to[0], to[1], to[2]]);
  }
  return pts;
}

// ── Sizing ─────────────────────────────────────────────────────

/**
 * Pick a pipe material + diameter for a given role + fixture
 * subtype. Defaults:
 *   supply → PEX @ SUPPLY_TABLE.minBranchSize (0.5" / 0.75")
 *   drain + overflow → PVC Schedule 40 sized from DFU
 *   vent → PVC Schedule 40, minimum 1.5"
 */
function selectMaterialAndDiameter(
  role: ConnectionPoint['role'],
  subtype: FixtureSubtype,
): { material: PipeMaterial; diameter: number; system: SystemType } {
  const supply = SUPPLY_TABLE[subtype];
  switch (role) {
    case 'cold': {
      const dia = supply?.minBranchSize > 0 ? supply.minBranchSize : 0.5;
      return { material: 'pex', diameter: dia, system: 'cold_supply' };
    }
    case 'hot': {
      const dia = supply?.minBranchSize > 0 ? supply.minBranchSize : 0.5;
      return { material: 'pex', diameter: dia, system: 'hot_supply' };
    }
    case 'drain': {
      // Choose diameter from DFU. IPC Table 710.1 minimums:
      //   DFU ≤ 1 → 1.25"  (but we round up to 1.5" — universal smallest)
      //   DFU ≤ 3 → 1.5"
      //   DFU ≤ 6 → 2"
      //   DFU ≤ 20 → 3"  (most single fixture branches)
      const dfu = DFU_TABLE[subtype] ?? 2;
      const dia = dfu <= 3 ? 1.5 : dfu <= 6 ? 2 : dfu <= 20 ? 3 : 4;
      return { material: 'pvc_sch40', diameter: dia, system: 'waste' };
    }
    case 'overflow':
      return { material: 'pvc_sch40', diameter: 1.5, system: 'waste' };
    case 'vent':
      return { material: 'pvc_sch40', diameter: 1.5, system: 'vent' };
    case 'ref':
      return { material: 'pvc_sch40', diameter: 2, system: 'waste' };
  }
}

// ── Public entry ───────────────────────────────────────────────

/**
 * Core auto-route: for every connection point on the fixture,
 * build a Manhattan route to the nearest legal target and
 * propose it as a pipe.
 *
 * Does NOT commit to any store — caller runs
 * `result.proposed.forEach(p => pipeStore.addPipe(...))` with a
 * fresh id per pipe.
 */
export function autoRouteFixture(input: AutoRouteInput): AutoRouteResult {
  const { fixture, floorY, ceilingY } = input;
  const geo = getFixtureGeometry(fixture.subtype, fixture.params);
  const proposed: ProposedPipe[] = [];
  const warnings: string[] = [];

  // Run height: midway between floor and ceiling. Typical residential
  // supply mains run in the ceiling joists; drain mains under slab
  // or below joist. Using the midpoint gives a consistent, legible
  // route shape that the user can refine.
  const runY = Math.max(ceilingY - 0.5, floorY + 3);

  for (const point of geo.points) {
    if (point.role === 'ref') continue;

    const worldStart = fixtureLocalToWorld(fixture, point.position);
    const target = resolveTarget(point.role, worldStart, input);
    if (!target) {
      warnings.push(`no target found for ${point.label}`);
      continue;
    }

    const route = buildManhattanRoute(worldStart, target.point, runY);
    if (route.length < 2) {
      warnings.push(`degenerate route for ${point.label}`);
      continue;
    }

    const spec = selectMaterialAndDiameter(point.role, fixture.subtype);
    proposed.push({
      points: route,
      material: spec.material,
      diameter: spec.diameter,
      system: spec.system,
      forConnectionId: point.id,
      role: point.role,
    });
  }

  return { proposed, warnings };
}
