/**
 * FixturePlacementPreview — translucent "ghost" model attached to the
 * cursor while a fixture is pending placement, PLUS an invisible R3F
 * drop-catcher plane that commits the placement on click.
 *
 * Activates when customerStore.pendingFixture !== null.
 *
 * Why an R3F drop catcher (vs the old canvas-level DOM click listener):
 *
 *   The previous approach used `canvas.addEventListener('click', …)`
 *   in AutoRouteTrigger. That listener sat OUTSIDE the R3F event
 *   system, so any R3F handler that called
 *   `e.nativeEvent.stopImmediatePropagation()` — which the fixture
 *   hitbox did on every pointerdown — could swallow the click before
 *   it reached the canvas listener.
 *
 *   Symptom: when you tried to drop a new fixture near an existing
 *   one, the drop silently failed because the existing fixture's
 *   hitbox captured the click.
 *
 *   The fix is two-fold:
 *     1. An invisible R3F plane here catches the drop click inside
 *        the R3F event system, so propagation order is deterministic.
 *     2. `FixtureHitbox` (FixtureModels.tsx) opts OUT of raycasting
 *        whenever pendingFixture is set, so existing fixtures are
 *        click-transparent during placement. Clicks pass straight
 *        through to this catcher.
 *
 * Escape still cancels the pending placement.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Text } from '@react-three/drei';
import { useCustomerStore } from '@store/customerStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useInteractionStore } from '@store/interactionStore';
import { useFloorStore } from '@store/floorStore';
import type { Vec3 } from '@core/events';
import { FixtureModel } from './FixtureModels';

/** Size of the invisible drop-catcher plane in ft. Large enough to
 *  cover any reasonable zoom level; mesh is invisible so no render cost. */
const CATCHER_SIZE = 400;

export function FixturePlacementPreview() {
  const pending = useCustomerStore((s) => s.pendingFixture);
  const setPendingFixture = useCustomerStore((s) => s.setPendingFixture);
  const activeFloor = useFloorStore((s) => s.floors[s.activeFloorId]);
  const floorY = activeFloor?.elevationBase ?? 0;

  const { raycaster, camera, pointer } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());
  const groupRef = useRef<THREE.Group>(null!);

  // Keep the ghost-projection plane anchored at the active floor Y.
  useEffect(() => {
    plane.current.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, floorY, 0),
    );
  }, [floorY]);

  // Escape cancels (redundant with App.tsx's chain, but kept so this
  // component is self-contained and works even if the chain changes).
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingFixture(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, setPendingFixture]);

  // Move the ghost to follow the cursor every frame.
  useFrame(() => {
    if (!pending || !groupRef.current) return;
    raycaster.setFromCamera(pointer, camera);
    const h = raycaster.ray.intersectPlane(plane.current, hit.current);
    if (!h) return;
    // Snap to 1" grid for placement — matches wall snap precision.
    const sx = Math.round(h.x * 12) / 12;
    const sz = Math.round(h.z * 12) / 12;
    groupRef.current.position.set(sx, floorY, sz);
  });

  if (!pending) return null;

  // ── Drop commit handler (R3F event path) ─────────────────────
  const onDrop = (e: ThreeEvent<MouseEvent>): void => {
    if (!pending) return;
    e.stopPropagation();
    // Left-button only.
    if (e.nativeEvent.button !== 0) return;
    // Don't drop while user is in Draw mode (pipe drawing owns clicks there).
    const mode = useInteractionStore.getState().mode;
    if (mode === 'draw') return;

    const pt = e.point;
    // Snap to 1" grid (match ghost).
    const dropPos: Vec3 = [
      Math.round(pt.x * 12) / 12,
      floorY,
      Math.round(pt.z * 12) / 12,
    ];

    // Commit. `fixtureStore.addFixture` internally emits EV.FIXTURE_PLACED
    // with the real fixture id; AutoRouteTrigger subscribes to that
    // event for its auto-route work, so we don't need a second emit.
    useFixtureStore.getState().addFixture(pending.subtype, dropPos, {
      tag: pending.variant,
    });

    // Clear AFTER the placement so the FIXTURE_PLACED handler can
    // still read `pendingFixture` to resolve the customer template.
    setPendingFixture(null);
  };

  return (
    <>
      {/* ── GHOST — visual preview, click-transparent ─────────── */}
      <group ref={groupRef}>
        {/* Translucent ghost fixture model */}
        <group>
          <FixtureModel position={[0, 0, 0]} subtype={pending.subtype} showGlow={false} />
        </group>

        {/* Gold placement ring at the drop point */}
        <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
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

      {/* ── DROP CATCHER — large invisible plane at floor height.
          Inside the R3F event graph so propagation order is
          deterministic: existing fixture hitboxes go click-
          transparent during placement (see FixtureModels.tsx
          `FixtureHitbox.raycast` gate), and clicks fall through
          to this plane. Covers a 400ft square so even zoomed-out
          views have full coverage. */}
      <mesh
        position={[0, floorY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={onDrop}
      >
        <planeGeometry args={[CATCHER_SIZE, CATCHER_SIZE]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </>
  );
}
