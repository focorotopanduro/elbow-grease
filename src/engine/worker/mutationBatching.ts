/**
 * Mutation Batching — Phase 14.AC.3
 *
 * The simulation worker receives graph mutations (add node, add edge,
 * remove node, remove edge) via postMessage. Each postMessage pays
 * structured-clone serialization + a thread boundary crossing + a
 * worker-side response (`GRAPH_UPDATED`). For any burst of pipe
 * commits — paste, riser templates, auto-route of many fixtures —
 * that cost compounded linearly.
 *
 * Example: a 4-pipe riser template where each pipe has 3 points.
 *
 *   Old path, per pipe:
 *     • 3 × ADD_NODE postMessage
 *     • 2 × ADD_EDGE postMessage
 *     • 5 × GRAPH_UPDATED response (one per mutation)
 *     = 10 thread crossings per pipe × 4 pipes = 40 crossings
 *
 *   New path:
 *     • 1 × BATCH_MUTATE postMessage with all nodes + edges
 *     • 1 × GRAPH_UPDATED response (one per batch)
 *     = 2 thread crossings total
 *
 * A 20× reduction in bridge traffic for typical multi-pipe bursts.
 * The SOLVE_REQUEST debounce in `SimulationBridge.queueSolve()`
 * already fires once per burst (50 ms window) — so this change
 * shrinks the pre-solve chatter to match.
 *
 * This module is PURE — no worker / event bus imports. Given pipe
 * metadata, return a typed `GraphMutationBatch`. The bridge + the
 * worker stay thin glue.
 */

import type { GraphNode, SystemType, FixtureSubtype } from '../graph/GraphNode';
import type { GraphEdge, PipeMaterial } from '../graph/GraphEdge';
import { DFU_TABLE, SUPPLY_TABLE } from '../graph/GraphNode';

// ── Public types ──────────────────────────────────────────────

export type Vec3 = readonly [number, number, number];

/** The minimal pipe payload needed to compute graph contributions. */
export interface PipeCommit {
  id: string;
  points: readonly Vec3[];
  diameter: number;
  material: PipeMaterial;
  /** Optional pre-assigned system. Defaults to 'waste' to match the
   *  legacy SimulationBridge behaviour — the solver reassigns based
   *  on fixture context, so this is just a placeholder. */
  system?: SystemType;
  /**
   * Phase 14.AC.7 — endpoint substitution. When set, the pipe's first
   * (or last) waypoint node is NOT created; instead the first (or
   * last) edge references the supplied node ID directly. Intended for
   * splicing fixture nodes into the graph: pipe draws out of a
   * toilet, the bridge detects the toilet at points[0], passes the
   * toilet's `fx-…` node id as `startNodeOverride`, and DFU
   * propagation now has a connected chain from fixture → edge → …
   *
   * When undefined, the legacy `wp-{pipeId}-{0|last}` node is created
   * as usual.
   */
  startNodeOverride?: string;
  endNodeOverride?: string;
}

/**
 * Phase 14.AC.6 — a placed fixture that should appear in the worker
 * DAG. Mirrors `FixtureInstance` but slimmed to just what the graph
 * needs. The bridge converts from `FixturePlacedPayload` into this
 * shape.
 */
export interface FixtureCommit {
  id: string;
  subtype: FixtureSubtype;
  position: Vec3;
  /**
   * Plumbing system the fixture connects to. Most fixtures default
   * to 'waste' for DWV accounting, but a tankless water heater or
   * hose bibb should live on 'cold_supply'. The bridge derives this
   * from the fixture's subtype using `defaultSystemFor(subtype)`.
   */
  system: SystemType;
}

/** One batched graph mutation sent to the worker. */
export interface GraphMutationBatch {
  nodesToAdd: GraphNode[];
  edgesToAdd: GraphEdge[];
  nodeIdsToRemove: string[];
  edgeIdsToRemove: string[];
}

// ── ID conventions ────────────────────────────────────────────
// These MUST match the legacy `wp-{pipeId}-{idx}` and
// `edge-{pipeId}-{idx}` strings that the old bridge produced, so a
// pipe removed before 14.AC.3 and its nodes touched after the
// upgrade still match up. Keep the helpers exported so
// `SimulationBridge` and tests use the same formatter.

export function nodeIdAt(pipeId: string, index: number): string {
  return `wp-${pipeId}-${index}`;
}

export function edgeIdAt(pipeId: string, index: number): string {
  return `edge-${pipeId}-${index}`;
}

/**
 * Graph node ID for a fixture. Distinct `fx-` prefix keeps
 * fixtures unambiguous vs pipe waypoints (`wp-…`) and edges
 * (`edge-…`). Phase 14.AC.6.
 */
export function fixtureNodeId(fixtureId: string): string {
  return `fx-${fixtureId}`;
}

