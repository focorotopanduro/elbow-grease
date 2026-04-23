/**
 * BackdropPlane — renders each uploaded blueprint image as a textured
 * plane slightly below the active floor slab.
 *
 * Uses Three.js TextureLoader on the data URL. The texture is cached
 * per backdrop id so repeated renders don't rebuild it.
 *
 * Selected backdrop gets a bright accent border and drag handles for
 * quick repositioning in top view (only when not locked).
 */

import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useBackdropStore, type Backdrop } from '@store/backdropStore';
import { useFloorStore } from '@store/floorStore';
import { type ThreeEvent } from '@react-three/fiber';

export function BackdropLayer() {
  const backdrops = useBackdropStore((s) => s.backdrops);
  const selectedId = useBackdropStore((s) => s.selectedId);
  const selectBackdrop = useBackdropStore((s) => s.selectBackdrop);
  // Phase 14.E — track active floor so backdrops filter per-level.
  const activeFloorId = useFloorStore((s) => s.activeFloorId);
  const visibilityMode = useFloorStore((s) => s.visibilityMode);

  const list = Object.values(backdrops);
  if (list.length === 0) return null;

  return (
    <group>
      {list.map((b) => (
        <BackdropMesh
          key={b.id}
          backdrop={b}
          selected={b.id === selectedId}
          onSelect={() => selectBackdrop(b.id)}
          activeFloorId={activeFloorId}
          visibilityMode={visibilityMode}
        />
      ))}
    </group>
  );
}

function BackdropMesh({
  backdrop, selected, onSelect, activeFloorId, visibilityMode,
}: {
  backdrop: Backdrop;
  selected: boolean;
  onSelect: () => void;
  activeFloorId: string;
  visibilityMode: 'all' | 'active_only' | 'ghost';
}) {
  const texture = useBackdropTexture(backdrop.dataUrl);
  const meshRef = useRef<THREE.Mesh>(null!);

  if (backdrop.hidden) return null;

  // Phase 14.E — per-floor filtering. A backdrop without a floorId
  // (legacy / pre-14.E) is always visible. A backdrop with a floorId
  // respects the floor store's visibility mode:
  //   • 'all'         → every backdrop renders
  //   • 'active_only' → only backdrops on the active floor render
  //   • 'ghost'       → all render, but off-floor ones at reduced opacity
  let effectiveOpacity = backdrop.opacity;
  if (backdrop.floorId) {
    const isActiveFloor = backdrop.floorId === activeFloorId;
    if (visibilityMode === 'active_only' && !isActiveFloor) return null;
    if (visibilityMode === 'ghost' && !isActiveFloor) {
      effectiveOpacity = Math.min(backdrop.opacity * 0.25, 0.15);
    }
  }

  return (
    <group position={backdrop.position} rotation={[0, backdrop.rotationY, 0]}>
      <mesh
        ref={meshRef}
        rotation-x={-Math.PI / 2}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (backdrop.locked) return;
          e.stopPropagation();
          onSelect();
        }}
      >
        <planeGeometry args={[backdrop.widthFt, backdrop.depthFt]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={effectiveOpacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {selected && !backdrop.locked && (
        <SelectionBorder width={backdrop.widthFt} depth={backdrop.depthFt} />
      )}
    </group>
  );
}

function SelectionBorder({ width, depth }: { width: number; depth: number }) {
  const points = useMemo(() => {
    const w = width / 2, d = depth / 2;
    return new Float32Array([
      -w, 0.005, -d, w, 0.005, -d,
      w, 0.005, -d, w, 0.005, d,
      w, 0.005, d, -w, 0.005, d,
      -w, 0.005, d, -w, 0.005, -d,
    ]);
  }, [width, depth]);
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[points, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#ffd54f" linewidth={2} transparent opacity={0.95} toneMapped={false} />
    </line>
  );
}

// ── Texture cache (module-scoped) ──────────────────────────────

const textureCache = new Map<string, THREE.Texture>();

function useBackdropTexture(dataUrl: string): THREE.Texture {
  const cached = textureCache.get(dataUrl);
  const texRef = useRef<THREE.Texture>(cached ?? createTexture(dataUrl));

  useEffect(() => {
    if (!textureCache.has(dataUrl)) {
      const t = createTexture(dataUrl);
      textureCache.set(dataUrl, t);
      texRef.current = t;
    } else {
      texRef.current = textureCache.get(dataUrl)!;
    }
  }, [dataUrl]);

  return texRef.current;
}

function createTexture(dataUrl: string): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
