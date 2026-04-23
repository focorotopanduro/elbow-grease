/**
 * clipboardStore — Phase 14.P
 *
 * Session-lived holder for the last multi-select copy. The payload
 * shape + semantics are defined in `selectionClipboard.ts`; this
 * store only adds Zustand reactivity so components can observe
 * "has clipboard data?" for enabling / disabling the Paste button.
 *
 * Design notes:
 *   • NOT persisted. A clipboard that survives an app restart is
 *     surprising (users expect "Paste" to be empty on fresh launch),
 *     plus the pasted positions would be relative to a possibly-
 *     deleted source selection anyway.
 *   • Single-slot. No history. Ctrl+C replaces. History could come
 *     later in a Phase 14.Q ("clipboard reel") if users ask; single-
 *     slot is the first-user expectation from every editor they've
 *     used.
 *   • Keyed by ISO string so the Paste button can show a "1m ago"
 *     hint if we ever want that.
 */

import { create } from 'zustand';
import type { ClipboardPayload } from '@core/selection/selectionClipboard';

interface ClipboardState {
  payload: ClipboardPayload | null;

  /** Replace the clipboard with a new payload. Pass `null` to clear. */
  setPayload: (payload: ClipboardPayload | null) => void;
  /** Alias for `setPayload(null)`. Kept for readability in call sites. */
  clear: () => void;
  /** True when there's something to paste. */
  hasData: () => boolean;
  /**
   * Count of items on the clipboard. Used by the HUD to show
   * "Paste (5)" style labels so the user knows the clipboard is
   * not empty before they commit.
   */
  itemCount: () => number;
}

export const useClipboardStore = create<ClipboardState>((set, get) => ({
  payload: null,

  setPayload: (payload) => set({ payload }),
  clear: () => set({ payload: null }),

  hasData: () => get().payload !== null,
  itemCount: () => {
    const p = get().payload;
    if (!p) return 0;
    return p.pipes.length + p.fixtures.length;
  },
}));
