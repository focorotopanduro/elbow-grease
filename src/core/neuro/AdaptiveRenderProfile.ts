/**
 * Adaptive Render Profile — dynamic visual intensity scaling.
 *
 * Consumes signals from three sources:
 *   1. EngagementMetrics (zone: flow/focused/exploring/disengaged)
 *   2. VisualFatigueGuard (intensityCap: 0.3–1.0)
 *   3. CognitiveLoadMonitor (level: low/moderate/high/overloaded)
 *
 * Produces a single RenderProfile that the R3F post-processing layer
 * reads each frame to scale:
 *   - Bloom intensity
 *   - Emissive glow strength
 *   - Particle density (snap/complete FX)
 *   - Fog density
 *   - Animation speed
 *   - Background richness (environment map exposure)
 *   - Grid line contrast
 *
 * The profile ensures the EEG-validated balance:
 *   "Perceptual engagement UP, task-level cognitive load STABLE."
 */

import { eventBus } from '../EventBus';
import {
  ENGAGE_EV,
  type EngagementZone,
  type EngagementState,
} from './EngagementMetrics';
import { FATIGUE_EV, type FatigueState } from './VisualFatigueGuard';
import {
  LOAD_EV,
  type LoadLevel,
  type LoadState,
} from '../spatial/CognitiveLoadMonitor';

// ── Profile shape ───────────────────────────────────────────────

export interface RenderProfile {
  /** Bloom strength multiplier (0–2). */
  bloom: number;
  /** Emissive glow on pipes/fixtures (0–3). */
  emissiveIntensity: number;
  /** Particle count multiplier for snap/complete FX (0–1). */
  particleDensity: number;
  /** Fog opacity multiplier (0–1). */
  fogDensity: number;
  /** Animation speed multiplier (0.3–1.5). */
  animationSpeed: number;
  /** Environment map exposure (0.3–2). */
  envExposure: number;
  /** Grid line opacity (0.1–0.6). */
  gridOpacity: number;
  /** Tone mapping exposure (0.6–1.5). */
  toneMappingExposure: number;
  /** Whether to show secondary FX (ambient particles, subtle pulses). */
  showAmbientFX: boolean;
}

export const PROFILE_EV = {
  PROFILE_UPDATED: 'render:profile:updated',
} as const;

// ── Base profiles per engagement zone ───────────────────────────

const ZONE_PROFILES: Record<EngagementZone, RenderProfile> = {
  flow: {
    bloom: 1.5,
    emissiveIntensity: 2.5,
    particleDensity: 1.0,
    fogDensity: 0.8,
    animationSpeed: 1.0,
    envExposure: 1.4,
    gridOpacity: 0.35,
    toneMappingExposure: 1.3,
    showAmbientFX: true,
  },
  focused: {
    bloom: 0.8,
    emissiveIntensity: 1.5,
    particleDensity: 0.6,
    fogDensity: 0.6,
    animationSpeed: 0.9,
    envExposure: 1.0,
    gridOpacity: 0.4,
    toneMappingExposure: 1.1,
    showAmbientFX: false,
  },
  exploring: {
    bloom: 1.3,
    emissiveIntensity: 2.0,
    particleDensity: 0.8,
    fogDensity: 0.7,
    animationSpeed: 1.1,
    envExposure: 1.3,
    gridOpacity: 0.3,
    toneMappingExposure: 1.2,
    showAmbientFX: true,
  },
  disengaged: {
    // Slightly increase visual richness to re-engage
    bloom: 1.8,
    emissiveIntensity: 2.8,
    particleDensity: 0.9,
    fogDensity: 0.5,
    animationSpeed: 1.2,
    envExposure: 1.5,
    gridOpacity: 0.25,
    toneMappingExposure: 1.4,
    showAmbientFX: true,
  },
};

// ── Cognitive load damping (reduces visuals when task is hard) ───

const LOAD_DAMPING: Record<LoadLevel, number> = {
  low:        1.0,
  moderate:   0.85,
  high:       0.65,
  overloaded: 0.4,
};

// ── Profile manager ─────────────────────────────────────────────

export class AdaptiveRenderProfileManager {
  private currentZone: EngagementZone = 'disengaged';
  private intensityCap = 1.0;
  private loadDamping = 1.0;
  private profile: RenderProfile;

  /** Smooth transition speed (0–1, higher = faster snapping). */
  private lerpSpeed = 0.03;
  private targetProfile: RenderProfile;

  constructor() {
    this.profile = { ...ZONE_PROFILES.disengaged };
    this.targetProfile = { ...this.profile };
    this.wireEvents();
  }

  /**
   * Call each frame. Returns the smoothly-interpolated render profile.
   * The R3F layer reads this to set post-processing params.
   */
  tick(): RenderProfile {
    // Lerp each parameter toward target
    const keys = Object.keys(this.profile) as (keyof RenderProfile)[];
    for (const k of keys) {
      if (k === 'showAmbientFX') {
        this.profile[k] = this.targetProfile[k];
        continue;
      }
      const current = this.profile[k] as number;
      const target = this.targetProfile[k] as number;
      (this.profile as unknown as Record<string, number | boolean>)[k] =
        current + (target - current) * this.lerpSpeed;
    }

    return { ...this.profile };
  }

  /** Get current profile without ticking. */
  getProfile(): RenderProfile {
    return { ...this.profile };
  }

  // ── Internal ────────────────────────────────────────────────

  private recomputeTarget(): void {
    const base = ZONE_PROFILES[this.currentZone];
    const cap = this.intensityCap;
    const damp = this.loadDamping;
    const scale = Math.min(cap, damp); // take the more restrictive

    this.targetProfile = {
      bloom: base.bloom * scale,
      emissiveIntensity: base.emissiveIntensity * scale,
      particleDensity: base.particleDensity * scale,
      fogDensity: base.fogDensity,
      animationSpeed: base.animationSpeed * (0.5 + scale * 0.5),
      envExposure: base.envExposure * (0.6 + scale * 0.4),
      gridOpacity: base.gridOpacity,
      toneMappingExposure: base.toneMappingExposure * (0.7 + scale * 0.3),
      // Disable ambient FX when strained or overloaded
      showAmbientFX: base.showAmbientFX && scale > 0.5,
    };

    eventBus.emit(PROFILE_EV.PROFILE_UPDATED, { ...this.targetProfile });
  }

  private wireEvents(): void {
    eventBus.on<EngagementState>(ENGAGE_EV.METRICS_UPDATED, (state) => {
      this.currentZone = state.zone;
      this.recomputeTarget();
    });

    eventBus.on<number>(FATIGUE_EV.INTENSITY_CAP, (cap) => {
      this.intensityCap = cap;
      this.recomputeTarget();
    });

    eventBus.on<LoadState>(LOAD_EV.LOAD_UPDATED, (state) => {
      this.loadDamping = LOAD_DAMPING[state.level];
      this.recomputeTarget();
    });
  }
}

export const renderProfile = new AdaptiveRenderProfileManager();
