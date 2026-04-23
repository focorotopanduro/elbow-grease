/**
 * Segment Extract Cache — Phase 14.AC.2
 *
 * `PipeInstanceRenderer` previously rebuilt the entire segment
 * bucket map from scratch on every relevant store emission (pipes,
 * layer visibility, floor params, phase filter). The walk is
 * O(N pipes × M segments) and allocates THREE.Vector3 pairs per
 * segment — with 200 pipes on a multi-floor job it's visible in a
 * profile trace whenever the user toggles a layer or adds a single
 * new pipe.
 *
 * This module exposes a small stateful cache that keeps a per-pipe
 * entry (bucket key + pre-built segments) keyed on the pipe object's
 * identity. Zustand uses immutable updates by convention, so when a
 * pipe's fields change the store hands us a NEW CommittedPipe object
 * — identity is a safe change signal. Pipes whose reference is
 * unchanged reuse their cached entry verbatim.
 *
 * External gating inputs (systemVisibility map, getFloorParams fn,
 * phaseFilter object) are tracked by reference. If any of those
 * refs change, the whole cache is invalidated — they can affect
 * every pipe's visibility or bucket classification.
 *
 * Common cases and the work they do:
 *
 *   • Single pipe added   → 1 new slot computed, all others reused
 *   • Single pipe edited  → 1 slot recomputed, all others reused
 *   • Single pipe removed → 1 slot evicted, all others reused
 *   • Layer toggled       → full invalidation (whole gate changed)
 *   • Floor switched      → full invalidation (getFloorParams ref
 *                            changed; this may be more conservative
 *                            than strictly necessary — see notes)
 *   • Phase filter changed→ full invalidation
 *
 * Worst-case cost stays identical to the old behavior, so there is
 * no regression for layer-toggle-heavy flows.
 */

import * as THREE from 'three';
import type { CommittedPipe } from '@store/pipeStore';
import type { FloorRenderParams } from '@store/floorStore';
import type { SystemType } from '../../../engine/graph/GraphNode';
import { classifyPipe } from '@core/phases/PhaseClassifier';
import { shouldPhaseRender, type ConstructionPhase, type PhaseVisibilityMode } from '@core/phases/PhaseTypes';
import { recordSegmentCacheStats } from '@core/perf/PerfStats';
import { getSocketDepthFt, getBendCenterlineRadiusFt } from '@core/pipe/PipeStandards';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';
import { isFlexibleMaterial, getOuterDiameterFt } from '@core/pipe/PipeSizeSpec';

// ── Public types ──────────────────────────────────────────────

export interface SegmentInstance {
  pipeId: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  diameter: number;
  material: string;
  opacity: number;
  colorOverride: string | null;
}

/**
 * Phase 14.AD.8/21 — junction hints per pipe ID.
 *
 * AD.8: originally a pair of booleans signaling "retract this end
 * by socketDepth because there's a fitting here."
 *
 * AD.21: upgraded to NUMERIC retraction amounts (in feet). The
 * junctionMap classifies the specific fitting type at each
 * endpoint (coupling/reducer/tee/bushing/elbow/mid-branch) and
 * passes the exact distance the pipe needs to retract to meet the
 * fitting's hub mouth. Fixes the "pipe ends before the fitting"
 * visual gap that appeared when a fixed retraction amount was
 * used for every endpoint type.
 *
 * 0 = no retraction (free end). Flexible materials (PEX) ignore
 * hints entirely — they bend smoothly without fittings.
 */
export type JunctionHints = ReadonlyMap<string, { retractStartFt: number; retractEndFt: number }>;

/** The shared inputs that influence gating + bucket classification. */
export interface ExtractContext {
  systemVisibility: Partial<Record<SystemType, boolean>>;
  getFloorParams: (yMin: number, yMax: number) => FloorRenderParams;
  phaseFilter: {
    activePhase: ConstructionPhase;
    mode: PhaseVisibilityMode;
    pipeOverride: (id: string) => ConstructionPhase | undefined;
  };
  /**
   * Phase 14.AD.8 — optional. When supplied, segments for pipes
   * listed in the map get endpoint retraction applied so junction
   * fittings don't overlap the pipe body. Reference-equality
   * change on the map triggers cache invalidation (same rule as
   * other context fields).
   */
  junctionHints?: JunctionHints;
}

/** What a single pipe contributes (or null if it's gated out). */
export interface PipeEntry {
  pipeRef: CommittedPipe;
  bucketKey: string;
  segments: SegmentInstance[];
}

// ── Pure helpers ──────────────────────────────────────────────

