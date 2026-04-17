/**
 * WallRenderer — 3D box per wall segment + click-click draw tool.
 *
 * Each wall is an extruded box oriented along its segment direction,
 * with thickness orthogonal. Colors come from WALL_TYPE_META.
 *
 * Uses the same floor-visibility and select-highlight logic as pipes:
 *   - Ghosted when off-floor (floor filter)
 *   - Selection glow when picked
 *
 * Drawing:
 *   - If wallStore.drawSession is active, an invisible ground plane
 *     catches pointer moves + clicks to add wall points
 *   - Live preview line from firstPoint → cursor
 *   - Escape cancels the chain
 *   - Right-click ends chain at the last point
 */

import { useEffect, useMemo, useRef } from 'react';
import { useThree, useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useWallStore, WALL_TYPE_META, type Wall, snapPointToWall } from '@store/wallStore';
import { useFloorStore, useFloorParams } from '@store/floorStore';
import { useInteractionStore } from '@store/interactionStore';

// ── Individual wall mesh ───────────────────────────────────────

function WallMesh({ wall, selected, onSelect }: { wall: Wall; selected: boolean; onSelect: () => void }) {
  const meta = WALL_TYPE_META[wall.type];
  const opacity = useWallStore((s) => s.wallOpacity);
  const getFloorParams = useFloorParams();

  const geom = useMemo(() => {
    const dx = wall.end[0] - wall.start[0];
    const dz = wall.end[1] - wall.start[1];
    const length = Math.sqrt(dx * dx + dz * dz);
    const g = new THREE.BoxGeometry(length, wall.height, wall.thickness);
    return g;
  }, [wall.start, wall.end, wall.thickness, wall.height]);

  const mid = useMemo(() => [
    (wall.start[0] + wall.end[0]) / 2,
    wall.floorY + wall.height / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ] as [number, number, number], [wall.start, wall.end, wall.floorY, wall.height]);

  const dx = wall.end[0] - wall.start[0];
  const dz = wall.end[1] - wall.start[1];
  const angle = Math.atan2(dz, dx);

  const fp = getFloorParams(wall.floorY, wall.floorY + wall.height);
  if (!fp.visible || wall.hidden) return null;
  const ghost = fp.opacity < 1;
  const effectiveOpacity = Math.max(0.06, opacity * (ghost ? 0.4 : 1));

  return (
    <group position={mid} rotation={[0, -angle, 0]}>
      <mesh
        geometry={geom}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); }}
      >
        <meshStandardMaterial
          color={meta.color}
          transparent
          opacity={effectiveOpacity}
          metalness={0.05}
          roughness={0.8}
          depthWrite={false}
        />
      </mesh>
      {/* Edge lines for clarity */}
      <lineSegments>
        <edgesGeometry args={[geom]} />
        <lineBasicMaterial
          color={selected ? '#ffd54f' : meta.color}
          transparent
          opacity={selected ? 0.95 : 0.55}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

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
  const walls = useWallStore((s) => s.walls);
  const selectedId = useWallStore((s) => s.selectedWallId);
  const selectWall = useWallStore((s) => s.selectWall);
  const show = useWallStore((s) => s.showWallsGlobal);

  if (!show) return (
    <>
      <DrawCatcher />
    </>
  );

  const list = Object.values(walls);

  return (
    <group>
      {list.map((w) => (
        <WallMesh
          key={w.id}
          wall={w}
          selected={w.id === selectedId}
          onSelect={() => selectWall(w.id)}
        />
      ))}
      <DrawCatcher />
    </group>
  );
}
