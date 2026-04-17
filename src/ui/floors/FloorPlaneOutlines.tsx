/**
 * FloorPlaneOutlines — thin horizontal reference planes at each floor's
 * base elevation. Provides spatial context while working in a 3D scene
 * so the user can always see WHERE each story is.
 *
 * Rendered as:
 *   - A translucent grid quad per floor, colored with the floor's accent
 *   - A wire border at the slab outline
 *   - A floating label at the far corner showing floor name + elevation
 *
 * The ACTIVE floor's plane is rendered brighter with a pulsing accent.
 * Hidden floors' planes are omitted entirely.
 *
 * Size: 60×60ft — comfortably larger than any likely residential footprint.
 */

import { useMemo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useFloorStore } from '@store/floorStore';

const PLANE_SIZE = 60;

export function FloorPlaneOutlines() {
  const floors = useFloorStore((s) => s.floors);
  const activeFloorId = useFloorStore((s) => s.activeFloorId);
  const hiddenFloorIds = useFloorStore((s) => s.hiddenFloorIds);
  const showFloorPlanes = useFloorStore((s) => s.showFloorPlanes);
  const visibilityMode = useFloorStore((s) => s.visibilityMode);

  const ordered = useMemo(
    () => Object.values(floors).sort((a, b) => a.order - b.order),
    [floors],
  );

  if (!showFloorPlanes) return null;

  return (
    <group>
      {ordered.map((floor) => {
        if (hiddenFloorIds.has(floor.id)) return null;

        const isActive = floor.id === activeFloorId;

        // In SOLO mode, only draw the active floor
        if (visibilityMode === 'active_only' && !isActive) return null;

        const y = floor.elevationBase + 0.005; // tiny offset to avoid z-fight

        return (
          <group key={floor.id}>
            {/* Translucent floor slab */}
            <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
              <meshBasicMaterial
                color={floor.color}
                transparent
                opacity={isActive ? 0.06 : 0.025}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Wire border */}
            <lineSegments position={[0, y, 0]}>
              <edgesGeometry
                args={[new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE).rotateX(-Math.PI / 2)]}
              />
              <lineBasicMaterial
                color={floor.color}
                transparent
                opacity={isActive ? 0.8 : 0.3}
                depthWrite={false}
              />
            </lineSegments>

            {/* Corner label */}
            <Billboard position={[PLANE_SIZE / 2 - 2, y + 0.4, PLANE_SIZE / 2 - 2]}>
              <Text
                fontSize={0.6}
                color={floor.color}
                outlineWidth={0.04}
                outlineColor="#000"
                anchorX="right"
                anchorY="bottom"
              >
                {`${floor.icon} ${floor.name}  ${floor.elevationBase}ft`}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}
