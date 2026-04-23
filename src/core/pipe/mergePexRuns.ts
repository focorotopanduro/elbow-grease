/**
 * mergePexRuns — group adjacent PEX pipes that should render as one
 * continuous organic tube.
 *
 * Two pipes are merged into the same run iff ALL of:
 *
 *   1. Both are PEX (only truly flexible material we model).
 *   2. Same diameter (a reducer is a fitting, not a bend).
 *   3. Same plumbing system (waste/vent/cold_supply/…).
 *   4. They share an endpoint within `EPSILON_FT` tolerance.
 *   5. The bend angle at the shared endpoint classifies as
 *      `smooth_bend` per PexBendClassifier — NOT `fitting_90`,
 *      `sharp_bend`, or `smooth_curve` (which is near-straight but
 *      we group those too, no visual difference).
 *
 * A junction where 3+ pipes meet is a tee — that vertex breaks merging
 * even if two of the three are PEX with smooth bends. Tees stay as
 * discrete fittings.
 *
 * A cycle (closed loop of PEX pipes) degenerates to "no terminal
 * endpoint"; we skip merging and let the pipes render as singletons.
 *
 * ── Algorithm ────────────────────────────────────────────────────
 *
 *   1. Quantize endpoints to a spatial hash key (round to 3 decimals).
 *   2. Build an adjacency map: vertexKey → pipes touching it.
 *   3. Vertices with exactly 2 pipes are merge candidates; classify
 *      the bend and union-find the pipes when eligible.
 *   4. For each group (including singletons), find terminals and walk
 *      to produce a merged point sequence.
 *
 * Returns a Map keyed by pipeId → PipeRunGroup. Every input pipe
 * appears in exactly one group; singletons get one-pipe groups.
 *
 * Complexity: O((P + V) · α(P)) where P=pipes, V=unique vertices.
 * α is the inverse Ackermann — effectively constant for Union-Find
 * with path compression.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType } from '../../engine/graph/GraphNode';
import { classifyBend } from './PexBendClassifier';

// ── Config ─────────────────────────────────────────────────────

const EPSILON_FT = 0.05;         // ~0.6": tight enough to avoid false merges
const QUANTIZE_DECIMALS = 3;     // vertex key precision

// ── Types ─────────────────────────────────────────────────────

export interface PipeRunGroup {
  /** Pipe ids participating in this group (singleton when len=1). */
  pipeIds: string[];
  /**
   * Rendering "lead" — the single pipe that should render the merged
   * tube. All non-lead pipes in the group skip the tube render but
   * keep their hitboxes for selection.
   */
  leadPipeId: string;
  /** Merged point sequence from one terminal to the other. */
  mergedPoints: Vec3[];
  /** Shared diameter, material, system — all group members agree. */
  diameter: number;
  material: PipeMaterial;
  system: SystemType;
  /** True when the group contains 2+ pipes — the `lead` renders a merged run. */
  isMerged: boolean;
}

export interface MergeResult {
  /** pipeId → the group it belongs to (singleton groups included). */
  byPipeId: Map<string, PipeRunGroup>;
  /** All unique groups, keyed by leadPipeId for iteration in render. */
  groups: Map<string, PipeRunGroup>;
  /**
   * Phase 7.B.ii — the set of world-space posKey strings where two
   * PEX pipes smooth-merged. Used by FittingGenerator to SUPPRESS
   * emission of a junction fitting (coupling/tee) at that vertex.
   *
   * Only includes vertices that passed BOTH the connectivity test
   * (exactly 2 PEX pipes incident) AND the bend-classifier test
   * (smooth_bend | smooth_curve). Junctions with 3+ incidences
   * stay as real tees and don't appear here.
   */
  mergedVertices: Set<string>;
}

// ── Union-Find ────────────────────────────────────────────────

