/**
 * CapPlug — NPT-style pipe cap with the characteristic outer retaining
 * ring. Used to mark an endpoint that was orphaned when its adjacent
 * pipe was deleted.
 *
 *   │         │        │         │    ← the live pipe (cylinder)
 *   │    ◉    │        │    ◉    │    ← outer ring (thin torus)
 *   │         │   →    ╚═════════╝    ← plug cap (half-sphere + collar)
 *    \       /
 *     \-----/
 *
 * Shapes chosen for readability at all zoom levels:
 *   • Short cylinder "collar" around the pipe diameter — the visible
 *     "plug" portion.
 *   • Half-sphere end-cap on the outward face.
 *   • Thin outer torus ring in the pipe's system color — the retaining
 *     ring the user described ("a pug and ring around the plug").
 *
 * The facing direction is specified via a normalized outward vector so
 * the plug always orients away from the pipe centerline.
 *
 * Production usage is gated by connectivity tracking which doesn't yet
 * exist (documented in ADR 007 as a Phase 7 prerequisite). Until that
 * lands, this component is exported and unit-testable but unmounted.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

// ── Component ─────────────────────────────────────────────────

export interface CapPlugProps {
  /** World-space position of the pipe endpoint. */
  position: [number, number, number];
  /** Outward-facing normal vector (normalized). Plug faces this way. */
  outward: [number, number, number];
  /** Pipe outer diameter in inches. */
  pipeDiameterIn: number;
  /** Ring + accent color — defaults to a neutral steel grey. */
  color?: string;
  /** Ring color — defaults to a subdued orange "warning" tone since a
   *  capped endpoint signals the route is intentionally terminated. */
  ringColor?: string;
}

export function CapPlug({
  position,
  outward,
  pipeDiameterIn,
  color = '#8a9bae',
  ringColor = '#ffa726',
}: CapPlugProps) {
  const pipeR = pipeDiameterIn / 24;       // feet
  const collarR = pipeR * 1.15;            // slight flare
  const collarLen = pipeR * 0.9;           // short collar
  const ringR = collarR * 1.18;            // outer retaining ring radius
  const ringTubeR = collarR * 0.09;        // ring thickness
  const endSphereR = collarR * 0.88;       // dome cap radius

  // Quaternion aligning the group's +Y axis to `outward` — all the
  // inner shapes are authored along +Y and rotated as one.
  const quaternion = useMemo(() => {
    const v = new THREE.Vector3(outward[0], outward[1], outward[2]).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  }, [outward]);

  return (
    <group position={position} quaternion={quaternion}>
      {/* Collar (short cylinder that slides onto the pipe end) */}
      <mesh position={[0, collarLen / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[collarR, collarR, collarLen, 20]} />
        <meshStandardMaterial
          color={color}
          metalness={0.55}
          roughness={0.45}
        />
      </mesh>

      {/* Retaining ring — torus wrapped around the collar midpoint */}
      <mesh
        position={[0, collarLen / 2, 0]}
        rotation-x={Math.PI / 2}
        castShadow
      >
        <torusGeometry args={[ringR, ringTubeR, 8, 24]} />
        <meshStandardMaterial
          color={ringColor}
          emissive={ringColor}
          emissiveIntensity={0.2}
          metalness={0.7}
          roughness={0.35}
          toneMapped={false}
        />
      </mesh>

      {/* End dome — the "sealed" side */}
      <mesh
        position={[0, collarLen, 0]}
        castShadow
      >
        <sphereGeometry args={[endSphereR, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color={color}
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
