/**
 * VertexDragInteraction — Phase 14.R.18.
 *
 * Scene-level ground-plane catcher for polygon-vertex dragging.
 * Mounts ONLY during the 'dragging' state of `roofingVertexDragStore`
 * so it has zero cost when no drag is active. While active:
 *
 *   pointer-move → compute new vertex world position via
 *                  R.8's `dragDelta` (delta from pointerStart +
 *                  vertexStart anchor + grid snap), call
 *                  `updatePolygonVertexLive` (no undo push).
 *   pointer-up   → commit by pushing the pre-drag snapshot onto
 *                  undoStack (one entry per drag), then endDrag.
 *   pointer-leave → same as pointer-up (graceful release when
 *                  dragging off the canvas).
 *   Escape       → restore the vertex to its pre-drag position via
 *                  updatePolygonVertexLive(vertexStart) and end the
 *                  drag WITHOUT pushing undo.
 *
 * Cursor becomes `grabbing` while the drag is live.
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useRoofingVertexDragStore,
  type GroundPoint,
} from '@store/roofingVertexDragStore';
import { useRoofStore } from '@store/roofStore';
import { dragDelta } from '@store/roofingDragStore';

const GRID_SNAP_FT = 0.5;

function pointerToGround(e: ThreeEvent<PointerEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return [p.x, p.z];
}

export function VertexDragInteraction() {
  const mode = useRoofingVertexDragStore((s) => s.mode);
  const sectionId = useRoofingVertexDragStore((s) => s.sectionId);
  const vertexIdx = useRoofingVertexDragStore((s) => s.vertexIdx);
  const pointerStart = useRoofingVertexDragStore((s) => s.pointerStart);
  const vertexStart = useRoofingVertexDragStore((s) => s.vertexStart);
  const endDrag = useRoofingVertexDragStore((s) => s.endDrag);

  const gl = useThree((s) => s.gl);

  // Cursor feedback.
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

  // Escape aborts — restores the vertex to its pre-drag position and
  // ends the drag without pushing undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useRoofingVertexDragStore.getState();
      if (st.mode !== 'dragging') return;
      if (st.sectionId && st.vertexStart && st.vertexIdx >= 0) {
        useRoofStore.getState().updatePolygonVertexLive(
          st.sectionId,
          st.vertexIdx,
          st.vertexStart,
        );
      }
      endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endDrag]);

  if (
    mode !== 'dragging'
    || !sectionId
    || vertexIdx < 0
    || !pointerStart
    || !vertexStart
  ) {
    return null;
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const cur = pointerToGround(e);
    const next = dragDelta(pointerStart, vertexStart, cur, GRID_SNAP_FT);
    useRoofStore.getState().updatePolygonVertexLive(
      sectionId,
      vertexIdx,
      [next.x, next.y],
    );
  };

  const commitAndEnd = () => {
    const st = useRoofingVertexDragStore.getState();
    if (st.preDragSnapshot) {
      useRoofStore.getState().pushUndoSnapshot(st.preDragSnapshot);
    }
    endDrag();
  };

  return (
    <mesh
      // Sit slightly above the ground grid + handle spheres so
      // pointer events through the catcher aren't occluded by them.
      position={[0, 0.004, 0]}
      rotation-x={-Math.PI / 2}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => { e.stopPropagation(); commitAndEnd(); }}
      onPointerLeave={() => commitAndEnd()}
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
