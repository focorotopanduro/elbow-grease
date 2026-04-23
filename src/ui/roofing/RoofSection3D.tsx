/**
 * RoofSection3D — Phase 14.R.4.
 *
 * R3F component rendering ONE `RoofSection` as a solid 3D roof shell
 * plus classified edge lines. Geometry is driven by the pure
 * `vertices3d`, `edges3d`, `faces3d` helpers from `RoofGraph` — all
 * four roof types (flat, shed, gable, hip) render from the same
 * component.
 *
 * Coordinate mapping (RoofGraph → Three.js):
 *   rg.x          → three.x        (plan east-west)
 *   rg.z (elev)   → three.y        (up)
 *   rg.y (plan z) → three.z        (plan north-south)
 * This puts the roof on the same XZ ground plane as the plumbing
 * fixtures so both worlds share one viewport without rescaling.
 *
 * Faces:
 *   Built as a single `BufferGeometry` with triangulated positions
 *   + per-vertex normals computed from THREE's `computeVertexNormals`.
 *   Each face gets the section's palette color; selected sections
 *   boost emissive so they glow even under bad lighting.
 *
 * Edges:
 *   Each `Edge3d` is rendered as an `<Line />` from drei. Colors
 *   come from EDGE_COLORS — blue eaves, red ridges, orange rakes,
 *   green hips, grey generic slopes. Matches the convention most
 *   AROYH users have seen on blueprints.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { type ThreeEvent } from '@react-three/fiber';
import {
  type RoofSection,
  type EdgeType,
  vertices3d,
  edges3d,
  faces3d,
  hasPolygon,
  earClipTriangulate,
} from '@engine/roofing/RoofGraph';
import { useRoofStore } from '@store/roofStore';
// Phase 14.R.8 — drag-to-move. Pointer-down on a section begins the
// drag session; SectionDragInteraction picks up pointer-move/up via
// a sibling ground-plane catcher.
import { useRoofingDragStore } from '@store/roofingDragStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { useRoofingCalibrationStore } from '@store/roofingCalibrationStore';

// ── Palettes ────────────────────────────────────────────────────

/** 8-slot palette keyed by `RoofSection.colorIdx`. */
export const SECTION_PALETTE: readonly string[] = [
  '#ff9800', // orange (primary)
  '#e91e63', // pink
  '#9c27b0', // purple
  '#3f51b5', // indigo
  '#00bcd4', // cyan
  '#4caf50', // green
  '#ffc107', // amber
  '#795548', // brown
];

/** Edge palette — colors match convention used on paper blueprints. */
export const EDGE_COLORS: Record<EdgeType, string> = {
  eave: '#2196f3',   // blue — drip edges / gutters live here
  ridge: '#f44336',  // red — the top of the roof
  rake: '#ff9800',   // orange — sloped gable ends
  hip: '#4caf50',    // green — hip lines
  slope: '#9e9e9e',  // grey — generic slope edges
  // Phase 14.R.13 — diagonal interior ridge at a concave (reflex)
  // corner of an L / T / U hip roof. Shows where valley flashing
  // metal runs between the two meeting wings.
  valley: '#9c27b0', // purple
};

// ── Coordinate helpers ──────────────────────────────────────────

/**
 * Map a RoofGraph 3D vertex `[x, planY, elevZ]` to a Three.js
 * `[x, y, z]` where y is up. Pure — keeps the conversion central
 * so any future global transform (scene rotation, scale) only has
 * to change in one place.
 */
function rgToThree(v: [number, number, number]): [number, number, number] {
  return [v[0], v[2], v[1]];
}

// ── Geometry builder ────────────────────────────────────────────

/**
 * Triangulate a face given as vertex indices into a vertex list.
 * Uses fan triangulation from vertex 0 — correct for CONVEX polygons,
 * which is what `faces3d` returns for rect-derived roof types
 * (flat/shed/gable/hip → triangles and convex quads only).
 *
 * Concave polygons (R.9 footprints like L / U / T shapes) require
 * ear-clipping — see `buildFaceGeometry` below for the branch that
 * routes polygon sections through `earClipTriangulate`.
 */
function triangulateFace(indices: number[]): [number, number, number][] {
  if (indices.length < 3) return [];
  const tris: [number, number, number][] = [];
  for (let i = 1; i < indices.length - 1; i++) {
    tris.push([indices[0]!, indices[i]!, indices[i + 1]!]);
  }
  return tris;
}

