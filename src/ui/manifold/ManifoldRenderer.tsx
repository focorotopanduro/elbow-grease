/**
 * ManifoldRenderer — 3D renderer + drag handler for PEX manifolds.
 *
 * Visual per manifold:
 *   • Trunk body     — rectangular block along local +X, length
 *                      scales with portCount.
 *   • Port tubes     — short cylinders extending from the trunk on
 *                      local +Z for each port.
 *   • Port collars   — small torus rings at each port base.
 *   • Selection ring — amber torus under the trunk when selected.
 *
 * Drag flow (Phase 7.C):
 *   1. Pointerdown on a manifold → start drag session.
 *   2. Move → dispatches `manifold.move` each pointermove for live feedback.
 *   3. Pointerup → dispatches `manifold.mergeNeighbors` to attempt
 *      a merge with any adjacent parallel manifold.
 *
 * Navigation freeze (`Space` hold) is auto-applied via
 * `setNavFrozen(true)` at drag start so orbit can't fight the drag.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useManifoldStore } from '@store/manifoldStore';
import { useInteractionStore } from '@store/interactionStore';
import { commandBus } from '@core/commands/CommandBus';
import {
  trunkLengthFt,
  computePortPositions,
  TRUNK_DIAMETER_FT,
  PORT_EXTENSION_FT,
  type Manifold,
} from '@core/manifold/ManifoldGeometry';
import type { Vec3 } from '@core/events';

// Visual sizing
const TRUNK_HEIGHT_FT = TRUNK_DIAMETER_FT;          // square cross-section
const TRUNK_DEPTH_FT = TRUNK_DIAMETER_FT;
const PORT_RADIUS_FT_DEFAULT = 0.5 / 24;            // ½" default — overridden per-port

// ── System colors ──────────────────────────────────────────────

const SYSTEM_COLORS: Record<string, string> = {
  cold_supply: '#29b6f6',
  hot_supply:  '#ff7043',
  waste:       '#ef5350',
  vent:        '#66bb6a',
  storm:       '#78909c',
};

// ── Main component ─────────────────────────────────────────────

export function ManifoldRenderer() {
  const manifolds = useManifoldStore((s) => s.manifolds);
  const selectedId = useManifoldStore((s) => s.selectedId);

  const list = useMemo(() => Object.values(manifolds), [manifolds]);
  if (list.length === 0) return null;

  return (
    <group>
      {list.map((m) => (
        <ManifoldBody key={`${m.id}-${m.portCount}`} manifold={m} isSelected={m.id === selectedId} />
      ))}
    </group>
  );
}

// ── One manifold body + ports + drag hitbox ────────────────────

function ManifoldBody({ manifold, isSelected }: { manifold: Manifold; isSelected: boolean }) {
  const moveManifold = useManifoldStore((s) => s.moveManifold);
  const selectManifold = useManifoldStore((s) => s.selectManifold);
  const setNavFrozen = useInteractionStore((s) => s.setNavFrozen);
  const { camera, raycaster, gl } = useThree();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -manifold.center[1]));
  const hitPoint = useRef(new THREE.Vector3());

  const length = trunkLengthFt(manifold.portCount);
  const ports = computePortPositions(manifold);
  const trunkColor = SYSTEM_COLORS[manifold.system] ?? '#a0aec0';

  // Body position: group's origin = manifold.center. Rotate around Y
  // so local +X matches the yaw.
  const bodyQuat = useMemo(() => {
    // Three's group uses rotation-y for yaw around world Y.
    return null; // we use the rotation-y prop directly below
  }, []);
  void bodyQuat;

  // ── Drag handlers ───────────────────────────────────────────

  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef<Vec3>([0, 0, 0]);

  const ndcFromEvent = (ev: PointerEvent) => {
    const el = gl.domElement;
    const rect = el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    return new THREE.Vector2(x, y);
  };

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.nativeEvent?.stopImmediatePropagation?.();
    // Record offset so the manifold doesn't jump to cursor on drag start —
    // it stays attached at whichever point the user grabbed.
    const hit = e.point;
    dragOffsetRef.current = [
      hit.x - manifold.center[0],
      0,
      hit.z - manifold.center[2],
    ];
    setDragging(true);
    selectManifold(manifold.id);
    setNavFrozen(true);
  }, [manifold.center, manifold.id, selectManifold, setNavFrozen]);

  // Window-level pointermove + pointerup so drags continue even off-body.
  useEffect(() => {
    if (!dragging) return;

    const onMove = (ev: PointerEvent) => {
      const ndc = ndcFromEvent(ev);
      raycaster.setFromCamera(ndc, camera);
      const p = raycaster.ray.intersectPlane(groundPlane.current, hitPoint.current);
      if (!p) return;
      const grid = useInteractionStore.getState().gridSnap || 0.25;
      const [offx, , offz] = dragOffsetRef.current;
      const newCenter: Vec3 = [
        Math.round((p.x - offx) / grid) * grid,
        manifold.center[1],
        Math.round((p.z - offz) / grid) * grid,
      ];
      moveManifold(manifold.id, newCenter);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      setDragging(false);
      setNavFrozen(false);
      // Attempt a merge with adjacent manifolds. Routed through the
      // command bus for traceability + undo support.
      commandBus.dispatch({
        type: 'manifold.mergeNeighbors',
        payload: { id: manifold.id },
      });
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Cancel drag without merging — stays at its current position.
      setDragging(false);
      setNavFrozen(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [dragging, manifold.id, manifold.center, camera, raycaster, gl, moveManifold, setNavFrozen]);

  // ── Render ──────────────────────────────────────────────────

  return (
    <group position={manifold.center}>
      <group rotation-y={manifold.yawRad}>
        {/* Trunk body */}
        <mesh
          onPointerDown={onPointerDown}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[length, TRUNK_HEIGHT_FT, TRUNK_DEPTH_FT]} />
          <meshStandardMaterial
            color={trunkColor}
            metalness={0.55}
            roughness={0.35}
            emissive={dragging ? trunkColor : '#000000'}
            emissiveIntensity={dragging ? 0.15 : 0}
          />
        </mesh>

        {/* End caps on the trunk */}
        <TrunkEndCap x={+length / 2} color={trunkColor} />
        <TrunkEndCap x={-length / 2} color={trunkColor} />

        {/* Selection ring (under the body) */}
        {isSelected && (
          <mesh position={[0, -TRUNK_HEIGHT_FT * 0.6, 0]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[length * 0.55, length * 0.62, 32]} />
            <meshBasicMaterial
              color="#ffc107"
              transparent
              opacity={0.6}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        )}
      </group>

      {/* Port tubes — computed in world space so no double-rotation needed */}
      {ports.map((port, i) => (
        <PortTube
          key={i}
          // Positions are already in world space relative to the group
          // origin (which is the manifold center). Back out the center
          // since the group's position="manifold.center" already offsets.
          worldPosition={[
            port.worldPosition[0] - manifold.center[0],
            port.worldPosition[1] - manifold.center[1],
            port.worldPosition[2] - manifold.center[2],
          ]}
          outward={port.outward}
          diameterIn={manifold.portDiameterIn}
          color={trunkColor}
        />
      ))}
    </group>
  );
}

