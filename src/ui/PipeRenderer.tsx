/**
 * PipeRenderer — two quality modes:
 *   3D   → full TubeGeometry for every pipe (thick, smooth, realistic)
 *   Fast → InstancedMesh cylinders (lightweight for 500+ pipes)
 *
 * Toggled via the toolbar "3D Pipes" button or the Q key.
 */

import { useEffect, useMemo } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { useLayerStore } from '@store/layerStore';
import { useInteractionStore } from '@store/interactionStore';
import { useFloorParams, type FloorRenderParams } from '@store/floorStore';
import { usePhaseFilter } from '@store/phaseStore';
import { shouldPhaseRender, PHASE_META } from '@core/phases/PhaseTypes';
import { classifyPipe } from '@core/phases/PhaseClassifier';
import { getOuterRadiusFt, isFlexibleMaterial } from '@core/pipe/PipeSizeSpec';
import type { PipeMaterial } from '../engine/graph/GraphEdge';
import {
  getPipeMaterial,
  getSelectedPipeMaterial,
  getWallShellMaterial,
  disposeAllMaterials,
} from '@ui/pipe/PipeMaterial';
import { PipeInstanceRenderer } from '@ui/pipe/perf/PipeInstanceRenderer';

// ── Per-pipe Y range (for floor membership) ────────────────────

function pipeYBounds(pipe: CommittedPipe): { min: number; max: number } {
  if (pipe.points.length === 0) return { min: 0, max: 0 };
  let min = pipe.points[0]![1], max = pipe.points[0]![1];
  for (const p of pipe.points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return { min, max };
}

// ── Full 3D pipe (TubeGeometry) ─────────────────────────────────

function FullPipe({
  pipe,
  onSelect,
  floorParams,
}: {
  pipe: CommittedPipe;
  onSelect: (id: string) => void;
  floorParams: FloorRenderParams;
}) {
  const geometries = useMemo(() => {
    const vecs = pipe.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (vecs.length < 2) return null;

    // Real-world outside radius (feet) — 2" PVC actually measures 2.375"
    // OD, 2" PEX measures 2.125" OD. Using the nominal size as the
    // rendered radius under-represents PVC and over-represents nothing
    // proportionally. Accurate OD means a 1/2" PEX line next to a 1/2"
    // copper line reads correctly in 3D.
    const radius = getOuterRadiusFt(pipe.material as PipeMaterial, pipe.diameter);

    // Rigid pipe is straight between fittings (crisp hospital corners).
    // Flexible pipe (PEX) bends smoothly — use a Catmull-Rom spline so
    // the tube curves naturally around the bend radius instead of
    // having visible hard corners with no elbow fitting beneath them.
    const flexible = isFlexibleMaterial(pipe.material as PipeMaterial);
    let curve: THREE.Curve<THREE.Vector3>;
    let segs: number;

    if (flexible) {
      curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.4);
      // Much higher for silky PEX curves (memo'd — no per-frame cost)
      segs = Math.max(32, pipe.points.length * 24);
    } else {
      const cp = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < vecs.length; i++) {
        cp.add(new THREE.LineCurve3(vecs[i - 1]!, vecs[i]!));
      }
      curve = cp;
      // Rigid pipes are straight — 4 segs per run is more than enough
      segs = Math.max(4, (pipe.points.length - 1) * 4);
    }

    return {
      // Radial segments bumped: rigid pipes → 20, flexible (PEX) → 24
      // for perfectly round curves. Single build per pipe (memo'd),
      // so no per-frame cost.
      main: new THREE.TubeGeometry(curve, segs, radius, flexible ? 24 : 20, false),
      wall: new THREE.TubeGeometry(curve, segs, radius * 1.08, flexible ? 24 : 20, false),
      radius,
    };
  }, [pipe.points, pipe.diameter, pipe.material]);

  useEffect(() => () => { geometries?.main.dispose(); geometries?.wall.dispose(); }, [geometries]);
  if (!geometries) return null;
  if (!floorParams.visible) return null;

  const mat = pipe.selected
    ? getSelectedPipeMaterial(pipe.diameter, pipe.material, pipe.system)
    : getPipeMaterial(pipe.diameter, pipe.material, pipe.system);
  const wallMat = getWallShellMaterial(pipe.diameter, pipe.material, pipe.system);

  // Floor-aware visual override (ghost fade / color override)
  const opacity = floorParams.opacity;
  const colorOverride = floorParams.colorOverride;
  const raycastDisabled = floorParams.disableInteraction;

  // Clone materials when ghosting so we don't mutate the cached ones
  const mainMat = opacity < 1 || colorOverride ? ghostify(mat, opacity, colorOverride) : mat;
  const shellMat = opacity < 1 || colorOverride ? ghostify(wallMat, opacity * 0.5, colorOverride) : wallMat;

  return (
    <group>
      <mesh
        geometry={geometries.main}
        material={mainMat}
        castShadow={!raycastDisabled}
        receiveShadow
        raycast={raycastDisabled ? () => null : undefined}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (raycastDisabled) return;
          e.stopPropagation();
          onSelect(pipe.id);
        }}
      />
      <mesh geometry={geometries.wall} material={shellMat} raycast={() => null} />
      <EndCap position={pipe.points[0]!} radius={geometries.radius} color={mainMat.color} opacity={opacity} />
      <EndCap position={pipe.points[pipe.points.length - 1]!} radius={geometries.radius} color={mainMat.color} opacity={opacity} />
    </group>
  );
}