/**
 * Pick a sensible default plumbing system for a fixture's graph node
 * when the UI hasn't supplied one. Most plumbing fixtures are DWV
 * consumers (waste); water-side equipment goes on cold_supply.
 *
 * This is a heuristic for scaffold-phase 14.AC.6. The connection-
 * phase (14.AC.7) should either derive the system from the pipe
 * the fixture connects to OR let the user tag it explicitly.
 */
export function defaultSystemForFixture(subtype: FixtureSubtype): SystemType {
  switch (subtype) {
    case 'water_heater':
    case 'tankless_water_heater':
    case 'hose_bibb':
    case 'expansion_tank':
    case 'backflow_preventer':
    case 'pressure_reducing_valve':
      return 'cold_supply';
    default:
      return 'waste';
  }
}

// ── Internal helpers ──────────────────────────────────────────

function segmentSlopePerFt(dx: number, dy: number, dz: number): number {
  const horizSq = dx * dx + dz * dz;
  if (horizSq <= 0) return 0;
  // Units: inches of drop per linear foot, matching existing bridge math.
  return (Math.abs(dy) / Math.sqrt(horizSq + 0.001)) * 12;
}

/** Build a minimal junction node matching the legacy shape exactly. */
function makeWaypointNode(pipeId: string, index: number, pt: Vec3, system: SystemType): GraphNode {
  return {
    id: nodeIdAt(pipeId, index),
    type: 'junction',
    system,
    dfu: 0,
    trapSize: 0,
    supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 },
    computed: {
      accumulatedDFU: 0,
      accumulatedWSFU: 0,
      pressure: 0,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0,
    },
    elevation: pt[1],
    label: `waypoint ${index}`,
  };
}

function makeSegmentEdge(
  pipeId: string,
  segIndex: number,
  fromPt: Vec3,
  toPt: Vec3,
  material: PipeMaterial,
  diameter: number,
  fromNodeId: string,
  toNodeId: string,
): GraphEdge {
  const dx = toPt[0] - fromPt[0];
  const dy = toPt[1] - fromPt[1];
  const dz = toPt[2] - fromPt[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    id: edgeIdAt(pipeId, segIndex),
    from: fromNodeId,
    to: toNodeId,
    material,
    diameter,
    length,
    slope: length > 0 ? segmentSlopePerFt(dx, dy, dz) : 0,
    elevationDelta: dy,
    fittings: [],
    computed: {
      equivalentLength: length,
      frictionLoss: 0,
      velocity: 0,
      reynolds: 0,
      frictionFactor: 0,
      pressureDrop: 0,
      properlySized: true,
      materialCost: 0,
    },
  };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Graph IDs a committed pipe owns. Useful when the store emits
 * `pipe:removed` with just an id — the bridge looks up these IDs
 * via a separate map, but for tests + callers without state this
 * helper reconstructs them from a known point count.
 */
export function pipeGraphIds(pipeId: string, pointCount: number): {
  nodeIds: string[];
  edgeIds: string[];
} {
  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  for (let i = 0; i < pointCount; i++) nodeIds.push(nodeIdAt(pipeId, i));
  for (let i = 1; i < pointCount; i++) edgeIds.push(edgeIdAt(pipeId, i));
  return { nodeIds, edgeIds };
}

/**
 * Translate a placed fixture into its graph-node contribution.
 * Pure — derives DFU + supply from the global tables that
 * `createFixtureNode` also uses, so a fixture built via this path
 * accumulates identically to one built via the factory.
 *
 * Phase 14.AC.6: we deliberately do NOT assign any outgoing edges
 * — the node is isolated until the pipe-connection phase (14.AC.7)
 * wires fixture IDs into pipe waypoint 0 substitution.
 */
export function fixtureToNode(commit: FixtureCommit): GraphNode {
  const dfu = DFU_TABLE[commit.subtype] ?? 0;
  const supply = SUPPLY_TABLE[commit.subtype] ?? { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 };
  const trapSize = commit.subtype === 'water_closet' ? 3
    : commit.subtype === 'floor_drain' ? 2
    : 1.5;
  return {
    id: fixtureNodeId(commit.id),
    type: 'fixture',
    system: commit.system,
    fixtureSubtype: commit.subtype,
    dfu,
    trapSize,
    supply,
    computed: {
      accumulatedDFU: dfu,
      accumulatedWSFU: supply.totalWSFU,
      pressure: 0,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0,
    },
    elevation: commit.position[1],
    label: commit.subtype.replace(/_/g, ' '),
  };
}

/**
 * Translate a single pipe into its graph contribution: one waypoint
 * node per point, one edge per consecutive pair. Deterministic IDs.
 *
 * When `startNodeOverride` / `endNodeOverride` are set (Phase
 * 14.AC.7), the endpoint waypoint node is omitted and the first /
 * last edge references the supplied node id instead. The substituted
 * node is expected to already exist in the DAG (fixture node placed
 * via a separate FIXTURE_PLACED handler, or `setGraph` rehydration).
 */
export function pipeToMutations(pipe: PipeCommit): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const sys: SystemType = pipe.system ?? 'waste';
  const lastIdx = pipe.points.length - 1;

  for (let i = 0; i < pipe.points.length; i++) {
    if (i === 0 && pipe.startNodeOverride) continue;
    if (i === lastIdx && pipe.endNodeOverride) continue;
    nodes.push(makeWaypointNode(pipe.id, i, pipe.points[i]!, sys));
  }
  for (let i = 1; i < pipe.points.length; i++) {
    const fromId =
      i - 1 === 0 && pipe.startNodeOverride
        ? pipe.startNodeOverride
        : nodeIdAt(pipe.id, i - 1);
    const toId =
      i === lastIdx && pipe.endNodeOverride
        ? pipe.endNodeOverride
        : nodeIdAt(pipe.id, i);
    edges.push(
      makeSegmentEdge(
        pipe.id,
        i,
        pipe.points[i - 1]!,
        pipe.points[i]!,
        pipe.material,
        pipe.diameter,
        fromId,
        toId,
      ),
    );
  }
  return { nodes, edges };
}

