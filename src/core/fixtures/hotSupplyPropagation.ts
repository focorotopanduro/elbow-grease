/**
 * hotSupplyPropagation — Phase 14.Y.4
 *
 * Flood-fills the pipe network from every water heater's hot
 * outlet to classify downstream pipes as `hot_supply`. Complements
 * 14.Y.3's auto-router: that router TERMINATES hot routes at the
 * water heater outlet; this module turns that termination anchor
 * into a propagation seed.
 *
 * Contract (from user):
 *   "make it look blue and when connecting to the water heater IN
 *    A REALISTIC WAY, MAKE IT turn red as to represent hot water"
 *
 * Algorithm:
 *
 *   1. Find every water heater (tank + tankless) in the scene.
 *      Extract the world-space position of its `hot` connection
 *      point.
 *
 *   2. Build a pipe-endpoint adjacency graph. Two pipes are
 *      adjacent when either endpoint of one is within
 *      JUNCTION_TOL of either endpoint of the other. Interior
 *      vertices don't count (matches FittingGenerator's junction
 *      detection + pipeCollision's shared-endpoint logic).
 *
 *   3. BFS outward from each hot-outlet seed, ONLY through pipes
 *      that are currently classified as supply (`cold_supply` or
 *      `hot_supply`). We never reclassify drainage / vent — those
 *      aren't carriers of hot water.
 *
 *   4. Produce a map {pipeId → 'hot_supply'} for every reached
 *      pipe.
 *
 *   5. `applyHotSupplyClassification` converts (a) the reached set
 *      + (b) the current pipe list into a list of "change system
 *      for this pipe to that" entries. Symmetric:
 *
 *        reached & currently cold → change to hot
 *        NOT reached & currently hot → change to cold (reversal)
 *
 *      Waste/vent/storm pipes are always skipped.
 *
 * Pure module — no React, no Zustand, no Three. The subscription
 * that runs this against live stores lives in
 * `bootHotSupplyPropagation.ts`.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';
import type { SystemType } from '../../engine/graph/GraphNode';
import {
  getFixtureGeometry,
  type ConnectionPoint,
} from './ConnectionPoints';
import { fixtureLocalToWorld } from './autoRouteFixture';
import { JUNCTION_TOLERANCE_FT, JUNCTION_TOLERANCE_FT_SQ } from '../pipe/junctionConstants';

// ── Constants ─────────────────────────────────────────────────

// Phase 14.AD.14 — single source via junctionConstants.
const JUNCTION_TOL = JUNCTION_TOLERANCE_FT;
const JUNCTION_TOL_SQ = JUNCTION_TOLERANCE_FT_SQ;

// ── Helpers ───────────────────────────────────────────────────

function pointsNear(a: Vec3, b: Vec3): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return dx * dx + dy * dy + dz * dz < JUNCTION_TOL_SQ;
}

function pipeEndpoints(p: CommittedPipe): [Vec3, Vec3] {
  return [p.points[0]!, p.points[p.points.length - 1]!];
}

function isSupplySystem(s: SystemType): boolean {
  return s === 'cold_supply' || s === 'hot_supply';
}

// ── Seed discovery ────────────────────────────────────────────

/**
 * Extract the world-space positions of every hot-outlet across
 * every water heater fixture in the scene.
 */
export function hotOutletSeeds(fixtures: readonly FixtureInstance[]): Vec3[] {
  const seeds: Vec3[] = [];
  for (const f of fixtures) {
    if (f.subtype !== 'water_heater' && f.subtype !== 'tankless_water_heater') continue;
    const geo = getFixtureGeometry(f.subtype, f.params);
    for (const port of geo.points) {
      if (port.role === 'hot') {
        seeds.push(fixtureLocalToWorld(f, port.position));
      }
    }
  }
  return seeds;
}

// ── Graph build ──────────────────────────────────────────────

interface PipeNode {
  id: string;
  a: Vec3;
  b: Vec3;
  /** Indices of adjacent pipe-nodes (share an endpoint). */
  neighbors: number[];
}

