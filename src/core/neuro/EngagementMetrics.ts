/**
 * Engagement Metrics — perceptual engagement tracker inspired by
 * EEG beta/theta rhythm research.
 *
 * Without actual EEG hardware, we approximate engagement state from
 * behavioral proxies that correlate with the same neural signatures:
 *
 *   Beta-proxy (focused attention):
 *     - Sustained interaction without pauses
 *     - Precise, deliberate actions (small movements, few corrections)
 *     - Consistent camera usage (not thrashing)
 *
 *   Theta-proxy (creative exploration):
 *     - Exploring multiple route options before committing
 *     - Camera rotation to inspect from different angles
 *     - Trying then canceling routes (divergent thinking, not frustration)
 *
 * The key insight from EEG research: elevated beta+theta together means
 * the user is ENGAGED at the perceptual level without being OVERLOADED
 * at the task level. We maintain this balance by scaling visual richness
 * up when engagement is healthy, and pulling it back when either:
 *   - Engagement drops (theta + beta both low → boredom → add stimulation)
 *   - Task load spikes (from CognitiveLoadMonitor → reduce visual noise)
 */

import { eventBus } from '../EventBus';
import { EV } from '../events';

// ── Events ──────────────────────────────────────────────────────

export const ENGAGE_EV = {
  METRICS_UPDATED: 'engage:metrics:updated',
  ZONE_CHANGED:    'engage:zone:changed',
} as const;

/**
 * Engagement zones — maps to the EEG-validated states:
 *   flow       = beta↑ theta↑ → ideal state, rich visuals safe
 *   focused    = beta↑ theta↓ → deep work, keep visuals moderate
 *   exploring  = beta↓ theta↑ → creative wandering, visuals can be rich
 *   disengaged = beta↓ theta↓ → losing interest, increase stimulation
 */
export type EngagementZone = 'flow' | 'focused' | 'exploring' | 'disengaged';

export interface EngagementState {
  zone: EngagementZone;
  /** Beta proxy: 0–1 sustained focused attention. */
  betaProxy: number;
  /** Theta proxy: 0–1 creative exploration. */
  thetaProxy: number;
  /** Composite engagement score 0–1. */
  engagement: number;
  /** How long the user has been in the current zone (seconds). */
  zoneDuration: number;
  /** Total session active time (seconds). */
  sessionTime: number;
}

// ── Tracker ─────────────────────────────────────────────────────

const SAMPLE_WINDOW = 30_000; // 30-second rolling window

export class EngagementTracker {
  // Beta-proxy signals
  private preciseActions: number[] = [];    // timestamps of non-canceled actions
  private interactionGaps: number[] = [];   // gap durations in ms

  // Theta-proxy signals
  private routeExplorations = 0;            // routes tried then discarded
  private cameraInspections: number[] = []; // camera rotation samples
  private hiloReviews = 0;                  // times user hovered different HILO options

  private lastActionTime = Date.now();
  private sessionStart = Date.now();
  private currentZone: EngagementZone = 'disengaged';
  private zoneEnteredAt = Date.now();

  private state: EngagementState = {
    zone: 'disengaged',
    betaProxy: 0,
    thetaProxy: 0,
    engagement: 0,
    zoneDuration: 0,
    sessionTime: 0,
  };

  constructor() {
    this.wireEvents();
  }

  /** Call periodically (e.g. every 1s) to recompute engagement. */
  tick(): EngagementState {
    const now = Date.now();
    this.pruneWindow(now);

    // ── Beta proxy (focused attention) ────────────────────────
    // High when: many precise actions, short gaps, few cancels
    const actionRate = this.preciseActions.length / (SAMPLE_WINDOW / 1000);
    const normalizedRate = Math.min(1, actionRate / 5); // 5 actions/s = max

    const avgGap = this.interactionGaps.length > 0
      ? this.interactionGaps.reduce((a, b) => a + b, 0) / this.interactionGaps.length
      : SAMPLE_WINDOW;
    const gapScore = Math.max(0, 1 - avgGap / 10_000); // <10s gaps = focused

    const beta = normalizedRate * 0.6 + gapScore * 0.4;

    // ── Theta proxy (creative exploration) ────────────────────
    // High when: exploring routes, rotating camera, reviewing options
    const exploreScore = Math.min(1, this.routeExplorations / 5);
    const camScore = this.cameraInspections.length > 0
      ? Math.min(1, this.cameraInspections.length / 20)
      : 0;
    const reviewScore = Math.min(1, this.hiloReviews / 8);

    const theta = exploreScore * 0.4 + camScore * 0.3 + reviewScore * 0.3;

    // ── Zone classification ───────────────────────────────────
    const zone: EngagementZone =
      beta > 0.5 && theta > 0.5 ? 'flow' :
      beta > 0.5 && theta <= 0.5 ? 'focused' :
      beta <= 0.5 && theta > 0.5 ? 'exploring' :
                                    'disengaged';

    if (zone !== this.currentZone) {
      this.currentZone = zone;
      this.zoneEnteredAt = now;
      eventBus.emit(ENGAGE_EV.ZONE_CHANGED, zone);
    }

    // Composite engagement = geometric mean (both must be present for high score)
    const engagement = Math.sqrt(beta * theta);

    this.state = {
      zone,
      betaProxy: beta,
      thetaProxy: theta,
      engagement,
      zoneDuration: (now - this.zoneEnteredAt) / 1000,
      sessionTime: (now - this.sessionStart) / 1000,
    };

    eventBus.emit(ENGAGE_EV.METRICS_UPDATED, { ...this.state });
    return this.state;
  }

  /** Report a camera rotation sample (for theta proxy). */
  reportCameraRotation(): void {
    this.cameraInspections.push(Date.now());
  }

  /** Report that the user hovered/reviewed a HILO option. */
  reportHILOReview(): void {
    this.hiloReviews++;
  }

  /** Get current state without recomputing. */
  getState(): EngagementState {
    return { ...this.state };
  }

  /** Reset for new session. */
  reset(): void {
    this.preciseActions = [];
    this.interactionGaps = [];
    this.cameraInspections = [];
    this.routeExplorations = 0;
    this.hiloReviews = 0;
    this.sessionStart = Date.now();
    this.lastActionTime = Date.now();
    this.currentZone = 'disengaged';
    this.zoneEnteredAt = Date.now();
  }

  // ── Internal ────────────────────────────────────────────────

  private wireEvents(): void {
    // Precise actions (non-canceled completions)
    const preciseEvents = [EV.PIPE_SNAP, EV.PIPE_COMPLETE, EV.FIXTURE_PLACED];
    for (const ev of preciseEvents) {
      eventBus.on(ev, () => {
        const now = Date.now();
        const gap = now - this.lastActionTime;
        this.preciseActions.push(now);
        this.interactionGaps.push(gap);
        this.lastActionTime = now;
      });
    }

    // Route exploration (cancel = tried and discarded)
    eventBus.on(EV.PIPE_CANCEL, () => {
      this.routeExplorations++;
      this.lastActionTime = Date.now();
    });

    // General interaction (keeps lastActionTime fresh)
    eventBus.on(EV.PIPE_DRAG_START, () => {
      this.lastActionTime = Date.now();
    });
  }

  private pruneWindow(now: number): void {
    const cutoff = now - SAMPLE_WINDOW;
    this.preciseActions = this.preciseActions.filter((t) => t > cutoff);
    this.interactionGaps = this.interactionGaps.slice(-20);
    this.cameraInspections = this.cameraInspections.filter((t) => t > cutoff);
  }
}

export const engagementTracker = new EngagementTracker();
