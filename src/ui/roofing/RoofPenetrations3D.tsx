/**
 * RoofPenetrations3D — Phase 14.R.27.
 *
 * Scene-level group that renders every placed roof penetration
 * (chimney, skylight, plumbing vent) as a small 3D marker at its
 * plan-XY coordinate. Markers are anchored at ground plane (z = 0)
 * with kind-specific heights so they're visible from the default
 * camera distance and obviously "on" the roof area the user
 * clicked into.
 *
 * Precise placement on the roof's actual sloped surface (ray-cast
 * into the faces of the containing section) is deferred to a
 * later phase — the current anchor is intentionally simple so the
 * feature ships with a clear "see what you placed" affordance and
 * the estimator integration (the real value) works end-to-end.
 *
 * Selection + editing are handled in the Inspector panel, not via
 * click-on-marker, to keep this component stateless and allow
 * the drawing ground-plane in `RoofingDrawInteraction` to
 * continue intercepting clicks without arguing with marker hits.
 */

import { useMemo } from 'react';
import { useRoofStore, selectPenetrationsArray } from '@store/roofStore';
import type { RoofPenetration, PenetrationKind } from '@engine/roofing/RoofGraph';

// ── Per-kind visual spec ─────────────────────────────────────────

interface KindVisual {
  /** Hex color for the marker body. */
  color: string;
  /** Height of the marker in feet (from ground up). */
  heightFt: number;
  /** Shape: box (chimney, skylight) or cylinder (vent). */
  shape: 'box' | 'cylinder';
  /** Metalness / roughness tuning for the marker material. */
  metalness: number;
  roughness: number;
}

const KIND_VISUAL: Record<PenetrationKind, KindVisual> = {
  chimney: {
    color: '#8d6e63', // brown masonry
    heightFt: 6,
    shape: 'box',
    metalness: 0.1,
    roughness: 0.9,
  },
  skylight: {
    color: '#4fc3f7', // glass-blue
    heightFt: 0.6,
    shape: 'box',
    metalness: 0.7,
    roughness: 0.1,
  },
  plumbing_vent: {
    color: '#b87333', // copper / PVC-painted
    heightFt: 2.5,
    shape: 'cylinder',
    metalness: 0.5,
    roughness: 0.4,
  },
};

// ── Component ────────────────────────────────────────────────────

interface RoofPenetration3DProps {
  pen: RoofPenetration;
}

function RoofPenetration3D({ pen }: RoofPenetration3DProps) {
  const visual = KIND_VISUAL[pen.kind];

  // Three.js convention in this project: plan-X → world X, plan-Y →
  // world Z, elevation → world Y. Marker's geometric origin is its
  // BASE so we lift by `heightFt / 2` to center the primitive above
  // z = 0.
  const position = useMemo<[number, number, number]>(() => (
    [pen.x, visual.heightFt / 2, pen.y]
  ), [pen.x, pen.y, visual.heightFt]);

  if (visual.shape === 'cylinder') {
    // Vents: thin cylindrical stack. Radius derived from the
    // smaller footprint dimension so a user-resized pen stays
    // proportional.
    const radius = Math.min(pen.widthFt, pen.lengthFt) / 2;
    return (
      <mesh position={position} castShadow>
        <cylinderGeometry args={[radius, radius, visual.heightFt, 16]} />
        <meshStandardMaterial
          color={visual.color}
          metalness={visual.metalness}
          roughness={visual.roughness}
        />
      </mesh>
    );
  }

  // Box-shaped markers (chimney, skylight). BoxGeometry args are
  // (width, height, depth) in local axes — plan-Y maps to depth.
  return (
    <mesh position={position} castShadow>
      <boxGeometry args={[pen.widthFt, visual.heightFt, pen.lengthFt]} />
      <meshStandardMaterial
        color={visual.color}
        metalness={visual.metalness}
        roughness={visual.roughness}
      />
    </mesh>
  );
}

// ── Layer ────────────────────────────────────────────────────────

export function RoofPenetrations3D() {
  const penetrations = useRoofStore(selectPenetrationsArray);

  return (
    <group>
      {penetrations.map((pen) => (
        <RoofPenetration3D key={pen.id} pen={pen} />
      ))}
    </group>
  );
}