function buildFaceGeometry(section: RoofSection): THREE.BufferGeometry {
  const verts = vertices3d(section).map(rgToThree);
  const positions: number[] = [];

  // Phase 14.R.10 — concave-safe triangulation for polygon+flat
  // sections. Fan-triangulating an L/U/T footprint from vertex 0
  // produces triangles that cross the notch; ear-clipping carves
  // off convex "ears" until only 3 vertices remain, preserving the
  // polygon's exact area.
  //
  // Phase 14.R.11 / R.14 / R.15 / R.16 — polygon sections with
  // MULTIPLE faces (pyramid hip, skeleton decomposition, gable
  // trapezoids, etc.) must use the faces3d path since their face
  // vertex indices reference apex / projection / leaf vertices that
  // aren't present in the raw polygon. Only when faces3d returns
  // exactly one face covering the polygon — R.9 flat, R.17 shed —
  // is ear-clipping the right triangulation path.
  //
  // Phase 14.R.17 — shed verts are at per-vertex elevations on the
  // single tilted plane, so ear-clipping on the 2D polygon + looking
  // up 3D via vertices3d gives the correct slope-face triangulation.
  const polygonMultiFace = hasPolygon(section)
    && faces3d(section).length > 1;
  if (hasPolygon(section) && !polygonMultiFace) {
    const triIndices = earClipTriangulate(section.polygon);
    for (const [a, b, c] of triIndices) {
      const va = verts[a];
      const vb = verts[b];
      const vc = verts[c];
      if (!va || !vb || !vc) continue;
      positions.push(...va, ...vb, ...vc);
    }
  } else {
    const faces = faces3d(section);
    for (const face of faces) {
      for (const [a, b, c] of triangulateFace(face.vertexIndices)) {
        const va = verts[a];
        const vb = verts[b];
        const vc = verts[c];
        if (!va || !vb || !vc) continue;
        positions.push(...va, ...vb, ...vc);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geo.computeVertexNormals();
  return geo;
}

// ── Component ───────────────────────────────────────────────────

interface RoofSection3DProps {
  section: RoofSection;
  onClick?: (sectionId: string) => void;
}

export function RoofSection3D({ section, onClick }: RoofSection3DProps) {
  const selectedId = useRoofStore((s) => s.selectedSectionId);
  const selected = section.sectionId === selectedId;

  // Rebuild geometry whenever the section's dimensional fields
  // change. Memo key covers every prop that affects the mesh —
  // including `section.polygon` (R.9) so polygon-footprint edits
  // trigger a GPU-geometry rebuild. Polygon arrays are cloned by
  // roofStore on every mutation, so reference-equality works as
  // the dependency check.
  const geometry = useMemo(
    () => buildFaceGeometry(section),
    [
      section.x,
      section.y,
      section.length,
      section.run,
      section.rotation,
      section.slope,
      section.overhang,
      section.z,
      section.roofType,
      section.polygon,
    ],
  );

  // Clean up GPU geometry on unmount / remount.
  useMemoDispose(geometry);

  const baseColor = SECTION_PALETTE[section.colorIdx % SECTION_PALETTE.length]!;
  const opacity = selected ? 0.92 : 0.82;

  // Pre-compute 3D vertices once per render so both the mesh and
  // the edge <Line>s can reference them.
  const verts = useMemo(
    () => vertices3d(section).map(rgToThree),
    [
      section.x, section.y, section.length, section.run,
      section.rotation, section.slope, section.overhang,
      section.z, section.roofType, section.polygon,
    ],
  );

  const edges = useMemo(() => edges3d(section), [
    section.roofType, section.length, section.run, section.overhang, section.polygon,
  ]);

  // Phase 14.R.8 — drag-to-move gate. Drag is suppressed while the
  // user is in a competing interaction mode (drawing a new rect or
  // calibrating the PDF), and on sections the user has locked. The
  // section's existing `onClick` behavior (select-only) still fires
  // when the pointer comes back up without any movement because R3F
  // only emits onClick on clean clicks.
  const drawMode = useRoofingDrawStore((s) => s.mode);
  const calibMode = useRoofingCalibrationStore((s) => s.mode);
  const beginDrag = useRoofingDragStore((s) => s.beginDrag);
  const dragEnabled =
    !section.locked &&
    drawMode === 'idle' &&
    calibMode === 'idle';

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!dragEnabled) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    // Selecting-on-grab matches how most CAD tools behave — a drag
    // without a prior click is common (power-users pick up a section
    // and relocate it). We mirror that so users don't need two
    // separate clicks.
    onClick?.(section.sectionId);
    const p = e.point as THREE.Vector3;
    beginDrag(
      section.sectionId,
      [p.x, p.z],
      [section.x, section.y],
    );
  };

  return (
    <group>
      {/* Solid roof shell */}
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onPointerDown={handlePointerDown}
        onClick={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onClick?.(section.sectionId);
        }}
      >
        <meshStandardMaterial
          color={baseColor}
          side={THREE.DoubleSide}
          transparent
          opacity={opacity}
          metalness={0.15}
          roughness={0.75}
          emissive={selected ? baseColor : '#000000'}
          emissiveIntensity={selected ? 0.18 : 0}
        />
      </mesh>

      {/* Classified edges (eave / ridge / rake / hip / slope) */}
      {edges.map((e, i) => {
        const from = verts[e.fromIdx];
        const to = verts[e.toIdx];
        if (!from || !to) return null;
        return (
          <Line
            key={`${section.sectionId}-edge-${i}`}
            points={[from, to]}
            color={EDGE_COLORS[e.edgeType]}
            lineWidth={selected ? 3.2 : 2}
            transparent
            opacity={selected ? 1 : 0.9}
          />
        );
      })}
    </group>
  );
}

// ── GPU cleanup hook ────────────────────────────────────────────

/**
 * `useMemo` returns a new BufferGeometry whenever the deps change,
 * but the OLD geometry's GPU buffers never auto-dispose. This hook
 * releases them on the next geometry swap + on unmount. Matches the
 * pattern used in PipeRenderer.
 */
function useMemoDispose(geo: THREE.BufferGeometry): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useDisposeOnChange(geo);
}

function useDisposeOnChange(geo: THREE.BufferGeometry): void {
  // Use a ref-like approach: capture the prev geometry and dispose
  // when geometry identity changes. A manual useRef+useEffect does
  // the job without pulling in the useEffect lifecycle.
  const refHolder = useMemo<{ prev: THREE.BufferGeometry | null }>(
    () => ({ prev: null }),
    [],
  );
  if (refHolder.prev && refHolder.prev !== geo) {
    refHolder.prev.dispose();
  }
  refHolder.prev = geo;
}
