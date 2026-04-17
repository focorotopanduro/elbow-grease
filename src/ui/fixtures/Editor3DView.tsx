/**
 * Editor3DView — perspective 3D view with orbit controls showing the
 * fixture model + connection-point handles that match the top-view.
 *
 * The 3D scene mirrors the top view exactly:
 *   - Same fixture rendered via FixtureModel (subtype + stagedParams)
 *   - Same connection points rendered as glowing orbs
 *   - Active handle pulses with extra scale + emissive boost
 *   - Rotation reflected on the model via group rotation
 *
 * Clicking a handle in either view sets `activeHandle`, so the other
 * view highlights it synchronously. Handle dragging in 3D space is
 * deliberately simple (Y-lock to current height, drag on XZ plane).
 */

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { ConnectionPoint, FixtureGeometry } from '@core/fixtures/ConnectionPoints';
import { useFixtureEditorStore } from '@store/fixtureEditorStore';
import { FixtureModel } from './FixtureModels';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';

const ROLE_COLORS: Record<string, string> = {
  drain:    '#ef5350',
  cold:     '#4fc3f7',
  hot:      '#ff7043',
  overflow: '#ab47bc',
  vent:     '#9ccc65',
  ref:      '#78909c',
};

interface Props {
  geometry: FixtureGeometry;
}

export function Editor3DView({ geometry }: Props) {
  const subtype = useFixtureEditorStore((s) => s.subtype);
  const stagedParams = useFixtureEditorStore((s) => s.stagedParams);
  const showDimensions = useFixtureEditorStore((s) => s.showDimensions);

  if (!subtype) return null;

  // Frame camera distance based on fixture size
  const maxExt = Math.max(geometry.footprint.width, geometry.footprint.depth, geometry.footprint.height);
  const camDist = maxExt * 2.8;

  return (
    <div style={{ width: '100%', height: '100%', background: '#0a1018' }}>
      <Canvas
        camera={{ position: [camDist, camDist * 0.7, camDist], fov: 35 }}
        shadows
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 10, 5]} intensity={0.9} castShadow />
        <directionalLight position={[-3, 6, -3]} intensity={0.3} />
        <Environment preset="night" />

        <Grid args={[10, 10]} cellSize={1/12} cellThickness={0.3} cellColor="#1a2a3a"
              sectionSize={0.5} sectionThickness={0.7} sectionColor="#2a4050"
              fadeDistance={20} position={[0, -0.005, 0]} />

        {/* Fixture — rotated by rotationDeg */}
        <FixtureGroup subtype={subtype} params={stagedParams} />

        {/* Connection handles */}
        <HandlesLayer geometry={geometry} />

        {/* Dimension labels floating above handle pairs */}
        {showDimensions && <DimLabels3D geometry={geometry} />}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          target={[0, geometry.footprint.height * 0.3, 0]}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={0.6}
          maxDistance={camDist * 3}
        />
      </Canvas>
    </div>
  );
}

// ── Fixture wrapper that applies rotation ──────────────────────

function FixtureGroup({ subtype, params }: { subtype: FixtureSubtype; params: Record<string, unknown> }) {
  const rotDeg = Number(params.rotationDeg ?? 0);
  return (
    <group rotation={[0, (rotDeg * Math.PI) / 180, 0]}>
      <FixtureModel position={[0, 0, 0]} subtype={subtype} showGlow={false} params={params} />
    </group>
  );
}

// ── Connection-point handles (3D) ──────────────────────────────

function HandlesLayer({ geometry }: { geometry: FixtureGeometry }) {
  const params = useFixtureEditorStore((s) => s.stagedParams);
  const activeHandle = useFixtureEditorStore((s) => s.activeHandle);
  const setActiveHandle = useFixtureEditorStore((s) => s.setActiveHandle);
  const rotDeg = Number(params.rotationDeg ?? 0);

  return (
    <group rotation={[0, (rotDeg * Math.PI) / 180, 0]}>
      {geometry.points.map((pt) => (
        <Handle3D
          key={pt.id}
          point={pt}
          active={pt.id === activeHandle}
          onSelect={() => setActiveHandle(pt.id === activeHandle ? null : pt.id)}
        />
      ))}
    </group>
  );
}

function Handle3D({
  point,
  active,
  onSelect,
}: {
  point: ConnectionPoint;
  active: boolean;
  onSelect: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const color = ROLE_COLORS[point.role] ?? '#ccc';
  const baseRadius = 0.045;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (active) {
      const s = 1 + 0.2 * Math.sin(clock.elapsedTime * 5);
      meshRef.current.scale.setScalar(s);
    } else {
      meshRef.current.scale.setScalar(1);
    }
  });

  return (
    <group position={point.position}>
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <sphereGeometry args={[baseRadius, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 0.9 : 0.35}
          metalness={0.3}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>
      {/* Outer halo ring */}
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[baseRadius * 1.6, baseRadius * 2.0, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={active ? 0.6 : 0.25}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* Label billboard */}
      <Billboard position={[0, baseRadius * 3, 0]}>
        <Text
          fontSize={0.05}
          color={color}
          outlineWidth={0.004}
          outlineColor="#000"
          anchorX="center"
          anchorY="bottom"
        >
          {point.label}
        </Text>
      </Billboard>
    </group>
  );
}

// ── Dimension labels between drain and supplies ────────────────

function DimLabels3D({ geometry }: { geometry: FixtureGeometry }) {
  const rotDeg = Number(useFixtureEditorStore.getState().stagedParams.rotationDeg ?? 0);
  const drains = geometry.points.filter((p) => p.role === 'drain');
  const supplies = geometry.points.filter((p) => p.role === 'cold' || p.role === 'hot');
  const els: JSX.Element[] = [];
  for (const d of drains) {
    for (const s of supplies) {
      const dx = s.position[0] - d.position[0];
      const dy = s.position[1] - d.position[1];
      const dz = s.position[2] - d.position[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.05) continue;
      const mid: [number, number, number] = [
        (s.position[0] + d.position[0]) / 2,
        (s.position[1] + d.position[1]) / 2 + 0.08,
        (s.position[2] + d.position[2]) / 2,
      ];
      els.push(
        <group key={`${d.id}-${s.id}`} rotation={[0, (rotDeg * Math.PI) / 180, 0]}>
          <Billboard position={mid}>
            <Text fontSize={0.045} color="#7fb8d0" outlineWidth={0.003} outlineColor="#000" anchorY="middle">
              {(dist * 12).toFixed(1)}″
            </Text>
          </Billboard>
        </group>,
      );
    }
  }
  return <>{els}</>;
}
