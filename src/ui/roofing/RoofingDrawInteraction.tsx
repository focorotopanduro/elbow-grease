/**
 * RoofingDrawInteraction — Phase 14.R.4 / R.9.
 *
 * Scene-level ground-plane catcher for the roofing draw tools.
 *
 *   mode = 'draw-rect' (R.4):
 *     1st click  → `setDraftStart(pt)`
 *     move       → `setDraftEnd(pt)`
 *     2nd click  → commit rectangle → addSection, return to idle
 *     ESC key    → cancelDraft
 *
 *   mode = 'draw-polygon' (R.9):
 *     Nth click (N >= 1)   → addPolygonVertex(pt)
 *     move                 → setDraftEnd(pt) for rubber-band preview
 *     Enter / double-click → commit polygon (≥3 vertices) → flat section
 *     click-on-first-vtx   → same as commit (closes the loop)
 *     Backspace            → pop last vertex without canceling the draw
 *     ESC key              → cancelDraft
 *
 *   mode = 'idle':
 *     renders nothing, intercepts nothing.
 *
 * Ground-plane coordinates come from `e.point` (THREE.Vector3 in
 * world space). X → plan-X, Z → plan-Y (see RoofSection3D for the
 * convention). Grid snap is 0.5 ft for both modes.
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useRoofingDrawStore,
  draftRectToSection,
  snapToGrid,
  type GroundPoint,
} from '@store/roofingDrawStore';
import { useRoofStore } from '@store/roofStore';

const GRID_SNAP_FT = 0.5;
/** How close a subsequent click has to be to the first polygon
 *  vertex to count as "close the loop" (feet). 1 grid cell = 0.5 ft
 *  on either axis → diagonal ~0.71 ft, so a half-foot radius is a
 *  generous but not misleading threshold. */
const POLY_CLOSE_RADIUS_FT = 0.75;

function pointerToGround(e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return snapToGrid([p.x, p.z], GRID_SNAP_FT);
}

function distance(a: GroundPoint, b: GroundPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function RoofingDrawInteraction() {
  const mode = useRoofingDrawStore((s) => s.mode);
  const defaults = useRoofingDrawStore((s) => ({
    roofType: s.defaultRoofType,
    sectionType: s.defaultSectionType,
    slope: s.defaultSlope,
    overhang: s.defaultOverhang,
    elevation: s.defaultElevation,
  }));

  // Cursor feedback — switch to a crosshair while drawing so the
  // user knows clicks will land as vertices.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;
    if (mode === 'draw-rect' || mode === 'draw-polygon' || mode === 'place-penetration') {
      canvas.style.setProperty('cursor', 'crosshair', 'important');
    } else {
      canvas.style.removeProperty('cursor');
    }
    return () => {
      canvas.style.removeProperty('cursor');
    };
  }, [mode, gl]);

  // ── Polygon commit ───────────────────────────────────────────
  // Extracted to a closure so both "Enter" and "click on first vtx"
  // and "double-click" can call it consistently. Phase 14.R.11 —
  // the user's selected `defaultRoofType` is now honored (R.9 forced
  // flat; R.11 supports polygon + hip as a centroid pyramid for
  // convex polygons). The renderer + aggregator gracefully degrade
  // to flat for unsupported combos (concave + hip, gable, shed).
  const commitPolygon = (): boolean => {
    const st = useRoofingDrawStore.getState();
    if (st.mode !== 'draw-polygon') return false;
    if (st.polygonVertices.length < 3) return false;
    const sid = useRoofStore.getState().addSection({
      x: st.polygonVertices[0]![0],
      y: st.polygonVertices[0]![1],
      slope: defaults.slope,
      overhang: defaults.overhang,
      z: defaults.elevation,
      roofType: defaults.roofType,
      sectionType: defaults.sectionType,
      polygon: st.polygonVertices,
    });
    useRoofStore.getState().selectSection(sid);
    st.cancelDraft();
    return true;
  };

  // Escape cancels the draft from anywhere; Enter commits polygon;
  // Backspace pops the last polygon vertex.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useRoofingDrawStore.getState();
      if (e.key === 'Escape') {
        if (st.mode === 'idle' && st.draftStart === null && st.polygonVertices.length === 0) return;
        st.cancelDraft();
        return;
      }
      if (st.mode !== 'draw-polygon') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        commitPolygon();
        return;
      }
      if (e.key === 'Backspace' && st.polygonVertices.length > 0) {
        e.preventDefault();
        st.removeLastPolygonVertex();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (
    mode !== 'draw-rect'
    && mode !== 'draw-polygon'
    && mode !== 'place-penetration'
  ) return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = pointerToGround(e);
    const st = useRoofingDrawStore.getState();

    // ── Penetration placement (R.27) ────────────────────────
    // Single click drops the armed kind at the click point and
    // returns to idle. Repeating placements requires re-arming
    // via the toolbar — matches the R.4 rect pattern rather than
    // the R.9 polygon "stay in mode" pattern because penetrations
    // are usually placed in ones or twos per job.
    if (st.mode === 'place-penetration') {
      const pid = useRoofStore.getState().addPenetration({
        kind: st.penetrationKind,
        x: pt[0],
        y: pt[1],
      });
      void pid;
      st.cancelDraft();
      return;
    }

    // ── Polygon branch (R.9) ───────────────────────────────
    if (st.mode === 'draw-polygon') {
      // Click-on-first-vertex closes the loop (when ≥ 3 vtx).
      if (
        st.polygonVertices.length >= 3
        && distance(pt, st.polygonVertices[0]!) <= POLY_CLOSE_RADIUS_FT
      ) {
        commitPolygon();
        return;
      }
      // Otherwise append.
      st.addPolygonVertex(pt);
      st.setDraftEnd(pt);
      return;
    }

    // ── Rect branch (R.4) ───────────────────────────────────
    if (st.draftStart === null) {
      st.setDraftStart(pt);
      st.setDraftEnd(pt);
      return;
    }
    const { x, y, length, run } = draftRectToSection(st.draftStart, pt);
    if (length < GRID_SNAP_FT || run < GRID_SNAP_FT) {
      st.cancelDraft();
      return;
    }
    const sid = useRoofStore.getState().addSection({
      x,
      y,
      length,
      run,
      slope: defaults.slope,
      overhang: defaults.overhang,
      z: defaults.elevation,
      roofType: defaults.roofType,
      sectionType: defaults.sectionType,
    });
    useRoofStore.getState().selectSection(sid);
    st.cancelDraft();
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const st = useRoofingDrawStore.getState();
    // Rect mode: only track once the first click has landed.
    if (st.mode === 'draw-rect' && !st.draftStart) return;
    // Polygon mode: track ALWAYS so the rubber-band preview shows
    // even before the first click (gives the user instant feedback
    // that drawing mode is live).
    const pt = pointerToGround(e);
    useRoofingDrawStore.getState().setDraftEnd(pt);
  };

  // Double-click commits a polygon (matches common CAD UX: close
  // with Enter, Esc, or double-click).
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (useRoofingDrawStore.getState().mode !== 'draw-polygon') return;
    e.stopPropagation();
    commitPolygon();
  };

  return (
    <mesh
      position={[0, -0.001, 0]}
      rotation-x={-Math.PI / 2}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDoubleClick={handleDoubleClick}
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
