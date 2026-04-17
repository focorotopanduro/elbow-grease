/**
 * AutoSave — localStorage auto-save with debounced writes.
 *
 * Saves the current design to localStorage:
 *   - Every 30 seconds (timer-based)
 *   - On every pipe commit (event-driven)
 *   - On browser beforeunload (last chance save)
 *
 * Maintains up to 3 auto-save slots for crash recovery:
 *   elbow-grease-autosave-0  (most recent)
 *   elbow-grease-autosave-1  (previous)
 *   elbow-grease-autosave-2  (oldest)
 *
 * On app startup, checks for auto-saved state and offers to restore.
 */

import { eventBus } from '../EventBus';
import { EV } from '../events';
import { serializeToJSON, deserializeProject, type SerializeInput, type DeserializeResult } from './ProjectSerializer';

// ── Storage keys ────────────────────────────────────────────────

const STORAGE_PREFIX = 'elbow-grease-autosave';
const MAX_SLOTS = 3;
const AUTOSAVE_INTERVAL_MS = 30_000; // 30 seconds

// ── AutoSave manager ────────────────────────────────────────────

export class AutoSaveManager {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private getState: (() => SerializeInput) | null = null;
  private dirty = false;
  private lastSaveTime = 0;
  private saveCount = 0;

  /**
   * Start auto-saving. Provide a function that returns the current
   * design state when called.
   */
  start(getState: () => SerializeInput): void {
    this.getState = getState;

    // Timer-based saves
    this.intervalId = setInterval(() => {
      if (this.dirty) this.save();
    }, AUTOSAVE_INTERVAL_MS);

    // Event-driven saves (on pipe commit)
    eventBus.on(EV.PIPE_COMPLETE, () => {
      this.dirty = true;
      // Debounce: don't save more than once per 5 seconds
      const now = Date.now();
      if (now - this.lastSaveTime > 5000) {
        this.save();
      }
    });

    // Last-chance save on tab close
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  /** Stop auto-saving. */
  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  /** Mark state as dirty (needs save). */
  markDirty(): void {
    this.dirty = true;
  }

  /** Perform an immediate save. */
  save(): boolean {
    if (!this.getState) return false;

    try {
      const state = this.getState();
      const json = serializeToJSON(state);

      // Rotate slots: 2 ← 1, 1 ← 0, 0 ← new
      for (let i = MAX_SLOTS - 1; i > 0; i--) {
        const prev = localStorage.getItem(`${STORAGE_PREFIX}-${i - 1}`);
        if (prev) {
          localStorage.setItem(`${STORAGE_PREFIX}-${i}`, prev);
        }
      }
      localStorage.setItem(`${STORAGE_PREFIX}-0`, json);
      localStorage.setItem(`${STORAGE_PREFIX}-timestamp`, new Date().toISOString());

      this.dirty = false;
      this.lastSaveTime = Date.now();
      this.saveCount++;
      return true;
    } catch (err) {
      console.warn('[AutoSave] Failed to save:', err);
      return false;
    }
  }

  /** Check if an auto-save exists. */
  hasAutoSave(): boolean {
    return localStorage.getItem(`${STORAGE_PREFIX}-0`) !== null;
  }

  /** Get the timestamp of the most recent auto-save. */
  getAutoSaveTimestamp(): string | null {
    return localStorage.getItem(`${STORAGE_PREFIX}-timestamp`);
  }

  /**
   * Load the most recent auto-save.
   * Returns null if no auto-save exists or it's invalid.
   */
  loadAutoSave(slot: number = 0): DeserializeResult | null {
    const json = localStorage.getItem(`${STORAGE_PREFIX}-${slot}`);
    if (!json) return null;

    try {
      return deserializeProject(json);
    } catch (err) {
      console.warn(`[AutoSave] Failed to load slot ${slot}:`, err);
      return null;
    }
  }

  /** Clear all auto-save slots. */
  clearAutoSaves(): void {
    for (let i = 0; i < MAX_SLOTS; i++) {
      localStorage.removeItem(`${STORAGE_PREFIX}-${i}`);
    }
    localStorage.removeItem(`${STORAGE_PREFIX}-timestamp`);
  }

  /** Get save statistics. */
  getStats() {
    return {
      dirty: this.dirty,
      saveCount: this.saveCount,
      lastSaveTime: this.lastSaveTime,
      hasAutoSave: this.hasAutoSave(),
      timestamp: this.getAutoSaveTimestamp(),
    };
  }

  // ── Internal ────────────────────────────────────────────────

  private onBeforeUnload = () => {
    if (this.dirty) this.save();
  };
}

export const autoSave = new AutoSaveManager();
