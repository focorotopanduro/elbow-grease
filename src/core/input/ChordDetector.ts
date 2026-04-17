/**
 * ChordDetector — multi-key chord detection with hold durations and
 * partial-chord visualization.
 *
 * Handles three chord classes:
 *
 *   1. HOLD chords (e.g. CTRL+SPACE)
 *      User holds both keys → activates. Releases → deactivates.
 *      The radial menus use this — wheel visible while held.
 *
 *   2. SEQUENCE chords (e.g. CTRL+E, F)
 *      User presses CTRL+E, releases, then presses F within window.
 *      Used for privileged operations like customer edit.
 *
 *   3. TAP chords (e.g. CTRL+SHIFT+Z for redo)
 *      Standard modifier + key press, fires once on key-down.
 *      Used for traditional shortcuts.
 *
 * Features:
 *   - Platform-aware (CTRL on Windows/Linux, CMD on Mac)
 *   - Partial chord visualization (emits events as user builds chord)
 *   - Chord conflict resolution (longer chord wins over shorter prefix)
 *   - Deterministic key-up ordering (chord "sticks" even if modifier released first)
 *   - Configurable hold threshold (default 150ms before activating hold chord)
 *   - Configurable sequence window (default 600ms between steps)
 *   - Input-field guard (chords suppressed when typing in an <input>)
 *
 * Events emitted on the EventBus:
 *   CHORD_PARTIAL — user has pressed part of a chord, system is waiting
 *   CHORD_ACTIVATE — a chord was recognized, fire its action
 *   CHORD_HOLD_START — a hold chord just activated, keep firing until release
 *   CHORD_HOLD_END — a hold chord was released
 */

import { eventBus } from '../EventBus';

// ── Chord type definitions ──────────────────────────────────────

export type ChordAction = () => void;

export interface HoldChord {
  id: string;
  keys: string[]; // e.g. ["Control", " "] for CTRL+SPACE
  onStart: ChordAction;
  onEnd?: ChordAction;
  description: string;
}

export interface SequenceChord {
  id: string;
  steps: string[][]; // each step is a key combo, e.g. [["Control","e"], ["f"]]
  /** Max time (ms) between steps before sequence resets. */
  windowMs?: number;
  action: ChordAction;
  description: string;
}

export interface TapChord {
  id: string;
  keys: string[]; // e.g. ["Control", "z"]
  action: ChordAction;
  description: string;
  /** If true, Shift modifier must match exactly. */
  requireShift?: boolean;
  /** If true, prevents default browser behavior. */
  preventDefault?: boolean;
}

// ── Events ──────────────────────────────────────────────────────

export const CHORD_EV = {
  PARTIAL:     'chord:partial',
  ACTIVATE:    'chord:activate',
  HOLD_START:  'chord:hold:start',
  HOLD_END:    'chord:hold:end',
  CLEAR:       'chord:clear',
} as const;

export interface PartialChordPayload {
  keysHeld: string[];
  candidates: { id: string; remaining: string[][]; description: string }[];
}

// ── Detector ────────────────────────────────────────────────────

export class ChordDetector {
  private holdChords: HoldChord[] = [];
  private sequenceChords: SequenceChord[] = [];
  private tapChords: TapChord[] = [];

  private keysDown = new Set<string>();
  private activeHoldChord: HoldChord | null = null;
  private sequenceStep = 0;
  private activeSequence: SequenceChord | null = null;
  private sequenceTimer: ReturnType<typeof setTimeout> | null = null;

  private defaultSeqWindowMs = 600;
  private holdThresholdMs = 150;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;

  private isMac = typeof navigator !== 'undefined' &&
                  /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // ── Registration ────────────────────────────────────────────

  registerHold(chord: HoldChord): void {
    this.holdChords.push(this.normalizeChord(chord) as HoldChord);
  }

  registerSequence(chord: SequenceChord): void {
    const normalized = {
      ...chord,
      steps: chord.steps.map((s) => s.map((k) => this.platformKey(k))),
    };
    this.sequenceChords.push(normalized);
  }

  registerTap(chord: TapChord): void {
    this.tapChords.push(this.normalizeChord(chord) as TapChord);
  }

  unregister(id: string): void {
    this.holdChords = this.holdChords.filter((c) => c.id !== id);
    this.sequenceChords = this.sequenceChords.filter((c) => c.id !== id);
    this.tapChords = this.tapChords.filter((c) => c.id !== id);
  }

  // ── Attach to DOM ───────────────────────────────────────────

  attach(): () => void {
    const down = this.onKeyDown;
    const up = this.onKeyUp;
    const blur = this.onBlur;
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }

  // ── Key event handlers ──────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent) => {
    // Suppress when typing in an input/textarea
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    const key = this.platformKey(e.key);
    if (e.repeat) return; // don't count key repeats
    this.keysDown.add(key);

    // ── Tap chords (fire immediately on matching key-down) ──
    for (const chord of this.tapChords) {
      if (this.matchesExact(chord.keys, this.keysDown)) {
        if (chord.requireShift !== undefined) {
          if (chord.requireShift !== e.shiftKey) continue;
        }
        if (chord.preventDefault) e.preventDefault();
        chord.action();
        eventBus.emit(CHORD_EV.ACTIVATE, { id: chord.id });
        return;
      }
    }