class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    let p = this.parent.get(id)!;
    while (p !== this.parent.get(p)) {
      // Path compression
      this.parent.set(p, this.parent.get(this.parent.get(p)!)!);
      p = this.parent.get(p)!;
    }
    return p;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankB < rankA) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Quantize a world-space position into the canonical posKey string used
 * as the key in `mergedVertices`. Exported so `FittingGenerator` can
 * match junction positions against the merged set.
 */
export function mergedVertexKey(v: Vec3): string {
  const k = (n: number) => n.toFixed(QUANTIZE_DECIMALS);
  return `${k(v[0])},${k(v[1])},${k(v[2])}`;
}

// Internal alias for the rest of this module.
const keyFor = mergedVertexKey;

/** Are two vectors approximately equal within EPSILON_FT? */
function near(a: Vec3, b: Vec3): boolean {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz <= EPSILON_FT * EPSILON_FT;
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// ── Main entrypoint ───────────────────────────────────────────

export function mergePexRuns(pipes: readonly CommittedPipe[]): MergeResult {
  const uf = new UnionFind();
  // Phase 7.B.ii — positions where smooth-merge happened. FittingGenerator
  // skips junction fittings at these vertices.
  const mergedVertices = new Set<string>();
  for (const p of pipes) uf.add(p.id);

  // Step 1: build vertex index — quantized endpoint → pipe incidences.
  //
  // Each entry captures: which pipe, which END (start or end), and the
  // adjacent-INTERIOR point so we can classify the bend direction.
  interface Incidence {
    pipeId: string;
    end: 'start' | 'end';
    /** The point just inward from the endpoint (used for bend classification). */
    interiorPoint: Vec3;
    /** The endpoint's actual position (pre-quantization). */
    endpoint: Vec3;
  }
  const byVertex = new Map<string, Incidence[]>();

  for (const p of pipes) {
    if (p.points.length < 2) continue;
    const first = p.points[0]!;
    const last = p.points[p.points.length - 1]!;
    const firstInterior = p.points[1]!;
    const lastInterior = p.points[p.points.length - 2]!;

    const kS = keyFor(first);
    const kE = keyFor(last);
    if (!byVertex.has(kS)) byVertex.set(kS, []);
    if (!byVertex.has(kE)) byVertex.set(kE, []);
    byVertex.get(kS)!.push({
      pipeId: p.id, end: 'start', interiorPoint: firstInterior, endpoint: first,
    });
    byVertex.get(kE)!.push({
      pipeId: p.id, end: 'end', interiorPoint: lastInterior, endpoint: last,
    });
  }

  // Step 2: at each vertex, if exactly 2 pipes incident + both PEX + same
  // diameter + same system + bend classifies as smooth_bend → union.
  // 3+ pipes = junction (tee), don't merge across.
  const pipeById = new Map<string, CommittedPipe>();
  for (const p of pipes) pipeById.set(p.id, p);

  for (const [vertexKey, incidences] of byVertex) {
    if (incidences.length !== 2) continue;
    const [a, b] = incidences as [Incidence, Incidence];
    const pa = pipeById.get(a.pipeId)!;
    const pb = pipeById.get(b.pipeId)!;

    // Filter: both PEX, same diameter, same system.
    if (pa.material !== 'pex' || pb.material !== 'pex') continue;
    if (Math.abs(pa.diameter - pb.diameter) > 1e-6) continue;
    if (pa.system !== pb.system) continue;

    // Compute bend at the shared vertex.
    const incoming = subtract(a.endpoint, a.interiorPoint);
    const outgoing = subtract(b.interiorPoint, b.endpoint);

    const c = classifyBend(incoming, outgoing, 'pex');
    if (c.kind === 'smooth_bend' || c.kind === 'smooth_curve') {
      uf.union(a.pipeId, b.pipeId);
      // Phase 7.B.ii — record this vertex so FittingGenerator suppresses
      // a junction fitting here.
      mergedVertices.add(vertexKey);
    }
  }

  // Step 3: collect groups, order them, and build merged point sequences.
  const groupOf = new Map<string, string[]>();
  for (const p of pipes) {
    const root = uf.find(p.id);
    if (!groupOf.has(root)) groupOf.set(root, []);
    groupOf.get(root)!.push(p.id);
  }

  const byPipeId = new Map<string, PipeRunGroup>();
  const groups = new Map<string, PipeRunGroup>();

  for (const [, pipeIds] of groupOf) {
    const members = pipeIds.map((id) => pipeById.get(id)!);
    const isMerged = members.length > 1;
    const lead = members[0]!;

    let mergedPoints: Vec3[];
    if (!isMerged) {
      mergedPoints = lead.points;
    } else {
      mergedPoints = walkGroupPoints(members);
    }

    const group: PipeRunGroup = {
      pipeIds,
      leadPipeId: lead.id,
      mergedPoints,
      diameter: lead.diameter,
      material: lead.material as PipeMaterial,
      system: lead.system,
      isMerged,
    };

    for (const id of pipeIds) byPipeId.set(id, group);
    groups.set(lead.id, group);
  }

  return { byPipeId, groups, mergedVertices };
}

// ── Walker ─────────────────────────────────────────────────────

/**
 * Given a group of ≥ 2 pipes known to chain through shared endpoints,
 * return the ordered merged point sequence from one terminal end to
 * the other.
 *
 * Falls back to the first pipe's points if traversal fails (e.g. the
 * group is a closed loop with no terminal — rare, but the renderer
 * shouldn't crash).
 */
/** Per-vertex incidence record used by the group walker. Lifted above the
 *  function so explicit type annotations inside the while loop resolve it. */
interface Touch { pipe: CommittedPipe; end: 'start' | 'end'; }

function walkGroupPoints(members: CommittedPipe[]): Vec3[] {
  // Adjacency: vertexKey → which pipes touch it, with their end info.
  const adj = new Map<string, Touch[]>();
  for (const p of members) {
    const first = p.points[0]!;
    const last = p.points[p.points.length - 1]!;
    const kS = keyFor(first);
    const kE = keyFor(last);
    if (!adj.has(kS)) adj.set(kS, []);
    if (!adj.has(kE)) adj.set(kE, []);
    adj.get(kS)!.push({ pipe: p, end: 'start' });
    adj.get(kE)!.push({ pipe: p, end: 'end' });
  }

  // Find a terminal: a vertex with exactly 1 pipe touching it.
  let terminal: { pipe: CommittedPipe; end: 'start' | 'end' } | null = null;
  for (const [, touches] of adj) {
    if (touches.length === 1) {
      terminal = touches[0]!;
      break;
    }
  }

  // Closed loop (or degenerate): bail to first pipe's points — the
  // user sees individual pipes rather than a merged run, no crash.
  if (!terminal) return members[0]!.points;

  // Walk: consume pipes one at a time, appending their points in order
  // (reversed if we're entering from the 'end' side of that pipe).
  const visited = new Set<string>();
  const out: Vec3[] = [];

  let currentPipe: CommittedPipe | null = terminal.pipe;
  let enteringEnd: 'start' | 'end' = terminal.end;

  while (currentPipe) {
    const cp: CommittedPipe = currentPipe;
    visited.add(cp.id);
    const pts: readonly Vec3[] = cp.points;
    const walk: Vec3[] = enteringEnd === 'start' ? [...pts] : [...pts].reverse();

    // Append, skipping the leading point if it duplicates the previous
    // pipe's exit point (shared endpoints).
    if (out.length === 0) {
      out.push(...walk);
    } else {
      const last = out[out.length - 1]!;
      for (const v of walk) {
        if (near(v, last) && out.length > 0) continue; // skip duplicate shared vertex
        out.push(v);
      }
    }

    // Move to the next pipe via the FAR endpoint of currentPipe.
    const exitPt: Vec3 = walk[walk.length - 1]!;
    const touches: Touch[] = adj.get(keyFor(exitPt)) ?? [];
    const next: Touch | undefined = touches.find((t) => !visited.has(t.pipe.id));
    if (!next) break;
    currentPipe = next.pipe;
    enteringEnd = next.end;
  }

  return out;
}
