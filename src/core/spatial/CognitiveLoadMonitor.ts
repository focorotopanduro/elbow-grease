/**
 * Cognitive Load Monitor — tracks real-time interaction metrics
 * to detect when the user is overwhelmed or disengaged.
 *
 * Metrics tracked (inspired by HCI eye-tracking / interaction studies):
 *   - Action rate (actions per minute)
 *   - Undo/cancel frequency (frustration signal)
 *   - Idle gaps (disengagement / confusion signal)
 *   - Route revision count (struggling with spatial layout)
 *   - Camera thrashing (rapid rotation = lost spatial orientation)
 *
 * When cognitive load exceeds a threshold, the system:
 *   - Increases visual cue prominence (bigger glow, brighter arrows)
 *   - Reduces the number of HILO suggestions (fewer choices)
 *   - Shows contextual hints in the HUD
 *   - Slows down animations for clarity
 *
 * This is the adaptive UI layer that makes the software usable
 * for novices without dumbing it down for experts.
 */

import { eventBus } from '../EventBus';
import { EV } from '../events';

// ── Load events ─────────────────────────────────────────────────

export const LOAD_EV = {
  LOAD_UPDATED: 'cognitive:load:updated',
  HINT_TRIGGER: 'cognitive:hint',
} as const;

export type LoadLevel = 'low' | 'moderate' | 'high' | 'overloaded';

export interface LoadState {
  level: LoadLevel;
  /** 0–1 composite score. */
  score: number;
  /** Actions per minute (rolling window). */
  actionsPerMinute: number;
  /** Cancel/undo rate as fraction of total actions. */
  cancelRate: number;
  /** Seconds since last meaningful action. */
  idleSeconds: number;
  /** How many route revisions in current session. */
  revisions: number;
  /** Camera rotation velocity (rad/s average). */
  cameraThrash: number;
}

export interface LoadAdaptation {
  /** Multiplier for visual cue intensity (1 = normal, 2 = emphasized). */
  cueIntensity: number;
  /** Max HILO suggestions to show. */
  maxSuggestions: number;
  /** Whether to show contextual hints. */
  showHints: boolean;
  /** Animation speed multiplier (lower = slower, clearer). */
  animationSpeed: number;
}

// ── Monitor ─────────────────────────────────────────────────────

const WINDOW_MS = 60_000; // 1-minute rolling window

export class CognitiveLoadMonitor {
  private actionTimestamps: number[] = [];
  private cancelTimestamps: number[] = [];
  private lastActionTime = Date.now();
  private revisions = 0;
  private cameraVelocities: number[] = [];

  private currentLoad: LoadState = {
    level: 'low',
    score: 0,
    actionsPerMinute: 0,
    cancelRate: 0,
    idleSeconds: 0,
    revisions: 0,
    cameraThrash: 0,
  };

  constructor() {
    this.wireEvents();
  }

  /** Call each frame to update idle time and emit load state. */
  tick(): LoadState {
    const now = Date.now();
    this.pruneWindow(now);

    // Compute metrics
    const apm = this.actionTimestamps.length;
    const cancels = this.cancelTimestamps.length;
    const cancelRate = apm > 0 ? cancels / apm : 0;
    const idleSec = (now - this.lastActionTime) / 1000;
    const avgCamVel = this.cameraVelocities.length > 0
      ? this.cameraVelocities.reduce((a, b) => a + b, 0) / this.cameraVelocities.length
      : 0;

    // Composite score (0–1)
    let score = 0;
    // High action rate with many cancels = frustration
    score += Math.min(1, cancelRate * 2) * 0.3;
    // Long idle = confusion
    score += Math.min(1, idleSec / 30) * 0.2;
    // Many revisions = struggling
    score += Math.min(1, this.revisions / 10) * 0.25;
    // Camera thrashing = lost orientation
    score += Math.min(1, avgCamVel / 3) * 0.25;

    const level: LoadLevel =
      score < 0.25 ? 'low' :
      score < 0.5  ? 'moderate' :
      score < 0.75 ? 'high' :
                     'overloaded';

    this.currentLoad = {
      level,
      score,
      actionsPerMinute: apm,
      cancelRate,
      idleSeconds: idleSec,
      revisions: this.revisions,
      cameraThrash: avgCamVel,
    };

    eventBus.emit(LOAD_EV.LOAD_UPDATED, { ...this.currentLoad });
    return this.currentLoad;
  }

  /** Get current adaptation parameters based on load level. */
  getAdaptation(): LoadAdaptation {
    switch (this.currentLoad.level) {
      case 'low':
        return { cueIntensity: 1, maxSuggestions: 4, showHints: false, animationSpeed: 1 };
      case 'moderate':
        return { cueIntensity: 1.3, maxSuggestions: 3, showHints: false, animationSpeed: 0.9 };
      case 'high':
        return { cueIntensity: 1.6, maxSuggestions: 2, showHints: true, animationSpeed: 0.7 };
      case 'overloaded':
        return { cueIntensity: 2, maxSuggestions: 1, showHints: true, animationSpeed: 0.5 };
    }
  }

  /** Report a camera rotation velocity sample. */
  reportCameraVelocity(radPerSec: number): void {
    this.cameraVelocities.push(radPerSec);
    if (this.cameraVelocities.length > 30) this.cameraVelocities.shift();
  }

  /** Get raw load state. */
  getLoad(): LoadState {
    return { ...this.currentLoad };
  }

  /** Reset all metrics (new session). */
  reset(): void {
    this.actionTimestamps = [];
    this.cancelTimestamps = [];
    this.lastActionTime = Date.now();
    this.revisions = 0;
    this.cameraVelocities = [];
  }

  // ── Internal ────────────────────────────────────────────────

  private wireEvents(): void {
    // Track all meaningful actions
    const actionEvents = [
      EV.PIPE_DRAG_START, EV.PIPE_SNAP, EV.PIPE_COMPLETE,
      EV.FIXTURE_PLACED, EV.FIXTURE_SELECTED,
    ];
    for (const ev of actionEvents) {
      eventBus.on(ev, () => this.recordAction());
    }

    // Track cancels / undos
    eventBus.on(EV.PIPE_CANCEL, () => this.recordCancel());

    // Track route revisions
    eventBus.on(EV.PIPE_ROUTE_UPDATE, () => {
      this.revisions++;
      this.recordAction();
    });
  }

  private recordAction(): void {
    const now = Date.now();
    this.actionTimestamps.push(now);
    this.lastActionTime = now;
  }

  private recordCancel(): void {
    this.cancelTimestamps.push(Date.now());
    this.recordAction();
  }

  private pruneWindow(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.actionTimestamps = this.actionTimestamps.filter((t) => t > cutoff);
    this.cancelTimestamps = this.cancelTimestamps.filter((t) => t > cutoff);
  }
}

export const cognitiveMonitor = new CognitiveLoadMonitor();
