/**
 * LiveRoutePreview — shows a solid pipe growing in real-time as the
 * user drags to create a route.
 *
 * Phase 14.Q rewrite:
 *
 *   Before: single CatmullRomCurve3 through all waypoints → splined
 *   curves that smoothly rounded every corner. Visually misleading
 *   for plumbing, which is always *segmented* (elbows + straight
 *   lengths). Fixed 2" diameter regardless of what diameter the user
 *   had selected.
 *
 *   After: segment-based cylinders, one per polyline edge, with the
 *   currently-selected diameter driving the radius. Matches what
 *   the committed PipeRenderer produces, so the live preview and
 *   the final geometry agree visually. Real pitch (drop-per-foot)
 *   shows up as actual Y delta between segment endpoints because
 *   the tube is now axis-aligned rather than splined.
 *
 * Subscribes to EV.PIPE_ROUTE_UPDATE (emitted during drag).
 * Clears on EV.PIPE_CANCEL or HILO_EV.ROUTES_GENERATED.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useEvent } from '@hooks/useEventBus';
import { useRafEvent } from '@hooks/useRafEvent';
import { EV, type Vec3, type PipeRouteUpdatePayload } from '@core/events';
import { HILO_EV } from '@core/hilo/HILOCoordinator';
import { useReducedMotion } from '@core/a11y/useReducedMotion';
import { useInteractionStore } from '@store/interactionStore';
import {
  buildRouteSegments,
  totalLength,
  classifySlope,
  type RouteSegment,
} from '@core/pipe/liveRouteBuild';
import { getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import { getColorForDiameter } from '@store/pipeStore';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// Cylinder orientation helper — applies the rotation that maps
// Three.js's default cylinder (Y-axis) to an arbitrary world-space
// direction. Reused across every segment; one scratch vector.
const SCRATCH_Q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const SCRATCH_DIR = new THREE.Vector3();

function segmentQuaternion(seg: RouteSegment): THREE.Quaternion {
  SCRATCH_DIR.set(seg.direction[0], seg.direction[1], seg.direction[2]);
  SCRATCH_Q.setFromUnitVectors(UP, SCRATCH_DIR);
  return SCRATCH_Q.clone();
}

// Slope verdict → color (matches committed PitchIndicators palette)
const SLOPE_COLOR = {
  compliant: '#00e676',
  marginal:  '#ffc107',
  undershot: '#ff1744',
  flat:      '#888888',
} as const;

// ── Main component ─────────────────────────────────────────────

export function LiveRoutePreview() {
  const [points, setPoints] = useState<Vec3[]>([]);
  const [active, setActive] = useState(false);

  // Live diameter + material from the interaction store so the
  // preview reflects the user's current pipe choice exactly.
  const diameter = useInteractionStore((s) => s.drawDiameter);
  const material = useInteractionStore((s) => s.drawMaterial);

  const reducedMotion = useReducedMotion();

  // rAF-coalesced — React setState on every pointermove churns the
  // fiber tree and cascades into the segment useMemo below. Throttling
  // to one update per frame removes that churn without changing perceived
  // responsiveness (display refresh is the ceiling anyway). (14.AC.1)
  useRafEvent<PipeRouteUpdatePayload>(EV.PIPE_ROUTE_UPDATE, (payload) => {
    if (payload.points.length >= 2) {
      setPoints([...payload.points]);
      setActive(true);
    }
  });

  useEvent(EV.PIPE_DRAG_START, () => {
    setActive(true);
    setPoints([]);
  });

  useEvent(EV.PIPE_CANCEL, () => {
    setActive(false);
    setPoints([]);
  });

  useEvent(HILO_EV.ROUTES_GENERATED, () => {
    setActive(false);
    setPoints([]);
  });

  // Pre-compute segments from the current polyline.
  const segments = useMemo(() => buildRouteSegments(points), [points]);

  const radiusFt = useMemo(
    () => getOuterRadiusFt(material as PipeMaterial, diameter),
    [material, diameter],
  );

  // Color the preview in the user's selected-diameter palette so
  // "3" waste" reads as green even in preview mode (consistent with
  // committed pipes' DIAMETER_COLORS).
  const baseColor = useMemo(() => getColorForDiameter(diameter), [diameter]);

  if (!active || segments.length === 0) return null;

  return (
    <group>
      {/* ── Straight segments — one cylinder per polyline edge ── */}
      {segments.map((seg, i) => (
        <LiveSegment
          key={i}
          seg={seg}
          radiusFt={radiusFt}
          baseColor={baseColor}
          reducedMotion={reducedMotion}
        />
      ))}

      {/* Start + head indicators — gold cap at the first point,
          cyan sphere at the last (the "drawing pen" tip). */}
      {points.length > 0 && (
        <StartRing point={points[0]!} radiusFt={radiusFt} />
      )}
      {points.length > 0 && (
        <HeadSphere point={points[points.length - 1]!} radiusFt={radiusFt} />
      )}

      {/* Pitch labels per segment — only for DWV (waste/storm)
          contexts. Supply pipes don't have a code-minimum slope,
          so labeling every segment would be noise. */}
      {segments.map((seg, i) => (
        <SegmentInfo
          key={`info-${i}`}
          seg={seg}
          diameter={diameter}
          material={material}
        />
      ))}

      {/* Running total length — floats at the live cursor. */}
      <TotalLengthBadge points={points} />
    </group>
  );
}

