/**
 * Autosave — crash-recovery persistence for the active document.
 *
 * Every N seconds (default 10) we capture the current stores into a
 * bundle and write it to localStorage under the AUTOSAVE_KEY. On the
 * next boot, if an autosave is present AND in-memory state is empty
 * (fresh launch, no pipes yet), we hydrate from it.
 *
 * This is NOT a substitute for Ctrl+S. An autosave represents "the
 * state you had when the tab died"; the user's explicit save to file
 * remains the authoritative backup path. Autosave is cleared when:
 *   • The user clicks Save (fresh Ctrl+S)
 *   • The user clicks Load (the loaded file becomes the new baseline)
 *   • The user calls `clearAutosave()` explicitly
 *
 * Dirty tracking:
 *   Subscribed to the commandBus — any successful non-undo/redo
 *   command marks the document dirty. If the flag is clean when the
 *   timer fires, we skip the write (prevents needless localStorage
 *   churn during idle sessions).
 */

import { commandBus } from '@core/commands/CommandBus';
import {
  captureBundleSerialized,
  applyBundle,
  parseBundle,
  type Bundle,
} from './Bundle';
import { logger } from '@core/logger/Logger';

const log = logger('Autosave');

const AUTOSAVE_KEY = 'elbow-grease-autosave';
const AUTOSAVE_INTERVAL_MS = 10_000;
/** Don't resume an autosave older than this — it's probably yesterday's. */
const MAX_AUTOSAVE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Phase 14.AD.1 — deadline for the idle-deferred capture. If the
 * browser never reports idle within this window we fire the capture
 * anyway so a dirty session doesn't defer persistence indefinitely
 * on a pegged-CPU machine.
 */
const IDLE_DEADLINE_MS = 1_000;

// ── Module state ───────────────────────────────────────────────

let dirty = false;
let lastSavedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let unsubCommand: (() => void) | null = null;
let beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
/**
 * Phase 14.AD.1 — track any in-flight idle callback so a fresh
 * tick doesn't pile up overlapping captures. Cleared when the
 * deferred work actually runs or autosave shuts down.
 */
let idleHandle: number | null = null;

// ── Public API ──────────────────────────────────────────────────

/** Start the autosave loop. Idempotent — second call is a no-op. */
export function bootAutosave(): () => void {
  if (timer) return () => { /* already running */ };

  // Dirty flag — any successful non-undo/redo command flips it.
  unsubCommand = commandBus.subscribe((entry) => {
    if (!entry.result.ok) return;
    const origin = entry.command.issuedBy;
    if (origin === 'undo' || origin === 'redo') return;
    dirty = true;
  });

  timer = setInterval(() => {
    if (!dirty) return;
    // Phase 14.AD.1 — defer the capture+write to a browser-idle
    // window so the 15–65ms of structural serialization doesn't
    // land mid-drag. `IDLE_DEADLINE_MS` guarantees we don't
    // indefinitely defer on a busy main thread.
    scheduleIdleCapture();
  }, AUTOSAVE_INTERVAL_MS);

  // Pre-unload safety net: flush one more write if dirty. MUST be
  // synchronous — the browser is about to kill the tab and won't
  // wait for an idle callback. We accept the frame-blocking cost
  // here because the tab is going away anyway.
  beforeUnloadHandler = () => {
    if (!dirty) return;
    try {
      // Cancel any pending idle work — we're flushing right now,
      // don't let a deferred callback fire after unmount.
      if (idleHandle !== null) cancelIdle(idleHandle);
      idleHandle = null;
      // Phase 14.R.26 — skip the PDF underlay dataUrl. localStorage
      // caps out at ~5–10 MB; a scanned blueprint can easily exceed
      // that on its own. The sections + calibration + filename still
      // persist so the next boot prompts the user to re-attach.
      const json = captureBundleSerialized({ omitPdfImageData: true });
      writeStringToStorage(json);
      lastSavedAt = Date.now();
      dirty = false;
    } catch {
      /* last-chance; can't surface errors here */
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }

  log.debug('autosave booted');
  return stopAutosave;
}

/** Stop the autosave loop + unsubscribe. */
export function stopAutosave(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (unsubCommand) { unsubCommand(); unsubCommand = null; }
  if (idleHandle !== null) { cancelIdle(idleHandle); idleHandle = null; }
  if (typeof window !== 'undefined' && beforeUnloadHandler) {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

/** True if any mutating command has landed since the last save. */
export function isDirty(): boolean {
  return dirty;
}

/** Mark clean (called after explicit Save to file). */
export function markClean(): void {
  dirty = false;
  lastSavedAt = Date.now();
}

/** Read the latest autosaved bundle from localStorage, or null. */
export function readAutosave(): Bundle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const bundle = parseBundle(raw);
    // Stale? Treat as no autosave.
    if (Date.now() - bundle.meta.savedAt > MAX_AUTOSAVE_AGE_MS) return null;
    return bundle;
  } catch (err) {
    log.warn('autosave read failed', err);
    return null;
  }
}

/** Hydrate stores from the autosave if one exists. Returns true if applied. */
export function recoverFromAutosave(): boolean {
  const bundle = readAutosave();
  if (!bundle) return false;
  try {
    applyBundle(bundle);
    dirty = false;
    log.info('recovered from autosave', { savedAt: bundle.meta.savedAt });
    return true;
  } catch (err) {
    log.warn('autosave recovery failed — dropping it', err);
    clearAutosave();
    return false;
  }
}

/** Wipe the autosave slot. Called after explicit Save or Load. */
export function clearAutosave(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
}

/** Wall-clock epoch ms of the last successful autosave write (0 if none). */
export function getLastAutosaveAt(): number {
  return lastSavedAt;
}

// ── Internal ───────────────────────────────────────────────────

/**
 * Write a pre-serialized bundle string to localStorage. Phase
 * 14.AD.1 replaced the previous `writeToStorage(bundle: Bundle)`
 * helper that re-serialized inside the timer tick — autosave and
 * beforeunload both now call `captureBundleSerialized` to produce
 * the JSON once and pass it straight through here.
 */
function writeStringToStorage(json: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, json);
  } catch (err) {
    log.warn('autosave write rejected (quota?)', err);
  }
}

