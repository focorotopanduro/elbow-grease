/**
 * FixtureRotationGizmo — Phase 14.F
 *
 * In-scene draggable rotation handle for the currently selected
 * fixture. Grab the ring, drag around, the fixture spins around its
 * Y axis. Snap modes via modifier keys:
 *
 *   (default)  5° snap
 *   Shift      1° snap (fine)
 *   Ctrl       90° snap (cardinal)
 *
 * Rendered at the fixture's world position but NOT inside the
 * rotated group — the ring stays world-axis-aligned so the user
 * can always tell where 0° (world +X) is. A small handle nub rotates
 * with the fixture's current orientation to show the current state.
 *
 * Pure math lives in `@core/fixtures/rotationGizmoMath` (24 tests).
 * This component is the R3F adapter around that.
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Vec3 } from '@core/events';
import {
  beginDrag,
  dragToRotation,
  snapStepFor,
  type GizmoDragSession,
  type RotationSnapMode,
} from '@core/fixtures/rotationGizmoMath';
import { useFixtureStore } from '@store/fixtureStore';

export interface FixtureRotationGizmoProps {
  fixtureId: string;
  /** Fixture world position. */
  position: Vec3;
  /** Current rotation in degrees. Drives the handle-nub placement. */
  currentRotationDeg: number;
  /** Ring radius in ft. Default 1.1 — sits just outside the body of
   *  typical fixtures (toilet ≈ 2×3, sink ≈ 1.5×2). */
  ringRadius?: number;
}

export function FixtureRotationGizmo({
  fixtureId,
  position,
  currentRotationDeg,
  ringRadius = 1.1,
}: FixtureRotationGizmoProps) {
  const updateParam = useFixtureStore((s) => s.updateParam);
  const sessionRef = useRef<GizmoDragSession | null>(null);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Ring is in the XZ plane — rotate the default torus (XY plane) by
  // -90° around X so its tube sweeps around the Y axis. Position it
  // just above the fixture's base (y+0.03) so it renders cleanly over
  // the floor / backdrop without z-fighting.
  const ringRotation = useMemo<[number, number, number]>(
    () => [-Math.PI / 2, 0, 0],
    [],
  );

  // Handle nub: small sphere at (r·cosθ, 0.03, r·sinθ) showing current
  // rotation direction. Moves as the fixture rotates.
  const handleOffset = useMemo<Vec3>(() => {
    const rad = (currentRotationDeg * Math.PI) / 180;
    return [Math.cos(rad) * ringRadius, 0.03, Math.sin(rad) * ringRadius];
  }, [currentRotationDeg, ringRadius]);

  // Modifier-to-snap mapping. Matches the keyboard shortcut convention
  // from `useFixtureRotationShortcuts`: Shift = fine, Ctrl = cardinal.
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
        try { (target as Element).setPointerCapture(e.nativeEvent.pointerId); }
        catch { /* some platforms reject pointer capture on fallback paths */ }
      }
      sessionRef.current = beginDrag(
        position,
        [e.point.x, e.point.y, e.point.z],
        currentRotationDeg,
      );
      setDragging(true);
    },
    [position, currentRotationDeg],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!sessionRef.current || !e.point) return;
      const step = snapStepFor(snapModeFor(e.nativeEvent));
      const next = dragToRotation(
        sessionRef.current,
        position,
        [e.point.x, e.point.y, e.point.z],
        step,
      );
      updateParam(fixtureId, 'rotationDeg', next);
    },
    [position, updateParam, fixtureId],
  );

  const endDrag = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      sessionRef.current = null;
      setDragging(false);
      const target = e.nativeEvent.target;
      if (target && 'releasePointerCapture' in target) {
        try { (target as Element).releasePointerCapture(e.nativeEvent.pointerId); }
        catch { /* already released */ }
      }
    },
    [],
  );

  const active = hovered || dragging;
  const ringColor = active ? '#00e5ff' : '#ffd54f';
  const ringOpacity = active ? 0.9 : 0.55;

  return (
    <group position={[position[0], position[1] + 0.03, position[2]]}>
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
        <torusGeometry args={[ringRadius, 0.045, 12, 48]} />
        <meshBasicMaterial
          color={ringColor}
          transparent
          opacity={ringOpacity}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Handle nub — tracks the fixture's current rotation */}
      <mesh position={handleOffset} raycast={() => null}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshBasicMaterial
          color="#ffd54f"
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Reference tick at world +X (0°) so user always sees where
          the origin is regardless of fixture rotation. */}
      <mesh position={[ringRadius + 0.15, 0, 0]} raycast={() => null}>
        <boxGeometry args={[0.12, 0.02, 0.02]} />
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
