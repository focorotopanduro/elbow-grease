/**
 * ManifoldPlacement — Phase 7.C.ii.
 *
 * Pressing `M` (when not in Draw mode + no text input focused) enters
 * a placement session: a translucent ghost manifold follows the cursor
 * on the ground plane. Click commits; Escape cancels.
 *
 * This is the MVP version of the "weapon-wheel manifold placement"
 * deferred in ADR 010. A future phase can surface the same entry via
 * a FittingWheel sector; the underlying session is reusable.
 *
 * Also renders a SNAP HINT while an existing manifold is being
 * dragged: a faint ring around the dragged manifold AND around any
 * eligible merge neighbor within snap distance.
 */

import { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useManifoldStore } from '@store/manifoldStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { commandBus } from '@core/commands/CommandBus';
import {
  trunkLengthFt,
  computePortPositions,
  TRUNK_DIAMETER_FT,
  PORT_EXTENSION_FT,
  checkManifoldMerge,
  type Manifold,
} from '@core/manifold/ManifoldGeometry';
import type { Vec3 } from '@core/events';

// ── Session state (module singleton) ──────────────────────────

interface PlacementSession {
  cursor: Vec3;
  yawRad: number;
}
let active: PlacementSession | null = null;
const listeners = new Set<() => void>();
function notify() { for (const l of listeners) l(); }

export function beginManifoldPlacement(): void {
  if (active) return;
  usePlumbingDrawStore.getState().setNavFrozen(true);
  active = { cursor: [0, 0, 0], yawRad: 0 };
  notify();
}

export function cancelManifoldPlacement(): void {
  if (!active) return;
  active = null;
  usePlumbingDrawStore.getState().setNavFrozen(false);
  notify();
}

function commitManifoldPlacement(): void {
  const s = active;
  if (!s) return;
  active = null;
  usePlumbingDrawStore.getState().setNavFrozen(false);
  notify();
  commandBus.dispatch({
    type: 'manifold.add',
    payload: {
      position: s.cursor,
      yawRad: s.yawRad,
      portCount: 2,
      system: 'cold_supply',
      material: 'pex',
      portDiameterIn: 0.5,
      floorY: s.cursor[1],
    },
  });
}

export function isManifoldPlacementActive(): boolean {
  return active !== null;
}

// ── Renderer (ghost + snap hint) ──────────────────────────────

export function ManifoldPlacement() {
  useWindowListeners();
  const [, force] = useState(0);
  useEffect(() => {
    listeners.add(() => force((x) => x + 1));
    return () => { listeners.clear(); };
  }, []);

  const manifolds = useManifoldStore((s) => s.manifolds);
  const selectedId = useManifoldStore((s) => s.selectedId);

  return (
    <>
      {/* Placement ghost while M-session is active */}
      {active && <PlacementGhost session={active} />}

      {/* Snap hints for merges while dragging an existing manifold */}
      <SnapHints manifolds={manifolds} selectedId={selectedId} />
    </>
  );
}

// ── Window input listeners ────────────────────────────────────

function useWindowListeners() {
  const { camera, raycaster, gl } = useThree();
  const ground = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;

    const ndc = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) return;
      raycaster.setFromCamera(ndc(ev), camera);
      const p = raycaster.ray.intersectPlane(ground.current, hit.current);
      if (!p) return;
      const grid = usePlumbingDrawStore.getState().gridSnap || 0.25;
      active = {
        ...active,
        cursor: [
          Math.round(p.x / grid) * grid,
          0,
          Math.round(p.z / grid) * grid,
        ],
      };
      notify();
    };

    const onDown = (ev: PointerEvent) => {
      if (!active) return;
      if (ev.button !== 0) return;
      // Consume the click so the Canvas click doesn't also register.
      ev.stopPropagation();
      commitManifoldPlacement();
    };

    const onKey = (ev: KeyboardEvent) => {
      if (!active) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelManifoldPlacement();
      } else if (ev.key.toLowerCase() === 'r') {
        // Rotate ghost 90° on R — useful for aiming port face before commit.
        ev.preventDefault();
        active = { ...active, yawRad: active.yawRad + Math.PI / 2 };
        notify();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [camera, raycaster, gl]);
}

// ── Placement ghost ───────────────────────────────────────────

function PlacementGhost({ session }: { session: PlacementSession }) {
  const length = trunkLengthFt(2);
  const color = '#00ffa6';

  return (
    <group position={session.cursor} rotation-y={session.yawRad}>
      {/* Ghost trunk */}
      <mesh>
        <boxGeometry args={[length, TRUNK_DIAMETER_FT, TRUNK_DIAMETER_FT]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.45}
          emissive={color}
          emissiveIntensity={0.3}
          depthWrite={false}
        />
      </mesh>
      {/* Two ghost port stubs */}
      {[-length / 4, +length / 4].map((x, i) => (
        <mesh key={i} position={[x, 0, PORT_EXTENSION_FT / 2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.03, 0.03, PORT_EXTENSION_FT, 12]} />
          <meshStandardMaterial color={color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

// ── Snap hints during drag ────────────────────────────────────
//
// When a manifold is selected AND its center is changing frame-to-frame
// (a rough proxy for "being dragged"), highlight any other manifold
// within merge distance as a "snap candidate" with a pulsing ring.

function SnapHints({
  manifolds, selectedId,
}: {
  manifolds: Record<string, Manifold>;
  selectedId: string | null;
}) {
  const [hints, setHints] = useState<string[]>([]);
  const lastSelectedCenter = useRef<Vec3 | null>(null);
  const dragActiveRef = useRef(false);

  useFrame(() => {
    if (!selectedId) {
      if (hints.length > 0) setHints([]);
      dragActiveRef.current = false;
      lastSelectedCenter.current = null;
      return;
    }
    const sel = manifolds[selectedId];
    if (!sel) return;
    const prev = lastSelectedCenter.current;
    const moved = !prev || dist(prev, sel.center) > 1e-4;
    lastSelectedCenter.current = sel.center;
    dragActiveRef.current = moved || dragActiveRef.current;

    // Only look for neighbors while the selected manifold appears to
    // be moving. When it's stationary, don't flicker the hint ring.
    if (!moved) return;

    const candidates: string[] = [];
    for (const other of Object.values(manifolds)) {
      if (other.id === selectedId) continue;
      const check = checkManifoldMerge(sel, other);
      if (check.canMerge) candidates.push(other.id);
    }
    if (!sameSet(candidates, hints)) {
      setHints(candidates);
    }
  });

  if (hints.length === 0) return null;

  return (
    <group>
      {hints.map((id) => {
        const m = manifolds[id];
        if (!m) return null;
        const len = trunkLengthFt(m.portCount);
        return (
          <mesh
            key={id}
            position={[m.center[0], m.center[1] - TRUNK_DIAMETER_FT, m.center[2]]}
            rotation-x={-Math.PI / 2}
            rotation-z={m.yawRad}
            raycast={() => null}
          >
            <ringGeometry args={[len * 0.55, len * 0.72, 40]} />
            <meshBasicMaterial
              color="#00ffa6"
              transparent
              opacity={0.7}
              side={THREE.DoubleSide}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  for (const id of b) if (!s.has(id)) return false;
  return true;
}
