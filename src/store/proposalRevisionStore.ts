/**
 * proposalRevisionStore — Phase 14.G
 *
 * Persisted library of saved proposal revisions, keyed by base
 * proposal number ("P-YYMMDD-XXXX"). Each entry is a time-ordered
 * list of `SavedRevision` snapshots. R1 is the original proposal;
 * each subsequent revision is a change order.
 *
 * Integration:
 *   • printProposal.ts saves a revision automatically on every
 *     print (so history accumulates without the user opting in).
 *   • RevisionComparePanel reads from here for the revision list.
 *   • printChangeOrder.ts pulls two revisions and diffs them.
 *
 * Persistence: localStorage under `elbow-grease-proposal-revisions`.
 * Schema versioned so future changes can gracefully drop stale data.
 */

import { create } from 'zustand';
import type { ProposalData } from '@core/print/proposalData';
import {
  buildSnapshot,
  nextRevisionNumber,
  type SavedRevision,
} from '@core/print/proposalRevision';

const STORAGE_KEY = 'elbow-grease-proposal-revisions';
const STORAGE_VERSION = 1;

interface PersistShape {
  version: number;
  /** Keyed by base proposal number ("P-YYMMDD-XXXX"). Each value is
   *  ascending-index revision list. */
  byBase: Record<string, SavedRevision[]>;
}

interface RevisionState {
  byBase: Record<string, SavedRevision[]>;

  /** Save a new revision for this proposal. Auto-derives the next
   *  revision label from existing history. Returns the saved record. */
  saveRevision: (
    baseNumber: string,
    data: ProposalData,
    opts?: { note?: string },
  ) => SavedRevision;

  /** Remove one revision. Mostly useful for tests + user cleanup. */
  deleteRevision: (baseNumber: string, revisionNumber: string) => void;

  /** All revisions for a given base, in ascending index order. */
  getRevisions: (baseNumber: string) => SavedRevision[];

  /** Every base proposal number in the library, newest-first. */
  getBaseNumbers: () => string[];

  /** Lookup by composite id. */
  getById: (id: string) => SavedRevision | null;

  /** Nuke the whole library. Confirmation is the UI's responsibility. */
  clearAll: () => void;
}

// ── Persistence helpers ──────────────────────────────────────

function loadState(): Record<string, SavedRevision[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistShape;
    if (parsed.version !== STORAGE_VERSION) return {};
    return parsed.byBase ?? {};
  } catch {
    return {};
  }
}

function saveState(byBase: Record<string, SavedRevision[]>): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PersistShape = { version: STORAGE_VERSION, byBase };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded — silently drop. Individual revisions can be large
    // (BOM + contractor logo data URL). If this bites real users, v2:
    //   • externalize logo data URLs
    //   • cap history depth per base (e.g. last 10 revisions)
  }
}

// ── Store ─────────────────────────────────────────────────────

export const useProposalRevisionStore = create<RevisionState>((set, get) => ({
  byBase: loadState(),

  saveRevision: (baseNumber, data, opts = {}) => {
    const existing = get().byBase[baseNumber] ?? [];
    const { revisionNumber, revisionIndex } = nextRevisionNumber(existing);
    const snap = buildSnapshot(data, baseNumber, revisionNumber, revisionIndex, opts);

    set((s) => {
      const nextList = [...existing, snap].sort((a, b) => a.revisionIndex - b.revisionIndex);
      const nextByBase = { ...s.byBase, [baseNumber]: nextList };
      saveState(nextByBase);
      return { byBase: nextByBase };
    });
    return snap;
  },

  deleteRevision: (baseNumber, revisionNumber) => {
    set((s) => {
      const list = s.byBase[baseNumber];
      if (!list) return s;
      const filtered = list.filter((r) => r.revisionNumber !== revisionNumber);
      const nextByBase = { ...s.byBase };
      if (filtered.length === 0) delete nextByBase[baseNumber];
      else nextByBase[baseNumber] = filtered;
      saveState(nextByBase);
      return { byBase: nextByBase };
    });
  },

  getRevisions: (baseNumber) => {
    return get().byBase[baseNumber] ?? [];
  },

  getBaseNumbers: () => {
    const keys = Object.keys(get().byBase);
    // Newest-first by the latest revision's savedAt.
    return keys.sort((a, b) => {
      const aLast = latestSavedAt(get().byBase[a]!);
      const bLast = latestSavedAt(get().byBase[b]!);
      return bLast.localeCompare(aLast);
    });
  },

  getById: (id) => {
    for (const list of Object.values(get().byBase)) {
      const hit = list.find((r) => r.id === id);
      if (hit) return hit;
    }
    return null;
  },

  clearAll: () => {
    saveState({});
    set({ byBase: {} });
  },
}));

function latestSavedAt(list: SavedRevision[]): string {
  return list.reduce((acc, r) => (r.savedAtIso > acc ? r.savedAtIso : acc), '');
}

// ── Non-React accessors (for non-component callers) ──────────

export function getActiveRevisions(baseNumber: string): SavedRevision[] {
  return useProposalRevisionStore.getState().getRevisions(baseNumber);
}
