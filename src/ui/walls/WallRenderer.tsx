/**
 * WallRenderer — batched wall rendering + click-click draw tool.
 *
 * Wall rendering delegates to `<InstancedWallMeshes />` which batches
 * every non-selected wall into at most 2 InstancedMesh draw calls + 2
 * merged-edge LineSegments. See `docs/adr/026-wall-instancing.md`.
 *
 * This outer component owns:
 *   • `showWallsGlobal` gating (skip all rendering when off).
 *   • `<DrawCatcher />` — ground-plane raycaster + click handler that
 *     captures the two points defining a new wall. This stays per-
 *     session state (no instancing relevant), so it keeps its own
 *     imperative implementation.
 *
 * The pre-instancing implementation rendered each wall as a separate
 * mesh + lineSegments pair (~2N draw calls for N walls). The new path
 * holds at ~2–5 draw calls regardless of wall count.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useWallStore, WALL_TYPE_META, snapPointToWall } from '@store/wallStore';
import { useFloorStore } from '@store/floorStore';
import { useInteractionStore } from '@store/interactionStore';
import { InstancedWallMeshes } from './InstancedWallMeshes';

// ── Draw-session preview + ground catcher ──────────────────────

function DrawCatcher() {
  const session = useWallStore((s) => s.drawSession);
  const placePoint = useWallStore((s) => s.placeWallPoint);
  const setPreview = useWallStore((s) => s.setWallPreview);
  const cancelDraw = useWallStore((s) => s.cancelWallDraw);
  const activeFloor = useFloorStore((s) => s.floors[s.activeFloorId]);
  const floorY = activeFloor?.elevationBase ?? 0;

  const { raycaster, camera, pointer, gl } = useThree();
  const plane = useRef(new THREE.Plane());
  const hit = useRef(new THREE.Vector3());

  // Recompute the plane equation whenever floorY changes
  useMemo(() => {
    plane.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, floorY, 0),
    );
  }, [floorY]);

  // Raycast cursor to the floor plane each frame for the preview line
  useFrame(() => {
    if (!session) return;
    raycaster.setFromCamera(pointer, camera);
    const h = raycaster.ray.intersectPlane(plane.current, hit.current);
    if (!h) return;
    const raw: [number, number] = [h.x, h.z];
    const snap = snapPointToWall(raw, 0.3);
    const pt: [number, number] = snap ? snap.point : snapGrid(raw, 0.25);
    // Only push preview if first point exists (preview line needs both ends)
    if (session.firstPoint) setPreview(pt);
  });

  // Window-level click handler — identical pattern to DrawInteraction,
  // bypasses R3F's competing raycast against other scene meshes.
  useEffect(() => {
    if (!session) return;
    const canvas = gl.domElement;
    if (!canvas) return;

    // Prevent pipe-draw mode from ALSO consuming the click — force
    // navigate mode while wall-draw is active.
    const prevMode = useInteractionStore.getState().mode;
    if (prevMode === 'draw') useInteractionStore.getState().setMode('navigate');

    const computePt = (): [number, number] | null => {
      raycaster.setFromCamera(pointer, camera);
      const h = raycaster.ray.intersectPlane(plane.current, hit.current);
      if (!h) return null;
      const raw: [number, number] = [h.x, h.z];
      const snap = snapPointToWall(raw, 0.3);
      return snap ? snap.point : snapGrid(raw, 0.25);
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Ignore clicks that originated on the HUD (UI buttons, panels)
      const target = e.target as HTMLElement;
      if (target && target.tagName !== 'CANVAS') return;
      const pt = computePt();
      if (!pt) return;
      placePoint(pt, floorY);
    };

    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      cancelDraw();
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDraw();
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onEsc);

    return () => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onEsc);
    };
  }, [session, gl, raycaster, camera, pointer, placePoint, cancelDraw, floorY]);

  if (!session) return null;

  return (
    <group>
      {/* First-point marker (yellow circle) */}
      {session.firstPoint && (
        <mesh position={[session.firstPoint[0], floorY + 0.05, session.firstPoint[1]]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.08, 16]} />
          <meshBasicMaterial color="#ffd54f" transparent opacity={0.9} toneMapped={false} />
        </mesh>
      )}

      {/* Preview segment from firstPoint → cursor */}
      {session.firstPoint && session.previewEnd && (
        <PreviewSegment
          a={[session.firstPoint[0], floorY + 0.02, session.firstPoint[1]]}
          b={[session.previewEnd[0], floorY + 0.02, session.previewEnd[1]]}
          type={session.type}
        />
      )}

      {/* Cursor crosshair while actively drawing — shows where next click lands */}
      {session.previewEnd && (
        <mesh position={[session.previewEnd[0], floorY + 0.03, session.previewEnd[1]]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.08, 0.12, 24]} />
          <meshBasicMaterial
            color={WALL_TYPE_META[session.type].color}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

function PreviewSegment({ a, b, type }: { a: [number, number, number]; b: [number, number, number]; type: keyof typeof WALL_TYPE_META }) {
  const meta = WALL_TYPE_META[type];
  const dx = b[0] - a[0], dz = b[2] - a[2];
  const length = Math.sqrt(dx * dx + dz * dz);
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2];
  const angle = Math.atan2(dz, dx);
  const thickness = meta.defaultThicknessFt;
  return (
    <group position={mid} rotation={[0, -angle, 0]}>
      <mesh>
        <boxGeometry args={[length, 0.02, thickness]} />
        <meshBasicMaterial color={meta.color} transparent opacity={0.55} toneMapped={false} />
      </mesh>
      {/* Length label could be added here */}
    </group>
  );
}

function snapGrid(p: [number, number], step: number): [number, number] {
  return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step];
}

// ── Main component ────────────────────────────────────────────

export function WallRenderer() {
  const show = useWallStore((s) => s.showWallsGlobal);

  // Note: the instanced meshes subscribe to wall + render-mode + cutaway
  // state internally. Keeping those subscriptions inside <InstancedWallMeshes>
  // means the outer WallRenderer only re-renders on the single cheap
  // showWallsGlobal toggle, not on every wall edit.

  if (!show) return (
    <>
      <DrawCatcher />
    </>
  );

  return (
    <group>
      <InstancedWallMeshes />
      <DrawCatcher />
    </group>
  );
}
