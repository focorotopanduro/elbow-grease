/**
 * LOD Controller — distance-based level-of-detail for pipes.
 *
 * Three rendering tiers based on camera distance:
 *
 *   FULL (< 15 units):
 *     TubeGeometry with full radial/tubular segments
 *     Fittings visible, dimensions visible
 *
 *   REDUCED (15–25 units):
 *     TubeGeometry with tubularSegments: 4, radialSegments: 6
 *     Fittings hidden, dimensions hidden
 *
 *   WIREFRAME (> 25 units):
 *     Line geometry only, no tube mesh
 *     No fittings, no dimensions
 *
 * The controller computes LOD levels per batch group (spatial cell)
 * using the cell center distance to camera — not per-pipe.
 * This is O(groups) not O(pipes).
 */

import * as THREE from 'three';
import type { BatchGroup } from './GeometryBatcher';

// ── LOD levels ──────────────────────────────────────────────────

export type LODLevel = 'full' | 'reduced' | 'wireframe';

export interface LODThresholds {
  /** Distance below which full detail is used. */
  fullDist: number;
  /** Distance below which reduced detail is used. Above = wireframe. */
  reducedDist: number;
}

const DEFAULT_THRESHOLDS: LODThresholds = {
  fullDist: 15,
  reducedDist: 25,
};

// ── Geometry parameters per LOD level ───────────────────────────

export interface LODGeometryParams {
  tubularSegments: number;
  radialSegments: number;
  showFittings: boolean;
  showDimensions: boolean;
  useWireframe: boolean;
}

const LOD_PARAMS: Record<LODLevel, LODGeometryParams> = {
  full: {
    tubularSegments: 16,
    radialSegments: 12,
    showFittings: true,
    showDimensions: true,
    useWireframe: false,
  },
  reduced: {
    tubularSegments: 4,
    radialSegments: 6,
    showFittings: false,
    showDimensions: false,
    useWireframe: false,
  },
  wireframe: {
    tubularSegments: 2,
    radialSegments: 4,
    showFittings: false,
    showDimensions: false,
    useWireframe: true,
  },
};

// ── Controller ──────────────────────────────────────────────────

export class LODController {
  private thresholds: LODThresholds;
  private groupLevels = new Map<string, LODLevel>();
  private cameraPos = new THREE.Vector3();

  constructor(thresholds?: Partial<LODThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Update LOD levels for all batch groups.
   * Call once per frame with the current camera position.
   * Returns true if any group changed level (needs re-render).
   */
  update(cameraPosition: THREE.Vector3, groups: BatchGroup[]): boolean {
    this.cameraPos.copy(cameraPosition);
    let changed = false;

    for (const group of groups) {
      const dist = this.cameraPos.distanceTo(group.center);
      const level = this.classifyDistance(dist);
      const prev = this.groupLevels.get(group.key);

      if (prev !== level) {
        this.groupLevels.set(group.key, level);
        changed = true;
      }
    }

    return changed;
  }

  /** Get the LOD level for a specific group. */
  getLevel(groupKey: string): LODLevel {
    return this.groupLevels.get(groupKey) ?? 'full';
  }

  /** Get geometry parameters for a group's current LOD level. */
  getParams(groupKey: string): LODGeometryParams {
    return LOD_PARAMS[this.getLevel(groupKey)];
  }

  /** Get parameters for a specific LOD level. */
  static paramsFor(level: LODLevel): LODGeometryParams {
    return LOD_PARAMS[level];
  }

  /** Update distance thresholds at runtime. */
  setThresholds(thresholds: Partial<LODThresholds>): void {
    Object.assign(this.thresholds, thresholds);
  }

  // ── Internal ────────────────────────────────────────────────

  private classifyDistance(dist: number): LODLevel {
    if (dist <= this.thresholds.fullDist) return 'full';
    if (dist <= this.thresholds.reducedDist) return 'reduced';
    return 'wireframe';
  }
}
