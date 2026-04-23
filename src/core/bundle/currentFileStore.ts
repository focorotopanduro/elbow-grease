/**
 * currentFileStore — tracks the path of the current project and a
 * bounded list of recent files.
 *
 * Two concepts:
 *
 *   1. Current path — set by the last successful save or load. When
 *      present, Ctrl+S writes to it directly (no dialog). Clearing to
 *      null restores the "first save needs a path" flow.
 *
 *   2. Recent files — Tauri-only. Browser paths are ephemeral
 *      (synthetic `browser-upload:` tokens can't be re-opened), so we
 *      skip the list entirely in the browser runtime.
 *
 * Persistence:
 *   Only in Tauri, and only paths. The bundle content itself stays on
 *   disk; storing it here would duplicate + desync. A recent entry is
 *   just `{ path, savedAt, name }` — the app re-reads the file on
 *   click.
 */

import { create } from 'zustand';
import { supportsRecentFiles } from './fsAdapter';

const STORAGE_KEY = 'elbow-grease-recent-files';
const MAX_RECENTS = 10;

export interface RecentFile {
  /** Absolute filesystem path. Always a real path — ephemeral browser
   * tokens never land here. */
  path: string;
  /** Wall-clock epoch ms at last save/open. */
  savedAt: number;
  /** Display name — defaults to the filename derived from `path`. */
  name: string;
  /**
   * Phase 11.E — customer name captured at the moment of save/open.
   * Used by RecentFilesPanel for grouping. Not guaranteed present: old
   * entries predating this field and bundles without a linked customer
   * both leave it undefined.
   */
  customerName?: string;
}

interface CurrentFileState {
  /** Absolute path of the active document, or null if never saved. */
  currentPath: string | null;
  /** Most-recent entries first, capped at MAX_RECENTS. */
  recents: RecentFile[];

  /** Called after a successful save or load that produced a real path. */
  setCurrent: (path: string, displayName?: string, customerName?: string) => void;
  /** Called on New / after a discarded session. */
  clearCurrent: () => void;
  /** Remove a recent (e.g. path no longer exists). */
  removeRecent: (path: string) => void;
  /** Wipe the recents list — exposed for a "Clear recents" UI. */
  clearRecents: () => void;
}

function loadRecents(): RecentFile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentFile[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecents(recents: RecentFile[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recents));
  } catch {
    /* quota — silent */
  }
}

function deriveName(path: string): string {
  // Handle both Windows (\) and Unix (/) separators.
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const base = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  // Strip extension for a prettier display name.
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export const useCurrentFileStore = create<CurrentFileState>((set, get) => ({
  currentPath: null,
  recents: loadRecents(),

  setCurrent: (path, displayName, customerName) => {
    set({ currentPath: path });

    // Only Tauri can re-open arbitrary paths; skip tracking in browser.
    if (!supportsRecentFiles()) return;

    const name = displayName ?? deriveName(path);
    const now = Date.now();
    const entry: RecentFile = customerName
      ? { path, savedAt: now, name, customerName }
      : { path, savedAt: now, name };
    const nextRecents: RecentFile[] = [
      entry,
      ...get().recents.filter((r) => r.path !== path),
    ].slice(0, MAX_RECENTS);

    set({ recents: nextRecents });
    saveRecents(nextRecents);
  },

  clearCurrent: () => set({ currentPath: null }),

  removeRecent: (path) => {
    const next = get().recents.filter((r) => r.path !== path);
    set({ recents: next });
    saveRecents(next);
  },

  clearRecents: () => {
    set({ recents: [] });
    saveRecents([]);
  },
}));

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  STORAGE_KEY,
  MAX_RECENTS,
  deriveName,
};
