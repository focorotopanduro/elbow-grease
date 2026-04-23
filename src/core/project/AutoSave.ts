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
import { EV, type PipeCompletePayload } from '../events';
import { serializeToJSON, deserializeProject, type SerializeInput, type DeserializeResult } from './ProjectSerializer';
import { ProjectBundle } from './ProjectBundle';
import { createFsAdapter } from './fs';
import type { ProjectEvent } from './ProjectEvents';
import { getFlag } from '@store/featureFlagStore';
import { logger } from '@core/logger/Logger';

const log = logger('AutoSave');

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
   * Phase 4: when the `projectBundle` feature flag is on, AutoSave
   * additionally writes to a crash-safe bundle via the FsAdapter.
   * This path runs IN PARALLEL with the legacy localStorage path
   * during rollout — both keep state so a bundle bug never loses
   * progress. Once Phase 4 graduates to default-on, the localStorage
   * path stays as a dev-only fallback.
   */
  private bundle: ProjectBundle<SerializeInput> | null = null;
  private bundleInitAttempted = false;

  private async getOrInitBundle(): Promise<ProjectBundle<SerializeInput> | null> {
    if (this.bundle) return this.bundle;
    if (this.bundleInitAttempted) return null; // already failed once
    this.bundleInitAttempted = true;
    try {
      const fs = await createFsAdapter();
      const bundle = new ProjectBundle<SerializeInput>(
        fs,
        'autosave/current.elbow',
        {
          projectName: 'Autosave',
          appVersion: '0.1.0',
          serializeSnapshot: () => this.getState?.() ?? {
            pipes: [], fixtures: [], structures: [],
            layers: { systems: {} as any, fittings: true, fixtures: true, dimensions: true },
            camera: { position: [0, 0, 0], target: [0, 0, 0], fov: 45 },
          },
        },
      );
      await bundle.ensureOpen();
      this.bundle = bundle;
      return bundle;
    } catch (err) {
      // eslint-disable-next-line no-console
      log.warn('bundle init failed, staying on localStorage', err);
      return null;
    }
  }

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
    eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
      this.dirty = true;
      // Debounce localStorage rewrite to 5s, but append to the
      // bundle log IMMEDIATELY — one small append is cheap and that's
      // the whole point of the bundle's crash resilience.
      void this.appendBundleEvent({
        k: 'pipe.add',
        t: performance.now(),
        id: payload.id,
        points: payload.points,
        diameter: payload.diameter,
        material: payload.material,
      });
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

      // Phase 4: if the bundle path is on, compact() captures a full
      // snapshot + truncates the log. We do this on explicit `save()`
      // which users implicitly trigger every ~30s or on pipe-commit
      // pulses. If the bundle isn't ready yet the call is a no-op.
      void this.compactBundle();

      this.dirty = false;
      this.lastSaveTime = Date.now();
      this.saveCount++;
      return true;
    } catch (err) {
      log.warn('save failed', err);
      return false;
    }
  }

  /**
   * Append a logical project event to the bundle if the flag is on.
   * Silent no-op if the flag is off or the bundle failed to init.
   */
  private async appendBundleEvent(evt: ProjectEvent): Promise<void> {
    if (!getFlag('projectBundle')) return;
    const bundle = await this.getOrInitBundle();
    if (!bundle) return;
    try {
      await bundle.appendEvent(evt);
    } catch (err) {
      // Log once, never throw — bundle failures must not break the UI.
      // eslint-disable-next-line no-console
      log.warn('bundle.appendEvent failed', err);
    }
  }

  /**
   * Compact the bundle (write snapshot + truncate log) if the flag
   * is on. Called from `save()`.
   */
  private async compactBundle(): Promise<void> {
    if (!getFlag('projectBundle')) return;
    const bundle = await this.getOrInitBundle();
    if (!bundle) return;
    try {
      await bundle.compact();
    } catch (err) {
      // eslint-disable-next-line no-console
      log.warn('bundle.compact failed', err);
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
      log.warn(`failed to load slot ${slot}`, err);
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
