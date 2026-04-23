/**
 * UndoManager — walks the CommandBus log and reverses commands.
 *
 * Phase 1 built a deterministic command stream + each handler
 * optionally defines `snapshot(payload)` and `undo(payload, snapshot)`.
 * Phase 8.B makes that promise visible to the user: Ctrl+Z pops the
 * most recent undoable command and dispatches its `undo`; Ctrl+Shift+Z
 * re-applies.
 *
 * Phase 3 (ARCHITECTURE.md §4.3) — per-mode partitioning.
 *
 * Each command now carries a `mode: 'plumbing' | 'roofing' | 'shared'`
 * stamp (set at dispatch time by the CommandBus). Ctrl+Z walks back
 * only over entries that match the CURRENT workspace — plus any
 * `shared` entries, which participate in BOTH stacks. Undoing a
 * shared command from either side marks it undone for everyone.
 *
 * Design choices:
 *
 * 1. **Source of truth is the CommandBus ring buffer.** The manager
 *    keeps a side-table of `undone` correlation IDs — not a separate
 *    stack of commands. "Undone" means "currently reversed and
 *    eligible for redo"; a fresh user command clears the set
 *    (classic redo truncation).
 *
 * 2. **Filter by current mode on every read.** `undoableEntries(mode)`
 *    is cheap (a single log filter). Classic single-mode depth math
 *    breaks down for shared commands — a shared entry's "position"
 *    inside the eligible list differs between workspaces. Tracking
 *    undone-ness per correlation-id gets the right answer under both
 *    per-mode and shared-undo paths.
 *
 * 3. **`issuedBy: 'undo' | 'redo' | 'replay'` filtered out.** Those
 *    are the manager's own dispatches. Including them would loop.
 *
 * 4. **Snapshot of the pre-apply state lives on the DispatchOk.snapshot
 *    field.** The manager threads it back into the undo dispatch. No
 *    duplicate snapshots.
 *
 * Memory impact: the undone set caps at the undoable-entry count
 * (currently ≤ log capacity of 500). Set<string> of correlationIds is
 * << 10KB.
 */

import { commandBus } from './CommandBus';
import { useAppModeStore } from '@store/appModeStore';
import type { AppMode } from '@store/appModeStore';
import type { CommandLogEntry } from './types';

// ── State ─────────────────────────────────────────────────────

/**
 * Correlation IDs of commands currently in the "undone" state —
 * reversed via `undo()`, pending re-apply via `redo()`. A fresh
 * user command clears this set (classic redo truncation).
 *
 * Phase 3 replaces the old global `undoDepth` counter. Per-mode
 * undo needs per-entry tracking because a shared command undone
 * from the roofing side must not appear as "top of stack" when
 * the user switches to plumbing.
 */
const undoneCorrelationIds = new Set<string>();

/**
 * Tracks the ORDER in which undos landed, so redo can re-apply
 * them in reverse-undo order (classic LIFO). Contains the SAME
 * correlation IDs that appear in `undoneCorrelationIds`; drained
 * by redo.
 */
const undoHistory: string[] = [];

/** Listeners notified on every undo/redo so UI indicators can refresh. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch { /* swallow subscriber errors */ }
  }
}

// ── Log filter ────────────────────────────────────────────────

/**
 * Walk the log filtering to "undoable-in-this-mode" entries —
 * those that:
 *   (a) completed successfully
 *   (b) were issued by a user (not our own undo/redo/replay)
 *   (c) have a handler that defines `undo`
 *   (d) carry `mode === currentMode` or `mode === 'shared'`
 *
 * Returned in log order, oldest → newest.
 */
function undoableEntries(currentMode: AppMode): CommandLogEntry[] {
  return commandBus.getLog().filter((e) => {
    if (!e.result.ok) return false;
    const origin = e.command.issuedBy;
    if (origin === 'undo' || origin === 'redo' || origin === 'replay') return false;
    if (!commandBus.hasUndo(e.command.type)) return false;
    const m = e.command.mode;
    return m === currentMode || m === 'shared';
  });
}

function currentMode(): AppMode {
  return useAppModeStore.getState().mode;
}

// ── Public API ────────────────────────────────────────────────

/** True iff there's a command in the CURRENT workspace (+ shared)
 *  that can be undone. */
export function canUndo(): boolean {
  const entries = undoableEntries(currentMode());
  for (const e of entries) {
    if (!undoneCorrelationIds.has(e.command.correlationId)) return true;
  }
  return false;
}

/** True iff there's a command in the CURRENT workspace (+ shared)
 *  that has been undone and is redoable. */
export function canRedo(): boolean {
  const entries = undoableEntries(currentMode());
  for (const e of entries) {
    if (undoneCorrelationIds.has(e.command.correlationId)) return true;
  }
  return false;
}

