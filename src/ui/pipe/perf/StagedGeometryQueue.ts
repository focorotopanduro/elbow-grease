/**
 * Staged Geometry Queue — spreads geometry rebuilds across frames
 * to prevent frame spikes.
 *
 * When the solver resizes 200 pipes at once, rebuilding all 200
 * TubeGeometries in a single frame would cause a ~50ms freeze.
 * Instead, this queue processes up to `maxPerFrame` rebuilds per
 * frame, spreading the work across 10+ frames for a smooth 60fps.
 *
 * Priority ordering:
 *   1. Visible + selected pipes first
 *   2. Visible + on-screen (in frustum) second
 *   3. All others last
 */

import * as THREE from 'three';
import type { CommittedPipe } from '@store/pipeStore';
import type { BatchGroup } from './GeometryBatcher';
import { LODController } from './LODController';

// ── Rebuild request ─────────────────────────────────────────────

export interface RebuildRequest {
  /** Pipe ID or batch group key. */
  id: string;
  /** Priority: lower = rebuilt first. */
  priority: number;
  /** The pipe data needed to rebuild geometry. */
  pipe?: CommittedPipe;
  /** The batch group to rebuild (if batching). */
  group?: BatchGroup;
  /** Timestamp when this request was queued. */
  queuedAt: number;
}

// ── Queue ───────────────────────────────────────────────────────

export class StagedGeometryQueue {
  private queue: RebuildRequest[] = [];
  private maxPerFrame: number;
  private processing = false;

  /** Total rebuilds processed since creation. */
  totalProcessed = 0;
  /** Total rebuilds currently waiting. */
  get pending(): number { return this.queue.length; }

  constructor(maxPerFrame: number = 20) {
    this.maxPerFrame = maxPerFrame;
  }

  /** Enqueue a rebuild request. Deduplicates by ID. */
  enqueue(request: RebuildRequest): void {
    // Remove existing request for same ID (replace with new one)
    const idx = this.queue.findIndex((r) => r.id === request.id);
    if (idx >= 0) this.queue.splice(idx, 1);

    this.queue.push(request);

    // Sort by priority (ascending = higher priority first)
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  /** Enqueue multiple requests at once. */
  enqueueBatch(requests: RebuildRequest[]): void {
    for (const r of requests) this.enqueue(r);
  }

  /**
   * Process up to maxPerFrame rebuilds.
   * Returns the requests that were dequeued this frame.
   * The caller is responsible for actually rebuilding the geometry.
   */
  processFrame(): RebuildRequest[] {
    if (this.queue.length === 0) return [];

    const batch = this.queue.splice(0, this.maxPerFrame);
    this.totalProcessed += batch.length;
    return batch;
  }

  /** Check if there's pending work. */
  get hasPending(): boolean {
    return this.queue.length > 0;
  }

  /** Clear all pending requests. */
  clear(): void {
    this.queue = [];
  }

  /** Adjust the max rebuilds per frame (for adaptive performance). */
  setMaxPerFrame(max: number): void {
    this.maxPerFrame = Math.max(1, Math.min(100, max));
  }

  /** Get queue diagnostics. */
  getStats() {
    return {
      pending: this.queue.length,
      maxPerFrame: this.maxPerFrame,
      totalProcessed: this.totalProcessed,
      oldestQueuedMs: this.queue.length > 0
        ? performance.now() - this.queue[0]!.queuedAt
        : 0,
    };
  }
}

// ── Priority helpers ────────────────────────────────────────────

/**
 * Compute rebuild priority for a pipe.
 * Lower number = rebuilt first.
 */
export function computePriority(
  pipe: CommittedPipe,
  cameraPosition: THREE.Vector3,
  frustum: THREE.Frustum,
): number {
  // Selected pipes: highest priority
  if (pipe.selected) return 0;

  // Compute centroid
  let cx = 0, cy = 0, cz = 0;
  for (const p of pipe.points) {
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  const n = pipe.points.length || 1;
  const centroid = new THREE.Vector3(cx / n, cy / n, cz / n);

  // In frustum: medium priority (based on distance)
  const sphere = new THREE.Sphere(centroid, 2);
  if (frustum.intersectsSphere(sphere)) {
    const dist = cameraPosition.distanceTo(centroid);
    return 10 + Math.min(dist, 50); // 10-60 range
  }

  // Off-screen: lowest priority
  return 100;
}
