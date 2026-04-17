/**
 * Signed Distance Field (SDF) — continuous obstacle weighting for
 * intelligent pipe routing.
 *
 * Replaces the boolean ObstacleMap with a 3D scalar field where
 * each cell stores the distance to the nearest obstacle surface.
 *
 *   Positive values → open space (distance to nearest wall)
 *   Zero            → obstacle surface
 *   Negative values → inside an obstacle
 *
 * The pathfinder uses SDF values as movement cost weights:
 *   - Cells near obstacles get high cost → routes curve away naturally
 *   - Cells far from obstacles get low cost → routes prefer open space
 *   - Cells inside obstacles get infinite cost → impassable
 *
 * This produces routes that maintain clearance from structural
 * elements without hard binary blocked/free boundaries.
 *
 * Also supports:
 *   - Clearance zones (minimum distance from walls for maintenance)
 *   - Preferred corridors (reduced cost along joist bays, chases)
 *   - Existing pipe avoidance (add committed pipes as soft obstacles)
 */

import type { Vec3 } from '../events';

// ── SDF Grid ────────────────────────────────────────────────────

export interface SDFConfig {
  /** Cell size in feet. */
  cellSize: number;
  /** Grid dimensions [x, y, z] in cells. */
  dimensions: [number, number, number];
  /** Minimum clearance from obstacles in feet. */
  minClearance: number;
  /** Cost multiplier for cells within clearance zone. */
  clearancePenalty: number;
  /** Cost multiplier for cells near existing pipes (soft avoidance). */
  pipeProximityPenalty: number;
}

export const DEFAULT_SDF_CONFIG: SDFConfig = {
  cellSize: 0.5,
  dimensions: [40, 20, 40],
  minClearance: 0.5,        // 6 inches from obstacles
  clearancePenalty: 5.0,     // 5× cost within clearance zone
  pipeProximityPenalty: 2.0, // 2× cost near existing pipes
};

export class SignedDistanceField {
  private grid: Float32Array;
  private config: SDFConfig;
  private dimX: number;
  private dimY: number;
  private dimZ: number;

  /** Preferred corridor cells (reduced cost). */
  private corridors = new Set<string>();

  constructor(config: SDFConfig = DEFAULT_SDF_CONFIG) {
    this.config = config;
    this.dimX = config.dimensions[0];
    this.dimY = config.dimensions[1];
    this.dimZ = config.dimensions[2];
    this.grid = new Float32Array(this.dimX * this.dimY * this.dimZ);
    // Initialize all cells to max distance (fully open)
    this.grid.fill(100);
  }

  // ── Index math ──────────────────────────────────────────────

  private idx(x: number, y: number, z: number): number {
    return x + y * this.dimX + z * this.dimX * this.dimY;
  }

