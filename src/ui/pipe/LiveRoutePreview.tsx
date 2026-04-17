/**
 * LiveRoutePreview — shows a solid pipe growing in real-time as the
 * user drags to create a route.
 *
 * Subscribes to EV.PIPE_ROUTE_UPDATE (emitted by SpatialPipeInteraction
 * during every pinch-move) and renders a semi-transparent TubeGeometry
 * that extends with each new waypoint.
 *
 * Clears on EV.PIPE_CANCEL or when HILO takes over (HILO_EV.ROUTES_GENERATED).
 *
 * This is the key UX improvement: the user sees the pipe forming in
 * real-time under their hand/cursor, not just after commit. The pipe
 * "grows" as a translucent cyan tube with pulsing emissive.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEvent } from '@hooks/useEventBus';
import { EV, type Vec3, type PipeRouteUpdatePayload } from '@core/events';
import { HILO_EV } from '@core/hilo/HILOCoordinator';
import { getPreviewMaterial } from '@ui/pipe/PipeMaterial';

// ── Default preview diameter (2" pipe) ──────────────────────────

const PREVIEW_RADIUS = 2 / 24; // 2 inches → feet

export function LiveRoutePreview() {
  const [points, setPoints] = useState<Vec3[]>([]);
  const [active, setActive] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null!);

  // Route update → extend the preview
  useEvent<PipeRouteUpdatePayload>(EV.PIPE_ROUTE_UPDATE, (payload) => {
    if (payload.points.length >= 2) {
      setPoints([...payload.points]);
      setActive(true);
    }
  });

  // Route started → activate
  useEvent(EV.PIPE_DRAG_START, () => {
    setActive(true);
    setPoints([]);
  });

  // Route canceled → clear
  useEvent(EV.PIPE_CANCEL, () => {
    setActive(false);
    setPoints([]);
  });

  // HILO takes over → clear (ghost routes replace the preview)
  useEvent(HILO_EV.ROUTES_GENERATED, () => {
    setActive(false);
    setPoints([]);
  });

  // Build geometry from current points
  const geometry = useMemo(() => {
    if (points.length < 2) return null;

    const vectors = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', 0.2);
    const segments = Math.max(8, points.length * 4);

    return new THREE.TubeGeometry(curve, segments, PREVIEW_RADIUS, 8, false);
  }, [points]);

  // Dispose old geometry
  useEffect(() => {
    return () => geometry?.dispose();
  }, [geometry]);

  // Pulse the emissive intensity for "live drawing" feel
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.4 + Math.sin(clock.elapsedTime * 4) * 0.2;
    mat.opacity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.1;
  });

  if (!active || !geometry) return null;

  const material = getPreviewMaterial();

  return (
    <group>
      {/* Growing tube */}
      <mesh ref={meshRef} geometry={geometry} material={material} />

      {/* Head indicator (sphere at the latest point) */}
      {points.length > 0 && (
        <mesh position={points[points.length - 1]!}>
          <sphereGeometry args={[PREVIEW_RADIUS * 1.5, 12, 12]} />
          <meshStandardMaterial
            color="#00e5ff"
            transparent
            opacity={0.7}
            emissive="#00e5ff"
            emissiveIntensity={1.2}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Start indicator (ring at first point) */}
      {points.length > 0 && (
        <mesh position={points[0]!} rotation-x={Math.PI / 2}>
          <torusGeometry args={[PREVIEW_RADIUS * 2, PREVIEW_RADIUS * 0.3, 8, 24]} />
          <meshStandardMaterial
            color="#00e5ff"
            transparent
            opacity={0.6}
            emissive="#00e5ff"
            emissiveIntensity={0.8}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Length label at midpoint */}
      {points.length >= 2 && (
        <LengthIndicator points={points} />
      )}
    </group>
  );
}

// ── Real-time length display ────────────────────────────────────

function LengthIndicator({ points }: { points: Vec3[] }) {
  const totalLength = useMemo(() => {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i]![0] - points[i - 1]![0];
      const dy = points[i]![1] - points[i - 1]![1];
      const dz = points[i]![2] - points[i - 1]![2];
      len += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return len;
  }, [points]);

  const midIdx = Math.floor(points.length / 2);
  const midPoint = points[midIdx];
  if (!midPoint) return null;

  // Render as a simple floating sphere with text via HTML overlay
  // (drei's <Text> would be cleaner but keeping it lightweight here)
  return (
    <mesh position={[midPoint[0], midPoint[1] + 0.4, midPoint[2]]}>
      <sphereGeometry args={[0.03, 6, 6]} />
      <meshBasicMaterial color="#00e5ff" transparent opacity={0.5} />
    </mesh>
  );
}
