/**
 * SectionDragInteraction — Phase 14.R.8.
 *
 * Scene-level catcher that drives drag-to-move for roof sections.
 * Only mounts — and only intercepts pointer events — when the
 * `roofingSectionDragStore` is in `'dragging'` mode, which flips on
 * from a `pointerdown` on a section mesh (handled in
 * `RoofSection3D`). Keeps the catcher inert for the 99.9% of
 * frames where no drag is in progress, so OrbitControls + the
 * other roofing interaction layers see their pointer events
 * unaltered.
 *
 * Coordinates match the rest of the roofing stack: ground plane
 * is XZ, with e.point.x → plan-X and e.point.z → plan-Y (see the
 * comments in `RoofSection3D.tsx` for why we remap).
 *
 * Escape while dragging → abort. The section snaps back to its
 * starting position (we restore from `sectionStart` captured at
 * the drag's pointer-down).
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useRoofingSectionDragStore,
  dragDelta,
  type GroundPoint,
} from '@store/roofingSectionDragStore';
import { useRoofStore } from '@store/roofStore';

const GRID_SNAP_FT = 0.5;

function pointerToGround(e: ThreeEvent<PointerEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return [p.x, p.z];
}

export function SectionDragInteraction() {
  const mode = useRoofingSectionDragStore((s) => s.mode);
  const sectionId = useRoofingSectionDragStore((s) => s.sectionId);
  const pointerStart = useRoofingSectionDragStore((s) => s.pointerStart);
  const sectionStart = useRoofingSectionDragStore((s) => s.sectionStart);
  const endDrag = useRoofingSectionDragStore((s) => s.endDrag);

  const gl = useThree((s) => s.gl);

  // Show a 'grabbing' cursor while the drag is live so the user
  // sees the interaction model change mid-motion.
  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;
    if (mode === 'dragging') {
      canvas.style.setProperty('cursor', 'grabbing', 'important');
    } else {
      canvas.style.removeProperty('cursor');
    }
    return () => { canvas.style.removeProperty('cursor'); };
  }, [mode, gl]);

  // Escape aborts. Restores the section to its pre-drag position
  // and clears the store.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useRoofingSectionDragStore.getState();
      if (st.mode !== 'dragging') return;
      // Snap back.
      if (st.sectionId && st.sectionStart) {
        useRoofStore.getState().moveSection(
          st.sectionId,
          st.sectionStart[0],
          st.sectionStart[1],
        );
      }
      endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endDrag]);

  if (mode !== 'dragging' || !sectionId || !pointerStart || !sectionStart) {
    return null;
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const cur = pointerToGround(e);
    const next = dragDelta(pointerStart, sectionStart, cur, GRID_SNAP_FT);
    useRoofStore.getState().moveSection(sectionId, next.x, next.y);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    endDrag();
  };

  const handlePointerLeave = () => {
    // Drop out of the catcher gracefully if the pointer exits the
    // canvas. Matches the "release on window blur" pattern used by
    // the navigation-freeze handler.
    endDrag();
  };

  return (
    <mesh
      position={[0, 0.003, 0]}
      rotation-x={-Math.PI / 2}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <planeGeometry args={[500, 500]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        visible={false}
      />
    </mesh>
  );
}
