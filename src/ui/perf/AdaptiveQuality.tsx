/**
 * AdaptiveQuality — monitors render FPS and progressively reduces
 * expensive settings if the frame time degrades.
 *
 * Strategy (tiered):
 *   tier 0 (HIGH)  — DPR 1.0–2.0 (retina), 4K shadow map, 24-seg pipes
 *   tier 1 (MED)   — DPR 1.0, 2K shadow map, 20-seg pipes
 *   tier 2 (LOW)   — DPR 1.0, 1K shadow map, no shadow radius
 *
 * Escalates tier when 1s average FPS < 50. Never decreases tier once
 * set (avoids oscillation). User can always override via LayerPanel.
 *
 * Mount inside <Canvas> — uses useFrame + useThree to sample.
 */

import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const TARGET_FPS = 50;           // escalate below this sustained
const SAMPLE_WINDOW_MS = 1000;   // 1 second averaging

export function AdaptiveQuality() {
  const { gl, scene } = useThree();
  const frameTimes = useRef<number[]>([]);
  const lastTime = useRef(performance.now());
  const tier = useRef<0 | 1 | 2>(0);

  // Apply initial tier settings
  useEffect(() => {
    applyTier(gl, scene, 0);
  }, [gl, scene]);

  useFrame(() => {
    const now = performance.now();
    const dt = now - lastTime.current;
    lastTime.current = now;
    frameTimes.current.push(dt);

    // Drop frames older than the sample window
    let total = 0;
    for (let i = frameTimes.current.length - 1; i >= 0; i--) {
      total += frameTimes.current[i]!;
      if (total > SAMPLE_WINDOW_MS) {
        frameTimes.current = frameTimes.current.slice(i);
        break;
      }
    }

    if (frameTimes.current.length < 30) return; // not enough data yet

    const avgMs = total / frameTimes.current.length;
    const fps = 1000 / avgMs;

    if (fps < TARGET_FPS && tier.current < 2) {
      tier.current = (tier.current + 1) as 0 | 1 | 2;
      applyTier(gl, scene, tier.current);
      frameTimes.current = []; // reset after tier change
    }
  });

  return null;
}

function applyTier(gl: THREE.WebGLRenderer, _scene: THREE.Scene, tierLevel: 0 | 1 | 2) {
  switch (tierLevel) {
    case 0:
      gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.enabled = true;
      break;
    case 1:
      gl.setPixelRatio(1);
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.enabled = true;
      break;
    case 2:
      gl.setPixelRatio(1);
      gl.shadowMap.type = THREE.BasicShadowMap;
      gl.shadowMap.enabled = true;
      break;
  }
}
