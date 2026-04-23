/**
 * GroupRotationGizmo — Phase 14.M
 *
 * In-scene drag ring that rotates the current multi-select around its
 * centroid. Sibling component to FixtureRotationGizmo (14.F): same
 * interaction model (drag the ring in XZ, optional snap modifiers),
 * different scope (group of pipes + fixtures instead of one fixture).
 *
 * Rendered only when `useMultiSelectStore.count() >= 2`. The single-
 * item case keeps its existing per-fixture gizmo for continuity.
 *
 * Fractal extras (Phase 14.M polish):
 *   • A crosshair at the centroid marks the rotation pivot clearly.
 *   • Ring radius auto-scales to the selection's extent (so a
 *     10-fixture bathroom doesn't get a tiny toy-sized ring).
 *   • Reference tick at world +X anchors "0° is east" for the user.
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vec3 } from '@core/events';
import { useMultiSelectStore } from '@store/multiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  computeGroupCentroid,
  rotateGroupAroundY,
} from '@core/selection/groupRotation';
import {
  beginDrag,
  dragToRotation,
  snapStepFor,
  type GizmoDragSession,
  type RotationSnapMode,
} from '@core/fixtures/rotationGizmoMath';

export function GroupRotationGizmo() {
  // Per-entity subscriptions would over-render; one subscription to
  // the whole store keyed on .count() is cheaper and activates only
  // when multi-select actually changes.
  const pipeIdsMap = useMultiSelectStore((s) => s.pipeIds);
  const fixtureIdsMap = useMultiSelectStore((s) => s.fixtureIds);

  // Live reads of the actual geometry. Subscribe to both stores so
  // the gizmo moves when the selected entities move.
  const pipes = usePipeStore((s) => s.pipes);
  const fixtures = useFixtureStore((s) => s.fixtures);

  const selectedPipeIds = Object.keys(pipeIdsMap);
  const selectedFixtureIds = Object.keys(fixtureIdsMap);
  const groupSize = selectedPipeIds.length + selectedFixtureIds.length;

  // Build the rotation input data. Recomputes only when membership or
  // geometry changes.
  const { selPipes, selFixtures, centroid, ringRadius } = useMemo(() => {
    const sp = selectedPipeIds
      .map((id) => pipes[id])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, points: p.points }));
    const sf = selectedFixtureIds
      .map((id) => fixtures[id])
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({
        id: f.id,
        position: f.position,
        rotationDeg: Number(f.params['rotationDeg'] ?? 0),
      }));
    const c = computeGroupCentroid(sp, sf);
    // Auto-size the ring to the selection's footprint (plus a 0.75 ft
    // margin), with a sensible min + max so tiny + huge selections
    // both read well visually.
    let maxR = 0;
    for (const p of sp) for (const pt of p.points) {
      const dx = pt[0] - c[0], dz = pt[2] - c[2];
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > maxR) maxR = r;
    }
    for (const f of sf) {
      const dx = f.position[0] - c[0], dz = f.position[2] - c[2];
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r > maxR) maxR = r;
    }
    const radius = Math.max(1.4, Math.min(maxR + 0.75, 12));
    return { selPipes: sp, selFixtures: sf, centroid: c, ringRadius: radius };
  }, [selectedPipeIds.join(','), selectedFixtureIds.join(','), pipes, fixtures]);

  const sessionRef = useRef<GizmoDragSession | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const snapModeFor = (e: PointerEvent | ThreeEvent<PointerEvent>['nativeEvent']): RotationSnapMode => {
    if (e.ctrlKey) return 'cardinal';
    if (e.shiftKey) return 'fine';
    return 'default';
  };

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.point) return;
      e.stopPropagation();
      const target = e.nativeEvent.target;
      if (target && 'setPointerCapture' in target) {
        try { (target as Element).setPointerCapture(e.nativeEvent.pointerId); } catch { /* fine */ }
      }
      // Store.start = current fixture rotation is meaningless for a
      // group; we treat the starting "rotation" as 0 and let
      // dragToRotation return the delta directly.
      sessionRef.current = beginDrag(
        centroid,
        [e.point.x, e.point.y, e.point.z],
        0,
      );
      setDragging(true);
    },
    [centroid],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!sessionRef.current || !e.point) return;
      const step = snapStepFor(snapModeFor(e.nativeEvent));
      const newDeg = dragToRotation(
        sessionRef.current,
        centroid,
        [e.point.x, e.point.y, e.point.z],
        step,
      );
      // `newDeg` is the new orientation relative to the session start
      // (fixture-rotation start was 0 → newDeg IS the delta since
      // pointerDown). Apply the delta-since-last-frame, not
      // delta-since-start, so each move is incremental.
      //
      // Implementation: compare the "virtual fixture rotation" stored
      // in the session each frame. Initialize at 0; update in place.
      const prevDeg = (sessionRef.current as GizmoDragSession & { _lastDeg?: number })._lastDeg ?? 0;
      const frameDelta = newDeg - prevDeg;
      // Unwrap across the 360/0 boundary so a small CCW motion near 0
      // doesn't read as +355°.
      const normalizedFrame = ((frameDelta + 540) % 360) - 180;

      if (Math.abs(normalizedFrame) < 0.01) return;

      const pipeStore = usePipeStore.getState();
      const fixtureStore = useFixtureStore.getState();
      const result = rotateGroupAroundY(
        { pipes: selPipes, fixtures: selFixtures },
        centroid,
        normalizedFrame,
      );
      for (const p of result.pipes) pipeStore.setPoints(p.id, p.points);
      for (const f of result.fixtures) {
        fixtureStore.setPosition(f.id, f.position);
        fixtureStore.updateParam(f.id, 'rotationDeg', f.rotationDeg);
      }
      // IMPORTANT: after applying, update the cached selection to
      // the post-rotation state so the next frame's centroid stays
      // coherent. We mutate in place because this is a live drag.
      for (let i = 0; i < selPipes.length; i++) {
        (selPipes as Array<{ id: string; points: Vec3[] }>)[i]!.points = result.pipes[i]!.points;
      }
      for (let i = 0; i < selFixtures.length; i++) {
        const dst = (selFixtures as Array<{ id: string; position: Vec3; rotationDeg: number }>)[i]!;
        dst.position = result.fixtures[i]!.position;
        dst.rotationDeg = result.fixtures[i]!.rotationDeg;
      }
      (sessionRef.current as GizmoDragSession & { _lastDeg?: number })._lastDeg = newDeg;
    },
    [centroid, selPipes, selFixtures],
  );

  const endDrag = useCallback((e: ThreeEvent<PointerEvent>) => {
    sessionRef.current = null;
    setDragging(false);
    const target = e.nativeEvent.target;
    if (target && 'releasePointerCapture' in target) {
      try { (target as Element).releasePointerCapture(e.nativeEvent.pointerId); } catch { /* fine */ }
    }
  }, []);

  if (groupSize < 2) return null;

  const active = hovered || dragging;
  const ringColor = active ? '#00e5ff' : '#ffd54f';
  const ringOpacity = active ? 0.9 : 0.55;
  const ringRotation: [number, number, number] = [-Math.PI / 2, 0, 0];

  return (
    <group position={[centroid[0], centroid[1] + 0.04, centroid[2]]}>
      {/* Drag ring */}
      <mesh
        rotation={ringRotation}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <torusGeometry args={[ringRadius, 0.055, 12, 64]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={ringOpacity}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Centroid crosshair — shows the pivot pivot visually. */}
      <CentroidCrosshair />

      {/* Reference tick at world +X so the user always knows where 0° is. */}
      <mesh position={[ringRadius + 0.2, 0, 0]} raycast={() => null}>
        <boxGeometry args={[0.16, 0.025, 0.025]} />
        <meshBasicMaterial
          color="#7a8592"
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function CentroidCrosshair() {
  // Two thin orthogonal bars at y ≈ 0. `raycast: null` so the crosshair
  // never steals clicks from the ring.
  return (
    <>
      <mesh position={[0, 0, 0]} raycast={() => null}>
        <boxGeometry args={[0.35, 0.02, 0.02]} />
        <meshBasicMaterial
          color="#00e5ff"
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, 0]} raycast={() => null}>
        <boxGeometry args={[0.02, 0.02, 0.35]} />
        <meshBasicMaterial
          color="#00e5ff"
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}
