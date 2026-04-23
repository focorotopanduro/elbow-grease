/**
 * LiveFittings — Phase 14.Q
 *
 * Ghost fittings (elbows + bends) rendered at every junction of the
 * in-progress pipe route. Sibling of LiveRoutePreview: while the
 * tube preview shows the STRAIGHT sections, this shows the JUNCTIONS
 * that will be produced when the route commits.
 *
 * Why this matters: without a junction preview, the user draws a
 * 47° bend, sees a nice smooth tube, hits commit, and is surprised
 * when the committed pipe suddenly has an "illegal bend" warning
 * or a 45° fitting they didn't expect. The ghost fitting shows the
 * real snap BEFORE commit so the user can nudge to a legal detent.
 *
 * How it works:
 *   1. Subscribe to the same route-update events as LiveRoutePreview.
 *   2. Synthesize a fake `CommittedPipe` from the draw points + the
 *      current material + diameter.
 *   3. Call `generateAllFittings([fakePipe])` — reuses the
 *      production fitting-detection logic.
 *   4. For each emitted fitting, render a simple cached geometry
 *      (same caches FittingMeshes uses for committed pipes) with a
 *      ghost/translucent material. Illegal-angle fittings flash
 *      red so the user knows to adjust before commit.
 */

import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useEvent } from '@hooks/useEventBus';
import { useRafEvent } from '@hooks/useRafEvent';
import { EV, type Vec3, type PipeRouteUpdatePayload } from '@core/events';
import { HILO_EV } from '@core/hilo/HILOCoordinator';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { generateAllFittings, type FittingInstance } from '@ui/pipe/FittingGenerator';
import {
  getElbow90Geo,
  getElbow45Geo,
  getBend22_5Geo,
  getBend90LongSweepGeo,
  getPexElbow90Geo,
} from '@ui/pipe/FittingMeshes';
import type { CommittedPipe } from '@store/pipeStore';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType } from '../../engine/graph/GraphNode';

// ── Ghost material ────────────────────────────────────────────

// One material is shared across every preview fitting. Gold-ish
// amber so it reads distinct from the cyan tube + not confused with
// a committed pipe's real fitting color.
let ghostMat: THREE.MeshStandardMaterial | null = null;
let illegalMat: THREE.MeshStandardMaterial | null = null;

function getGhostMaterial(): THREE.MeshStandardMaterial {
  if (ghostMat) return ghostMat;
  ghostMat = new THREE.MeshStandardMaterial({
    color: '#ffd54f',
    transparent: true,
    opacity: 0.7,
    metalness: 0.2,
    roughness: 0.5,
    emissive: '#ffd54f',
    emissiveIntensity: 0.55,
    toneMapped: false,
    depthWrite: false,
  });
  return ghostMat;
}

function getIllegalMaterial(): THREE.MeshStandardMaterial {
  if (illegalMat) return illegalMat;
  illegalMat = new THREE.MeshStandardMaterial({
    color: '#ff1744',
    transparent: true,
    opacity: 0.8,
    metalness: 0.1,
    roughness: 0.6,
    emissive: '#ff1744',
    emissiveIntensity: 0.9,
    toneMapped: false,
    depthWrite: false,
  });
  return illegalMat;
}

// Map fitting type → cached geometry (same caches FittingMeshes uses).
// Unhandled types fall back to a sphere so we always have SOMETHING
// to show at the junction.
function geometryForFitting(
  f: FittingInstance,
  fallbackRadius: number,
): THREE.BufferGeometry {
  const mat = f.material as PipeMaterial;
  switch (f.type) {
    case 'elbow_90':
    case 'bend_90':
      return getElbow90Geo(mat, f.diameter);
    case 'pex_elbow_90':
      return getPexElbow90Geo(mat, f.diameter);
    case 'elbow_45':
    case 'bend_45':
      return getElbow45Geo(mat, f.diameter);
    case 'bend_22_5':
      return getBend22_5Geo(mat, f.diameter);
    case 'bend_90_ls':
      return getBend90LongSweepGeo(mat, f.diameter);
    default:
      // Fallback: a sphere 20% larger than the pipe radius. Enough
      // to read as "a fitting goes here" even if we don't have a
      // sculpted mesh for this specific type yet.
      return new THREE.SphereGeometry(fallbackRadius * 1.2, 14, 10);
  }
}

// ── Component ─────────────────────────────────────────────────

