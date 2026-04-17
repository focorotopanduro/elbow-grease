/**
 * Geometry Batcher — merges pipe geometries per diameter bucket
 * per spatial cell to minimize draw calls.
 *
 * Without batching: 500 pipes = 500 draw calls (+ 500 wall shells)
 * With batching:    500 pipes = ~30-50 draw calls total
 *
 * Strategy:
 *   1. Partition scene into spatial cells (8×8×8 ft cubes)
 *   2. Group pipes by (cell, diameter bucket)
 *   3. Merge each group's TubeGeometries into one BufferGeometry
 *   4. One draw call per merged group
 *   5. Selected pipes extracted from batch and rendered individually
 *
 * Three.js frustum culling works per-object, so each spatial cell
 * gets its own merged mesh — off-screen cells are culled entirely.
 */

import * as THREE from 'three';
import type { CommittedPipe } from '@store/pipeStore';

// ── Spatial cell sizing ─────────────────────────────────────────

const CELL_SIZE = 8; // feet per cell

export function spatialCellKey(x: number, y: number, z: number): string {
  const cx = Math.floor(x / CELL_SIZE);
  const cy = Math.floor(y / CELL_SIZE);
  const cz = Math.floor(z / CELL_SIZE);
  return `${cx},${cy},${cz}`;
}

function pipeCentroid(pipe: CommittedPipe): [number, number, number] {
  let sx = 0, sy = 0, sz = 0;
  for (const p of pipe.points) {
    sx += p[0]; sy += p[1]; sz += p[2];
  }
  const n = pipe.points.length || 1;
  return [sx / n, sy / n, sz / n];
}

// ── Diameter buckets ────────────────────────────────────────────

const DIAMETER_BUCKETS = [0.5, 1, 1.5, 2, 3, 4, 6, 8, 12];

function diameterBucket(diameter: number): number {
  for (const b of DIAMETER_BUCKETS) {
    if (diameter <= b) return b;
  }
  return DIAMETER_BUCKETS[DIAMETER_BUCKETS.length - 1]!;
}

// ── Batch key ───────────────────────────────────────────────────

function batchKey(cellKey: string, dBucket: number): string {
  return `${cellKey}|${dBucket}`;
}

// ── Batch group ─────────────────────────────────────────────────

export interface BatchGroup {
  key: string;
  cellKey: string;
  diameterBucket: number;
  pipeIds: string[];
  /** Merged geometry (rebuilt when pipes change). */
  geometry: THREE.BufferGeometry | null;
  /** Bounding center for frustum culling. */
  center: THREE.Vector3;
  /** Whether this group needs a geometry rebuild. */
  dirty: boolean;
}

// ── Batcher ─────────────────────────────────────────────────────

export class GeometryBatcher {
  private groups = new Map<string, BatchGroup>();
  /** Map from pipeId → batchKey for fast lookup. */
  private pipeToGroup = new Map<string, string>();
  /** Version counter — incremented on any structural change. */
  version = 0;

  /**
   * Rebuild the batch grouping from scratch.
   * Call when pipes are added/removed. Does NOT rebuild geometry
   * — that's deferred to the staged queue.
   */
  regroup(pipes: CommittedPipe[]): void {
    // Dispose old geometries
    for (const g of this.groups.values()) {
      g.geometry?.dispose();
    }
    this.groups.clear();
    this.pipeToGroup.clear();

    for (const pipe of pipes) {
      const [cx, cy, cz] = pipeCentroid(pipe);
      const cell = spatialCellKey(cx, cy, cz);
      const dBucket = diameterBucket(pipe.diameter);
      const key = batchKey(cell, dBucket);

      if (!this.groups.has(key)) {
        this.groups.set(key, {
          key,
          cellKey: cell,
          diameterBucket: dBucket,
          pipeIds: [],
          geometry: null,
          center: new THREE.Vector3(
            Math.floor(cx / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
            Math.floor(cy / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
            Math.floor(cz / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
          ),
          dirty: true,
        });
      }

      this.groups.get(key)!.pipeIds.push(pipe.id);
      this.pipeToGroup.set(pipe.id, key);
    }

    this.version++;
  }

  /** Mark a specific pipe's group as needing geometry rebuild. */
  markDirty(pipeId: string): void {
    const key = this.pipeToGroup.get(pipeId);
    if (key) {
      const group = this.groups.get(key);
      if (group) group.dirty = true;
    }
    this.version++;
  }

  /** Mark all groups dirty (e.g. after solver resizes many pipes). */
  markAllDirty(): void {
    for (const g of this.groups.values()) g.dirty = true;
    this.version++;
  }

  /** Get all groups that need geometry rebuild. */
  getDirtyGroups(): BatchGroup[] {
    return [...this.groups.values()].filter((g) => g.dirty);
  }

  /** Get all groups (for rendering). */
  getAllGroups(): BatchGroup[] {
    return [...this.groups.values()];
  }

  /** Get the group a pipe belongs to. */
  getGroupForPipe(pipeId: string): BatchGroup | undefined {
    const key = this.pipeToGroup.get(pipeId);
    return key ? this.groups.get(key) : undefined;
  }

  /** Total number of batch groups (= draw calls). */
  get groupCount(): number {
    return this.groups.size;
  }

  /** Dispose all geometries. */
  dispose(): void {
    for (const g of this.groups.values()) {
      g.geometry?.dispose();
    }
    this.groups.clear();
    this.pipeToGroup.clear();
  }
}

// ── Geometry merge utility ──────────────────────────────────────

/**
 * Merge multiple TubeGeometries into one BufferGeometry.
 * Uses manual attribute concatenation (faster than BufferGeometryUtils
 * for our known-shape case).
 */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 0) return new THREE.BufferGeometry();
  if (geos.length === 1) return geos[0]!.clone();

  let totalVerts = 0;
  let totalIndices = 0;

  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    totalIndices += g.index ? g.index.count : g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIndices);

  let vOffset = 0;
  let iOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const norm = g.getAttribute('normal') as THREE.BufferAttribute;

    // Copy positions
    for (let i = 0; i < pos.count; i++) {
      positions[(vOffset + i) * 3]     = pos.getX(i);
      positions[(vOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vOffset + i) * 3 + 2] = pos.getZ(i);
    }

    // Copy normals
    if (norm) {
      for (let i = 0; i < norm.count; i++) {
        normals[(vOffset + i) * 3]     = norm.getX(i);
        normals[(vOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vOffset + i) * 3 + 2] = norm.getZ(i);
      }
    }

    // Copy indices (offset by vertex count)
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[iOffset + i] = g.index.getX(i) + vOffset;
      }
      iOffset += g.index.count;
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset + i] = i + vOffset;
      }
      iOffset += pos.count;
    }

    vOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();

  return merged;
}
