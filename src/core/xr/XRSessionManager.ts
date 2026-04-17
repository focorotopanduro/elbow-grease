/**
 * XR Session Manager — WebXR lifecycle and capability detection.
 *
 * Handles the full HMD session lifecycle: capability probing, session
 * request, reference space setup, and graceful fallback to desktop 3D.
 *
 * Three interaction tiers (auto-detected, best-available):
 *   Tier 1 — Immersive VR (HMD + hand tracking)
 *   Tier 2 — Immersive AR (passthrough + hand tracking)
 *   Tier 3 — Desktop 3D (mouse/keyboard, enhanced camera)
 *
 * Events are broadcast on the EventBus so the rest of the system
 * adapts its UI and interaction model to the active tier.
 */

import { eventBus } from '../EventBus';

// ── XR events ───────────────────────────────────────────────────

export const XR_EV = {
  CAPABILITIES_DETECTED: 'xr:capabilities',
  SESSION_STARTED:       'xr:session:start',
  SESSION_ENDED:         'xr:session:end',
  TIER_CHANGED:          'xr:tier:changed',
  HAND_TRACKING_READY:   'xr:hands:ready',
  INPUT_SOURCE_CHANGED:  'xr:input:changed',
} as const;

export type XRTier = 'immersive-vr' | 'immersive-ar' | 'desktop';

export interface XRCapabilities {
  supportsVR: boolean;
  supportsAR: boolean;
  supportsHandTracking: boolean;
  supportsBoundedFloor: boolean;
  activeTier: XRTier;
}

// ── Manager ─────────────────────────────────────────────────────

export class XRSessionManager {
  private capabilities: XRCapabilities = {
    supportsVR: false,
    supportsAR: false,
    supportsHandTracking: false,
    supportsBoundedFloor: false,
    activeTier: 'desktop',
  };

  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;

  /** Probe device capabilities. Call once at app boot. */
  async detectCapabilities(): Promise<XRCapabilities> {
    if (!('xr' in navigator)) {
      this.capabilities.activeTier = 'desktop';
      eventBus.emit(XR_EV.CAPABILITIES_DETECTED, { ...this.capabilities });
      return this.capabilities;
    }

    const xr = navigator.xr!;

    const [vr, ar] = await Promise.all([
      xr.isSessionSupported('immersive-vr').catch(() => false),
      xr.isSessionSupported('immersive-ar').catch(() => false),
    ]);

    this.capabilities.supportsVR = vr;
    this.capabilities.supportsAR = ar;
    this.capabilities.activeTier = vr ? 'immersive-vr' : ar ? 'immersive-ar' : 'desktop';

    eventBus.emit(XR_EV.CAPABILITIES_DETECTED, { ...this.capabilities });
    return this.capabilities;
  }

  /** Request an immersive session with best-available features. */
  async startSession(preferredTier?: XRTier): Promise<boolean> {
    const tier = preferredTier ?? this.capabilities.activeTier;
    if (tier === 'desktop') return false;
    if (!navigator.xr) return false;

    const mode = tier === 'immersive-vr' ? 'immersive-vr' : 'immersive-ar';

    // Request features: hand-tracking if available, local-floor minimum
    const requiredFeatures: string[] = ['local-floor'];
    const optionalFeatures: string[] = [
      'hand-tracking',
      'bounded-floor',
      'hit-test',
      'anchors',
    ];

    try {
      this.session = await navigator.xr!.requestSession(mode, {
        requiredFeatures,
        optionalFeatures,
      });

      this.session.addEventListener('end', this.onSessionEnd);
      this.session.addEventListener('inputsourceschange', this.onInputSourceChange);

      // Establish reference space
      try {
        this.refSpace = await this.session.requestReferenceSpace('bounded-floor');
        this.capabilities.supportsBoundedFloor = true;
      } catch {
        this.refSpace = await this.session.requestReferenceSpace('local-floor');
      }

      // Check hand tracking support
      this.capabilities.supportsHandTracking =
        this.session.inputSources.length > 0 &&
        'hand' in (this.session.inputSources[0] ?? {});

      this.capabilities.activeTier = tier;

      eventBus.emit(XR_EV.SESSION_STARTED, {
        tier,
        handTracking: this.capabilities.supportsHandTracking,
      });
      eventBus.emit(XR_EV.TIER_CHANGED, tier);

      return true;
    } catch (err) {
      console.warn('XR session request failed, falling back to desktop:', err);
      this.capabilities.activeTier = 'desktop';
      eventBus.emit(XR_EV.TIER_CHANGED, 'desktop');
      return false;
    }
  }

  /** End the current immersive session. */
  async endSession(): Promise<void> {
    if (this.session) {
      await this.session.end();
    }
  }

  /** Get the active XR session (null if desktop). */
  getSession(): XRSession | null {
    return this.session;
  }

  /** Get the reference space. */
  getReferenceSpace(): XRReferenceSpace | null {
    return this.refSpace;
  }

  /** Get current capabilities snapshot. */
  getCapabilities(): XRCapabilities {
    return { ...this.capabilities };
  }

  /** Get active interaction tier. */
  get tier(): XRTier {
    return this.capabilities.activeTier;
  }

  // ── Internal handlers ───────────────────────────────────────

  private onSessionEnd = () => {
    this.session = null;
    this.refSpace = null;
    this.capabilities.activeTier = 'desktop';
    eventBus.emit(XR_EV.SESSION_ENDED, null);
    eventBus.emit(XR_EV.TIER_CHANGED, 'desktop');
  };

  private onInputSourceChange = (ev: XRInputSourcesChangeEvent) => {
    const hands = ev.session.inputSources.length;
    const hasHandTracking = [...ev.session.inputSources].some((s) => s.hand);
    this.capabilities.supportsHandTracking = hasHandTracking;

    eventBus.emit(XR_EV.INPUT_SOURCE_CHANGED, {
      sourceCount: hands,
      handTracking: hasHandTracking,
    });

    if (hasHandTracking) {
      eventBus.emit(XR_EV.HAND_TRACKING_READY, null);
    }
  };
}

/** Singleton. */
export const xrManager = new XRSessionManager();