export function LiveFittings() {
  const [points, setPoints] = useState<Vec3[]>([]);
  const [active, setActive] = useState(false);

  const diameter = usePlumbingDrawStore((s) => s.drawDiameter);
  const material = usePlumbingDrawStore((s) => s.drawMaterial);

  // rAF-coalesced: generateAllFittings walks all point triples doing
  // angle math; no need to re-run at 120Hz when 60Hz already exceeds
  // the human perception threshold for live geometry feedback. (14.AC.1)
  useRafEvent<PipeRouteUpdatePayload>(EV.PIPE_ROUTE_UPDATE, (p) => {
    if (p.points.length >= 3) {
      // Only ≥ 3 points mean there's at least one internal vertex —
      // i.e. a potential bend to preview.
      setPoints([...p.points]);
      setActive(true);
    } else {
      // 2 points or fewer → no bends; suppress any previous ghosts.
      setPoints([]);
    }
  });
  useEvent(EV.PIPE_DRAG_START, () => { setActive(true); setPoints([]); });
  useEvent(EV.PIPE_CANCEL, () => { setActive(false); setPoints([]); });
  useEvent(HILO_EV.ROUTES_GENERATED, () => { setActive(false); setPoints([]); });

  const fittings = useMemo<FittingInstance[]>(() => {
    if (points.length < 3) return [];
    // Default system during draw is 'waste' — the solver reassigns
    // on commit. Legal-angle detection is system-independent so this
    // default is fine for preview.
    const fakePipe: CommittedPipe = {
      id: '__live_preview__',
      points: points.map((p) => [p[0], p[1], p[2]] as Vec3),
      diameter,
      material,
      system: 'waste' as SystemType,
      color: '#ffa726',
      visible: true,
      selected: false,
    };
    return generateAllFittings([fakePipe]);
  }, [points, diameter, material]);

  if (!active || fittings.length === 0) return null;

  return (
    <group>
      {fittings.map((f) => (
        <GhostFitting key={f.id} fitting={f} />
      ))}
    </group>
  );
}

// ── Single ghost fitting ──────────────────────────────────────

function GhostFitting({ fitting }: { fitting: FittingInstance }) {
  // Pipe OD in feet — used as the sphere-fallback radius scale.
  const fallbackRadius = (fitting.diameter / 2) / 12;

  const geo = useMemo(
    () => geometryForFitting(fitting, fallbackRadius),
    [fitting.type, fitting.material, fitting.diameter],
  );

  const mat = fitting.illegalAngle ? getIllegalMaterial() : getGhostMaterial();

  const q = fitting.quaternion;
  const p = fitting.position;

  // Label: "45° bend" / "90° elbow" etc. Illegal-angle labels show
  // the actual measured angle so the user can see what to aim for.
  const label = fitting.illegalAngle && fitting.measuredAngleDeg !== undefined
    ? `${fitting.measuredAngleDeg.toFixed(0)}° · ILLEGAL`
    : prettyLabel(fitting);

  return (
    <group position={[p[0], p[1], p[2]]} quaternion={[q[0], q[1], q[2], q[3]]}>
      <mesh geometry={geo} material={mat} />
      {/* Label is on the centered group; rotating quaternion is
          canceled out by re-anchoring in the billboard child. */}
      <Billboard position={[0, 0.4, 0]}>
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[Math.max(0.7, label.length * 0.08), 0.22]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.88} />
        </mesh>
        <Text
          fontSize={0.12}
          color={fitting.illegalAngle ? '#ff1744' : '#ffd54f'}
          outlineWidth={0.008}
          outlineColor="#000"
          anchorX="center"
          anchorY="middle"
        >
          {label}
        </Text>
      </Billboard>
    </group>
  );
}

function prettyLabel(f: FittingInstance): string {
  switch (f.type) {
    case 'bend_90':      return '90° bend';
    case 'bend_90_ls':   return '90° long sweep';
    case 'bend_45':      return '45° bend';
    case 'bend_22_5':    return '22.5° bend';
    case 'elbow_90':     return '90° ell';
    case 'elbow_45':     return '45° ell';
    case 'pex_elbow_90': return 'ProPEX 90°';
    case 'tee':          return f.material === 'pex' ? 'ProPEX tee' : 'tee';
    case 'sanitary_tee': return 'san tee';
    case 'wye':          return 'wye';
    case 'combo_wye_eighth': return 'combo wye';
    case 'reducer':      return 'reducer';
    case 'coupling':     return 'coupling';
    default:             return String(f.type);
  }
}
