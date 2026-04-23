/**
 * AxisRotationGizmo — Phase 14.R.23.
 *
 * A cyan arrow rendered at the polygon centroid pointing in the
 * direction of the current ridge (gable) or tilt axis (shed). The
 * arrowhead is a grabbable cone — pointer-down begins an axis-drag
 * session, pointer-move sweeps the arrow around the centroid, and
 * pointer-up commits the new `roofAxisOverrideDeg` with one undo
 * entry.
 *
 * Sibling to R.20's numeric input (still present in the Sections
 * panel) and R.19's rotation ring (rotates the whole section
 * geometry — orthogonal concern). Both visual gizmos + the keyboard
 * shortcut + the text input coexist; users can pick whichever feels
 * natural for the precision they need.
 *
 * Gate: renders ONLY when a convex-polygon section is selected with
 * roofType `gable` or `shed` (the only modes where the axis field
 * matters), the section is unlocked, and no competing interaction
 * is active (draw, calibrate, section-drag, vertex-drag, rotation
 * gizmo, axis-drag itself for someone else's pointer).
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRoofStore } from '@store/roofStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { useRoofingCalibrationStore } from '@store/roofingCalibrationStore';
import { useRoofingDragStore } from '@store/roofingDragStore';
import { useRoofingVertexDragStore } from '@store/roofingVertexDragStore';
import { useRoofingRotationDragStore } from '@store/roofingRotationDragStore';
import {
  useRoofingAxisDragStore,
  type GroundPoint,
} from '@store/roofingAxisDragStore';
import {
  rotationAngleDelta,
  snapDegrees,
} from '@store/roofingRotationDragStore';
import {
  polygonCentroid,
  polygonBoundingBox,
  isConvexPolygon,
  type RoofSection,
} from '@engine/roofing/RoofGraph';

const ARROW_COLOR_IDLE = '#00e5ff';   // cyan
const ARROW_COLOR_ACTIVE = '#80ffff'; // brighter during drag
const HEAD_RADIUS = 0.3;
const HEAD_HEIGHT = 0.7;

function pointerToGround(e: ThreeEvent<PointerEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return [p.x, p.z];
}

function pointerAngleFromCenter(pt: GroundPoint, center: GroundPoint): number {
  return Math.atan2(pt[1] - center[1], pt[0] - center[0]);
}

/** Read the section's current axis angle (deg) — either the explicit
 *  override or the bbox auto-pick. Returns 0 for unsupported sections. */
function currentAxisDeg(section: RoofSection): number {
  if (section.roofAxisOverrideDeg !== undefined) return section.roofAxisOverrideDeg;
  if (!section.polygon) return 0;
  const bbox = polygonBoundingBox(section.polygon);
  if (!bbox) return 0;
  const bboxW = bbox.maxX - bbox.minX;
  const bboxH = bbox.maxY - bbox.minY;
  if (section.roofType === 'gable') return bboxW >= bboxH ? 0 : 90;
  if (section.roofType === 'shed')  return bboxH <= bboxW ? 90 : 0;
  return 0;
}

