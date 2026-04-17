/**
 * PivotPreview — live visual feedback during pipe pivot.
 *
 * Mounted inside the R3F Canvas. Active only when
 * pipeStore.pivotSession is non-null. Renders:
 *
 *   1. Ghost pipe at current snapped orientation (solid cyan if legal,
 *      red if illegal / outside tolerance)
 *   2. Anchor marker — bright sphere on the fixed endpoint
 *   3. Grabbed endpoint marker — orange sphere following the snapped
 *      angle
 *   4. Legal-angle guide rays — 7 faint spokes from anchor showing
 *      {0, ±22.5°, ±45°, ±90°} reachable positions
 *   5. Angle arc — circular arc + angle text between original
 *      direction and current direction
 *   6. Original pipe rendered at 25% opacity for reference
 *
 * Listens to window pointermove to compute cursor position on the
 * ground plane, runs computePivotDelta, calls pipeStore.updatePivot
 * every frame. On pointerup: if legal, commitPivot; else cancelPivot.
 * Escape key also cancels.
 */

import { useEffect, useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { usePipeStore } from '@store/pipeStore';
import { useInteractionStore } from '@store/interactionStore';
import {
  computePivotDelta,
  applyPivot,
  computeLegalPositions,
  DEFAULT_SNAP_TOL_RAD,
} from '@core/geometry/PivotController';
import { eventBus } from '@core/EventBus';
import { EV } from '@core/events';
import type { Vec3 } from '@core/events';

// ── Component ───────────────────────────────────────────────────

export function PivotPreview() {
  const { raycaster, camera, pointer } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hitVec = useRef(new THREE.Vector3());

  const pivotSession = usePipeStore((s) => s.pivotSession);
  const updatePivot = usePipeStore((s) => s.updatePivot);
  const commitPivot = usePipeStore((s) => s.commitPivot);
  const cancelPivot = usePipeStore((s) => s.cancelPivot);

  // Live-computed points (pure ref, no re-render per frame)
  const currentPointsRef = useRef<Vec3[]>([]);
  const currentDeltaRef = useRef<number>(0);
  const [displayState, setDisplayState] = useState<{
    points: Vec3[];
    snappedAngle: number;
    isLegal: boolean;
    fittingName: string;
    rawAngle: number;
  }>({
    points: [],
    snappedAngle: 0,
    isLegal: true,
    fittingName: 'Straight (0°)',
    rawAngle: 0,
  });

  const frameCounter = useRef(0);

  // Ground plane raycast → world position
  const mouseWorldPos = useRef<Vec3>([0, 0, 0]);

  // ── Per-frame update ────────────────────────────────────────

  useFrame(() => {
    if (!pivotSession) return;

    // Project cursor onto ground plane
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(plane.current, hitVec.current);
    if (!hit) return;
    mouseWorldPos.current = [hit.x, hit.y, hit.z];

    // Compute delta
    const result = computePivotDelta(
      pivotSession.anchor,
      pivotSession.grabbedOrig,
      mouseWorldPos.current,
      'xz',
      DEFAULT_SNAP_TOL_RAD,
    );

    // Apply rotation to original points
    const rotated = applyPivot(
      pivotSession.originalPoints,
      pivotSession.anchor,
      result.snappedAngle,
      'xz',
    );

    currentPointsRef.current = rotated;
    currentDeltaRef.current = result.snappedAngle;

    // Throttle display updates to every 4th frame (~15Hz) to avoid re-render storm
    frameCounter.current++;
    if (frameCounter.current % 4 === 0) {
      setDisplayState({
        points: rotated,
        snappedAngle: result.snappedAngle,
        isLegal: result.isLegal,
        fittingName: result.fittingName,
        rawAngle: result.rawAngle,
      });
      updatePivot(result.snappedAngle, result.isLegal, result.fittingName);
    }
  });

  // ── Mouse up: commit or cancel ──────────────────────────────

  useEffect(() => {
    if (!pivotSession) return;

    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      // Use latest ref value (not stale state)
      const final = currentPointsRef.current;
      const delta = currentDeltaRef.current;

      // Recompute legality against latest raw vs snapped (already done in useFrame,
      // but recompute explicitly from final ref for determinism)
      const raw = computePivotDelta(
        pivotSession.anchor,
        pivotSession.grabbedOrig,
        mouseWorldPos.current,
        'xz',
      );

      if (raw.isLegal && final.length >= 2) {
        commitPivot(final);
        eventBus.emit(EV.PIPE_SNAP, {
          position: pivotSession.anchor,
          snapType: 'pipe' as const,
        });
      } else {
        cancelPivot();
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPivot();
    };

    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [pivotSession, commitPivot, cancelPivot]);

  if (!pivotSession) return null;

  // Compute legal ray positions (for snap guide visualization)
  const legalPositions = useMemo(() => {
    return computeLegalPositions(
      pivotSession.anchor,
      pivotSession.grabbedOrig,
      'xz',
    );
  }, [pivotSession.anchor, pivotSession.grabbedOrig]);

  const pipe = usePipeStore.getState().pipes[pivotSession.pipeId];
  const pipeRadius = (pipe?.diameter ?? 2) / 24;
  const ghostColor = displayState.isLegal ? '#00e676' : '#ff1744';
  const emissiveIntensity = displayState.isLegal ? 1.2 : 1.6;

  return (
    <group>
      {/* Original pipe ghost (25% opacity, for reference) */}
      {pivotSession.originalPoints.length >= 2 && (
        <Line
          points={pivotSession.originalPoints}
          color="#555"
          lineWidth={2}
          transparent
          opacity={0.35}
          dashed
          dashSize={0.15}
          gapSize={0.1}
        />
      )}

      {/* Legal snap guide rays — 7 faint spokes from anchor */}
      {legalPositions.map((legal) => (
        <Line
          key={legal.angle}
          points={[pivotSession.anchor, legal.pos]}
          color="#00e5ff"
          lineWidth={1}
          transparent
          opacity={0.18}
          dashed
          dashSize={0.08}
          gapSize={0.05}
        />
      ))}

      {/* Ghost pipe at snapped position */}
      {displayState.points.length >= 2 && (
        <GhostPipe
          points={displayState.points}
          radius={pipeRadius}
          color={ghostColor}
          emissive={ghostColor}
          emissiveIntensity={emissiveIntensity}
        />
      )}

      {/* Anchor marker (fixed point) */}
      <mesh position={pivotSession.anchor}>
        <sphereGeometry args={[pipeRadius * 2.2, 16, 16]} />
        <meshStandardMaterial
          color="#00e5ff"
          emissive="#00e5ff"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      <mesh position={pivotSession.anchor} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[pipeRadius * 2.4, pipeRadius * 3.2, 32]} />
        <meshBasicMaterial
          color="#00e5ff"
          transparent
          opacity={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Grabbed endpoint marker at snapped position */}
      {displayState.points.length >= 2 && (
        <>
          <mesh position={
            pivotSession.grabbedEnd === 'start'
              ? displayState.points[0]!
              : displayState.points[displayState.points.length - 1]!
          }>
            <sphereGeometry args={[pipeRadius * 2.4, 16, 16]} />
            <meshStandardMaterial
              color={ghostColor}
              emissive={ghostColor}
              emissiveIntensity={emissiveIntensity}
              toneMapped={false}
            />
          </mesh>
          {/* Illegal halo */}
          {!displayState.isLegal && (
            <IllegalHalo
              position={pivotSession.grabbedEnd === 'start'
                ? displayState.points[0]!
                : displayState.points[displayState.points.length - 1]!}
              radius={pipeRadius * 3.5}
            />
          )}
        </>
      )}

      {/* Angle arc + readout */}
      <AngleArc
        anchor={pivotSession.anchor}
        origDir={pivotSession.grabbedOrig}
        snappedAngle={displayState.snappedAngle}
        rawAngle={displayState.rawAngle}
        isLegal={displayState.isLegal}
        fittingName={displayState.fittingName}
      />
    </group>
  );
}

// ── Ghost pipe rendering ────────────────────────────────────────

function GhostPipe({
  points, radius, color, emissive, emissiveIntensity,
}: {
  points: Vec3[]; radius: number; color: string; emissive: string; emissiveIntensity: number;
}) {
  const geometry = useMemo(() => {
    const vecs = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    const curve = new THREE.CatmullRomCurve3(vecs, false, 'catmullrom', 0.2);
    return new THREE.TubeGeometry(curve, Math.max(16, points.length * 8), radius, 10, false);
  }, [points, radius]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.65}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Illegal halo (red pulse when outside snap tolerance) ────────

function IllegalHalo({ position, radius }: { position: Vec3; radius: number }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 8) * 0.15;
    ref.current.scale.setScalar(pulse);
    (ref.current.material as THREE.MeshBasicMaterial).opacity =
      0.5 + Math.sin(t * 8) * 0.2;
  });

  return (
    <mesh ref={ref} position={position} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[radius, radius * 1.2, 32]} />
      <meshBasicMaterial
        color="#ff1744"
        transparent
        opacity={0.6}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

