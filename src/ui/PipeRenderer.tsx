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
// Phase 14.I — multi-select layer. Bare click = single-select (existing
// behavior). Shift+click = toggle into the multi-select set.
import { useMultiSelectStore } from '@store/multiSelectStore';
import { useInteractionStore } from '@store/interactionStore';
import { useFloorParams, type FloorRenderParams } from '@store/floorStore';
import { usePhaseFilter } from '@store/phaseStore';
import { shouldPhaseRender, PHASE_META } from '@core/phases/PhaseTypes';
import { classifyPipe } from '@core/phases/PhaseClassifier';
import { getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import type { PipeMaterial } from '../engine/graph/GraphEdge';
import { computeJunctionHints } from '@ui/pipe/junctionRetraction';
import {
  getPipeMaterial,
  getSelectedPipeMaterial,
  getWallShellMaterial,
  disposeAllMaterials,
} from '@ui/pipe/PipeMaterial';
import { PipeInstanceRenderer } from '@ui/pipe/perf/PipeInstanceRenderer';
import { buildPipeGeometry } from '@ui/pipe/buildPipeGeometry';
// mergeGeometries import removed along with the inline rigid-tube
// assembly that moved into buildPipeGeometry (Phase 14.AD.4).
import { mergePexRuns, type PipeRunGroup } from '@core/pipe/mergePexRuns';
import type { Vec3 } from '@core/events';

// ── Click dispatch (Phase 14.I + 14.M) ────────────────────────

/**
 * Pipe click handler that routes based on modifiers:
 *
 *   bare click          → clear multi-select + single-select this pipe
 *   Shift+click         → toggle this pipe in multi-select
 *   Alt+click           → remove this pipe from multi-select (14.M)
 *   Ctrl+Shift+click    → "select similar" — add every pipe with the
 *                         same material to multi-select (14.M)
 *
 * Alt takes precedence over Shift to give a clear "subtract" gesture
 * even when the user's Shift is still pressed from a prior add.
 */
function dispatchPipeClick(
  e: ThreeEvent<MouseEvent>,
  id: string,
  singleSelect: (id: string) => void,
): void {
  e.stopPropagation();
  const ne = e.nativeEvent;
  const multi = useMultiSelectStore.getState();

  if (ne.altKey) {
    // Subtract from selection.
    multi.removePipe(id);
    return;
  }
  if (ne.ctrlKey && ne.shiftKey) {
    // Select-similar: all pipes of the same material.
    const pipes = usePipeStore.getState().pipes;
    const thisPipe = pipes[id];
    if (!thisPipe) return;
    const matchingIds = Object.values(pipes)
      .filter((p) => p.material === thisPipe.material)
      .map((p) => p.id);
    multi.addMany(matchingIds, []);
    return;
  }
  if (ne.shiftKey) {
    multi.togglePipe(id);
    return;
  }
  // Bare click — single-select path.
  multi.clear();
  singleSelect(id);
}

// ── Per-pipe Y range (for floor membership) ────────────────────

/** Squared distance between two Vec3 tuples. Avoids sqrt in hot-path loops. */
function dist2(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function pipeYBounds(pipe: CommittedPipe): { min: number; max: number } {
  if (pipe.points.length === 0) return { min: 0, max: 0 };
  let min = pipe.points[0]![1], max = pipe.points[0]![1];
  for (const p of pipe.points) {
    if (p[1] < min) min = p[1];
    if (p[1] > max) max = p[1];
  }
  return { min, max };
}

// ── Merged PEX run (Phase 7.B) ──────────────────────────────────

/**
 * When two or more PEX pipes share endpoints at smooth bends, they
 * render as ONE continuous TubeGeometry spanning all member pipes.
 * The individual pipes retain their store identity + hitboxes; only
 * the VISUAL mesh is merged.
 *
 * Selection state: if ANY member pipe in the group is selected, the
 * whole run paints with the selected material. Simpler than splitting
 * the mesh at selection time, and matches the user's mental model —
 * clicking part of a "run" highlights the run you see.
 */
function MergedPexRun({
  group,
  anySelected,
  floorParams,
  onSelect,
}: {
  group: PipeRunGroup;
  anySelected: boolean;
  floorParams: FloorRenderParams;
  onSelect: (id: string) => void;
}) {
  const geometries = useMemo(() => {
    const vecs = group.mergedPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    if (vecs.length < 2) return null;
    const radius = getOuterRadiusFt(group.material, group.diameter);
    // Always flexible (PEX) — the classifier only merged smooth bends.
    // Higher tension (0.4) keeps the CatmullRom close to the anchor
    // points so grid-drawn geometry still reads as intentional.
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.4);
    const segs = Math.max(32, group.mergedPoints.length * 20);
    return {
      main: new THREE.TubeGeometry(curve, segs, radius, 24, false),
      wall: new THREE.TubeGeometry(curve, segs, radius * 1.08, 24, false),
      radius,
    };
  }, [group.mergedPoints, group.diameter, group.material]);

  useEffect(() => () => {
    geometries?.main.dispose();
    geometries?.wall.dispose();
  }, [geometries]);

  if (!geometries) return null;
  if (!floorParams.visible) return null;

  const mat = anySelected
    ? getSelectedPipeMaterial(group.diameter, group.material, group.system)
    : getPipeMaterial(group.diameter, group.material, group.system);
  const wallMat = getWallShellMaterial(group.diameter, group.material, group.system);

  const opacity = floorParams.opacity;
  const colorOverride = floorParams.colorOverride;
  const raycastDisabled = floorParams.disableInteraction;

  const mainMat = opacity < 1 || colorOverride ? ghostify(mat, opacity, colorOverride) : mat;
  const shellMat = opacity < 1 || colorOverride ? ghostify(wallMat, opacity * 0.5, colorOverride) : wallMat;

  // When the merged tube is clicked, select the LEAD pipe. Individual
  // pipe hitboxes (PipeHitboxes) still work for precise selection;
  // this is the fallback if the user clicks the visual tube.
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
          dispatchPipeClick(e, group.leadPipeId, onSelect);
        }}
      />
      <mesh geometry={geometries.wall} material={shellMat} raycast={() => null} />
      <EndCap
        position={group.mergedPoints[0]!}
        radius={geometries.radius}
        color={mainMat.color}
        opacity={opacity}
      />
      <EndCap
        position={group.mergedPoints[group.mergedPoints.length - 1]!}
        radius={geometries.radius}
        color={mainMat.color}
        opacity={opacity}
      />
    </group>
  );
}

