/**
 * FixturePlacementPreview — translucent "ghost" model attached to the
 * cursor while a fixture is pending placement.
 *
 * Activates when customerStore.pendingFixture !== null. Tracks the
 * ground-plane intersection with the cursor each frame and renders a
 * dim copy of the fixture there so the user can see exactly where it
 * will drop on click.
 *
 * Also wires Escape to cancel the pending placement — without this,
 * once you pick a fixture the ONLY way to cancel was to pick another
 * or click somewhere random to drop one you don't want.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useCustomerStore } from '@store/customerStore';
import { FixtureModel } from './FixtureModels';
import { useFloorStore } from '@store/floorStore';

export function FixturePlacementPreview() {
  const pending = useCustomerStore((s) => s.pendingFixture);
  const setPendingFixture = useCustomerStore((s) => s.setPendingFixture);
  const activeFloor = useFloorStore((s) => s.floors[s.activeFloorId]);
  const floorY = activeFloor?.elevationBase ?? 0;

  const { raycaster, camera, pointer } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());
  const groupRef = useRef<THREE.Group>(null!);

  // Sync plane to floor height
  useEffect(() => {
    plane.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, floorY, 0),
    );
  }, [floorY]);

  // Escape cancels
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingFixture(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, setPendingFixture]);

  // Move the ghost to follow the cursor every frame
  useFrame(() => {
    if (!pending || !groupRef.current) return;
    raycaster.setFromCamera(pointer, camera);
    const h = raycaster.ray.intersectPlane(plane.current, hit.current);
    if (!h) return;
    // Snap to 1" grid for placement — matches wall snap precision
    const sx = Math.round(h.x * 12) / 12;
    const sz = Math.round(h.z * 12) / 12;
    groupRef.current.position.set(sx, floorY, sz);
  });

  if (!pending) return null;

  return (
    <group ref={groupRef}>
      {/* Translucent ghost fixture model */}
      <group>
        <FixtureModel position={[0, 0, 0]} subtype={pending.subtype} showGlow={false} />
      </group>

      {/* Gold placement ring at the drop point */}
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.8, 0.95, 48]} />
        <meshBasicMaterial
          color="#ffd54f"
          transparent
          opacity={0.75}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* Floating label */}
      <Billboard position={[0, 1.4, 0]}>
        <Text
          fontSize={0.12}
          color="#ffd54f"
          outlineWidth={0.008}
          outlineColor="#000"
          anchorY="middle"
        >
          {`◦ PLACE ${pending.variant.toUpperCase()}  ·  Esc to cancel`}
        </Text>
      </Billboard>
    </group>
  );
}