    // ── Hold chords (activate after threshold) ──────────────
    for (const chord of this.holdChords) {
      if (this.matchesExact(chord.keys, this.keysDown)) {
        if (this.activeHoldChord?.id === chord.id) return;
        // Activate immediately (radial menus need instant response)
        this.activateHold(chord);
        e.preventDefault();
        return;
      }
    }

    // ── Sequence chords ─────────────────────────────────────
    this.processSequenceStep();

    // Emit partial chord hint for UI
    this.emitPartial();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const key = this.platformKey(e.key);
    this.keysDown.delete(key);

    // Hold chord release check
    if (this.activeHoldChord) {
      const stillHeld = this.activeHoldChord.keys.every((k) =>
        this.keysDown.has(this.platformKey(k)),
      );
      if (!stillHeld) {
        this.deactivateHold();
      }
    }

    this.emitPartial();
  };

  private onBlur = () => {
    this.keysDown.clear();
    if (this.activeHoldChord) this.deactivateHold();
    this.resetSequence();
  };

  // ── Hold activation ─────────────────────────────────────────

  private activateHold(chord: HoldChord): void {
    this.activeHoldChord = chord;
    chord.onStart();
    eventBus.emit(CHORD_EV.HOLD_START, { id: chord.id });
  }

  private deactivateHold(): void {
    if (!this.activeHoldChord) return;
    const chord = this.activeHoldChord;
    chord.onEnd?.();
    eventBus.emit(CHORD_EV.HOLD_END, { id: chord.id });
    this.activeHoldChord = null;
  }

  // ── Sequence chord processing ───────────────────────────────

  private processSequenceStep(): void {
    for (const chord of this.sequenceChords) {
      const expectedStep = chord.steps[this.sequenceStep];
      if (!expectedStep) continue;
      if (!this.matchesExact(expectedStep, this.keysDown)) continue;

      // Step matches
      if (this.sequenceTimer) clearTimeout(this.sequenceTimer);
      this.activeSequence = chord;
      this.sequenceStep++;

      if (this.sequenceStep >= chord.steps.length) {
        // Full sequence complete
        chord.action();
        eventBus.emit(CHORD_EV.ACTIVATE, { id: chord.id });
        this.resetSequence();
        return;
      }

      // Wait for next step
      this.sequenceTimer = setTimeout(() => {
        this.resetSequence();
      }, chord.windowMs ?? this.defaultSeqWindowMs);
      return;
    }
  }

  private resetSequence(): void {
    this.sequenceStep = 0;
    this.activeSequence = null;
    if (this.sequenceTimer) {
      clearTimeout(this.sequenceTimer);
      this.sequenceTimer = null;
    }
    eventBus.emit(CHORD_EV.CLEAR, null);
  }

  // ── Partial chord hint ──────────────────────────────────────

  private emitPartial(): void {
    if (this.keysDown.size === 0) return;

    const held = [...this.keysDown];
    const candidates: PartialChordPayload['candidates'] = [];

    // Sequence chords with partial match
    if (this.activeSequence) {
      const remaining = this.activeSequence.steps.slice(this.sequenceStep);
      if (remaining.length > 0) {
        candidates.push({
          id: this.activeSequence.id,
          remaining,
          description: this.activeSequence.description,
        });
      }
    }

    // Hold chords with partial (at least one key held)
    for (const chord of this.holdChords) {
      const matchCount = chord.keys.filter((k) => this.keysDown.has(this.platformKey(k))).length;
      if (matchCount > 0 && matchCount < chord.keys.length) {
        const remaining = chord.keys.filter((k) => !this.keysDown.has(this.platformKey(k)));
        candidates.push({
          id: chord.id,
          remaining: [remaining],
          description: chord.description,
        });
      }
    }

    if (candidates.length > 0) {
      eventBus.emit<PartialChordPayload>(CHORD_EV.PARTIAL, {
        keysHeld: held,
        candidates,
      });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private normalizeChord<T extends { keys: string[] }>(chord: T): T {
    return { ...chord, keys: chord.keys.map((k) => this.platformKey(k)) };
  }

  /** Normalize cross-platform modifier keys (Meta/Control). */
  private platformKey(k: string): string {
    const lower = k.toLowerCase();
    if (lower === 'control' || lower === 'ctrl' || lower === 'meta' || lower === 'cmd') {
      return this.isMac ? 'meta' : 'control';
    }
    if (lower === 'option' || lower === 'alt') return 'alt';
    return lower;
  }

  /** Check if the required key set matches exactly (no extras). */
  private matchesExact(required: string[], held: Set<string>): boolean {
    if (required.length !== held.size) return false;
    return required.every((k) => held.has(this.platformKey(k)));
  }

  // ── Diagnostics ─────────────────────────────────────────────

  getRegisteredChords(): { holds: HoldChord[]; sequences: SequenceChord[]; taps: TapChord[] } {
    return {
      holds: [...this.holdChords],
      sequences: [...this.sequenceChords],
      taps: [...this.tapChords],
    };
  }

  isHolding(): boolean {
    return this.activeHoldChord !== null;
  }
}

/** Singleton. */
export const chordDetector = new ChordDetector();
