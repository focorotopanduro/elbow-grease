/**
 * Interference Visualizer — R3F component showing collision feedback.
 *
 * Renders two layers of interference visualization:
 *
 *   1. Route preview coloring — segments of the live route preview
 *      are colored green/yellow/red based on collision prediction
 *
 *   2. Clash markers — pulsing red spheres at collision points
 *      with Billboard text showing the clearance violation details
 *
 *   3. Clearance halos — translucent shells around structural
 *      elements showing their clearance zones
 *
 * Subscribes to PIPE_ROUTE_UPDATE for live prediction during drag,
 * and to AUTOROUTE_EV.RESULT for post-route validation.
 */

import { useState, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useEvent } from '@hooks/useEventBus';
import { EV, type Vec3, type PipeRouteUpdatePayload } from '@core/events';
import { AUTOROUTE_EV } from '@core/pathfinding/AutoRouter';
import {
  predictCollisions,
  type CollisionPrediction,
  type SegmentCollision,
} from '@core/interference/CollisionPredictor';
import type { StructuralElement } from '@core/interference/StructuralElements';
import { usePipeStore } from '@store/pipeStore';

// ── Colors ──────────────────────────────────────────────────────

const STATUS_COLORS = {
  clear:     '#00e676',
  warning:   '#ffc107',
  collision: '#ff1744',
};

// ── Clash marker (pulsing red sphere) ───────────────────────────

function ClashMarker({ collision }: { collision: SegmentCollision }) {
  const ref = useRef<THREE.Mesh>(null!);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const scale = 1 + Math.sin(clock.elapsedTime * 5) * 0.3;
    ref.current.scale.setScalar(scale);
  });

  if (collision.status === 'clear') return null;

  const color = STATUS_COLORS[collision.status];

  return (
    <group>
      <mesh ref={ref} position={collision.midpoint}>
        <sphereGeometry args={[0.08, 10, 10]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.8}
          emissive={color}
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>

      {/* Label */}
      <Billboard position={[
        collision.midpoint[0],
        collision.midpoint[1] + 0.3,
        collision.midpoint[2],
      ]}>
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[1.2, 0.15]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.9} />
        </mesh>
        <Text
          fontSize={0.06}
          color={color}
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          {collision.status === 'collision' ? 'CLASH' : 'CLEARANCE'}
          {collision.elementType ? ` — ${collision.elementType}` : ''}
          {` (${(collision.clearance * 12).toFixed(1)}")`}
        </Text>
      </Billboard>
    </group>
  );
}

// ── Clearance halo (translucent shell around structural element)

interface ClearanceHaloProps {
  element: StructuralElement;
  clearance: number;
  hasViolation: boolean;
}

function ClearanceHalo({ element, clearance, hasViolation }: ClearanceHaloProps) {
  const size: Vec3 = [
    element.max[0] - element.min[0] + clearance * 2,
    element.max[1] - element.min[1] + clearance * 2,
    element.max[2] - element.min[2] + clearance * 2,
  ];

  const center: Vec3 = [
    (element.min[0] + element.max[0]) / 2,
    (element.min[1] + element.max[1]) / 2,
    (element.min[2] + element.max[2]) / 2,
  ];

  const color = hasViolation ? '#ff1744' : '#ffc107';

  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <meshStandardMaterial
        color={color}
        transparent
        opacity={hasViolation ? 0.12 : 0.05}
        wireframe={!hasViolation}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Color-coded route segments ──────────────────────────────────

function ColoredRouteSegments({
  points,
  segments,
}: {
  points: Vec3[];
  segments: SegmentCollision[];
}) {
  if (points.length < 2 || segments.length === 0) return null;

  return (
    <group>
      {segments.map((seg, i) => {
        if (i >= points.length - 1) return null;
        const ptA = points[i]!;
        const ptB = points[i + 1]!;
        const color = STATUS_COLORS[seg.status];

        return (
          <Line
            key={i}
            points={[ptA, ptB]}
            color={color}
            lineWidth={seg.status === 'collision' ? 5 : seg.status === 'warning' ? 3 : 2}
            transparent
            opacity={seg.status === 'clear' ? 0.3 : 0.8}
          />
        );
      })}
    </group>
  );
}

// ── Main component ──────────────────────────────────────────────

interface InterferenceVisualizerProps {
  elements: StructuralElement[];
  /** Whether to show clearance halos around all elements. */
  showHalos?: boolean;
}

export function InterferenceVisualizer({
  elements,
  showHalos = false,
}: InterferenceVisualizerProps) {
  const [prediction, setPrediction] = useState<CollisionPrediction | null>(null);
  const [previewPoints, setPreviewPoints] = useState<Vec3[]>([]);
  const existingPipes = usePipeStore((s) => Object.values(s.pipes));

  // Live collision prediction during route drawing
  useEvent<PipeRouteUpdatePayload>(EV.PIPE_ROUTE_UPDATE, (payload) => {
    if (payload.points.length < 2) return;
    setPreviewPoints([...payload.points]);
    const result = predictCollisions(
      payload.points,
      2, // default 2" diameter for preview
      elements,
      existingPipes,
    );
    setPrediction(result);
  });

  // Clear on cancel
  useEvent(EV.PIPE_CANCEL, () => {
    setPrediction(null);
    setPreviewPoints([]);
  });

  // Clear when HILO takes over
  useEvent(AUTOROUTE_EV.RESULT, () => {
    setPrediction(null);
    setPreviewPoints([]);
  });

  // Find which elements have violations
  const violatedElementIds = useMemo(() => {
    if (!prediction) return new Set<string>();
    return new Set(
      prediction.segments
        .filter((s) => s.status !== 'clear' && s.elementId)
        .map((s) => s.elementId!),
    );
  }, [prediction]);

  return (
    <group>
      {/* Color-coded route segments */}
      {prediction && previewPoints.length >= 2 && (
        <ColoredRouteSegments
          points={previewPoints}
          segments={prediction.segments}
        />
      )}

      {/* Clash markers at collision points */}
      {prediction?.segments
        .filter((s) => s.status !== 'clear')
        .map((seg) => (
          <ClashMarker key={seg.segmentIndex} collision={seg} />
        ))}

      {/* Clearance halos around structural elements */}
      {showHalos && elements.map((elem) => {
        const rule = { beam: 2/12, joist: 0.5/12, wall: 0, column: 3/12, duct: 1/12, slab: 0, footing: 6/12 };
        const clearance = elem.clearanceOverride ?? rule[elem.type] ?? 0.1;
        return (
          <ClearanceHalo
            key={elem.id}
            element={elem}
            clearance={clearance}
            hasViolation={violatedElementIds.has(elem.id)}
          />
        );
      })}
    </group>
  );
}
