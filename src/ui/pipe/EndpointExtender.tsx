/**
 * EndpointExtender — QuickPlumb-style drag-from-endpoint extension.
 *
 * For every visible committed pipe, render a glowing "+" glyph at both
 * endpoints (start + end). Click-drag on a glyph:
 *
 *   1. Calls beginExtend() from the shared ExtendSession module.
 *   2. Shows a live preview tube following the cursor.
 *   3. Grid-snaps via interactionStore.gridSnap.
 *   4. On pointer-up: commits a new pipe with the currently-selected
 *      diameter + material via commitExtendSession().
 *
 * The session machinery lives in ExtendSession.ts so PipeHitboxes can
 * ALSO use it for tee-from-middle-drag (Phase 7.A).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { useInteractionStore } from '@store/interactionStore';
import { useLayerStore } from '@store/layerStore';
import { useFloorParams } from '@store/floorStore';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { useReducedMotion } from '@core/a11y/useReducedMotion';
import type { Vec3 } from '@core/events';
import {
  beginExtend,
  updateExtendCursor,
  commitExtendSession,
  cancelExtendSession,
  getActiveExtendSession,
  subscribeExtendSession,
} from './ExtendSession';

// ── Glyph sizing ───────────────────────────────────────────────

const GLYPH_WORLD_SIZE = 0.35;          // feet; stays readable at normal zoom
const GLYPH_HOVER_SCALE = 1.3;
const SNAP_INCREMENT_FT = 0.5;

// ── Main component ─────────────────────────────────────────────

export function EndpointExtender() {
  const pipes = usePipeStore((s) => s.pipes);
  const mode = useInteractionStore((s) => s.mode);
  const pivoting = usePipeStore((s) => s.pivotSession !== null);
  const enabled = useFeatureFlagStore((s) => s.pipeExtendDrag);
  const systemVis = useLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();

  // Gate: select mode, flag on, not pivoting.
  const active = mode === 'select' && enabled && !pivoting;
  if (!active) return null;

  const list = Object.values(pipes).filter((p) => {
    if (!p.visible || !systemVis[p.system]) return false;
    let yMin = p.points[0]?.[1] ?? 0, yMax = yMin;
    for (const pt of p.points) { if (pt[1] < yMin) yMin = pt[1]; if (pt[1] > yMax) yMax = pt[1]; }
    const fp = getFloorParams(yMin, yMax);
    return fp.visible && !fp.disableInteraction;
  });

  return (
    <group>
      {list.map((pipe) => (
        <PipeEndpointPair key={pipe.id} pipe={pipe} />
      ))}
      <ExtendPreview />
    </group>
  );
}

// ── Per-pipe: two endpoint glyphs ──────────────────────────────

function PipeEndpointPair({ pipe }: { pipe: CommittedPipe }) {
  const start = pipe.points[0]!;
  const end = pipe.points[pipe.points.length - 1]!;
  return (
    <>
      <EndpointGlyph pipeId={pipe.id} position={start} which="start" />
      <EndpointGlyph pipeId={pipe.id} position={end} which="end" />
    </>
  );
}

// ── A single endpoint glyph ────────────────────────────────────

function EndpointGlyph({
  pipeId, position, which,
}: {
  pipeId: string;
  position: Vec3;
  which: 'start' | 'end';
}) {
  const [hovered, setHovered] = useState(false);
  const pulseRef = useRef<THREE.Group>(null!);
  const reducedMotion = useReducedMotion();

  useFrame(({ clock }) => {
    if (!pulseRef.current) return;
    const base = hovered ? GLYPH_HOVER_SCALE : 1;
    if (reducedMotion) {
      // Static: show hover scale change (a state-change cue, not an
      // animation), but skip the continuous 3Hz breathe.
      pulseRef.current.scale.setScalar(base);
      return;
    }
    const t = clock.elapsedTime;
    const breathe = 1 + 0.06 * Math.sin(t * 3.0);
    pulseRef.current.scale.setScalar(base * breathe);
  });

  const onDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.nativeEvent?.stopImmediatePropagation?.();
    beginExtend({
      parentPipeId: pipeId,
      origin: which === 'start' ? 'endpoint-start' : 'endpoint-end',
      anchor: position,
    });
  }, [pipeId, which, position]);

  const onOver = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = 'crosshair';
  }, []);
  const onOut = useCallback(() => {
    setHovered(false);
    document.body.style.cursor = '';
  }, []);

  const color = hovered ? '#00ffa6' : '#00e5ff';

  return (
    <group ref={pulseRef} position={position}>
      <mesh onPointerDown={onDown} onPointerOver={onOver} onPointerOut={onOut}>
        <sphereGeometry args={[GLYPH_WORLD_SIZE * 1.2, 12, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh raycast={() => null}>
        <sphereGeometry args={[GLYPH_WORLD_SIZE * 0.55, 14, 14]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={hovered ? 0.22 : 0.12}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh raycast={() => null}>
        <boxGeometry args={[GLYPH_WORLD_SIZE * 0.7, GLYPH_WORLD_SIZE * 0.12, GLYPH_WORLD_SIZE * 0.12]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
      </mesh>
      <mesh raycast={() => null}>
        <boxGeometry args={[GLYPH_WORLD_SIZE * 0.12, GLYPH_WORLD_SIZE * 0.7, GLYPH_WORLD_SIZE * 0.12]} />
        <meshBasicMaterial color={color} transparent opacity={0.95} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── Global window listeners: shared drag flow ─────────────────
//
// Mounted inside ExtendPreview so it lives exactly as long as the
// EndpointExtender is active. Short-circuits unless a session is in flight.

function useExtendSessionListeners() {
  const { camera, raycaster, gl } = useThree();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;

    const ndcFromEvent = (ev: PointerEvent): THREE.Vector2 => {
      const rect = el.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      return new THREE.Vector2(x, y);
    };

    const onMove = (ev: PointerEvent) => {
      const s = getActiveExtendSession();
      if (!s) return;
      const ndc = ndcFromEvent(ev);
      raycaster.setFromCamera(ndc, camera);
      const p = raycaster.ray.intersectPlane(groundPlane.current, hit.current);
      if (!p) return;
      const grid = useInteractionStore.getState().gridSnap || SNAP_INCREMENT_FT;
      const cursor: Vec3 = [
        Math.round(p.x / grid) * grid,
        s.anchor[1],
        Math.round(p.z / grid) * grid,
      ];
      updateExtendCursor(cursor);
    };

    const onUp = (ev: PointerEvent) => {
      if (!getActiveExtendSession()) return;
      if (ev.button !== 0) return;
      commitExtendSession();
    };

    const onKey = (ev: KeyboardEvent) => {
      if (!getActiveExtendSession()) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelExtendSession();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [camera, raycaster, gl]);
}

// ── Live preview ───────────────────────────────────────────────

function ExtendPreview() {
  useExtendSessionListeners();

  const [, force] = useState(0);
  useEffect(() => {
    return subscribeExtendSession(() => force((x) => x + 1));
  }, []);

  const s = getActiveExtendSession();
  const diameter = useInteractionStore((st) => st.drawDiameter);
  if (!s) return null;

  const points = useMemoPoints(s.anchor, s.currentCursor);
  const r = diameter / 24;
  const previewColor = s.origin === 'tee' ? '#ffc107' : '#00ffa6';

  return (
    <group>
      <Line points={points} color={previewColor} lineWidth={5} transparent opacity={0.85} />
      <mesh position={s.anchor}>
        <sphereGeometry args={[r * 1.5, 12, 12]} />
        <meshStandardMaterial color={previewColor} emissive={previewColor} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
      <mesh position={s.currentCursor}>
        <sphereGeometry args={[r * 1.5, 12, 12]} />
        <meshStandardMaterial color={previewColor} emissive={previewColor} emissiveIntensity={1.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function useMemoPoints(a: Vec3, b: Vec3): [Vec3, Vec3] {
  return useMemo(() => [a, b], [a[0], a[1], a[2], b[0], b[1], b[2]]);
}
