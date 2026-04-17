/**
 * Visual Fatigue Guard — prevents overstimulation during long sessions.
 *
 * EEG research shows gamified visuals enhance perceptual engagement
 * WITHOUT degrading task performance — but only if the system respects
 * session duration and visual intensity limits.
 *
 * This guard tracks:
 *   - Continuous session duration (eyes-on-screen time)
 *   - Visual event density (how many FX fired recently)
 *   - Sustained high-engagement duration (flow state can exhaust)
 *   - Screen time without breaks
 *
 * When fatigue risk rises, it emits adaptation signals that the
 * AdaptiveRenderProfile consumes to gently reduce visual intensity,
 * suggest breaks, and dim non-essential FX.
 *
 * The goal: the user stays in the "stimulated but not strained" zone
 * validated by the neurophysiological research.
 */

import { eventBus } from '../EventBus';
import { EV } from '../events';
import { ENGAGE_EV, type EngagementState } from './EngagementMetrics';

// ── Events ──────────────────────────────────────────────────────

export const FATIGUE_EV = {
  FATIGUE_UPDATED:   'fatigue:updated',
  BREAK_SUGGESTED:   'fatigue:break:suggested',
  INTENSITY_CAP:     'fatigue:intensity:cap',
} as const;

export type FatigueLevel = 'fresh' | 'normal' | 'tired' | 'strained';

export interface FatigueState {
  level: FatigueLevel;
  /** 0–1 fatigue score. */
  score: number;
  /** Continuous session time in minutes. */
  sessionMinutes: number;
  /** Minutes since last break. */
  minutesSinceBreak: number;
  /** Visual events per minute (rolling). */
  visualEventsPerMinute: number;
  /** Minutes spent in sustained flow state. */
  flowMinutes: number;
  /** Maximum safe visual intensity multiplier (1 = full, 0.3 = heavily reduced). */
  intensityCap: number;
  /** Whether a break has been suggested but not taken. */
  breakPending: boolean;
}

// ── Thresholds ──────────────────────────────────────────────────

const BREAK_INTERVAL_MIN = 45;    // suggest break every 45 min
const FLOW_EXHAUST_MIN = 30;      // sustained flow > 30 min = fatigue risk
const MAX_VFX_PER_MIN = 40;       // visual event density ceiling
const SESSION_FATIGUE_MIN = 120;  // 2+ hours = elevated baseline fatigue

// ── Guard ───────────────────────────────────────────────────────

export class VisualFatigueGuard {
  private sessionStart = Date.now();
  private lastBreak = Date.now();
  private vfxTimestamps: number[] = [];
  private flowAccumMs = 0;
  private lastTickTime = Date.now();
  private breakPending = false;

  private state: FatigueState = {
    level: 'fresh',
    score: 0,
    sessionMinutes: 0,
    minutesSinceBreak: 0,
    visualEventsPerMinute: 0,
    flowMinutes: 0,
    intensityCap: 1,
    breakPending: false,
  };

  constructor() {
    this.wireEvents();
  }

  /** Call periodically (e.g. every 2s) to recompute fatigue. */
  tick(): FatigueState {
    const now = Date.now();
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;

    // Prune VFX window (60s)
    this.vfxTimestamps = this.vfxTimestamps.filter((t) => now - t < 60_000);

    const sessionMin = (now - this.sessionStart) / 60_000;
    const breakMin = (now - this.lastBreak) / 60_000;
    const vfxPerMin = this.vfxTimestamps.length;
    const flowMin = this.flowAccumMs / 60_000;

    // ── Composite fatigue score ────────────────────────────────
    let score = 0;

    // Session duration factor (ramps slowly after 2 hours)
    score += Math.min(0.3, (sessionMin / SESSION_FATIGUE_MIN) * 0.3);

    // Time since break factor
    score += Math.min(0.3, (breakMin / BREAK_INTERVAL_MIN) * 0.3);

    // Visual event density factor
    score += Math.min(0.2, (vfxPerMin / MAX_VFX_PER_MIN) * 0.2);

    // Sustained flow exhaustion
    score += Math.min(0.2, (flowMin / FLOW_EXHAUST_MIN) * 0.2);

    // ── Level classification ──────────────────────────────────
    const level: FatigueLevel =
      score < 0.2 ? 'fresh' :
      score < 0.45 ? 'normal' :
      score < 0.7 ? 'tired' :
                     'strained';

    // ── Intensity cap (how much visual richness is safe) ──────
    // Fresh: full visuals. Strained: reduce to 30% intensity.
    const intensityCap =
      level === 'fresh'    ? 1.0 :
      level === 'normal'   ? 0.85 :
      level === 'tired'    ? 0.6 :
                             0.3;

    // ── Break suggestion ──────────────────────────────────────
    if (breakMin >= BREAK_INTERVAL_MIN && !this.breakPending) {
      this.breakPending = true;
      eventBus.emit(FATIGUE_EV.BREAK_SUGGESTED, {
        minutesSinceBreak: Math.round(breakMin),
      });
    }

    this.state = {
      level,
      score,
      sessionMinutes: sessionMin,
      minutesSinceBreak: breakMin,
      visualEventsPerMinute: vfxPerMin,
      flowMinutes: flowMin,
      intensityCap,
      breakPending: this.breakPending,
    };

    eventBus.emit(FATIGUE_EV.FATIGUE_UPDATED, { ...this.state });
    eventBus.emit(FATIGUE_EV.INTENSITY_CAP, intensityCap);

    return this.state;
  }

  /** Call when the user takes a break (stood up, tabbed away, etc). */
  recordBreak(): void {
    this.lastBreak = Date.now();
    this.breakPending = false;
    this.flowAccumMs = Math.max(0, this.flowAccumMs - 10 * 60_000); // recover 10 min
  }

  /** Get current state without recomputing. */
  getState(): FatigueState {
    return { ...this.state };
  }

  /** Reset (new session). */
  reset(): void {
    this.sessionStart = Date.now();
    this.lastBreak = Date.now();
    this.vfxTimestamps = [];
    this.flowAccumMs = 0;
    this.breakPending = false;
  }

  // ── Internal ────────────────────────────────────────────────

  private wireEvents(): void {
    // Count visual events (cues + rewards)
    eventBus.on(EV.CUE, () => this.vfxTimestamps.push(Date.now()));
    eventBus.on(EV.REWARD, () => this.vfxTimestamps.push(Date.now()));

    // Track flow state accumulation
    eventBus.on<EngagementState>(ENGAGE_EV.METRICS_UPDATED, (state) => {
      if (state.zone === 'flow') {
        this.flowAccumMs += 2000; // assumes 2s tick interval
      }
    });
  }
}

export const fatigueGuard = new VisualFatigueGuard();
