/**
 * Sensory Feedback — R3F components that react to EventBus signals.
 *
 * These are the "visual verbs" of the gamified UX:
 *   GlowRing      — pulsing ring on attachment points (CUE)
 *   CollisionFlash — red sphere flash at collision site (CUE)
 *   SnapBurst      — expanding ring on successful snap (REWARD)
 *   CompletePulse  — radial shockwave on route commit (REWARD)
 *
 * Every component subscribes via useEvent — zero coupling to the
 * simulation engine.
 */

import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEvent } from '@hooks/useEventBus';
import { EV, type CuePayload, type RewardPayload } from '@core/events';

// ── GlowRing ────────────────────────────────────────────────────
// Renders a pulsing torus at a given position to signal "attach here."

interface GlowRingProps {
  position: [number, number, number];
  color?: string;
  active?: boolean;
}

export function GlowRing({ position, color = '#00e5ff', active = true }: GlowRingProps) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const s = active ? 1 + Math.sin(clock.elapsedTime * 3) * 0.15 : 1;
    ref.current.scale.setScalar(s);
    (ref.current.material as THREE.MeshStandardMaterial).opacity =
      active ? 0.5 + Math.sin(clock.elapsedTime * 3) * 0.3 : 0.15;
  });

  return (
    <mesh ref={ref} position={position} rotation-x={Math.PI / 2}>
      <torusGeometry args={[0.15, 0.03, 16, 32]} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.5}
        emissive={color}
        emissiveIntensity={1.5}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── CollisionFlash ──────────────────────────────────────────────
// Red sphere that flashes at a collision point then fades out.

export function CollisionFlash() {
  const ref = useRef<THREE.Mesh>(null!);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  const [visible, setVisible] = useState(false);
  const startTime = useRef(0);

  useEvent<CuePayload>(EV.CUE, (payload) => {
    if (payload.type === 'highlight' && payload.position) {
      setPos(payload.position);
      setVisible(true);
      startTime.current = performance.now();
    }
  });

  useFrame(() => {
    if (!visible || !ref.current) return;
    const elapsed = (performance.now() - startTime.current) / 1000;
    const fade = Math.max(0, 1 - elapsed / 0.8);
    ref.current.scale.setScalar(1 + elapsed * 2);
    (ref.current.material as THREE.MeshStandardMaterial).opacity = fade * 0.7;
    if (fade <= 0) setVisible(false);
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} position={pos}>
      <sphereGeometry args={[0.1, 16, 16]} />
      <meshStandardMaterial
        color="#ff1744"
        transparent
        opacity={0.7}
        emissive="#ff1744"
        emissiveIntensity={2}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── SnapBurst ───────────────────────────────────────────────────
// Expanding ring effect when a pipe segment snaps into place.

export function SnapBurst() {
  const ref = useRef<THREE.Mesh>(null!);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  const [visible, setVisible] = useState(false);
  const startTime = useRef(0);

  useEvent<RewardPayload>(EV.REWARD, (payload) => {
    if (payload.type === 'snap' && payload.position) {
      setPos(payload.position);
      setVisible(true);
      startTime.current = performance.now();
    }
  });

  useFrame(() => {
    if (!visible || !ref.current) return;
    const elapsed = (performance.now() - startTime.current) / 1000;
    const progress = elapsed / 0.5; // 500ms animation
    ref.current.scale.setScalar(1 + progress * 3);
    (ref.current.material as THREE.MeshStandardMaterial).opacity =
      Math.max(0, 0.8 * (1 - progress));
    if (progress >= 1) setVisible(false);
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} position={pos} rotation-x={Math.PI / 2}>
      <torusGeometry args={[0.2, 0.015, 8, 32]} />
      <meshStandardMaterial
        color="#00e676"
        transparent
        opacity={0.8}
        emissive="#00e676"
        emissiveIntensity={2}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── CompletePulse ───────────────────────────────────────────────
// Radial shockwave when an entire route is committed.

export function CompletePulse() {
  const ref = useRef<THREE.Mesh>(null!);
  const [pos, setPos] = useState<[number, number, number]>([0, 0, 0]);
  const [visible, setVisible] = useState(false);
  const startTime = useRef(0);

  useEvent<RewardPayload>(EV.REWARD, (payload) => {
    if (payload.type === 'complete' && payload.position) {
      setPos(payload.position);
      setVisible(true);
      startTime.current = performance.now();
    }
  });

  useFrame(() => {
    if (!visible || !ref.current) return;
    const elapsed = (performance.now() - startTime.current) / 1000;
    const progress = elapsed / 1.0; // 1 second animation
    ref.current.scale.setScalar(1 + progress * 8);
    (ref.current.material as THREE.MeshStandardMaterial).opacity =
      Math.max(0, 0.6 * (1 - progress));
    if (progress >= 1) setVisible(false);
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} position={pos} rotation-x={Math.PI / 2}>
      <ringGeometry args={[0.8, 1.0, 64]} />
      <meshStandardMaterial
        color="#448aff"
        transparent
        opacity={0.6}
        emissive="#448aff"
        emissiveIntensity={3}
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