/**
 * Compose a batch from any number of pipe + fixture commits and
 * removal IDs.
 *
 * If a pipe/fixture appears in BOTH the added list AND its nodes
 * appear in `removedNodeIds`, the adds are suppressed AND the
 * cancelled removal IDs are dropped — net no-op. This keeps the
 * worker from doing double-work when a short-lived object gets
 * undone within one debounce window.
 *
 * @param addedPipes       Pipes committed within this debounce.
 * @param addedFixtures    Fixtures placed within this debounce
 *                         (14.AC.6). Empty when the fixtureGraph
 *                         flag is off.
 * @param removedNodeIds   Node ids to remove. The bridge passes the
 *                         exact node IDs it tracked at commit time.
 * @param removedEdgeIds   Edge ids to remove.
 */
export function composeMutationBatch(
  addedPipes: readonly PipeCommit[],
  removedNodeIds: readonly string[],
  removedEdgeIds: readonly string[],
  addedFixtures: readonly FixtureCommit[] = [],
): GraphMutationBatch {
  // Identify add/remove overlap for cancellation.
  const removedNodeIdSet = new Set(removedNodeIds);
  const removedEdgeIdSet = new Set(removedEdgeIds);

  const nodesToAdd: GraphNode[] = [];
  const edgesToAdd: GraphEdge[] = [];

  // Pipes first, then fixtures — order doesn't affect correctness
  // because the worker-side handler order is remove-edges →
  // remove-nodes → add-nodes → add-edges regardless of the array
  // order we ship.
  for (const pipe of addedPipes) {
    const { nodes, edges } = pipeToMutations(pipe);
    for (const n of nodes) {
      if (!removedNodeIdSet.has(n.id)) nodesToAdd.push(n);
    }
    for (const e of edges) {
      if (!removedEdgeIdSet.has(e.id)) edgesToAdd.push(e);
    }
  }

  for (const fixture of addedFixtures) {
    const node = fixtureToNode(fixture);
    if (!removedNodeIdSet.has(node.id)) nodesToAdd.push(node);
  }

  // Trim cancelled IDs from the removal lists — the worker would
  // silently ignore unknown IDs, but clean state is friendlier to
  // debug.
  const addedNodeIds = new Set([
    ...addedPipes.flatMap((p) =>
      Array.from({ length: p.points.length }, (_, i) => nodeIdAt(p.id, i)),
    ),
    ...addedFixtures.map((f) => fixtureNodeId(f.id)),
  ]);
  const addedEdgeIds = new Set(
    addedPipes.flatMap((p) =>
      Array.from({ length: Math.max(0, p.points.length - 1) }, (_, i) => edgeIdAt(p.id, i + 1)),
    ),
  );

  const finalRemovedNodes = removedNodeIds.filter((id) => !addedNodeIds.has(id));
  const finalRemovedEdges = removedEdgeIds.filter((id) => !addedEdgeIds.has(id));

  return {
    nodesToAdd,
    edgesToAdd,
    nodeIdsToRemove: finalRemovedNodes,
    edgeIdsToRemove: finalRemovedEdges,
  };
}

/**
 * `true` if the batch carries zero work. Used by the bridge to
 * short-circuit sending a no-op BATCH_MUTATE before a SOLVE_REQUEST.
 */
export function isEmptyBatch(b: GraphMutationBatch): boolean {
  return b.nodesToAdd.length === 0
    && b.edgesToAdd.length === 0
    && b.nodeIdsToRemove.length === 0
    && b.edgeIdsToRemove.length === 0;
}