// ── Port tube (small cylinder + collar ring) ───────────────────

function PortTube({
  worldPosition, outward, diameterIn, color,
}: {
  worldPosition: Vec3;
  outward: Vec3;
  diameterIn: number;
  color: string;
}) {
  const portR = Math.max(PORT_RADIUS_FT_DEFAULT, diameterIn / 24);
  const portLen = PORT_EXTENSION_FT;

  const quat = useMemo(() => {
    const v = new THREE.Vector3(outward[0], outward[1], outward[2]).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
  }, [outward[0], outward[1], outward[2]]);

  // Cylinder centered along its length; place it so one end touches
  // the trunk (pull back by portLen/2 toward the trunk along outward).
  const halfOut = portLen / 2;
  const basePos: Vec3 = [
    worldPosition[0] - outward[0] * halfOut,
    worldPosition[1] - outward[1] * halfOut,
    worldPosition[2] - outward[2] * halfOut,
  ];

  return (
    <group position={basePos} quaternion={quat}>
      <mesh position={[0, halfOut, 0]} castShadow>
        <cylinderGeometry args={[portR, portR, portLen, 16]} />
        <meshStandardMaterial
          color={color}
          metalness={0.55}
          roughness={0.35}
        />
      </mesh>
      {/* Collar at base of port */}
      <mesh position={[0, 0, 0]} rotation-x={Math.PI / 2} castShadow>
        <torusGeometry args={[portR * 1.25, portR * 0.18, 8, 20]} />
        <meshStandardMaterial
          color="#cfd8dc"
          metalness={0.7}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

function TrunkEndCap({ x, color }: { x: number; color: string }) {
  return (
    <mesh position={[x, 0, 0]} rotation-z={Math.PI / 2} castShadow>
      <cylinderGeometry args={[TRUNK_HEIGHT_FT * 0.55, TRUNK_HEIGHT_FT * 0.55, 0.02, 12]} />
      <meshStandardMaterial
        color={color}
        metalness={0.55}
        roughness={0.35}
      />
    </mesh>
  );
}
