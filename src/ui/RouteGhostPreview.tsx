/**
 * RouteGhostPreview — 3D translucent pipe previews for HILO candidates.
 *
 * Renders each candidate route as a color-coded ghost tube in the 3D
 * scene. The user can hover to highlight and click to select.
 * Unselected routes fade; the selected route solidifies.
 */

import { useRef, useState, useMemo } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { useEvent } from '@hooks/useEventBus';
import type { RouteCandidate } from '@core/optimizer/ParetoFrontier';
import {
  HILO_EV,
  type RoutesGeneratedPayload,
} from '@core/hilo/HILOCoordinator';

// ── Route colors (one per candidate slot) ───────────────────────

const ROUTE_COLORS = ['#00e5ff', '#7c4dff', '#ffc107', '#00e676'];

interface GhostTubeProps {
  points: [number, number, number][];
  color: string;
  hovered: boolean;
  selected: boolean;
  onClick: () => void;
  onHover: (h: boolean) => void;
}

function GhostTube({ points, color, hovered, selected, onClick, onHover }: GhostTubeProps) {
  const meshRef = useRef<THREE.Group>(null!);

  const opacity = selected ? 0.85 : hovered ? 0.6 : 0.25;
  const lineWidth = selected ? 4 : hovered ? 3 : 2;

  // Animated pulse on hover
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (hovered && !selected) {
      const pulse = 1 + Math.sin(clock.elapsedTime * 6) * 0.05;
      meshRef.current.scale.setScalar(pulse);
    } else {
      meshRef.current.scale.setScalar(1);
    }
  });

  // Build sphere markers at each waypoint
  const markers = useMemo(
    () =>
      points.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={opacity}
            emissive={color}
            emissiveIntensity={hovered ? 2 : 0.8}
            toneMapped={false}
          />
        </mesh>
      )),
    [points, color, opacity, hovered],
  );

  return (
    <group
      ref={meshRef}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={() => onHover(false)}
    >
      <Line
        points={points}
        color={color}
        lineWidth={lineWidth}
        transparent
        opacity={opacity}
      />
      {markers}
    </group>
  );
}

// ── Multi-route preview container ───────────────────────────────

interface RouteGhostPreviewProps {
  onSelect: (routeId: string) => void;
}

export function RouteGhostPreview({ onSelect }: RouteGhostPreviewProps) {
  const [routes, setRoutes] = useState<RouteCandidate[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [committedIds, setCommittedIds] = useState<Set<string>>(new Set());

  useEvent<RoutesGeneratedPayload>(HILO_EV.ROUTES_GENERATED, (payload) => {
    setRoutes(payload.ranked);
    setSelectedId(null);
    setHoveredId(null);
  });

  // When a route is selected and committed, track its ID so we fade it
  useEvent(HILO_EV.ROUTE_SELECTED, (payload: { selected: { id: string } }) => {
    setCommittedIds((prev) => new Set([...prev, payload.selected.id]));
    // Clear ghost routes after a short delay (solid pipe replaces them)
    setTimeout(() => setRoutes([]), 500);
  });

  if (routes.length === 0) return null;

  return (
    <group>
      {routes.map((route, i) => (
        <GhostTube
          key={route.id}
          points={route.points}
          color={ROUTE_COLORS[i % ROUTE_COLORS.length]!}
          hovered={hoveredId === route.id}
          selected={selectedId === route.id}
          onClick={() => {
            setSelectedId(route.id);
            onSelect(route.id);
          }}
          onHover={(h) => setHoveredId(h ? route.id : null)}
        />
      ))}
    </group>
  );
}
