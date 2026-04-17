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
import { type ThreeEvent } from '@react-three/fiber';

export function BackdropLayer() {
  const backdrops = useBackdropStore((s) => s.backdrops);
  const selectedId = useBackdropStore((s) => s.selectedId);
  const selectBackdrop = useBackdropStore((s) => s.selectBackdrop);

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
        />
      ))}
    </group>
  );
}

function BackdropMesh({ backdrop, selected, onSelect }: { backdrop: Backdrop; selected: boolean; onSelect: () => void }) {
  const texture = useBackdropTexture(backdrop.dataUrl);
  const meshRef = useRef<THREE.Mesh>(null!);

  if (backdrop.hidden) return null;

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
          opacity={backdrop.opacity}
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
