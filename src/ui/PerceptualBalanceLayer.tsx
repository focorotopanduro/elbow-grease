/**
 * Perceptual Balance Layer — R3F component that applies the adaptive
 * render profile to the Three.js scene in real-time.
 *
 * Reads the smoothly-interpolated RenderProfile each frame and
 * adjusts tone mapping, fog, and emissive scaling. This is the
 * bridge between the neurophysiological monitoring systems and
 * the actual pixels on screen.
 *
 * The visual intensity changes are imperceptible per-frame (lerped)
 * so the user never notices jarring shifts — they just naturally
 * stay in the "stimulated but not strained" zone.
 */

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { renderProfile, type RenderProfile } from '@core/neuro/AdaptiveRenderProfile';

export function PerceptualBalanceLayer() {
  const { gl, scene } = useThree();
  const lastProfile = useRef<RenderProfile | null>(null);

  useFrame(() => {
    const profile = renderProfile.tick();

    // Tone mapping exposure
    gl.toneMappingExposure = profile.toneMappingExposure;

    // Fog density
    if (scene.fog && scene.fog instanceof THREE.Fog) {
      // Adjust far plane — lower fogDensity = farther fog = less visible
      scene.fog.far = 20 + (1 - profile.fogDensity) * 30;
    }

    // Walk the scene and scale emissive materials
    // Only do this when the profile has meaningfully changed
    if (
      !lastProfile.current ||
      Math.abs(lastProfile.current.emissiveIntensity - profile.emissiveIntensity) > 0.05
    ) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          if (obj.material.emissive && obj.material.emissiveIntensity > 0) {
            // Scale emissive relative to original value
            // Store original in userData if not already
            if (obj.userData.originalEmissiveIntensity === undefined) {
              obj.userData.originalEmissiveIntensity = obj.material.emissiveIntensity;
            }
            obj.material.emissiveIntensity =
              obj.userData.originalEmissiveIntensity * profile.emissiveIntensity;
          }
        }
      });
    }

    lastProfile.current = profile;
  });

  return null;
}

/**
 * Ambient particle system — subtle floating particles that add
 * visual richness when the render profile allows it.
 * Controlled by RenderProfile.showAmbientFX and particleDensity.
 */
export function AmbientParticles() {
  const meshRef = useRef<THREE.Points>(null!);
  const count = 200;

  // Generate static particle positions once
  const positions = useRef<Float32Array | null>(null);
  if (!positions.current) {
    positions.current = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions.current[i * 3] = (Math.random() - 0.5) * 20;
      positions.current[i * 3 + 1] = Math.random() * 8;
      positions.current[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
  }

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const profile = renderProfile.getProfile();

    // Hide when ambient FX disabled
    meshRef.current.visible = profile.showAmbientFX;
    if (!meshRef.current.visible) return;

    // Gentle float animation
    const geo = meshRef.current.geometry;
    const posAttr = geo.getAttribute('position');
    const base = positions.current!;

    for (let i = 0; i < count; i++) {
      const t = clock.elapsedTime * 0.1 + i * 0.1;
      posAttr.setY(
        i,
        base[i * 3 + 1]! + Math.sin(t) * 0.3,
      );
    }
    posAttr.needsUpdate = true;

    // Scale opacity by particle density
    const mat = meshRef.current.material as THREE.PointsMaterial;
    mat.opacity = 0.15 * profile.particleDensity;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={positions.current}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#4a6fa5"
        transparent
        opacity={0.15}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}