// ── Angle arc + readout ─────────────────────────────────────────

function AngleArc({
  anchor, origDir, snappedAngle, rawAngle, isLegal, fittingName,
}: {
  anchor: Vec3;
  origDir: Vec3;
  snappedAngle: number;
  rawAngle: number;
  isLegal: boolean;
  fittingName: string;
}) {
  // Arc in XZ plane at ~1ft from anchor
  const arcRadius = 0.8;
  const origAngle = Math.atan2(origDir[2] - anchor[2], origDir[0] - anchor[0]);

  // Build arc points from origAngle to origAngle + snappedAngle
  const arcPoints = useMemo(() => {
    const segments = 32;
    const pts: Vec3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = origAngle + snappedAngle * t;
      pts.push([
        anchor[0] + Math.cos(a) * arcRadius,
        anchor[1] + 0.02,
        anchor[2] + Math.sin(a) * arcRadius,
      ]);
    }
    return pts;
  }, [anchor, origAngle, snappedAngle]);

  // Text position: midpoint of arc, pushed slightly outward
  const midAngle = origAngle + snappedAngle / 2;
  const textPos: Vec3 = [
    anchor[0] + Math.cos(midAngle) * (arcRadius + 0.6),
    anchor[1] + 0.5,
    anchor[2] + Math.sin(midAngle) * (arcRadius + 0.6),
  ];

  const color = isLegal ? '#00e676' : '#ff1744';

  return (
    <group>
      {/* Arc */}
      {Math.abs(snappedAngle) > 0.01 && (
        <Line points={arcPoints} color={color} lineWidth={2} transparent opacity={0.8} />
      )}

      {/* Billboard readout */}
      <Billboard position={textPos}>
        {/* Background plate */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.5, 0.5]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.92} />
        </mesh>
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[1.52, 0.52]} />
          <meshBasicMaterial color={color} transparent opacity={0.4} />
        </mesh>
        {/* Fitting name */}
        <Text
          position={[0, 0.11, 0]}
          fontSize={0.13}
          color={color}
          anchorX="center" anchorY="middle"
          fontWeight={700}
        >
          {fittingName}
        </Text>
        {/* Raw angle */}
        <Text
          position={[0, -0.08, 0]}
          fontSize={0.08}
          color="#aaa"
          anchorX="center" anchorY="middle"
        >
          cursor: {((rawAngle * 180) / Math.PI).toFixed(1)}°
          {isLegal ? '' : ' ⨯ snap-back on release'}
        </Text>
      </Billboard>
    </group>
  );
}
