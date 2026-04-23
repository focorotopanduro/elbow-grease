/**
 * AdaptiveQuality — monitors render FPS and adapts expensive settings.
 *
 * Strategy (tiered):
 *   tier 0 (HIGH)  — DPR 1.0–2.0, 2048 shadow map (PCFSoft)
 *   tier 1 (MED)   — DPR 1.0, 1024 shadow map (PCFSoft)
 *   tier 2 (LOW)   — DPR 1.0,  512 shadow map (Basic)
 *
 * Phase 12.B refinements:
 *   • Each tier now also drives the directional-light shadow map
 *     resolution. The previous implementation left shadow map size
 *     fixed at 4096 across all tiers — wasted memory on low-end GPUs.
 *   • `initialTier` can be supplied from `lowSpecDetection` so a
 *     known-iGPU user starts at tier 1 instead of stuttering into it.
 *
 * Hysteresis (Phase 12.A audit fix):
 *   • Escalate (tier ↑) when 1s average FPS falls below TARGET_FPS.
 *   • De-escalate (tier ↓) when 1s average FPS stays above
 *     TARGET_FPS + HEADROOM for the full cooldown window.
 *
 * Mount inside <Canvas> — uses useFrame + useThree to sample.
 */

import { useRef, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
// Phase 10.D — every frame we already measure here is forwarded to
// the global perf collector so the PerfHUD + future telemetry can
// read consistent numbers. No extra dt computation: reuses the one
// we need for tier escalation.
import { recordFrame } from '@core/perf/PerfStats';
// Phase 12.B — boot-time GPU classification. Phase 12.D unified this
// with App.tsx's pre-Canvas probe: both sources now read the same
// cached result from `bootGpuProbe` so antialias + DPR + initial tier
// all derive from one classification.
import { initialTierFor } from './lowSpecDetection';
import { probeGpuAtBoot } from './bootGpuProbe';
import { logger } from '@core/logger/Logger';

const log = logger('AdaptiveQuality');

const TARGET_FPS = 50;           // escalate below this sustained
const DEESCALATE_HEADROOM_FPS = 15;
const SAMPLE_WINDOW_MS = 1000;
const TIER_COOLDOWN_MS = 3000;

type Tier = 0 | 1 | 2;

/** Per-tier settings. Keyed on tier number for clean lookup. */
interface TierConfig {
  dpr: number;                       // max devicePixelRatio
  shadowMap: {
    type: THREE.ShadowMapType;
    size: number;                    // applied to directionalLight.shadow.mapSize.{width,height}
  };
}

const TIERS: Record<Tier, TierConfig> = {
  0: {
    dpr: Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2),
    shadowMap: { type: THREE.PCFSoftShadowMap, size: 2048 },
  },
  1: {
    dpr: 1,
    shadowMap: { type: THREE.PCFSoftShadowMap, size: 1024 },
  },
  2: {
    dpr: 1,
    shadowMap: { type: THREE.BasicShadowMap, size: 512 },
  },
};

export function AdaptiveQuality() {
  const { gl, scene } = useThree();
  const frameTimes = useRef<number[]>([]);
  const lastTime = useRef(performance.now());
  const tier = useRef<Tier>(0);
  const lastTierChangeAt = useRef(0);

  // Apply initial tier settings. Phase 12.D: seed from the SAME cached
  // probe that App.tsx uses for the Canvas's antialias/DPR props — one
  // classification drives every boot-time render decision.
  useEffect(() => {
    const probe = probeGpuAtBoot();
    const seed = initialTierFor(probe.tier);
    tier.current = seed;
    applyTier(gl, scene, seed);
    log.info('adaptive quality initialized', {
      gpuTier: probe.tier,
      startingTier: seed,
    });
  }, [gl, scene]);

  useFrame(() => {
    const now = performance.now();
    const dt = now - lastTime.current;
    lastTime.current = now;
    frameTimes.current.push(dt);

    // Forward every frame to the global perf ring so the HUD, future
    // telemetry, and any dev tool read from ONE source of truth.
    recordFrame(dt);

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
    const sinceChange = now - lastTierChangeAt.current;

    // Enforce cooldown so we don't thrash between tiers.
    if (sinceChange < TIER_COOLDOWN_MS) return;

    if (fps < TARGET_FPS && tier.current < 2) {
      // Escalate — GPU can't keep up, drop quality.
      tier.current = (tier.current + 1) as Tier;
      applyTier(gl, scene, tier.current);
      frameTimes.current = []; // reset after tier change
      lastTierChangeAt.current = now;
      log.debug('escalated tier', { tier: tier.current, fps });
      return;
    }

    if (fps > TARGET_FPS + DEESCALATE_HEADROOM_FPS && tier.current > 0) {
      // De-escalate — we have budget to spare, recover quality.
      tier.current = (tier.current - 1) as Tier;
      applyTier(gl, scene, tier.current);
      frameTimes.current = [];
      lastTierChangeAt.current = now;
      log.debug('de-escalated tier', { tier: tier.current, fps });
    }
  });

  return null;
}

function applyTier(gl: THREE.WebGLRenderer, scene: THREE.Scene, tierLevel: Tier): void {
  const config = TIERS[tierLevel];

  gl.setPixelRatio(config.dpr);
  gl.shadowMap.type = config.shadowMap.type;
  gl.shadowMap.enabled = true;

  // Resize the directional-light shadow maps that the scene currently
  // carries. Walking scene.children avoids coupling AdaptiveQuality to
  // the specific light-mounting component in App.tsx — if we add or
  // remove a directional light later, this still does the right thing.
  scene.traverse((obj) => {
    if ((obj as THREE.DirectionalLight).isDirectionalLight) {
      const light = obj as THREE.DirectionalLight;
      if (light.castShadow && light.shadow) {
        light.shadow.mapSize.width = config.shadowMap.size;
        light.shadow.mapSize.height = config.shadowMap.size;
        // Invalidate the existing shadow-map render target so the
        // new size takes effect on the next frame.
        if (light.shadow.map) {
          light.shadow.map.dispose();
          (light.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
        }
      }
    }
  });
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  TIERS,
  TARGET_FPS,
  DEESCALATE_HEADROOM_FPS,
  TIER_COOLDOWN_MS,
};