/**
 * Reverse the most-recent undoable command in the current workspace
 * (or any shared command regardless of workspace). No-op if nothing
 * eligible. Returns the reversed command's type on success, or null.
 */
export function undo(): string | null {
  const entries = undoableEntries(currentMode());
  // Walk newest → oldest looking for the first eligible, not-yet-
  // undone entry. That preserves the intuitive "last action first"
  // ordering inside each workspace — shared commands interleave
  // naturally because they live in the same log.
  for (let i = entries.length - 1; i >= 0; i--) {
    const target = entries[i];
    if (!target) continue;
    if (undoneCorrelationIds.has(target.command.correlationId)) continue;

    // Dispatch an undo-flagged copy. The handler reads the snapshot
    // off the payload's `__undoSnapshot` field (see CommandBus.ts
    // dispatch()). Preserve the original mode stamp so the undo
    // entry itself carries the right workspace attribution in the
    // log (though it's filtered out of undoableEntries()).
    const snapshot = (target.result as { snapshot: unknown }).snapshot;
    const payload = {
      ...(target.command.payload as object),
      __undoSnapshot: snapshot,
    };
    commandBus.dispatch({
      type: target.command.type,
      payload,
      issuedBy: 'undo',
      correlationId: `${target.command.correlationId}#undo`,
      mode: target.command.mode,
    });

    undoneCorrelationIds.add(target.command.correlationId);
    undoHistory.push(target.command.correlationId);
    notify();
    return target.command.type;
  }
  return null;
}

/**
 * Re-apply a previously undone command in the current workspace.
 * No-op if nothing eligible. Returns the re-applied command's type
 * on success, or null.
 *
 * Redo order is REVERSE of undo order — the last thing you undid
 * is the first thing redo re-applies, even if it's a shared command
 * and the user has since switched workspaces.
 */
export function redo(): string | null {
  const mode = currentMode();
  const entries = undoableEntries(mode);
  const eligibleIds = new Set(entries.map((e) => e.command.correlationId));

  // Pop from the top of undoHistory, skipping entries that aren't
  // in the current workspace's eligible set (they'll stay there for
  // when the user switches back).
  for (let i = undoHistory.length - 1; i >= 0; i--) {
    const cid = undoHistory[i]!;
    if (!eligibleIds.has(cid)) continue;
    // Found — find the matching log entry and re-apply.
    const target = entries.find((e) => e.command.correlationId === cid);
    if (!target) {
      // Shouldn't happen (eligibleIds is from entries), but guard.
      continue;
    }
    commandBus.dispatch({
      type: target.command.type,
      payload: target.command.payload,
      issuedBy: 'redo',
      correlationId: `${target.command.correlationId}#redo`,
      mode: target.command.mode,
    });
    undoneCorrelationIds.delete(cid);
    undoHistory.splice(i, 1);
    notify();
    return target.command.type;
  }
  return null;
}

/**
 * Called when a fresh user command lands — truncates the redo
 * region globally. Matches classic undo semantics: once you edit
 * after an undo, the undone branch is gone forever.
 *
 * We do NOT partition truncation by mode: a new plumbing command
 * that slots chronologically between an undone shared command and
 * its would-be redo makes the redo state ambiguous. Safer to
 * clear the whole undone set.
 */
export function onUserCommand(): void {
  if (undoneCorrelationIds.size > 0 || undoHistory.length > 0) {
    undoneCorrelationIds.clear();
    undoHistory.length = 0;
    notify();
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Reads the current undone-set size — useful for the God Mode
 * status line. Preserved for backward-compat with the pre-Phase-3
 * single-depth model; now it's `undoneCorrelationIds.size`.
 */
export function getUndoDepth(): number {
  return undoneCorrelationIds.size;
}

// ── Integration with the bus ──────────────────────────────────

/**
 * Hook the manager into the CommandBus: every USER-issued command
 * truncates the redo region. Called once from `bootCommandBus`.
 *
 * Idempotent — safe to call multiple times (subscription is a Set).
 */
let hookInstalled = false;
const HOOKED = Symbol.for('elbow-undo-hook');

export function installUndoHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  commandBus.subscribe((entry) => {
    // Note: an undo()/redo() dispatch will also fire this subscription,
    // but those carry issuedBy !== 'user' so we short-circuit.
    if (!entry.result.ok) return;
    if (entry.command.issuedBy !== 'user') return;
    onUserCommand();
  });
  // Mark global so test resetters can assert it once and find it.
  (globalThis as unknown as Record<symbol, boolean>)[HOOKED] = true;
}

// ── Test helpers ──────────────────────────────────────────────

export function __resetUndoManagerForTests(): void {
  undoneCorrelationIds.clear();
  undoHistory.length = 0;
  listeners.clear();
  hookInstalled = false;
  delete (globalThis as unknown as Record<symbol, boolean>)[HOOKED];
}