// ── Full 3D pipe (TubeGeometry) ─────────────────────────────────

function FullPipe({
  pipe,
  onSelect,
  floorParams,
  retractStartFt = 0,
  retractEndFt = 0,
}: {
  pipe: CommittedPipe;
  onSelect: (id: string) => void;
  floorParams: FloorRenderParams;
  /**
   * Phase 14.AD.21 — per-endpoint retraction distance in feet.
   * junctionMap classifies the specific fitting at each endpoint
   * (elbow / coupling / tee / reducer / bushing / mid-branch) and
   * passes the exact amount the pipe should retract to meet the
   * fitting's hub mouth. 0 = free end.
   */
  retractStartFt?: number;
  retractEndFt?: number;
}) {
  const geometries = useMemo(
    () => buildPipeGeometry({
      points: pipe.points,
      diameter: pipe.diameter,
      material: pipe.material as PipeMaterial,
      retractStartFt,
      retractEndFt,
    }),
    [pipe.points, pipe.diameter, pipe.material, retractStartFt, retractEndFt],
  );

  useEffect(() => () => { geometries?.main.dispose(); geometries?.wall.dispose(); }, [geometries]);
  // Phase 14.I — multi-select highlighting. Subscribe per-pipe so only
  // pipes whose membership changes re-render, not every pipe when any
  // selection changes.
  const inMultiSelect = useMultiSelectStore((s) => s.pipeIds[pipe.id] === true);
  if (!geometries) return null;
  if (!floorParams.visible) return null;

  const isHighlighted = pipe.selected || inMultiSelect;
  const mat = isHighlighted
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

  // Phase 14.X — deterministic per-pipe render order. Two pipes at
  // IDENTICAL depth would z-fight and flicker unpredictably; giving
  // each pipe a unique, stable renderOrder derived from its ID hash
  // means Three.js picks a consistent winner each frame. Human-
  // invisible on its own (the painter's algorithm still respects
  // actual depth for non-coplanar pipes) but bulletproofs against
  // the "two pipes at the same Y" collision flicker.
  const renderOrder = pipeIdRenderOrder(pipe.id);

  return (
    <group>
      <mesh
        geometry={geometries.main}
        material={mainMat}
        castShadow={!raycastDisabled}
        receiveShadow
        renderOrder={renderOrder}
        raycast={raycastDisabled ? () => null : undefined}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (raycastDisabled) return;
          dispatchPipeClick(e, pipe.id, onSelect);
        }}
      />
      <mesh geometry={geometries.wall} material={shellMat} renderOrder={renderOrder} raycast={() => null} />
      <EndCap position={pipe.points[0]!} radius={geometries.radius} color={mainMat.color} opacity={opacity} />
      <EndCap position={pipe.points[pipe.points.length - 1]!} radius={geometries.radius} color={mainMat.color} opacity={opacity} />
    </group>
  );
}

