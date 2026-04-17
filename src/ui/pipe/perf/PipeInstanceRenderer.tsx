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
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { usePipeStore, type CommittedPipe, getColorForDiameter } from '@store/pipeStore';
import { useLayerStore } from '@store/layerStore';
import { useFloorParams, type FloorRenderParams } from '@store/floorStore';
import { usePhaseFilter } from '@store/phaseStore';
import { shouldPhaseRender, PHASE_META } from '@core/phases/PhaseTypes';
import { classifyPipe } from '@core/phases/PhaseClassifier';
import { getPipeMaterial } from '../PipeMaterial';
import { getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

// ── Segment instance data ───────────────────────────────────────

interface SegmentInstance {
  pipeId: string;
  start: THREE.Vector3;
  end: THREE.Vector3;
  diameter: number;
  material: string;
  opacity: number;
  colorOverride: string | null;
}

function pipeYBoundsLocal(pipe: CommittedPipe): { min: number; max: number } {
  if (pipe.points.length === 0) return { min: 0, max: 0 };
  let min = pipe.points[0]![1], max = pipe.points[0]![1];
  for (const p of pipe.points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return { min, max };
}

function extractSegments(
  pipes: CommittedPipe[],
  getFloorParams: (yMin: number, yMax: number) => FloorRenderParams,
): Map<string, SegmentInstance[]> {
  // Bucket by diameter+ghost-state so ghosted pipes share a cloned material
  const buckets = new Map<string, SegmentInstance[]>();

  for (const pipe of pipes) {
    if (pipe.selected) continue;

    const { min, max } = pipeYBoundsLocal(pipe);
    const fp = getFloorParams(min, max);
    if (!fp.visible) continue;

    const ghostKey = fp.opacity < 1 || fp.colorOverride ? `g${fp.opacity.toFixed(2)}_${fp.colorOverride ?? ''}` : 'full';
    const bucketKey = `${pipe.diameter}__${pipe.material}__${ghostKey}`;

    if (!buckets.has(bucketKey)) buckets.set(bucketKey, []);
    const bucket = buckets.get(bucketKey)!;

    for (let i = 1; i < pipe.points.length; i++) {
      const start = new THREE.Vector3(...pipe.points[i - 1]!);
      const end = new THREE.Vector3(...pipe.points[i]!);

      bucket.push({
        pipeId: pipe.id,
        start,
        end,
        diameter: pipe.diameter,
        material: pipe.material,
        opacity: fp.opacity,
        colorOverride: fp.colorOverride,
      });
    }
  }

  return buckets;
}

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
  const systemVisibility = useLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();
  const phaseFilter = usePhaseFilter();

  const buckets = useMemo(() => {
    const visiblePipes = Object.values(pipes).filter((p) => {
      if (!p.visible || p.selected || !systemVisibility[p.system]) return false;
      const autoPhase = classifyPipe(p);
      const effectivePhase = phaseFilter.pipeOverride(p.id) ?? autoPhase;
      return shouldPhaseRender(effectivePhase, phaseFilter.activePhase, phaseFilter.mode);
    });
    return extractSegments(visiblePipes, getFloorParams);
  }, [pipes, systemVisibility, getFloorParams, phaseFilter]);

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
