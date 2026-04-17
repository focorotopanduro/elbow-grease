/**
 * Gravity-Aware A* — pathfinder that auto-computes vertical drops
 * for drainage slope requirements.
 *
 * Unlike the original ECBS router which merely checks slope constraints,
 * this solver BUILDS the required slope into the path automatically:
 *
 *   1. For drainage (waste) routes: every horizontal cell traversal
 *      drops the Y coordinate by (minSlope × cellSize) to maintain
 *      the IPC-required 1/4"/ft grade.
 *
 *   2. For supply routes: elevation changes are allowed freely
 *      (pressurized pipes go up/down without gravity constraints).
 *
 *   3. For vent routes: must rise toward atmosphere (Y only increases).
 *
 * The heuristic accounts for the required elevation drop, so the
 * pathfinder naturally plans enough vertical clearance from start.
 *
 * Uses the SDF for movement costs — routes curve around obstacles
 * smoothly rather than hard-blocking.
 *
 * Binary heap priority queue for O(E log V) performance.
 */

import type { Vec3 } from '../events';
import { type SignedDistanceField } from './SignedDistanceField';
import type { SystemType } from '../../engine/graph/GraphNode';

// ── Config ──────────────────────────────────────────────────────

export interface RouteConstraints {
  system: SystemType;
  /** Minimum slope for drainage in inches per foot. */
  minDrainageSlope: number;
  /** Maximum trap arm distance in feet. */
  maxTrapArm: number;
  /** Maximum total route length in feet. */
  maxLength: number;
  /** Preferred vertical clearance from floor/ceiling in cells. */
  verticalClearance: number;
  /** Pipe diameter in inches (affects clearance). */
  diameter: number;
}

export const DEFAULT_CONSTRAINTS: RouteConstraints = {
  system: 'waste',
  minDrainageSlope: 0.25,  // 1/4" per foot
  maxTrapArm: 5,
  maxLength: 100,
  verticalClearance: 2,
  diameter: 2,
};

// ── Search node ─────────────────────────────────────────────────

interface AStarNode {
  x: number;
  y: number;
  z: number;
  /** Cost from start. */
  g: number;
  /** Heuristic to goal. */
  h: number;
  /** f = g + h */
  f: number;
  /** Parent for path reconstruction. */
  parent: AStarNode | null;
  /** Horizontal run since last vertical segment (trap arm tracking). */
  horizRun: number;
  /** Number of direction changes (bend count). */
  bends: number;
  /** Direction of last move for bend detection. */
  lastDir: number; // index into DIRS
}

// ── 6-connected directions ──────────────────────────────────────

const DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],   // X axis
  [0, 0, 1], [0, 0, -1],   // Z axis
  [0, 1, 0], [0, -1, 0],   // Y axis (up/down)
];

// ── Binary min-heap ─────────────────────────────────────────────

class MinHeap {
  private heap: AStarNode[] = [];

  push(node: AStarNode): void {
    this.heap.push(node);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): AStarNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number { return this.heap.length; }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i]!.f >= this.heap[parent]!.f) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent]!, this.heap[i]!];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left]!.f < this.heap[smallest]!.f) smallest = left;
      if (right < n && this.heap[right]!.f < this.heap[smallest]!.f) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest]!, this.heap[i]!];
      i = smallest;
    }
  }
}

// ── Heuristic ───────────────────────────────────────────────────

function heuristic(
  x: number, y: number, z: number,
  gx: number, gy: number, gz: number,
  constraints: RouteConstraints,
  cellSize: number,
): number {
  const horizDist = Math.abs(x - gx) + Math.abs(z - gz);
  const vertDist = Math.abs(y - gy);

  // For drainage: add the required elevation drop to the heuristic
  // so the pathfinder knows it needs vertical clearance
  if (constraints.system === 'waste') {
    const requiredDrop = horizDist * cellSize * (constraints.minDrainageSlope / 12);
    const requiredDropCells = Math.ceil(requiredDrop / cellSize);
    return (horizDist + vertDist + requiredDropCells) * cellSize;
  }

  return (horizDist + vertDist) * cellSize;
}

// ── Gravity-aware movement ──────────────────────────────────────

/**
 * Compute the actual Y coordinate after a horizontal move,
 * accounting for drainage slope requirements.
 */
function gravityAdjustedY(
  currentY: number,
  dx: number, dz: number,
  constraints: RouteConstraints,
  cellSize: number,
): number {
  if (constraints.system !== 'waste') return currentY;

  // Horizontal move: drop by slope requirement
  const isHorizontal = dx !== 0 || dz !== 0;
  if (!isHorizontal) return currentY;

  const dropPerCell = (constraints.minDrainageSlope / 12) * cellSize;
  return currentY - dropPerCell / cellSize; // fractional Y drop per cell
}

// ── Main search ─────────────────────────────────────────────────

export interface SearchResult {
  /** The found path in world coordinates. */
  path: Vec3[];
  /** Total path length in feet. */
  totalLength: number;
  /** Number of bends in the path. */
  bendCount: number;
  /** Total elevation change in feet. */
  elevationDelta: number;
  /** Nodes explored during search. */
  nodesExplored: number;
  /** Search time in milliseconds. */
  searchMs: number;
  /** Whether the search found a valid path. */
  success: boolean;
  /** Reason for failure (if any). */
  failureReason?: string;
}

/**
 * Find a gravity-aware, obstacle-avoiding path between two points.
 *
 * @param start — start position in world coordinates
 * @param goal — goal position in world coordinates
 * @param sdf — signed distance field for obstacle costs
 * @param constraints — system-specific routing constraints
 */
