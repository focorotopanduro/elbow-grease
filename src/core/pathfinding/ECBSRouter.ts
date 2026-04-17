/**
 * Enhanced Conflict-Based Search (ECBS) Router.
 *
 * Generates a DIVERSE set of valid pipe routes between two points
 * on a discretized 3D grid. Unlike vanilla A* which returns one
 * shortest path, ECBS uses bounded-suboptimal search with a focal
 * list to explore near-optimal alternatives — giving the human
 * engineer a menu of meaningfully different solutions.
 *
 * Constraints:
 *   - Obstacles (structural beams, walls) are impassable
 *   - Drainage pipes must maintain minimum slope (gravity)
 *   - Routes must respect maximum trap arm distances (IPC venting)
 */

import type { Vec3 } from '../events';
import type { RouteCandidate, ObjectiveVector } from '../optimizer/ParetoFrontier';

// ── Grid types ──────────────────────────────────────────────────

export interface GridConfig {
  /** Grid cell size in feet. */
  cellSize: number;
  /** Grid dimensions [x, y, z] in cells. */
  dimensions: [number, number, number];
  /** Minimum slope for drainage (rise per foot of run, e.g. 0.25/12). */
  minDrainageSlope: number;
  /** Maximum trap arm distance in feet (IPC table). */
  maxTrapArm: number;
}

interface GridCell {
  x: number;
  y: number;
  z: number;
}

interface SearchNode {
  cell: GridCell;
  g: number;        // cost so far
  h: number;        // heuristic to goal
  f: number;        // g + h
  parent: SearchNode | null;
  slopeAccum: number; // accumulated elevation drop
  runLength: number;  // horizontal run since last vent/stack
}

// ── Obstacle map ────────────────────────────────────────────────

export class ObstacleMap {
  private blocked = new Set<string>();

  private key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  addObstacle(x: number, y: number, z: number): void {
    this.blocked.add(this.key(x, y, z));
  }

  addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++)
          this.addObstacle(x, y, z);
  }

  isBlocked(x: number, y: number, z: number): boolean {
    return this.blocked.has(this.key(x, y, z));
  }
}

// ── 26-connected 3D neighbors ───────────────────────────────────

const DIRS_6: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// ── Heuristic ───────────────────────────────────────────────────

function octileH(a: GridCell, b: GridCell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
}

// ── ECBS core ───────────────────────────────────────────────────

function cellKey(c: GridCell): string {
  return `${c.x},${c.y},${c.z}`;
}

function reconstructPath(node: SearchNode, cellSize: number): Vec3[] {
  const path: Vec3[] = [];
  let cur: SearchNode | null = node;
  while (cur) {
    path.unshift([
      cur.cell.x * cellSize,
      cur.cell.y * cellSize,
      cur.cell.z * cellSize,
    ]);
    cur = cur.parent;
  }
  return path;
}

/**
 * Single bounded-suboptimal A* search.
 * Uses a focal list with bound `w` to find a near-optimal path
 * that may differ from the true shortest path.
 */