function buildPipeGraph(pipes: readonly CommittedPipe[]): PipeNode[] {
  // Filter to supply pipes only — drainage can't carry hot water
  // propagation even if it happens to touch a WH outlet.
  const supply = pipes.filter((p) => isSupplySystem(p.system) && p.visible);
  const nodes: PipeNode[] = supply.map((p) => {
    const [a, b] = pipeEndpoints(p);
    return { id: p.id, a, b, neighbors: [] };
  });
  // N² adjacency — fine for typical residential scene sizes.
  // Spatial bucketing is available later if a 500+ supply-pipe
  // scene shows up.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const ni = nodes[i]!;
      const nj = nodes[j]!;
      if (
        pointsNear(ni.a, nj.a) || pointsNear(ni.a, nj.b)
        || pointsNear(ni.b, nj.a) || pointsNear(ni.b, nj.b)
      ) {
        ni.neighbors.push(j);
        nj.neighbors.push(i);
      }
    }
  }
  return nodes;
}

// ── BFS from seeds ────────────────────────────────────────────

/**
 * Compute the set of pipe IDs reachable from any water-heater
 * hot outlet via pipe-endpoint adjacency. Only supply pipes are
 * considered (never drainage / vent).
 */
export function computeHotSupplyReachable(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): Set<string> {
  const seeds = hotOutletSeeds(fixtures);
  if (seeds.length === 0) return new Set();

  const nodes = buildPipeGraph(pipes);
  if (nodes.length === 0) return new Set();

  // Find which nodes are seeded — any supply pipe with an
  // endpoint touching a WH hot outlet.
  const queue: number[] = [];
  const visited = new Set<number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    for (const seed of seeds) {
      if (pointsNear(n.a, seed) || pointsNear(n.b, seed)) {
        if (!visited.has(i)) {
          visited.add(i);
          queue.push(i);
        }
        break;
      }
    }
  }

  // BFS
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const n = nodes[idx]!;
    for (const nb of n.neighbors) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  const reachedIds = new Set<string>();
  for (const idx of visited) reachedIds.add(nodes[idx]!.id);
  return reachedIds;
}

// ── Classification diff ───────────────────────────────────────

export interface ClassificationChange {
  pipeId: string;
  oldSystem: SystemType;
  newSystem: SystemType;
  reason: 'reached_from_hot_outlet' | 'disconnected_from_hot_outlet';
}

/**
 * Given the current pipes + fixtures, return the list of system-
 * classification changes needed to make the scene consistent with
 * hot-supply propagation from water heaters.
 *
 * Only touches pipes whose current `system` is `cold_supply` or
 * `hot_supply` — never reclassifies drainage, vent, or storm.
 *
 * Symmetric:
 *   reached + currently cold → change to hot
 *   not reached + currently hot → change to cold (reversal)
 */
export function applyHotSupplyClassification(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): ClassificationChange[] {
  const reached = computeHotSupplyReachable(pipes, fixtures);
  const changes: ClassificationChange[] = [];
  for (const p of pipes) {
    if (!isSupplySystem(p.system)) continue; // leave drain/vent alone
    const shouldBeHot = reached.has(p.id);
    if (shouldBeHot && p.system !== 'hot_supply') {
      changes.push({
        pipeId: p.id,
        oldSystem: p.system,
        newSystem: 'hot_supply',
        reason: 'reached_from_hot_outlet',
      });
    } else if (!shouldBeHot && p.system === 'hot_supply') {
      changes.push({
        pipeId: p.id,
        oldSystem: p.system,
        newSystem: 'cold_supply',
        reason: 'disconnected_from_hot_outlet',
      });
    }
  }
  return changes;
}

// ── Debug/observability ──────────────────────────────────────

export interface HotSupplyReport {
  seedCount: number;
  supplyPipeCount: number;
  reachedCount: number;
  changes: ClassificationChange[];
}

/**
 * All-in-one: compute reached set + change diff + summary stats
 * for logging. Pure; used by the subscription layer + tests.
 */
export function computeHotSupplyReport(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): HotSupplyReport {
  const seeds = hotOutletSeeds(fixtures);
  const reached = computeHotSupplyReachable(pipes, fixtures);
  const changes = applyHotSupplyClassification(pipes, fixtures);
  return {
    seedCount: seeds.length,
    supplyPipeCount: pipes.filter((p) => isSupplySystem(p.system)).length,
    reachedCount: reached.size,
    changes,
  };
}

// Re-export for the store subscription boot module.
export { fixtureLocalToWorld };