// ── Single segment cylinder ───────────────────────────────────

function LiveSegment({
  seg,
  radiusFt,
  baseColor,
  reducedMotion,
}: {
  seg: RouteSegment;
  radiusFt: number;
  baseColor: string;
  reducedMotion: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const quat = useMemo(() => segmentQuaternion(seg), [seg.direction]);

  // Soft pulse on opacity only — emissiveIntensity is kept static
  // so the color reading isn't washed out at peak pulse.
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const m = meshRef.current.material as THREE.MeshStandardMaterial;
    if (reducedMotion) {
      m.opacity = 0.55;
      return;
    }
    m.opacity = 0.5 + Math.sin(clock.elapsedTime * 2.5) * 0.07;
  });

  return (
    <mesh
      ref={meshRef}
      position={[seg.mid[0], seg.mid[1], seg.mid[2]]}
      quaternion={quat}
    >
      <cylinderGeometry args={[radiusFt, radiusFt, seg.length, 16, 1, false]} />
      <meshStandardMaterial
        color={baseColor}
        transparent
        opacity={0.55}
        metalness={0.3}
        roughness={0.45}
        emissive={baseColor}
        emissiveIntensity={0.35}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Per-segment info label (pitch + length) ───────────────────

function SegmentInfo({
  seg,
  diameter,
  material,
}: {
  seg: RouteSegment;
  diameter: number;
  material: string;
}) {
  // Only show pitch for DWV-relevant materials; supply pipe slope
  // is not a meaningful spec so leave supply lines unannotated to
  // reduce clutter.
  const isDWVMaterial = material === 'pvc_sch40'
    || material === 'pvc_sch80'
    || material === 'abs'
    || material === 'cast_iron';

  const verdict = classifySlope(seg.slopeInchesPerFoot, diameter);
  const color = SLOPE_COLOR[verdict];
  const label =
    seg.isVertical ? `${seg.length.toFixed(1)} ft · VERT`
    : isDWVMaterial && verdict !== 'flat'
      ? `${seg.length.toFixed(1)} ft · ${seg.slopeInchesPerFoot.toFixed(2)}"/ft`
      : `${seg.length.toFixed(1)} ft`;

  return (
    <Billboard position={[seg.mid[0], seg.mid[1] + 0.35, seg.mid[2]]}>
      {/* Pill background */}
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[Math.max(0.55, label.length * 0.07), 0.22]} />
        <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} />
      </mesh>
      <Text
        fontSize={0.11}
        color={color}
        outlineWidth={0.006}
        outlineColor="#000"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </Billboard>
  );
}

// ── Start ring ─────────────────────────────────────────────────

function StartRing({ point, radiusFt }: { point: Vec3; radiusFt: number }) {
  return (
    <mesh position={[point[0], point[1], point[2]]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[radiusFt * 2.2, radiusFt * 0.3, 8, 24]} />
      <meshStandardMaterial
        color="#ffd54f"
        transparent
        opacity={0.75}
        emissive="#ffd54f"
        emissiveIntensity={0.9}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Head sphere (drawing pen tip) ──────────────────────────────

function HeadSphere({ point, radiusFt }: { point: Vec3; radiusFt: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = 1 + Math.sin(clock.elapsedTime * 6) * 0.15;
    ref.current.scale.set(s, s, s);
  });
  return (
    <mesh ref={ref} position={[point[0], point[1], point[2]]}>
      <sphereGeometry args={[radiusFt * 1.6, 14, 14]} />
      <meshStandardMaterial
        color="#00e5ff"
        transparent
        opacity={0.85}
        emissive="#00e5ff"
        emissiveIntensity={1.4}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Running total length ───────────────────────────────────────

function TotalLengthBadge({ points }: { points: Vec3[] }) {
  const t = totalLength(points);
  if (t < 0.1) return null;
  const tail = points[points.length - 1]!;
  return (
    <Billboard position={[tail[0], tail[1] + 0.85, tail[2]]}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[1.1, 0.3]} />
        <meshBasicMaterial color="#0a0a0f" transparent opacity={0.92} />
      </mesh>
      <Text
        fontSize={0.15}
        color="#00e5ff"
        outlineWidth={0.008}
        outlineColor="#000"
        anchorX="center"
        anchorY="middle"
      >
        {`Σ ${t.toFixed(2)} ft`}
      </Text>
    </Billboard>
  );
}