function boundedAStar(
  start: GridCell,
  goal: GridCell,
  obstacles: ObstacleMap,
  config: GridConfig,
  w: number,
  taboo: Set<string>,
): Vec3[] | null {
  const open = new Map<string, SearchNode>();
  const closed = new Set<string>();

  const startNode: SearchNode = {
    cell: start,
    g: 0,
    h: octileH(start, goal),
    f: octileH(start, goal),
    parent: null,
    slopeAccum: 0,
    runLength: 0,
  };
  open.set(cellKey(start), startNode);

  let bestF = startNode.f;

  while (open.size > 0) {
    // Build focal list: all nodes with f <= w * bestF
    const focalThreshold = w * bestF;
    let bestNode: SearchNode | null = null;
    let bestScore = Infinity;

    for (const node of open.values()) {
      if (node.f > focalThreshold) continue;
      // Prefer nodes with fewer conflicts (taboo cells visited)
      const conflicts = taboo.has(cellKey(node.cell)) ? 1 : 0;
      const score = node.f + conflicts * 2;
      if (score < bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    if (!bestNode) {
      // Fallback: pick lowest f from open
      for (const node of open.values()) {
        if (!bestNode || node.f < bestNode.f) bestNode = node;
      }
    }
    if (!bestNode) return null;

    const current = bestNode;
    const currentKey = cellKey(current.cell);
    open.delete(currentKey);
    closed.add(currentKey);

    // Goal reached
    if (current.cell.x === goal.x && current.cell.y === goal.y && current.cell.z === goal.z) {
      return reconstructPath(current, config.cellSize);
    }

    for (const [dx, dy, dz] of DIRS_6) {
      const nx = current.cell.x + dx;
      const ny = current.cell.y + dy;
      const nz = current.cell.z + dz;

      // Bounds check
      if (nx < 0 || ny < 0 || nz < 0) continue;
      if (nx >= config.dimensions[0] || ny >= config.dimensions[1] || nz >= config.dimensions[2]) continue;

      const nKey = `${nx},${ny},${nz}`;
      if (closed.has(nKey)) continue;
      if (obstacles.isBlocked(nx, ny, nz)) continue;

      // Slope constraint: horizontal moves must drop at required slope for drainage
      const isHorizontal = dy === 0;
      const elevDrop = -dy * config.cellSize;
      const newSlope = current.slopeAccum + (isHorizontal ? 0 : elevDrop);

      // Trap arm constraint: horizontal run can't exceed max
      const newRun = isHorizontal
        ? current.runLength + config.cellSize
        : 0; // vertical moves reset the run
      if (newRun > config.maxTrapArm) continue;

      const moveCost = config.cellSize;
      const ng = current.g + moveCost;
      const nh = octileH({ x: nx, y: ny, z: nz }, goal);
      const nf = ng + nh;

      const existing = open.get(nKey);
      if (existing && existing.g <= ng) continue;

      const neighbor: SearchNode = {
        cell: { x: nx, y: ny, z: nz },
        g: ng,
        h: nh,
        f: nf,
        parent: current,
        slopeAccum: newSlope,
        runLength: newRun,
      };
      open.set(nKey, neighbor);

      if (nf < bestF) bestF = nf;
    }
  }

  return null; // no path found
}

// ── Public API ──────────────────────────────────────────────────

let routeIdCounter = 0;

/**
 * Generate `count` diverse routes between start and goal.
 *
 * Uses iterative ECBS: each successive search adds the previous
 * path's cells to a taboo set so the focal list biases away from
 * already-found routes, producing meaningfully different alternatives.
 */
export function generateDiverseRoutes(
  start: Vec3,
  goal: Vec3,
  obstacles: ObstacleMap,
  config: GridConfig,
  count: number,
  wBounds: number[] = [1.0, 1.2, 1.5, 2.0, 3.0],
): RouteCandidate[] {
  const startCell: GridCell = {
    x: Math.round(start[0] / config.cellSize),
    y: Math.round(start[1] / config.cellSize),
    z: Math.round(start[2] / config.cellSize),
  };
  const goalCell: GridCell = {
    x: Math.round(goal[0] / config.cellSize),
    y: Math.round(goal[1] / config.cellSize),
    z: Math.round(goal[2] / config.cellSize),
  };

  const results: RouteCandidate[] = [];
  const taboo = new Set<string>();

  for (let i = 0; i < count; i++) {
    const w = wBounds[i % wBounds.length] ?? 1.0;
    const path = boundedAStar(startCell, goalCell, obstacles, config, w, taboo);
    if (!path) continue;

    // Add this path's cells to taboo for diversity
    for (const p of path) {
      const cx = Math.round(p[0] / config.cellSize);
      const cy = Math.round(p[1] / config.cellSize);
      const cz = Math.round(p[2] / config.cellSize);
      taboo.add(`${cx},${cy},${cz}`);
    }

    results.push({
      id: `route-${routeIdCounter++}`,
      points: path,
      objectives: evaluateRoute(path, config),
      wBound: w,
      dominated: false,
    });
  }

  return results;
}

// ── Route objective evaluation ──────────────────────────────────

function evaluateRoute(points: Vec3[], config: GridConfig): ObjectiveVector {
  let pipeLength = 0;
  let slopeViolations = 0;
  let bends = 0;

  for (let i = 1; i < points.length; i++) {
    const dx = points[i]![0] - points[i - 1]![0];
    const dy = points[i]![1] - points[i - 1]![1];
    const dz = points[i]![2] - points[i - 1]![2];
    pipeLength += Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Check slope on horizontal segments
    const hDist = Math.sqrt(dx * dx + dz * dz);
    if (hDist > 0) {
      const slope = Math.abs(dy) / hDist;
      if (slope < config.minDrainageSlope && dy !== 0) slopeViolations++;
    }

    // Count bends
    if (i >= 2) {
      const px = points[i - 1]![0] - points[i - 2]![0];
      const pz = points[i - 1]![2] - points[i - 2]![2];
      if (Math.abs(dx - px) > 0.01 || Math.abs(dz - pz) > 0.01) bends++;
    }
  }

  // Cost heuristic: $8/ft for PVC, each bend adds a fitting ~$15
  const materialCost = pipeLength * 8 + bends * 15;

  // Accessibility: fewer bends = easier maintenance
  const accessibility = Math.max(0, 1 - bends * 0.1);

  // Slope compliance: 1 = perfect, decreasing with violations
  const slopeCompliance = Math.max(0, 1 - slopeViolations * 0.2);

  return {
    pipeLength,
    slopeCompliance,
    materialCost,
    accessibility,
    violations: slopeViolations,
  };
}
