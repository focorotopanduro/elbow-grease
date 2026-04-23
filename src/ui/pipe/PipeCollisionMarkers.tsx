/**
 * PipeCollisionMarkers — Phase 14.X
 *
 * Renders pulsing markers at every location where two committed
 * pipes physically overlap. Complements `InterferenceVisualizer`
 * (which shows pipe-vs-structural-element during route preview) by
 * covering the "two pipes already in the scene intersect each other"
 * case — the common 3D-engine failure mode that produces z-fighting
 * and visual tearing.
 *
 * Visual language:
 *   • Red pulsing sphere at `clip` severity (tubes literally intersect)
 *   • Amber sphere at `overlap` severity (within half clearance)
 *   • No marker at `touch` (within full clearance but not overlapping)
 *
 * Runs inside a `useMemo` keyed on the pipes map so the collision
 * detection only re-runs when a pipe actually mutates. For typical
 * scenes (≤ 500 pipes) the detector is sub-50 ms; no throttling
 * needed. For 1000+ scenes we can add a debounce.
 */

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { usePipeStore } from '@store/pipeStore';
import {
  detectPipePipeCollisions,
  type PipeCollision,
} from '@core/interference/pipeCollision';

// ── Marker component ──────────────────────────────────────────

function CollisionMarker({ collision }: { collision: PipeCollision }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    // Pulse a bit faster for clip severity so the user eyes it first
    const speed = collision.severity === 'clip' ? 6 : 3.5;
    const amp = collision.severity === 'clip' ? 0.4 : 0.2;
    const s = 1 + Math.sin(clock.elapsedTime * speed) * amp;
    ref.current.scale.setScalar(s);
  });

  const color = collision.severity === 'clip' ? '#ff1744' : '#ffa726';
  const radius = collision.severity === 'clip' ? 0.22 : 0.16;
  const label =
    collision.severity === 'clip' ? 'CLIP' :
    collision.severity === 'overlap' ? 'overlap' : '';

  return (
    <group position={collision.position}>
      {/* Sphere marker — emissive so it pops in dim scenes. The
          raycast opt-out means this doesn't block fixture/pipe
          clicks underneath. */}
      <mesh ref={ref} raycast={() => null}>
        <sphereGeometry args={[radius, 16, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.4}
          transparent
          opacity={0.7}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Label floats above. Only for clip — amber overlaps get
          no label to reduce visual noise in dense scenes. */}
      {label && (
        <Billboard position={[0, 0.6, 0]}>
          <mesh position={[0, 0, -0.005]} raycast={() => null}>
            <planeGeometry args={[0.5, 0.2]} />
            <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} />
          </mesh>
          <Text
            fontSize={0.13}
            color={color}
            outlineWidth={0.008}
            outlineColor="#000"
            anchorX="center"
            anchorY="middle"
          >
            {label}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

// ── Main ──────────────────────────────────────────────────────

export function PipeCollisionMarkers() {
  const pipes = usePipeStore((s) => s.pipes);

  const collisions = useMemo(() => {
    const list = Object.values(pipes);
    if (list.length < 2) return [];
    // Only flag clip + overlap (not touch) to reduce visual noise.
    // Touch is "within 1 inch of clearance" which is a valid layout
    // warning but shouldn't dominate a busy scene.
    return detectPipePipeCollisions(list).filter(
      (c) => c.severity !== 'touch',
    );
  }, [pipes]);

  if (collisions.length === 0) return null;

  return (
    <group>
      {collisions.map((c, i) => (
        <CollisionMarker
          key={`${c.pipeA}-${c.pipeB}-${c.segmentA}-${c.segmentB}-${i}`}
          collision={c}
        />
      ))}
    </group>
  );
}
