/**
 * Pipe Instance Renderer — InstancedMesh for straight pipe segments.
 *
 * ECBS routes on a grid produce mostly axis-aligned straight runs
 * with right-angle turns. Each straight segment between two points
 * is rendered as a cylinder instance rather than a TubeGeometry.
 *
 * Benefits:
 *   - One InstancedMesh per diameter bucket (vs one mesh per pipe)
 *   - Instance matrix update is O(1) per segment (vs O(N) geometry rebuild)
 *   - Cylinder geometry is shared across all instances (GPU memory saving)
 *
 * TubeGeometry is reserved for selected/highlighted pipes where
 * smooth curve rendering matters. All other pipes use this renderer.
 */

import { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { usePipeStore } from '@store/pipeStore';
import { usePlumbingLayerStore } from '@store/plumbingLayerStore';
import { useFloorParams } from '@store/floorStore';
import { usePhaseFilter } from '@store/phaseStore';
import { getPipeMaterial } from '../PipeMaterial';
import { getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';
import { SegmentExtractCache, type SegmentInstance as CachedSegmentInstance } from './segmentExtractCache';
import { computeJunctionHints } from '../junctionRetraction';

// ── Segment instance data ───────────────────────────────────────
// Keep a local alias so the rest of this file doesn't need to be
// rewritten when we pull the extract logic out into a cache module.
// Phase 14.AC.2 moved the walk to SegmentExtractCache — see
// `./segmentExtractCache` for the cached implementation.

type SegmentInstance = CachedSegmentInstance;

// ── Unit cylinder geometry (shared) ─────────────────────────────

const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
// Rotate so cylinder axis is along Z (default is Y)
unitCylinder.rotateX(Math.PI / 2);

// ── Instanced bucket renderer ───────────────────────────────────

function InstancedBucket({
  diameter,
  segments,
  pipeMaterial,
}: {
  diameter: number;
  segments: SegmentInstance[];
  pipeMaterial: string;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const sample = segments[0];
  const ghosted = sample && (sample.opacity < 1 || sample.colorOverride);

  const material = useMemo(() => {
    const base = getPipeMaterial(diameter, pipeMaterial);
    if (!ghosted) return base;
    const clone = base.clone();
    clone.transparent = true;
    clone.opacity = Math.max(0.02, sample!.opacity);
    clone.depthWrite = sample!.opacity > 0.85;
    if (sample!.colorOverride) {
      clone.color = new THREE.Color(sample!.colorOverride);
      clone.emissive = new THREE.Color(sample!.colorOverride).multiplyScalar(0.05);
    }
    return clone;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diameter, pipeMaterial, ghosted, sample?.opacity, sample?.colorOverride]);

  useEffect(() => {
    if (!meshRef.current || segments.length === 0) return;

    // Real OD in feet — accurate relative sizing across materials.
    const radius = getOuterRadiusFt(pipeMaterial as PipeMaterial, diameter);

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const mid = new THREE.Vector3().addVectors(seg.start, seg.end).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(seg.end, seg.start);
      const length = dir.length();

      dummy.position.copy(mid);
      dummy.scale.set(radius, radius, length);

      // Orient cylinder along segment direction
      if (length > 0.001) {
        dummy.lookAt(seg.end);
      }

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [segments, diameter, dummy]);

  if (segments.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[unitCylinder, material, segments.length]}
      castShadow
      receiveShadow
      frustumCulled
    />
  );
}

// ── Main component ──────────────────────────────────────────────

export function PipeInstanceRenderer() {
  const pipes = usePipeStore((s) => s.pipes);
  const systemVisibility = usePlumbingLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();
  const phaseFilter = usePhaseFilter();

  // Cache persists across re-renders; useMemo still re-runs on dep
  // change, but the cache's per-pipe identity check means unchanged
  // pipes keep their pre-built segments. Single-pipe mutations now
  // do O(1) work instead of O(N) regardless of total pipe count.
  // (Phase 14.AC.2.)
  const cacheRef = useRef<SegmentExtractCache | null>(null);
  if (cacheRef.current === null) cacheRef.current = new SegmentExtractCache();

  // Phase 14.AD.8/21 — per-endpoint retraction hints. Classification
  // logic lives in `junctionRetraction.ts` and produces numeric
  // distances per endpoint based on the specific fitting (coupling,
  // elbow, tee, reducer, bushing, mid-branch). Same helper is used
  // by the 3D-mode PipeRenderer so the two render paths stay in sync.
  const junctionHints = useMemo(
    () => computeJunctionHints(Object.values(pipes)),
    [pipes],
  );

  const buckets = useMemo(() => {
    return cacheRef.current!.extract(pipes, {
      systemVisibility,
      getFloorParams,
      phaseFilter,
      junctionHints,
    });
  }, [pipes, systemVisibility, getFloorParams, phaseFilter, junctionHints]);

  if (buckets.size === 0) return null;

  return (
    <group>
      {[...buckets.entries()].map(([bucketKey, segments]) => (
        <InstancedBucket
          key={bucketKey}
          diameter={segments[0]?.diameter ?? 2}
          segments={segments}
          pipeMaterial={segments[0]?.material ?? 'pvc_sch40'}
        />
      ))}
    </group>
  );
}