// Create a transient ghosted clone of a cached material
function ghostify(
  base: THREE.MeshStandardMaterial,
  opacity: number,
  colorOverride: string | null,
): THREE.MeshStandardMaterial {
  const clone = base.clone();
  clone.transparent = true;
  clone.opacity = Math.max(0.02, opacity);
  clone.depthWrite = opacity > 0.85;
  if (colorOverride) {
    clone.color = new THREE.Color(colorOverride);
    clone.emissive = new THREE.Color(colorOverride).multiplyScalar(0.05);
  }
  return clone;
}

function EndCap({
  position,
  radius,
  color,
  opacity = 1,
}: {
  position: [number, number, number];
  radius: number;
  color: THREE.Color;
  opacity?: number;
}) {
  return (
    <mesh position={position} raycast={() => null}>
      <circleGeometry args={[radius, 16]} />
      <meshStandardMaterial
        color={color}
        metalness={0.4}
        roughness={0.3}
        side={THREE.DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

// ── Click targets for fast mode ─────────────────────────────────

function PipeClickTargets({
  pipes,
  onSelect,
  getFloorParams,
}: {
  pipes: CommittedPipe[];
  onSelect: (id: string) => void;
  getFloorParams: (yMin: number, yMax: number) => FloorRenderParams;
}) {
  return (
    <group>
      {pipes.map((pipe) => {
        if (pipe.selected) return null;
        const { min, max } = pipeYBounds(pipe);
        const fp = getFloorParams(min, max);
        if (!fp.visible || fp.disableInteraction) return null;
        return pipe.points.slice(1).map((pt, i) => {
          const prev = pipe.points[i]!;
          const mid: [number, number, number] = [(prev[0]+pt[0])/2, (prev[1]+pt[1])/2, (prev[2]+pt[2])/2];
          const dx = pt[0]-prev[0], dy = pt[1]-prev[1], dz = pt[2]-prev[2];
          if (Math.sqrt(dx*dx+dy*dy+dz*dz) < 0.01) return null;
          return (
            <mesh key={`${pipe.id}-ht-${i}`} position={mid} visible={false}
              onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(pipe.id); }}>
              <boxGeometry args={[Math.max(Math.abs(dx),0.2), Math.max(Math.abs(dy),0.2), Math.max(Math.abs(dz),0.2)]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

// ── Main renderer ───────────────────────────────────────────────

export function PipeRenderer() {
  const pipes = usePipeStore((s) => s.pipes);
  const selectPipe = usePipeStore((s) => s.selectPipe);
  const selectedId = usePipeStore((s) => s.selectedId);
  const systemVis = useLayerStore((s) => s.systems);
  const quality = useInteractionStore((s) => s.pipeQuality);
  const pivotingPipeId = usePipeStore((s) => s.pivotSession?.pipeId ?? null);
  const getFloorParams = useFloorParams();
  const phaseFilter = usePhaseFilter();

  const visible = useMemo(
    () => Object.values(pipes).filter((p) => {
      if (!p.visible || !systemVis[p.system] || p.id === pivotingPipeId) return false;
      const autoPhase = classifyPipe(p);
      const effectivePhase = phaseFilter.pipeOverride(p.id) ?? autoPhase;
      return shouldPhaseRender(effectivePhase, phaseFilter.activePhase, phaseFilter.mode);
    }),
    [pipes, systemVis, pivotingPipeId, phaseFilter],
  );

  useEffect(() => () => disposeAllMaterials(), []);
  if (visible.length === 0) return null;

  if (quality === '3d') {
    return (
      <group onPointerMissed={() => selectPipe(null)}>
        {visible.map((pipe) => {
          const { min, max } = pipeYBounds(pipe);
          const fp = getFloorParams(min, max);
          if (!fp.visible) return null;
          return (
            <FullPipe
              key={`${pipe.id}-${pipe.diameter}`}
              pipe={pipe}
              onSelect={selectPipe}
              floorParams={fp}
            />
          );
        })}
      </group>
    );
  }

  const selectedPipe = selectedId ? pipes[selectedId] : null;
  const selectedFp = selectedPipe
    ? (() => {
        const { min, max } = pipeYBounds(selectedPipe);
        return getFloorParams(min, max);
      })()
    : null;

  return (
    <group onPointerMissed={() => selectPipe(null)}>
      <PipeInstanceRenderer />
      {selectedPipe && selectedPipe.visible && systemVis[selectedPipe.system] && selectedFp && selectedFp.visible && (
        <FullPipe pipe={selectedPipe} onSelect={selectPipe} floorParams={selectedFp} />
      )}
      <PipeClickTargets pipes={visible} onSelect={selectPipe} getFloorParams={getFloorParams} />
    </group>
  );
}