function pipeYBounds(pipe: CommittedPipe): { min: number; max: number } {
  if (pipe.points.length === 0) return { min: 0, max: 0 };
  let min = pipe.points[0]![1], max = pipe.points[0]![1];
  for (const p of pipe.points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return { min, max };
}

/**
 * Evaluate the full visibility / bucket classification for one
 * pipe. Returns null if the pipe should NOT render (any gate failed).
 * Pure: same inputs → same outputs.
 */
export function buildPipeEntry(
  pipe: CommittedPipe,
  ctx: ExtractContext,
): PipeEntry | null {
  if (!pipe.visible || pipe.selected) return null;
  if (!ctx.systemVisibility[pipe.system]) return null;

  const autoPhase = classifyPipe(pipe);
  const effectivePhase = ctx.phaseFilter.pipeOverride(pipe.id) ?? autoPhase;
  if (!shouldPhaseRender(effectivePhase, ctx.phaseFilter.activePhase, ctx.phaseFilter.mode)) return null;

  const { min, max } = pipeYBounds(pipe);
  const fp = ctx.getFloorParams(min, max);
  if (!fp.visible) return null;

  const ghostKey = fp.opacity < 1 || fp.colorOverride
    ? `g${fp.opacity.toFixed(2)}_${fp.colorOverride ?? ''}`
    : 'full';
  const bucketKey = `${pipe.diameter}__${pipe.material}__${ghostKey}`;

  // Phase 14.AD.8 — retract at internal bend vertices + at endpoints
  // that are in a junction (per hints). Same logic as 3D-mode
  // `buildPipeGeometry` but applied to the InstancedMesh segment
  // coordinates so fast-mode rendering has identical visual
  // behaviour at bends + junctions. Skipped entirely for flexible
  // materials (PEX bends smoothly with no fittings to clear).
  const material = pipe.material as PipeMaterial;
  const isRigid = !isFlexibleMaterial(material);
  const socketDepth = isRigid ? getSocketDepthFt(material, pipe.diameter) : 0;
  // Phase 14.AD.19/21 — bend-radius-aware retraction using numeric hints.
  const pipeOdFt = isRigid ? getOuterDiameterFt(material, pipe.diameter) : 0;
  const hint = ctx.junctionHints?.get(pipe.id);
  const retractStartFt = isRigid ? (hint?.retractStartFt ?? 0) : 0;
  const retractEndFt = isRigid ? (hint?.retractEndFt ?? 0) : 0;
  const lastIdx = pipe.points.length - 1;

  // Pre-compute segment directions for per-vertex bend-angle lookup.
  const segDirs: THREE.Vector3[] = [];
  if (isRigid) {
    for (let i = 1; i < pipe.points.length; i++) {
      const d = new THREE.Vector3(
        pipe.points[i]![0] - pipe.points[i - 1]![0],
        pipe.points[i]![1] - pipe.points[i - 1]![1],
        pipe.points[i]![2] - pipe.points[i - 1]![2],
      );
      if (d.lengthSq() > 1e-8) d.normalize();
      segDirs.push(d);
    }
  }

  const bendRAt = (prev: THREE.Vector3, next: THREE.Vector3): number => {
    const cosAngle = Math.max(-1, Math.min(1, prev.dot(next)));
    const angleDeg = Math.acos(cosAngle) * 180 / Math.PI;
    if (angleDeg < 5) return 0;
    let bendKind: 'sixteenth' | 'eighth' | 'short_sweep';
    if (angleDeg < 30) bendKind = 'sixteenth';
    else if (angleDeg < 67.5) bendKind = 'eighth';
    else bendKind = 'short_sweep';
    return getBendCenterlineRadiusFt(material, pipeOdFt, bendKind);
  };

  const segments: SegmentInstance[] = [];
  for (let i = 1; i < pipe.points.length; i++) {
    const rawStart = new THREE.Vector3(...pipe.points[i - 1]!);
    const rawEnd = new THREE.Vector3(...pipe.points[i]!);

    let start = rawStart;
    let end = rawEnd;

    if (isRigid) {
      const segLen = rawStart.distanceTo(rawEnd);
      if (segLen > 0.0001) {
        // Endpoint retraction: use caller-provided distance (0 if
        // no fitting). Internal vertex: socketDepth + bendR at
        // the vertex's actual angle.
        const internalStart = i === 1
          ? retractStartFt
          : socketDepth + bendRAt(segDirs[i - 2]!, segDirs[i - 1]!);
        const internalEnd = i === lastIdx
          ? retractEndFt
          : socketDepth + bendRAt(segDirs[i - 1]!, segDirs[i]!);
        let startPullback = Math.min(internalStart, segLen / 2);
        let endPullback = Math.min(internalEnd, segLen / 2);

        // Bug-fix (user report "half the pipe is rendered"): mirror
        // the proportional-scale fix from buildPipeGeometry. If the
        // two pullbacks would collapse a short segment past zero,
        // scale them down so at least MIN_VISIBLE_FT of the segment
        // survives. Keeps the fast-mode instanced path visually
        // identical to 3D-mode when short segments are present.
        const MIN_VISIBLE_FT = 0.02;
        const maxPull = Math.max(0, segLen - MIN_VISIBLE_FT);
        const requested = startPullback + endPullback;
        if (requested > maxPull && requested > 0) {
          const scale = maxPull / requested;
          startPullback *= scale;
          endPullback *= scale;
        }

        if (segLen - startPullback - endPullback < 0.005) continue;

        const dir = new THREE.Vector3().subVectors(rawEnd, rawStart).normalize();
        start = rawStart.clone().addScaledVector(dir, startPullback);
        end = rawEnd.clone().addScaledVector(dir, -endPullback);
      }
    }

    segments.push({
      pipeId: pipe.id,
      start,
      end,
      diameter: pipe.diameter,
      material: pipe.material,
      opacity: fp.opacity,
      colorOverride: fp.colorOverride,
    });
  }

  return { pipeRef: pipe, bucketKey, segments };
}

// ── Stateful cache ────────────────────────────────────────────

/** Internal slot — remembers the pipe ref even for gated-out pipes so
 *  a re-gate only fires when the pipe actually mutates. */
interface Slot {
  pipeRef: CommittedPipe;
  entry: PipeEntry | null;
}

/**
 * Extract segment buckets for a set of committed pipes with
 * incremental re-use. Safe to keep in a React ref across
 * the lifetime of the renderer component; not thread-safe.
 */
export class SegmentExtractCache {
  private slots = new Map<string, Slot>();
  private prevCtx: ExtractContext | null = null;

  /** Diagnostic counters — reset at the start of each `extract` call. */
  public lastHits = 0;
  public lastMisses = 0;
  public lastEvictions = 0;

  /** Force a full invalidation on the next extract. Useful for tests
   *  and for external callers that know they've mutated upstream state
   *  in a way we can't detect (we don't currently have any such case). */
  invalidate(): void {
    this.slots.clear();
    this.prevCtx = null;
  }

  /** Number of cached slots — exposed for instrumentation / tests. */
  get size(): number {
    return this.slots.size;
  }

  /**
   * Build the bucket map for the currently-visible pipes, reusing
   * cache entries where possible.
   *
   * @param pipes  Record keyed by pipe id (Zustand store shape).
   * @param ctx    External gate inputs (by reference — must be stable
   *               across calls when unchanged).
   */
  extract(
    pipes: Record<string, CommittedPipe>,
    ctx: ExtractContext,
  ): Map<string, SegmentInstance[]> {
    this.lastHits = 0;
    this.lastMisses = 0;
    this.lastEvictions = 0;

    // If any external gate input changed by reference, the whole
    // cache is suspect — any pipe could have moved buckets or
    // become visible/invisible. Phase 14.AD.8 adds junctionHints
    // to the comparison: a different map means a pipe's endpoint
    // joined or left a junction cluster, which changes its
    // segment coordinates.
    const ctxChanged =
      !this.prevCtx
      || this.prevCtx.systemVisibility !== ctx.systemVisibility
      || this.prevCtx.getFloorParams !== ctx.getFloorParams
      || this.prevCtx.phaseFilter !== ctx.phaseFilter
      || this.prevCtx.junctionHints !== ctx.junctionHints;
    if (ctxChanged) {
      this.slots.clear();
      this.prevCtx = ctx;
    }

    // Walk incoming pipes; reuse slot if ref unchanged, else rebuild.
    const alive = new Set<string>();
    for (const id in pipes) {
      const pipe = pipes[id]!;
      alive.add(id);
      const slot = this.slots.get(id);
      if (slot && slot.pipeRef === pipe) {
        this.lastHits++;
        continue;
      }
      this.lastMisses++;
      this.slots.set(id, { pipeRef: pipe, entry: buildPipeEntry(pipe, ctx) });
    }

    // Evict slots for pipes no longer present.
    for (const id of [...this.slots.keys()]) {
      if (!alive.has(id)) {
        this.slots.delete(id);
        this.lastEvictions++;
      }
    }

    // Assemble bucket map.
    const buckets = new Map<string, SegmentInstance[]>();
    for (const slot of this.slots.values()) {
      const entry = slot.entry;
      if (!entry) continue;
      let bucket = buckets.get(entry.bucketKey);
      if (!bucket) {
        bucket = [];
        buckets.set(entry.bucketKey, bucket);
      }
      for (const s of entry.segments) bucket.push(s);
    }

    // Surface the hit / miss split to the PerfHUD (Phase 14.AC.4).
    // Two integer adds — cheap enough to always run.
    recordSegmentCacheStats(this.lastHits, this.lastMisses);

    return buckets;
  }
}
