/**
 * PolygonVertexHandles — Phase 14.R.18.
 *
 * Small amber spheres at each vertex of the currently-selected
 * polygon section. Pointer-down on a handle:
 *   1. Captures a pre-drag snapshot of the roofStore.
 *   2. Calls `beginDrag` on the vertex-drag store with the vertex
 *      index + pointer anchor + vertex anchor + snapshot.
 *   3. Stops event propagation so R.8's section-drag doesn't also
 *      fire and OrbitControls doesn't rotate.
 *
 * Gating: handles render ONLY when ALL of:
 *   • A section is selected AND has a `polygon`
 *   • The section is not locked
 *   • No competing interaction mode is active (draw, calibrate,
 *     section-drag)
 *
 * When gated off, R.8's section-drag kicks in at the section level
 * instead — grabbing the section's face drags the whole section; the
 * handle path is ONLY for vertex-level edits.
 */

import * as THREE from 'three';
import { type ThreeEvent } from '@react-three/fiber';
import { useRoofStore } from '@store/roofStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { useRoofingPdfCalibStore } from '@store/roofingPdfCalibStore';
import { useRoofingSectionDragStore } from '@store/roofingSectionDragStore';
import {
  useRoofingVertexDragStore,
  type GroundPoint,
} from '@store/roofingVertexDragStore';

// Visual constants — amber handles contrast with the orange roofing
// accent color so they read as interactive without being garish.
const HANDLE_COLOR_IDLE = '#ffc107';
const HANDLE_COLOR_ACTIVE = '#ffeb3b'; // brighter yellow during drag
const HANDLE_RADIUS_IDLE = 0.22;
const HANDLE_RADIUS_ACTIVE = 0.34;

export function PolygonVertexHandles() {
  const selectedId = useRoofStore((s) => s.selectedSectionId);
  const section = useRoofStore((s) =>
    s.selectedSectionId ? (s.sections[s.selectedSectionId] ?? null) : null,
  );
  const drawMode = useRoofingDrawStore((s) => s.mode);
  const calibMode = useRoofingPdfCalibStore((s) => s.mode);
  const sectionDragMode = useRoofingSectionDragStore((s) => s.mode);
  const vertexDragMode = useRoofingVertexDragStore((s) => s.mode);
  const vertexDragIdx = useRoofingVertexDragStore((s) => s.vertexIdx);
  const vertexDragSid = useRoofingVertexDragStore((s) => s.sectionId);
  const beginDrag = useRoofingVertexDragStore((s) => s.beginDrag);

  // Gate: all conditions must be true to show handles.
  if (!section || !section.polygon) return null;
  if (section.locked) return null;
  if (drawMode !== 'idle') return null;
  if (calibMode !== 'idle') return null;
  if (sectionDragMode !== 'idle') return null;

  const polygon = section.polygon;
  void selectedId; // used via `section` lookup above

  const handlePointerDown = (i: number) => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = e.point as THREE.Vector3;
    const pointerStart: GroundPoint = [p.x, p.z];
    const [vx, vy] = polygon[i]!;
    const vertexStart: GroundPoint = [vx, vy];
    // Snapshot BEFORE the first live update so undo rolls back to
    // the state with this exact vertex at its original position.
    const preDragSnapshot = useRoofStore.getState().serialize();
    beginDrag({
      sectionId: section.sectionId,
      vertexIdx: i,
      pointerStart,
      vertexStart,
      preDragSnapshot,
    });
  };

  return (
    <group>
      {polygon.map(([px, py], i) => {
        const active = vertexDragMode === 'dragging'
          && vertexDragSid === section.sectionId
          && vertexDragIdx === i;
        const r = active ? HANDLE_RADIUS_ACTIVE : HANDLE_RADIUS_IDLE;
        return (
          <mesh
            key={i}
            // Handle sits at the vertex world position + a tiny y
            // offset so it hovers visibly above the roof surface
            // even on eave corners at z=0.
            position={[px, section.z + 0.15, py]}
            onPointerDown={handlePointerDown(i)}
          >
            <sphereGeometry args={[r, 12, 12]} />
            <meshBasicMaterial
              color={active ? HANDLE_COLOR_ACTIVE : HANDLE_COLOR_IDLE}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