export function AxisRotationGizmo() {
  const section = useRoofStore((s) =>
    s.selectedSectionId ? (s.sections[s.selectedSectionId] ?? null) : null,
  );
  const drawMode = useRoofingDrawStore((s) => s.mode);
  const calibMode = useRoofingCalibrationStore((s) => s.mode);
  const sectionDragMode = useRoofingDragStore((s) => s.mode);
  const vertexDragMode = useRoofingVertexDragStore((s) => s.mode);
  const rotateMode = useRoofingRotationDragStore((s) => s.mode);
  const axisDragMode = useRoofingAxisDragStore((s) => s.mode);
  const axisDragSid = useRoofingAxisDragStore((s) => s.sectionId);
  const beginDrag = useRoofingAxisDragStore((s) => s.beginDrag);
  const endDrag = useRoofingAxisDragStore((s) => s.endDrag);

  const gl = useThree((s) => s.gl);

  // Cursor while dragging.
  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;
    if (axisDragMode === 'dragging') {
      canvas.style.setProperty('cursor', 'grabbing', 'important');
    } else {
      canvas.style.removeProperty('cursor');
    }
    return () => { canvas.style.removeProperty('cursor'); };
  }, [axisDragMode, gl]);

  // ESC aborts: restore anchor axis, end drag, no undo push.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useRoofingAxisDragStore.getState();
      if (st.mode !== 'dragging' || !st.sectionId) return;
      useRoofStore.getState().updateSectionLive(st.sectionId, {
        roofAxisOverrideDeg: st.anchorAxisDeg,
      });
      endDrag();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [endDrag]);

  // Centroid + arrow direction.
  const layout = useMemo(() => {
    if (!section) return null;
    if (!section.polygon || section.polygon.length < 3) return null;
    if (!isConvexPolygon(section.polygon)) return null;
    const center = polygonCentroid(section.polygon);
    const axisDeg = currentAxisDeg(section);
    const axisRad = (axisDeg * Math.PI) / 180;
    const dir: [number, number] = [Math.cos(axisRad), Math.sin(axisRad)];
    // Arrow length = 40% of the polygon's bbox max dim → extends
    // well into the polygon without crossing the boundary most of
    // the time.
    const bbox = polygonBoundingBox(section.polygon)!;
    const maxDim = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
    const length = Math.max(maxDim * 0.4, 1.0);
    const tip: [number, number] = [
      center[0] + dir[0] * length,
      center[1] + dir[1] * length,
    ];
    return { center, axisDeg, axisRad, dir, length, tip };
  }, [section]);

  // Gate — every competing mode must be idle. (Axis-drag with
  // another section's sid still counts as "idle from our side".)
  const gated = !section
    || !section.polygon
    || section.locked
    || drawMode !== 'idle'
    || calibMode !== 'idle'
    || sectionDragMode !== 'idle'
    || vertexDragMode !== 'idle'
    || rotateMode !== 'idle'
    || (axisDragMode === 'dragging' && axisDragSid !== section.sectionId);

  if (gated || !section || !layout) return null;
  // Only meaningful for gable / shed.
  if (section.roofType !== 'gable' && section.roofType !== 'shed') return null;

  const active = axisDragMode === 'dragging' && axisDragSid === section.sectionId;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = pointerToGround(e);
    const startAngle = pointerAngleFromCenter(pt, layout.center);
    const preDragSnapshot = useRoofStore.getState().serialize();
    beginDrag({
      sectionId: section.sectionId,
      center: layout.center,
      startPointerAngle: startAngle,
      anchorAxisDeg: layout.axisDeg,
      preDragSnapshot,
    });
  };

  // Y offset for all gizmo geometry so it hovers slightly above the
  // roof surface regardless of elevation.
  const y = section.z + 0.25;
  const shaftStart: [number, number, number] = [
    layout.center[0], y, layout.center[1],
  ];
  const shaftEnd: [number, number, number] = [
    layout.tip[0], y, layout.tip[1],
  ];

  // The cone's default axis is +Y (up). We rotate it to point along
  // the arrow direction in the XZ plane. The angle needed is the
  // axisDeg converted to a rotation around +Y.
  //   Three.js +X → axisDeg=0  → cone rotation = +Z (−axis after flip)
  // Using `rotation={[0, -axisRad, 0]}` aligns +Y after the rotation
  // with the arrow's XZ direction (since the cone's initial +Y axis,
  // once flipped to point along +X, rotates to the axis direction
  // under CCW-Y rotation of −axisRad).
  // The simpler approach: orient the cone's base at shaftEnd with
  // its Y axis along `dir` after a conversion from XZ to Three's Y.
  // We'll pre-rotate −π/2 around +Z to bring +Y→+X, then rotate by
  // −axisRad around +Y to align with arrow direction.

  const color = active ? ARROW_COLOR_ACTIVE : ARROW_COLOR_IDLE;

  return (
    <>
      {/* Shaft — dashed line from centroid to tip */}
      <Line
        points={[shaftStart, shaftEnd]}
        color={color}
        lineWidth={active ? 3 : 2}
        dashed={false}
        transparent
        opacity={active ? 1 : 0.85}
      />
      {/* Arrowhead — cone, with pointerDown starting the drag */}
      <mesh
        position={shaftEnd}
        rotation={[
          0, // X rotation
          -layout.axisRad, // Y rotation (aligns cone's +X after the Z-tilt)
          -Math.PI / 2,    // Z rotation tips the cone's +Y onto +X
        ]}
        onPointerDown={handlePointerDown}
      >
        <coneGeometry args={[HEAD_RADIUS, HEAD_HEIGHT, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {/* Small sphere at the centroid anchor — decorative */}
      <mesh position={shaftStart}>
        <sphereGeometry args={[0.15, 10, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.8} />
      </mesh>
      {/* Drag catcher — only mounts during drag. */}
      {active && (
        <AxisDragCatcher
          center={layout.center}
          sectionId={section.sectionId}
        />
      )}
    </>
  );
}

function AxisDragCatcher({
  center,
  sectionId,
}: {
  center: GroundPoint;
  sectionId: string;
}) {
  const endDrag = useRoofingAxisDragStore((s) => s.endDrag);

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const st = useRoofingAxisDragStore.getState();
    if (st.startPointerAngle === null) return;
    const pt = pointerToGround(e);
    const curAngle = pointerAngleFromCenter(pt, center);
    const deltaRad = rotationAngleDelta(st.startPointerAngle, curAngle);
    const deltaDeg = (deltaRad * 180) / Math.PI;
    const rawNext = st.anchorAxisDeg + deltaDeg;
    // Snap: 15° bare, 1° with Shift held.
    const shiftDown = e.nativeEvent.shiftKey === true;
    const snapped = snapDegrees(rawNext, shiftDown ? 1 : 15);
    useRoofStore.getState().updateSectionLive(sectionId, {
      roofAxisOverrideDeg: snapped,
    });
  };

  const commitAndEnd = () => {
    const st = useRoofingAxisDragStore.getState();
    if (st.preDragSnapshot) {
      useRoofStore.getState().pushUndoSnapshot(st.preDragSnapshot);
    }
    endDrag();
  };

  return (
    <mesh
      position={[0, 0.007, 0]}
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
