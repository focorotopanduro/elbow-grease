/**
 * UndoManager — walks the CommandBus log and reverses commands.
 *
 * Phase 1 built a deterministic command stream + each handler
 * optionally defines `snapshot(payload)` and `undo(payload, snapshot)`.
 * Phase 8.B makes that promise visible to the user: Ctrl+Z pops the
 * most recent undoable command and dispatches its `undo`; Ctrl+Shift+Z
 * re-applies.
 *
 * Design choices:
 *
 * 1. **Undo stack is derived, not separate.** The CommandBus ring
 *    buffer IS the source of truth. The manager keeps a pointer
 *    into it indicating how far back the user has undone. Commands
 *    AFTER the pointer are "undone"; a new user command truncates
 *    the redo region (classic undo semantics).
 *
 * 2. **Filter to "undoable" entries.** Not every command has an
 *    undo (e.g. `interaction.setMode`, `manifold.select`). When
 *    walking back, skip entries whose handler doesn't define `undo`.
 *    When walking forward (redo), same.
 *
 * 3. **Ignore commands issued by 'undo' / 'replay'.** Those are the
 *    manager's own dispatches. Including them would create loops.
 *
 * 4. **Snapshot of the pre-apply state lives on the DispatchOk.snapshot
 *    field.** The manager reaches into the stored entry and re-provides
 *    it when calling `undo()`. No duplicate snapshots.
 *
 * This is fundamentally a POINTER + FILTER, not a separate data
 * structure. Memory impact: ~40 bytes of additional state.
 */

import { commandBus } from './CommandBus';
import type { Command, CommandLogEntry } from './types';

// ── State ─────────────────────────────────────────────────────

/**
 * Offset from the END of the log. 0 = "live" (nothing undone).
 * 1 = "the most recent undoable command has been undone".
 * Reset to 0 on every new user-issued command (new edit truncates redo).
 */
let undoDepth = 0;

/** Listeners notified on every undo/redo so UI indicators can refresh. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch { /* swallow subscriber errors */ }
  }
}

// ── Log filter ────────────────────────────────────────────────

/**
 * Walk the log filtering to "undoable" entries — those that (a)
 * completed successfully, (b) have a handler that defines `undo`,
 * and (c) were not themselves an undo/redo/replay dispatch.
 *
 * "Undoable" is determined by handler identity, not by the presence
 * of a snapshot — some handlers undo purely from the payload (e.g.
 * `pipe.add` undoes by removing the pipe whose id is in the payload).
 */
function undoableEntries(): CommandLogEntry[] {
  return commandBus.getLog().filter((e) => {
    if (!e.result.ok) return false;
    if (e.command.issuedBy === 'undo' || e.command.issuedBy === 'redo' || e.command.issuedBy === 'replay') return false;
    return commandBus.hasUndo(e.command.type);
  });
}

// ── Public API ────────────────────────────────────────────────

export function canUndo(): boolean {
  const entries = undoableEntries();
  return undoDepth < entries.length;
}

export function canRedo(): boolean {
  return undoDepth > 0;
}

/**
 * Reverse the most-recent undoable command. No-op if nothing to undo.
 * Returns the reversed command's type on success, or null.
 */
export function undo(): string | null {
  const entries = undoableEntries();
  if (undoDepth >= entries.length) return null;
  // entries[entries.length - 1 - undoDepth] is the target
  const target = entries[entries.length - 1 - undoDepth];
  if (!target) return null;

  // Dispatch an undo-flagged copy. Handlers read the snapshot off the
  // payload's `__undoSnapshot` field (see CommandBus.ts dispatch).
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
  });

  undoDepth++;
  notify();
  return target.command.type;
}

/**
 * Re-apply a previously undone command. No-op if nothing to redo.
 * Returns the re-applied command's type on success, or null.
 */
export function redo(): string | null {
  if (undoDepth <= 0) return null;
  const entries = undoableEntries();
  // When we undid N commands, undoDepth = N. The next redo target is
  // the command at index (length - undoDepth).
  const target = entries[entries.length - undoDepth];
  if (!target) return null;

  commandBus.dispatch({
    type: target.command.type,
    payload: target.command.payload,
    issuedBy: 'redo',
    correlationId: `${target.command.correlationId}#redo`,
  });

  undoDepth--;
  notify();
  return target.command.type;
}

/** Called when a fresh user command lands — truncates the redo region. */
export function onUserCommand(): void {
  if (undoDepth > 0) {
    undoDepth = 0;
    notify();
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Reads the current depth — useful for the God Mode status line. */
export function getUndoDepth(): number {
  return undoDepth;
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
  undoDepth = 0;
  listeners.clear();
  hookInstalled = false;
  delete (globalThis as unknown as Record<symbol, boolean>)[HOOKED];
}
