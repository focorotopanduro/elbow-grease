/**
 * RotationGizmo — Phase 14.R.19.
 *
 * A magenta torus ring rendered around the selected section's
 * rotation pivot:
 *   • Rect sections → pivot at (x + length/2, y + run/2), the bbox
 *     center — matches `corners()` behavior.
 *   • Polygon sections → pivot at the polygon centroid
 *     (`polygonCentroid`).
 *
 * Drag lifecycle:
 *   pointer-down on ring → capture anchor state + snapshot, switch
 *     to 'rotating' mode.
 *   pointer-move on ground-plane catcher → compute angle delta from
 *     pointer anchor, snap to 15° (1° with Shift held), call
 *     `roofStore.rotateSectionLive`.
 *   pointer-up → push the pre-drag snapshot onto undoStack (one
 *     undo entry per drag), end rotate.
 *   Escape mid-drag → restore the section to anchor state via
 *     rotateSectionLive(0°), end rotate, no undo push.
 *
 * Gate (like R.18): renders ONLY when a section is selected + not
 * locked + draw/calib/section-drag/vertex-drag modes all idle.
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRoofStore } from '@store/roofStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { useRoofingCalibrationStore } from '@store/roofingCalibrationStore';
import { useRoofingSectionDragStore } from '@store/roofingSectionDragStore';
import { useRoofingVertexDragStore } from '@store/roofingVertexDragStore';
import {
  useRoofingRotationDragStore,
  rotationAngleDelta,
  snapDegrees,
  type GroundPoint,
} from '@store/roofingRotationDragStore';
import { polygonCentroid } from '@engine/roofing/RoofGraph';

const RING_COLOR_IDLE = '#e040fb';   // magenta
const RING_COLOR_ACTIVE = '#ff80ff'; // brighter when rotating
const RING_TUBE_RADIUS = 0.12;       // thickness of the torus
const RING_MARGIN_FT = 1.2;          // offset outside the section's bbox

function pointerToGround(e: ThreeEvent<PointerEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return [p.x, p.z];
}

function pointerAngleFromCenter(pt: GroundPoint, center: GroundPoint): number {
  return Math.atan2(pt[1] - center[1], pt[0] - center[0]);
}

export function RotationGizmo() {
  const section = useRoofStore((s) =>
    s.selectedSectionId ? (s.sections[s.selectedSectionId] ?? null) : null,
  );
  const drawMode = useRoofingDrawStore((s) => s.mode);
  const calibMode = useRoofingCalibrationStore((s) => s.mode);
  const sectionDragMode = useRoofingSectionDragStore((s) => s.mode);
  const vertexDragMode = useRoofingVertexDragStore((s) => s.mode);
  const rotateMode = useRoofingRotationDragStore((s) => s.mode);
  const beginRotate = useRoofingRotationDragStore((s) => s.beginRotate);
  const endRotate = useRoofingRotationDragStore((s) => s.endRotate);
  const rotateStartAngle = useRoofingRotationDragStore((s) => s.startPointerAngle);
  const rotateCenter = useRoofingRotationDragStore((s) => s.center);
  const rotateSid = useRoofingRotationDragStore((s) => s.sectionId);
  const anchorRotation = useRoofingRotationDragStore((s) => s.anchorRotation);
  const anchorPolygon = useRoofingRotationDragStore((s) => s.anchorPolygon);

  const gl = useThree((s) => s.gl);

  // Cursor feedback while the rotation is live.
  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;
    if (rotateMode === 'rotating') {
      canvas.style.setProperty('cursor', 'grabbing', 'important');
    } else {
      canvas.style.removeProperty('cursor');
    }
    return () => { canvas.style.removeProperty('cursor'); };
  }, [rotateMode, gl]);

  // Escape aborts — restore anchor state, end rotate without undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useRoofingRotationDragStore.getState();
      if (st.mode !== 'rotating' || !st.sectionId || !st.center) return;
      useRoofStore.getState().rotateSectionLive(st.sectionId, 0, {
        rotation: st.anchorRotation,
        polygon: st.anchorPolygon,
        center: st.center,
      });
      endRotate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endRotate]);

  // Ring geometry — recomputed whenever the section's footprint
  // changes so the ring always hugs the current bounding box.
  const ringGeometry = useMemo(() => {
    if (!section) return null;
    // Radius = max bbox half-dim + margin.
    const halfMax = Math.max(section.length, section.run) / 2;
    const radius = Math.max(halfMax + RING_MARGIN_FT, RING_MARGIN_FT * 2);
    return new THREE.TorusGeometry(radius, RING_TUBE_RADIUS, 8, 48);
  }, [section?.length, section?.run]);

  // Pivot center (polygon sections use centroid; rect sections use
  // the un-rotated bbox center). Rect rotation itself is applied via
  // the `<group>` rotation prop below so the ring orbits with the
  // section visually.
  const center: GroundPoint | null = useMemo(() => {
    if (!section) return null;
    if (section.polygon) return polygonCentroid(section.polygon);
    return [section.x + section.length / 2, section.y + section.run / 2];
  }, [section]);

  // Gate the render.
  const hidden = !section
    || section.locked
    || drawMode !== 'idle'
    || calibMode !== 'idle'
    || sectionDragMode !== 'idle'
    || vertexDragMode !== 'idle';
  if (hidden || !section || !ringGeometry || !center) return null;

  const active = rotateMode === 'rotating' && rotateSid === section.sectionId;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = pointerToGround(e);
    const startAngle = pointerAngleFromCenter(pt, center);
    const preDragSnapshot = useRoofStore.getState().serialize();
    beginRotate({
      sectionId: section.sectionId,
      center,
      startPointerAngle: startAngle,
      anchorRotation: section.rotation,
      anchorPolygon: section.polygon ?? null,
      preDragSnapshot,
    });
  };

  return (
    <>
      {/* The torus ring at the section's rotation pivot. For rect
          sections we visually rotate the ring to match the section's
          current rotation, so the gizmo feels attached even though
          the ring itself is a circle (rotation-invariant). */}
      <group position={[center[0], section.z + 0.2, center[1]]}>
        <mesh
          geometry={ringGeometry}
          rotation-x={-Math.PI / 2}
          onPointerDown={handlePointerDown}
        >
          <meshBasicMaterial
            color={active ? RING_COLOR_ACTIVE : RING_COLOR_IDLE}
            toneMapped={false}
            transparent
            opacity={active ? 1 : 0.85}
          />
        </mesh>
      </group>
      {/* Ground-plane catcher for pointer-move + pointer-up while
          the rotation drag is live. Self-unmounts between drags so
          it doesn't intercept anything when idle. */}
      {active && rotateStartAngle !== null && rotateCenter !== null && (
        <RotationDragCatcher
          center={rotateCenter}
          startAngle={rotateStartAngle}
          sectionId={section.sectionId}
          anchorRotation={anchorRotation}
          anchorPolygon={anchorPolygon}
        />
      )}
    </>
  );
}

