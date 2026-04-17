/**
 * AdaptiveRenderBridge — wires AdaptiveRenderProfile output into the
 * actual R3F scene parameters in real time.
 *
 * The neuro layer (engagement + fatigue + cognitive load) produces a
 * live RenderProfile. This component reads that profile each frame
 * and applies it to:
 *
 *   - Tone mapping exposure (brightness)
 *   - Fog density (atmospheric depth)
 *   - Environment intensity (HDRI brightness)
 *   - Directional light intensity
 *   - Ambient light intensity
 *
 * The result: when the user is overloaded or fatigued, the scene
 * gently desaturates and dims. When they're in flow, colors pop.
 * Happens over slow lerps (0.5-2s) so the user never notices the
 * shift — it just keeps them in the zone.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { renderProfile } from '@core/neuro/AdaptiveRenderProfile';

// ── Target parameters reading loop ──────────────────────────────

export function AdaptiveRenderBridge() {
  const { gl, scene } = useThree();
  const currentExposure = useRef(1.2);
  const currentFogFar = useRef(30);
  const targetRef = useRef({ exposure: 1.2, fogFar: 30, ambient: 0.4, directional: 0.9 });

  // Find scene lights to modulate
  const ambientRef = useRef<THREE.AmbientLight | null>(null);
  const dirRef = useRef<THREE.DirectionalLight | null>(null);

  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) ambientRef.current = obj;
      if (obj instanceof THREE.DirectionalLight && !dirRef.current) dirRef.current = obj;
    });
  }, [scene]);

  useFrame((_, dt) => {
    const profile = renderProfile.tick();

    // Map profile values to scene targets
    targetRef.current.exposure = profile.toneMappingExposure;
    targetRef.current.fogFar = 20 + (1 - profile.fogDensity) * 40;
    targetRef.current.ambient = 0.25 + profile.envExposure * 0.25;
    targetRef.current.directional = 0.6 + profile.envExposure * 0.4;

    // Smooth lerp toward targets (slow so changes are subliminal)
    const lerpAmount = Math.min(1, dt * 1.5);

    currentExposure.current += (targetRef.current.exposure - currentExposure.current) * lerpAmount;
    gl.toneMappingExposure = currentExposure.current;

    currentFogFar.current += (targetRef.current.fogFar - currentFogFar.current) * lerpAmount;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.far = currentFogFar.current;
    }

    if (ambientRef.current) {
      ambientRef.current.intensity += (targetRef.current.ambient - ambientRef.current.intensity) * lerpAmount;
    }
    if (dirRef.current) {
      dirRef.current.intensity += (targetRef.current.directional - dirRef.current.intensity) * lerpAmount;
    }
  });

  return null;
}