/**
 * Phase 14.AD.1 — schedule the capture+write on a browser-idle
 * window. If the browser doesn't expose `requestIdleCallback`
 * (Safari still hasn't shipped it at time of writing), fall back
 * to a `setTimeout(0)` so the work at least lands on the next
 * macrotask rather than the current one. `IDLE_DEADLINE_MS` caps
 * how long we're willing to defer before firing anyway.
 */
function scheduleIdleCapture(): void {
  if (idleHandle !== null) return; // already scheduled

  const run = () => {
    idleHandle = null;
    if (!dirty) return; // beat us to it (e.g. Ctrl+S), nothing to do
    try {
      // Phase 14.R.26 — same rationale as the beforeunload path:
      // autosave lives in localStorage, so the PDF underlay blob
      // is dropped to keep quota usage bounded. Explicit Save to
      // file still captures the full bundle including the PDF.
      const json = captureBundleSerialized({ omitPdfImageData: true });
      writeStringToStorage(json);
      lastSavedAt = Date.now();
      dirty = false;
    } catch (err) {
      log.warn('autosave failed', err);
    }
  };

  idleHandle = requestIdle(run);
}

/**
 * Cross-environment wrapper for `requestIdleCallback` with a
 * `setTimeout` fallback. Returns a handle usable with `cancelIdle`.
 */
function requestIdle(cb: () => void): number {
  if (typeof window !== 'undefined'
    && typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === 'function') {
    const ric = (window as unknown as {
      requestIdleCallback: (cb: () => void, opts?: { timeout?: number }) => number;
    }).requestIdleCallback;
    return ric(cb, { timeout: IDLE_DEADLINE_MS });
  }
  // Fallback: next macrotask. Not quite "idle" but at least unblocks
  // the current call stack so the autosave tick doesn't burn frames.
  return setTimeout(cb, 0) as unknown as number;
}

function cancelIdle(handle: number): void {
  if (typeof window !== 'undefined'
    && typeof (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback === 'function') {
    const cic = (window as unknown as {
      cancelIdleCallback: (h: number) => void;
    }).cancelIdleCallback;
    cic(handle);
    return;
  }
  clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

export const __testables = {
  AUTOSAVE_KEY,
  AUTOSAVE_INTERVAL_MS,
  MAX_AUTOSAVE_AGE_MS,
  markDirtyForTest: () => { dirty = true; },
  // Phase 14.AD.1 — expose the scheduler so tests can exercise the
  // deferral path without waiting on real rIC.
  scheduleIdleCaptureForTest: scheduleIdleCapture,
  hasPendingIdleForTest: () => idleHandle !== null,
};