  private inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 &&
           x < this.dimX && y < this.dimY && z < this.dimZ;
  }

  // ── Set/get raw distance values ─────────────────────────────

  setDistance(x: number, y: number, z: number, dist: number): void {
    if (this.inBounds(x, y, z)) {
      this.grid[this.idx(x, y, z)] = dist;
    }
  }

  getDistance(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return -1; // out of bounds = inside obstacle
    return this.grid[this.idx(x, y, z)]!;
  }

  /** Get distance at a world-space position. */
  getDistanceAt(pos: Vec3): number {
    const x = Math.round(pos[0] / this.config.cellSize);
    const y = Math.round(pos[1] / this.config.cellSize);
    const z = Math.round(pos[2] / this.config.cellSize);
    return this.getDistance(x, y, z);
  }

  // ── Add obstacles ─────────────────────────────────────────────

  /** Add a solid box obstacle. Sets cells inside to negative distance. */
  addBox(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): void {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          if (this.inBounds(x, y, z)) {
            this.grid[this.idx(x, y, z)] = -1;
          }
        }
      }
    }
  }

  /** Add a cylindrical obstacle (e.g. column). */
  addCylinder(
    centerX: number, centerZ: number,
    radius: number,
    yMin: number, yMax: number,
  ): void {
    const r2 = radius * radius;
    for (let x = Math.floor(centerX - radius); x <= Math.ceil(centerX + radius); x++) {
      for (let z = Math.floor(centerZ - radius); z <= Math.ceil(centerZ + radius); z++) {
        const dx = x - centerX;
        const dz = z - centerZ;
        if (dx * dx + dz * dz <= r2) {
          for (let y = yMin; y <= yMax; y++) {
            if (this.inBounds(x, y, z)) {
              this.grid[this.idx(x, y, z)] = -1;
            }
          }
        }
      }
    }
  }

  /**
   * Add a structural element from its AABB.
   * Marks the element body as impassable and applies clearance
   * buffer around it via the Chamfer propagation pass.
   */
  addStructuralBox(min: Vec3, max: Vec3): void {
    const cs = this.config.cellSize;
    this.addBox(
      Math.floor(min[0] / cs), Math.floor(min[1] / cs), Math.floor(min[2] / cs),
      Math.ceil(max[0] / cs), Math.ceil(max[1] / cs), Math.ceil(max[2] / cs),
    );
  }

  /** Add an existing pipe route as a soft obstacle (avoidance zone). */
  addPipeRoute(points: Vec3[], avoidanceRadius: number = 1): void {
    for (const pt of points) {
      const cx = Math.round(pt[0] / this.config.cellSize);
      const cy = Math.round(pt[1] / this.config.cellSize);
      const cz = Math.round(pt[2] / this.config.cellSize);
      const r = Math.ceil(avoidanceRadius / this.config.cellSize);

      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const nx = cx + dx, ny = cy + dy, nz = cz + dz;
            if (!this.inBounds(nx, ny, nz)) continue;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) * this.config.cellSize;
            if (dist <= avoidanceRadius) {
              const current = this.grid[this.idx(nx, ny, nz)]!;
              // Don't overwrite hard obstacles, just reduce distance
              if (current > 0) {
                this.grid[this.idx(nx, ny, nz)] = Math.min(current, dist);
              }
            }
          }
        }
      }
    }
  }

  // ── Preferred corridors ───────────────────────────────────────

  /** Mark cells as preferred routing corridors (joist bays, pipe chases). */
  addCorridor(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
  ): void {
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
          this.corridors.add(`${x},${y},${z}`);
        }
      }
    }
  }

  isCorridor(x: number, y: number, z: number): boolean {
    return this.corridors.has(`${x},${y},${z}`);
  }

  // ── Propagate distances (Chamfer 3-4-5) ───────────────────────

  /**
   * Compute the full SDF from the obstacle seeds using two-pass
   * Chamfer distance transform. O(N) where N = total grid cells.
   *
   * Call this AFTER adding all obstacles and BEFORE pathfinding.
   */
  propagate(): void {
    const { dimX, dimY, dimZ } = this;

    // Forward pass (x+, y+, z+)
    for (let z = 0; z < dimZ; z++) {
      for (let y = 0; y < dimY; y++) {
        for (let x = 0; x < dimX; x++) {
          if (this.grid[this.idx(x, y, z)]! < 0) continue; // obstacle

          const neighbors = [
            x > 0 ? this.grid[this.idx(x - 1, y, z)]! + 1 : 100,
            y > 0 ? this.grid[this.idx(x, y - 1, z)]! + 1 : 100,
            z > 0 ? this.grid[this.idx(x, y, z - 1)]! + 1 : 100,
          ];
          const minN = Math.min(...neighbors);
          const current = this.grid[this.idx(x, y, z)]!;
          this.grid[this.idx(x, y, z)] = Math.min(current, minN);
        }
      }
    }

    // Backward pass (x-, y-, z-)
    for (let z = dimZ - 1; z >= 0; z--) {
      for (let y = dimY - 1; y >= 0; y--) {
        for (let x = dimX - 1; x >= 0; x--) {
          if (this.grid[this.idx(x, y, z)]! < 0) continue;

          const neighbors = [
            x < dimX - 1 ? this.grid[this.idx(x + 1, y, z)]! + 1 : 100,
            y < dimY - 1 ? this.grid[this.idx(x, y + 1, z)]! + 1 : 100,
            z < dimZ - 1 ? this.grid[this.idx(x, y, z + 1)]! + 1 : 100,
          ];
          const minN = Math.min(...neighbors);
          const current = this.grid[this.idx(x, y, z)]!;
          this.grid[this.idx(x, y, z)] = Math.min(current, minN);
        }
      }
    }
  }

  // ── Movement cost for pathfinding ─────────────────────────────

  /**
   * Compute the movement cost for entering a cell.
   * Used by GravityAwareAStar as the edge weight.
   *
   * Returns Infinity for impassable cells.
   */
  movementCost(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return Infinity;

    const dist = this.grid[this.idx(x, y, z)]!;

    // Inside obstacle
    if (dist < 0) return Infinity;

    // Base cost = cell size
    let cost = this.config.cellSize;

    // Clearance penalty: cells within minClearance get extra cost
    const clearanceCells = this.config.minClearance / this.config.cellSize;
    if (dist < clearanceCells) {
      cost *= this.config.clearancePenalty * (1 - dist / clearanceCells);
    }

    // Pipe proximity penalty
    if (dist < 3 && dist >= 0) {
      cost *= 1 + this.config.pipeProximityPenalty * (1 - dist / 3);
    }

    // Corridor bonus: 50% reduced cost
    if (this.isCorridor(x, y, z)) {
      cost *= 0.5;
    }

    return cost;
  }

  // ── Accessors ─────────────────────────────────────────────────

  getConfig(): SDFConfig { return { ...this.config }; }
  getDimensions(): [number, number, number] { return [...this.config.dimensions]; }
  getCellSize(): number { return this.config.cellSize; }

  /** Check if a cell is passable (distance > 0). */
  isPassable(x: number, y: number, z: number): boolean {
    return this.getDistance(x, y, z) > 0;
  }
}