function RotationDragCatcher({
  center,
  startAngle,
  sectionId,
  anchorRotation,
  anchorPolygon,
}: {
  center: GroundPoint;
  startAngle: number;
  sectionId: string;
  anchorRotation: number;
  anchorPolygon: ReadonlyArray<readonly [number, number]> | null;
}) {
  const endRotate = useRoofingRotationDragStore((s) => s.endRotate);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const pt = pointerToGround(e);
    const curAngle = pointerAngleFromCenter(pt, center);
    const deltaRad = rotationAngleDelta(startAngle, curAngle);
    const deltaDeg = (deltaRad * 180) / Math.PI;
    // Snap: 15° bare, 1° with Shift held (finer control).
    const shiftDown = e.nativeEvent.shiftKey === true;
    const snapped = snapDegrees(deltaDeg, shiftDown ? 1 : 15);
    useRoofStore.getState().rotateSectionLive(sectionId, snapped, {
      rotation: anchorRotation,
      polygon: anchorPolygon,
      center,
    });
  };

  const commitAndEnd = () => {
    const st = useRoofingRotationDragStore.getState();
    if (st.preDragSnapshot) {
      useRoofStore.getState().pushUndoSnapshot(st.preDragSnapshot);
    }
    endRotate();
  };

  return (
    <mesh
      position={[0, 0.005, 0]}
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
