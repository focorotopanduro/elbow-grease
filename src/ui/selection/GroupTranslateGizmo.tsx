/**
 * GroupTranslateGizmo — Phase 14.O
 *
 * In-scene drag handle that translates the current multi-select in
 * the XZ plane. Sibling to GroupRotationGizmo (14.M): same activation
 * (multi-select ≥ 2), different interaction (translation vs rotation).
 *
 * Visual: a small diamond-ish handle (rotated cube + ring) at the
 * centroid. Clicking the handle starts a drag. During the drag:
 *
 *   bare move    → translate freely in XZ at the centroid's Y plane
 *   Shift held   → axis-constrained (whichever of X/Z had more motion)
 *   Ctrl held    → snap delta to 1 ft grid
 *
 * Fractals baked in:
 *   • A live delta readout (Billboard text above the handle) shows
 *     "+3.50 ft, +0.25 ft" so the user knows the exact offset.
 *   • Axis indicator: when Shift-constrained, a longer bar appears
 *     along the constrained axis making it obvious what's locked.
 *   • Ray-to-plane intersection happens against a plane at the
 *     centroid's Y, so the drag stays consistent even if the camera
 *     is angled steeply.
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Vec3 } from '@core/events';
import { usePlumbingMultiSelectStore } from '@store/plumbingMultiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  computeCentroid,
  beginTranslateDrag,
  dragToTranslation,
  translateGroup,
  type TranslateDragSession,
} from '@core/selection/groupTranslate';

const GRID_STEP_FT = 1; // Ctrl snap step — matches the world grid.
const HANDLE_Y_OFFSET = 0.12; // how far above the rotation ring the handle sits

export function GroupTranslateGizmo() {
  const pipeIdsMap = usePlumbingMultiSelectStore((s) => s.pipeIds);
  const fixtureIdsMap = usePlumbingMultiSelectStore((s) => s.fixtureIds);
  const pipes = usePipeStore((s) => s.pipes);
  const fixtures = useFixtureStore((s) => s.fixtures);
  const { raycaster, camera, gl } = useThree();

  const selectedPipeIds = Object.keys(pipeIdsMap);
  const selectedFixtureIds = Object.keys(fixtureIdsMap);
  const groupSize = selectedPipeIds.length + selectedFixtureIds.length;

  const { selPipes, selFixtures, centroid } = useMemo(() => {
    const sp = selectedPipeIds
      .map((id) => pipes[id])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, points: p.points as readonly Vec3[] }));
    const sf = selectedFixtureIds
      .map((id) => fixtures[id])
      .filter((f): f is NonNullable<typeof f> => !!f)
      .map((f) => ({ id: f.id, position: f.position as Vec3 }));
    const c = computeCentroid(sp, sf);
    return { selPipes: sp, selFixtures: sf, centroid: c };
  }, [selectedPipeIds.join(','), selectedFixtureIds.join(','), pipes, fixtures]);

  // Drag state — live during a drag, null otherwise.
  const sessionRef = useRef<TranslateDragSession | null>(null);
  const planeRef = useRef(new THREE.Plane());
  const hitRef = useRef(new THREE.Vector3());
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [liveDelta, setLiveDelta] = useState<Vec3>([0, 0, 0]);
  const [axisConstrained, setAxisConstrained] = useState(false);

  const ndcRef = useRef(new THREE.Vector2());
  // Ray-to-centroid-plane intersection. Returns null when the pointer
  // ray is parallel to the plane (grazing angle).
  const rayHit = useCallback((clientX: number, clientY: number, planeY: number): Vec3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    ndcRef.current.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndcRef.current, camera);
    planeRef.current.set(new THREE.Vector3(0, 1, 0), -planeY);
    const hit = raycaster.ray.intersectPlane(planeRef.current, hitRef.current);
    if (!hit) return null;
    return [hit.x, hit.y, hit.z];
  }, [raycaster, camera, gl]);

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!e.point) return;
      e.stopPropagation();
      const target = e.nativeEvent.target;
      if (target && 'setPointerCapture' in target) {
        try { (target as Element).setPointerCapture(e.nativeEvent.pointerId); } catch { /* fine */ }
      }
      // Anchor the drag plane at the centroid's Y. Project the initial
      // click through that plane so horizontal motion reads the same
      // regardless of camera angle.
      const startHit = rayHit(e.nativeEvent.clientX, e.nativeEvent.clientY, centroid[1]);
      if (!startHit) return;
      sessionRef.current = beginTranslateDrag(startHit, centroid);
      setDragging(true);
      setLiveDelta([0, 0, 0]);
      setAxisConstrained(false);
    },
    [centroid, rayHit],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const session = sessionRef.current;
      if (!session) return;
      const currentHit = rayHit(e.nativeEvent.clientX, e.nativeEvent.clientY, session.startCentroid[1]);
      if (!currentHit) return;
      const shift = e.nativeEvent.shiftKey;
      const ctrl = e.nativeEvent.ctrlKey;
      const opts = {
        constrainToAxis: shift,
        ...(ctrl ? { snapStep: GRID_STEP_FT } : {}),
      };
      const { delta } = dragToTranslation(session, currentHit, opts);

      // Compute delta SINCE LAST FRAME (not since start) so we apply
      // incrementally. The session's centroid tracks the user's
      // running total; we subtract to get the per-frame delta.
      const lastCentroid = session.startCentroid;
      const newCentroid: Vec3 = [
        session.startCentroid[0] + delta[0],
        session.startCentroid[1] + delta[1],
        session.startCentroid[2] + delta[2],
      ];
      // The actual per-frame delta is `newCentroid - currentCentroid`.
      // We cached the previous frame's delta in `liveDelta` — use
      // `delta − liveDelta` as the incremental move this frame.
      const frameDelta: Vec3 = [
        delta[0] - liveDelta[0],
        delta[1] - liveDelta[1],
        delta[2] - liveDelta[2],
      ];
      if (Math.abs(frameDelta[0]) < 0.001 && Math.abs(frameDelta[2]) < 0.001) {
        // Grid snap may produce zero-delta frames when the cursor is
        // between cells — leave the group + gizmo alone.
        return;
      }

      const pipeStore = usePipeStore.getState();
      const fixtureStore = useFixtureStore.getState();
      const transformed = translateGroup(
        { pipes: selPipes, fixtures: selFixtures },
        frameDelta,
      );
      for (const p of transformed.pipes) pipeStore.setPoints(p.id, p.points);
      for (const f of transformed.fixtures) fixtureStore.setPosition(f.id, f.position);

      // Mutate cached selection so the NEXT frame's centroid stays
      // coherent (the rotation gizmo uses the same pattern).
      for (let i = 0; i < selPipes.length; i++) {
        (selPipes as Array<{ id: string; points: Vec3[] }>)[i]!.points =
          transformed.pipes[i]!.points;
      }
      for (let i = 0; i < selFixtures.length; i++) {
        (selFixtures as Array<{ id: string; position: Vec3 }>)[i]!.position =
          transformed.fixtures[i]!.position;
      }

      setLiveDelta(delta);
      setAxisConstrained(shift);
      // Keep the session's startCentroid in sync so the readout above
      // the handle is "+X, +Z since start of drag."
      void lastCentroid; // referenced for clarity
      void newCentroid;
    },
    [selPipes, selFixtures, liveDelta, rayHit],
  );

  const endDrag = useCallback((e: ThreeEvent<PointerEvent>) => {
    sessionRef.current = null;
    setDragging(false);
    setLiveDelta([0, 0, 0]);
    setAxisConstrained(false);
    const target = e.nativeEvent.target;
    if (target && 'releasePointerCapture' in target) {
      try { (target as Element).releasePointerCapture(e.nativeEvent.pointerId); } catch { /* fine */ }
    }
  }, []);

  if (groupSize < 2) return null;

  const active = hovered || dragging;
  const handleColor = active ? '#00e5ff' : '#ffd54f';

  // Delta readout text: shows ±feet per axis, blank when idle.
  const deltaText = dragging && (Math.abs(liveDelta[0]) > 0.01 || Math.abs(liveDelta[2]) > 0.01)
    ? `${fmtDelta(liveDelta[0])} ft · ${fmtDelta(liveDelta[2])} ft`
    : null;

  return (
    <group position={[centroid[0], centroid[1] + HANDLE_Y_OFFSET, centroid[2]]}>
      {/* Translate handle — a pair of perpendicular bars forming a cross */}
      <mesh
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <boxGeometry args={[0.55, 0.1, 0.1]} />
        <meshBasicMaterial
          color={handleColor}
          transparent
          opacity={active ? 0.95 : 0.75}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh raycast={() => null}>
        <boxGeometry args={[0.1, 0.1, 0.55]} />
        <meshBasicMaterial
          color={handleColor}
          transparent
          opacity={active ? 0.95 : 0.75}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Axis indicator: elongated bar along the locked axis */}
      {dragging && axisConstrained && Math.abs(liveDelta[0]) >= Math.abs(liveDelta[2]) && (
        <mesh position={[0, 0, 0]} raycast={() => null}>
          <boxGeometry args={[3, 0.04, 0.04]} />
          <meshBasicMaterial color="#00e5ff" depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      {dragging && axisConstrained && Math.abs(liveDelta[2]) > Math.abs(liveDelta[0]) && (
        <mesh position={[0, 0, 0]} raycast={() => null}>
          <boxGeometry args={[0.04, 0.04, 3]} />
          <meshBasicMaterial color="#00e5ff" depthTest={false} depthWrite={false} toneMapped={false} />
        </mesh>
      )}

      {/* Live delta readout — billboard text above the handle */}
      {deltaText && (
        <Billboard position={[0, 0.6, 0]}>
          <Text
            fontSize={0.3}
            color="#00e5ff"
            outlineWidth={0.025}
            outlineColor="#0a0e18"
            anchorX="center"
            anchorY="middle"
          >
            {deltaText}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

function fmtDelta(n: number): string {
  if (Math.abs(n) < 0.005) return '0.00';
  const sign = n > 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(2)}`;
}