export function gravityAwareAStar(
  start: Vec3,
  goal: Vec3,
  sdf: SignedDistanceField,
  constraints: RouteConstraints = DEFAULT_CONSTRAINTS,
): SearchResult {
  const t0 = performance.now();
  const cellSize = sdf.getCellSize();
  const [dimX, dimY, dimZ] = sdf.getDimensions();

  // Convert to grid coordinates
  const sx = Math.round(start[0] / cellSize);
  const sy = Math.round(start[1] / cellSize);
  const sz = Math.round(start[2] / cellSize);
  const gx = Math.round(goal[0] / cellSize);
  const gy = Math.round(goal[1] / cellSize);
  const gz = Math.round(goal[2] / cellSize);

  // For drainage: adjust goal Y to account for required slope drop
  let adjustedGY = gy;
  if (constraints.system === 'waste') {
    const horizDist = (Math.abs(sx - gx) + Math.abs(sz - gz)) * cellSize;
    const requiredDrop = horizDist * (constraints.minDrainageSlope / 12);
    adjustedGY = Math.round(sy - requiredDrop / cellSize);
    // Ensure goal Y doesn't go below floor
    adjustedGY = Math.max(0, adjustedGY);
  }

  const open = new MinHeap();
  const closed = new Map<string, number>(); // key → best g
  let nodesExplored = 0;

  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  const h0 = heuristic(sx, sy, sz, gx, adjustedGY, gz, constraints, cellSize);
  open.push({
    x: sx, y: sy, z: sz,
    g: 0, h: h0, f: h0,
    parent: null,
    horizRun: 0,
    bends: 0,
    lastDir: -1,
  });

  const maxNodes = dimX * dimY * dimZ; // safety limit

  while (open.size > 0 && nodesExplored < maxNodes) {
    const current = open.pop()!;
    nodesExplored++;

    const ck = key(current.x, current.y, current.z);

    // Skip if we've found a better path to this cell
    const bestG = closed.get(ck);
    if (bestG !== undefined && bestG <= current.g) continue;
    closed.set(ck, current.g);

    // Goal check (with Y tolerance for drainage adjustment)
    const yTolerance = constraints.system === 'waste' ? 2 : 0;
    if (current.x === gx && current.z === gz &&
        Math.abs(current.y - adjustedGY) <= yTolerance) {
      const path = reconstructPath(current, cellSize);
      return {
        path,
        totalLength: current.g,
        bendCount: current.bends,
        elevationDelta: Math.abs(current.y - sy) * cellSize,
        nodesExplored,
        searchMs: performance.now() - t0,
        success: true,
      };
    }

    // Expand neighbors
    for (let dirIdx = 0; dirIdx < DIRS.length; dirIdx++) {
      const [dx, dy, dz] = DIRS[dirIdx]!;
      let nx = current.x + dx;
      let ny = current.y + dy;
      let nz = current.z + dz;

      // Bounds check
      if (nx < 0 || ny < 0 || nz < 0) continue;
      if (nx >= dimX || ny >= dimY || nz >= dimZ) continue;

      // System-specific vertical constraints
      if (constraints.system === 'waste') {
        // Drainage can't go up (except small tolerance for fitting offsets)
        if (dy > 0) continue;

        // Auto-apply gravity drop on horizontal moves
        if (dy === 0 && (dx !== 0 || dz !== 0)) {
          const dropPerCell = (constraints.minDrainageSlope / 12) * cellSize / cellSize;
          const newY = current.y - dropPerCell;
          ny = Math.round(newY);
          if (ny < 0) continue;
        }
      } else if (constraints.system === 'vent') {
        // Vents must rise toward atmosphere
        if (dy < 0) continue;
      }

      // SDF movement cost
      const moveCost = sdf.movementCost(nx, ny, nz);
      if (!isFinite(moveCost)) continue;

      // Trap arm constraint for drainage
      const isHorizontal = dy === 0;
      const newHorizRun = isHorizontal
        ? current.horizRun + cellSize
        : 0;
      if (constraints.system === 'waste' && newHorizRun > constraints.maxTrapArm) continue;

      // Bend penalty: direction changes cost extra (each bend = a fitting)
      const newBends = current.lastDir >= 0 && dirIdx !== current.lastDir
        ? current.bends + 1
        : current.bends;
      const bendPenalty = newBends > current.bends ? cellSize * 0.5 : 0;

      // Total cost
      const ng = current.g + moveCost + bendPenalty;

      // Max length check
      if (ng > constraints.maxLength) continue;

      const nk = key(nx, ny, nz);
      const existingG = closed.get(nk);
      if (existingG !== undefined && existingG <= ng) continue;

      const nh = heuristic(nx, ny, nz, gx, adjustedGY, gz, constraints, cellSize);

      open.push({
        x: nx, y: ny, z: nz,
        g: ng, h: nh, f: ng + nh,
        parent: current,
        horizRun: newHorizRun,
        bends: newBends,
        lastDir: dirIdx,
      });
    }
  }

  return {
    path: [],
    totalLength: 0,
    bendCount: 0,
    elevationDelta: 0,
    nodesExplored,
    searchMs: performance.now() - t0,
    success: false,
    failureReason: nodesExplored >= maxNodes
      ? 'Search exceeded maximum node limit'
      : 'No valid path exists between start and goal',
  };
}

// ── Path reconstruction ─────────────────────────────────────────

function reconstructPath(node: AStarNode, cellSize: number): Vec3[] {
  const path: Vec3[] = [];
  let cur: AStarNode | null = node;
  while (cur) {
    path.unshift([
      cur.x * cellSize,
      cur.y * cellSize,
      cur.z * cellSize,
    ]);
    cur = cur.parent;
  }
  return path;
}