/**
 * Phase 14.X — stable per-pipe renderOrder integer.
 * Maps a pipe id to a small integer in [0, 999] deterministically so
 * identical-depth pipes get tie-broken by a consistent ordering
 * rather than by Three.js's draw-call sequence (which can change
 * frame-to-frame under certain batching conditions).
 */
function pipeIdRenderOrder(id: string): number {
  // DJB2-ish string hash, modulo 1000. Good enough entropy; the
  // exact value doesn't matter, only that it's stable per pipe.
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 1000;
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
              onClick={(e: ThreeEvent<MouseEvent>) => dispatchPipeClick(e, pipe.id, onSelect)}>
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
  // Phase 14.I — subscribe so merged-run highlighting re-evaluates on
  // multi-select changes. The actual read is in the merged-run branch.
  const multiSelectPipeIds = useMultiSelectStore((s) => s.pipeIds);

  const visible = useMemo(
    () => Object.values(pipes).filter((p) => {
      if (!p.visible || !systemVis[p.system] || p.id === pivotingPipeId) return false;
      const autoPhase = classifyPipe(p);
      const effectivePhase = phaseFilter.pipeOverride(p.id) ?? autoPhase;
      return shouldPhaseRender(effectivePhase, phaseFilter.activePhase, phaseFilter.mode);
    }),
    [pipes, systemVis, pivotingPipeId, phaseFilter],
  );

  // Phase 7.B — pre-compute which pipes should render as merged PEX runs.
  // Recomputed only when the visible pipe set changes; output is stable
  // across identity-equal `visible` references.
  const merge = useMemo(() => mergePexRuns(visible), [visible]);

  // Phase 14.AD.21 — per-endpoint retraction map. Classification
  // logic lives in `junctionRetraction.ts` and is shared with the
  // fast-mode renderer.
  const junctionMap = useMemo(() => computeJunctionHints(visible), [visible]);

  useEffect(() => () => disposeAllMaterials(), []);
  if (visible.length === 0) return null;

  if (quality === '3d') {
    return (
      <group onPointerMissed={() => { selectPipe(null); useMultiSelectStore.getState().clear(); }}>
        {visible.map((pipe) => {
          const group = merge.byPipeId.get(pipe.id);
          // Merged-group member that is NOT the lead — skip rendering
          // its individual tube; the lead's MergedPexRun covers it.
          if (group && group.isMerged && group.leadPipeId !== pipe.id) return null;

          const { min, max } = pipeYBounds(pipe);
          const fp = getFloorParams(min, max);
          if (!fp.visible) return null;

          // Merged lead → render the group as one continuous tube.
          if (group && group.isMerged && group.leadPipeId === pipe.id) {
            // Phase 14.I — include multi-select members in "is this
            // run highlighted?" — `multiSelectPipeIds` comes from a
            // Zustand subscription at PipeRenderer scope so this
            // re-evaluates when the selection changes.
            const anySelected = group.pipeIds.some(
              (id) => pipes[id]?.selected || multiSelectPipeIds[id] === true,
            );
            return (
              <MergedPexRun
                key={`run-${group.leadPipeId}-${group.diameter}`}
                group={group}
                anySelected={anySelected}
                floorParams={fp}
                onSelect={selectPipe}
              />
            );
          }

          // Singleton — legacy per-pipe render path.
          const j = junctionMap.get(pipe.id);
          return (
            <FullPipe
              key={`${pipe.id}-${pipe.diameter}`}
              pipe={pipe}
              onSelect={selectPipe}
              floorParams={fp}
              retractStartFt={j?.retractStartFt ?? 0}
              retractEndFt={j?.retractEndFt ?? 0}
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
        <FullPipe
          pipe={selectedPipe}
          onSelect={selectPipe}
          floorParams={selectedFp}
          retractStartFt={junctionMap.get(selectedPipe.id)?.retractStartFt ?? 0}
          retractEndFt={junctionMap.get(selectedPipe.id)?.retractEndFt ?? 0}
        />
      )}
      <PipeClickTargets pipes={visible} onSelect={selectPipe} getFloorParams={getFloorParams} />
    </group>
  );
}
