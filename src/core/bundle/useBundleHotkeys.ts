/**
 * useBundleHotkeys — global save / save-as / open keybindings.
 *
 *   Ctrl+S       — Save to the current path if one is known; otherwise
 *                   prompts for a save location (Save As flow).
 *   Ctrl+Shift+S — Always prompts for a save location, regardless of
 *                   the current path. "Save a copy" semantics.
 *   Ctrl+O       — Open a file via native dialog (Tauri) or <input
 *                   type=file> (browser).
 *
 * Ignores keystrokes while focus is inside an input / textarea /
 * contenteditable — users typing in search boxes should not
 * accidentally write files.
 *
 * Environment adaptation happens inside `fsAdapter` — this hook
 * doesn't branch on Tauri vs browser. Toasts surface outcomes via
 * EV.CUE and the existing FeedbackOverlay.
 */

import { useEffect } from 'react';
import { eventBus } from '@core/EventBus';
import { EV, type CuePayload } from '@core/events';
import {
  captureBundle,
  applyBundle,
  serializeBundle,
  parseBundle,
  BUNDLE_EXTENSION,
  BUNDLE_MIME,
} from './Bundle';
import {
  requestSavePath,
  requestOpenPath,
  writeToPath,
  isRealPath,
} from './fsAdapter';
import { useCurrentFileStore } from './currentFileStore';
import { clearAutosave, markClean } from './autosave';
import { logger } from '@core/logger/Logger';

const log = logger('BundleHotkeys');

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const t = target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function cue(message: string): void {
  // FeedbackOverlay reads `message` and ignores `type` for CuePayload toasts.
  eventBus.emit<CuePayload>(EV.CUE, { type: 'highlight', message });
}

function suggestDefaultName(): string {
  const active = useCurrentFileStore.getState().currentPath;
  if (active) {
    const lastSlash = Math.max(active.lastIndexOf('/'), active.lastIndexOf('\\'));
    return lastSlash >= 0 ? active.slice(lastSlash + 1) : active;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  return `project-${stamp}${BUNDLE_EXTENSION}`;
}

// ── Save flows ─────────────────────────────────────────────────

/**
 * Save to the current file path without prompting. If there is no
 * current path yet, falls through to Save As.
 */
export async function saveBundle(): Promise<void> {
  const currentPath = useCurrentFileStore.getState().currentPath;
  if (currentPath && isRealPath(currentPath)) {
    await writeCurrentBundleTo(currentPath, { silentSuccess: false });
    return;
  }
  await saveBundleAs();
}

/**
 * Always prompts for a save location. Used for Ctrl+Shift+S and for
 * the first save of a new project.
 */
export async function saveBundleAs(): Promise<void> {
  try {
    const path = await requestSavePath({
      defaultName: suggestDefaultName(),
      extension: BUNDLE_EXTENSION.replace(/^\./, ''),
    });
    if (!path) {
      // User cancelled — stay silent, no toast.
      return;
    }
    await writeCurrentBundleTo(path, { silentSuccess: false });
  } catch (err) {
    log.error('save-as failed', err);
    cue(`Save failed — ${errorMessage(err)}`);
  }
}

async function writeCurrentBundleTo(
  path: string,
  opts: { silentSuccess: boolean },
): Promise<void> {
  try {
    const bundle = captureBundle();
    const content = serializeBundle(bundle);
    await writeToPath(path, content, {
      browserFilename: suggestDefaultName(),
      browserMime: BUNDLE_MIME,
    });

    // Only track real on-disk paths. Browser tokens are ephemeral.
    if (isRealPath(path)) {
      useCurrentFileStore.getState().setCurrent(
        path,
        /* displayName */ undefined,
        bundle.project?.customerSnapshot?.name,
      );
    }

    markClean();
    clearAutosave();

    if (!opts.silentSuccess) {
      const counts = `${bundle.data.pipes.length} pipes, ${bundle.data.fixtures.length} fixtures`;
      const forCustomer = bundle.project?.customerSnapshot?.name
        ? ` for ${bundle.project.customerSnapshot.name}`
        : '';
      cue(`Saved${forCustomer} · ${counts}`);
    }

    log.info('saved bundle', {
      path,
      pipes: bundle.data.pipes.length,
      fixtures: bundle.data.fixtures.length,
      customerId: bundle.project?.customerId,
    });
  } catch (err) {
    log.error('save failed', err);
    cue(`Save failed — ${errorMessage(err)}`);
  }
}

// ── Open flow ──────────────────────────────────────────────────

export async function openBundleFromFile(): Promise<void> {
  try {
    const picked = await requestOpenPath({
      extensions: [BUNDLE_EXTENSION.replace(/^\./, ''), 'json'],
      filterLabel: 'ELBOW GREASE Project',
    });
    if (!picked) return; // cancelled

    const bundle = parseBundle(picked.content);
    const result = applyBundle(bundle);

    if (isRealPath(picked.path)) {
      useCurrentFileStore.getState().setCurrent(
        picked.path,
        /* displayName */ undefined,
        result.project?.customerName,
      );
    } else {
      // Browser upload — we have content but no persistent path. Forget
      // the previous current path rather than leaving it stale.
      useCurrentFileStore.getState().clearCurrent();
    }

    markClean();
    clearAutosave();

    const counts = `${result.counts.pipes} pipes, ${result.counts.fixtures} fixtures`;
    let customerSuffix = '';
    if (result.project?.customerName) {
      customerSuffix = result.project.customerResolved
        ? ` for ${result.project.customerName}`
        : ` (original customer ${result.project.customerName} not found locally)`;
    }
    cue(
      `Loaded${customerSuffix} · ${counts}` +
      (result.migrated ? ' (migrated)' : ''),
    );
  } catch (err) {
    log.error('open failed', err);
    cue(`Open failed — ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 80);
}

// ── Hook ───────────────────────────────────────────────────────

export function useBundleHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.altKey) return;
      if (isEditable(e.target)) return;

      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) void saveBundleAs();
        else void saveBundle();
      } else if (k === 'o' && !e.shiftKey) {
        e.preventDefault();
        void openBundleFromFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
