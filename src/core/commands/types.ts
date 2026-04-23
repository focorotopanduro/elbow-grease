/**
 * Command pattern — contracts.
 *
 * A Command is a serializable description of an intent to mutate state.
 * A CommandHandler knows how to validate, apply, and reverse a command
 * of a particular type.
 *
 * The CommandBus is the ONLY code path allowed to mutate Zustand stores
 * once Phase 1 is complete (the `commandBus` feature flag on). Every
 * mutation therefore gets: a stable name, a timestamp, a correlationId
 * linking it to whatever user action produced it, a precondition check,
 * an FSM gate, and an entry in the 500-deep ring buffer the God Mode
 * console displays.
 *
 * Why this shape over Redux-style reducers:
 *   1. Handlers colocate precondition + mutation + undo snapshot —
 *      keeps invariants in ONE place per action.
 *   2. The bus is synchronous. No middleware pipeline, no thunks.
 *      Dispatch returns { ok, reason? } on the same tick.
 *   3. No global state tree. Handlers reach into whichever Zustand
 *      store they need — unchanged from today's architecture.
 *   4. Undo carries a snapshot taken pre-apply by the handler itself,
 *      not a reverse-mutation function. This is crash-safer: a broken
 *      undo() can't compound the bug, the snapshot just gets restored.
 */

// ── Provenance ─────────────────────────────────────────────────

export type CommandOrigin =
  /** Direct user action (click, keypress, drag). */
  | 'user'
  /** Fired as a consequence of an EventBus event (e.g. solver output). */
  | 'event'
  /** Replaying a previously-logged command (God Mode, tests). */
  | 'replay'
  /** Undo/redo stack walking backwards or forwards. */
  | 'undo'
  | 'redo';

// ── Domain / mode scope ─────────────────────────────────────────

import type { AppMode } from '@store/appModeStore';

/**
 * Phase 3 (ARCHITECTURE.md §4.3) — which workspace a command
 * belongs to for undo-stack partitioning.
 *
 *   • `plumbing` / `roofing` — workspace-scoped. `Ctrl+Z` in the
 *     OTHER workspace will not walk back over this entry.
 *   • `shared` — participates in BOTH workspaces' undo stacks.
 *     Examples: pricing edits, customer edits, file save/open,
 *     contractor-profile edits. Undoing from either workspace
 *     reverses the change for both.
 */
export type CommandMode = AppMode | 'shared';

// ── The command ────────────────────────────────────────────────

export interface Command<P = unknown> {
  /** Dot-prefixed action name, e.g. 'pipe.add', 'fixture.place'. */
  readonly type: string;
  /** Action payload — validated by the matching handler. */
  readonly payload: P;
  /** Who or what asked for this. */
  readonly issuedBy: CommandOrigin;
  /** `performance.now()` at dispatch. */
  readonly timestamp: number;
  /** Traces a user action through all its side effects. */
  readonly correlationId: string;
  /**
   * Phase 3 — workspace scope stamped at dispatch. Drives the
   * UndoManager's per-mode partitioning. Either the handler
   * declares it (`CommandHandler.mode`) or the bus falls back to
   * `useAppModeStore.getState().mode` at dispatch time. See
   * ARCHITECTURE.md §4.3.
   */
  readonly mode: CommandMode;
}

// ── Dispatch result ────────────────────────────────────────────

export interface DispatchOk<R = unknown> {
  readonly ok: true;
  readonly result?: R;
  /** Pre-apply store snapshot (used by undo). */
  readonly snapshot?: unknown;
  readonly command: Command;
}

export interface DispatchRejected {
  readonly ok: false;
  readonly reason: string;
  readonly command: Command;
}

export type DispatchResult<R = unknown> = DispatchOk<R> | DispatchRejected;

// ── Handler contract ───────────────────────────────────────────

export interface CommandHandler<P = unknown, R = unknown> {
  /** Must match the Command.type this handler claims. */
  readonly type: string;

  /**
   * Phase 3 (ARCHITECTURE.md §4.3) — workspace scope for the
   * commands this handler serves. When declared, the bus stamps
   * every matching Command with this `mode`; when omitted, the
   * bus falls back to the active `useAppModeStore.getState().mode`
   * at dispatch time. Declare `shared` for commands that
   * meaningfully apply to both workspaces (pricing, customer,
   * contractor profile, file IO). Declare `plumbing` / `roofing`
   * for domain-scoped commands to get compile-time clarity + a
   * safety net against accidental cross-domain dispatch.
   */
  readonly mode?: CommandMode;

  /**
   * Return `null` to proceed; return a human-readable error string to
   * reject the command without mutating anything.
   *
   * Preconditions should be cheap (reads only). Heavier validation
   * belongs inside `apply` with a return reason.
   */
  readonly preconditions?: (payload: P, ctx: HandlerContext) => string | null;

  /**
   * If this handler participates in undo/redo, return a snapshot of
   * whatever state `apply` is about to mutate. Returned value is
   * handed back into `undo`. Returning `undefined` opts out of undo.
   */
  readonly snapshot?: (payload: P, ctx: HandlerContext) => unknown;

  /**
   * Apply the mutation. This is the ONLY place store setters run
   * in commandBus-enabled code. Return `undefined` (success) or a
   * result value the caller may inspect. Throwing = fatal bug.
   */
  readonly apply: (payload: P, ctx: HandlerContext) => R | undefined;

  /**
   * Reverse the mutation using the snapshot returned by `snapshot`.
   * Only called during `issuedBy: 'undo'` dispatches. Optional.
   */
  readonly undo?: (payload: P, snapshot: unknown, ctx: HandlerContext) => void;
}

/**
 * Handler context — thin view onto the bus for cross-command concerns
 * (child correlation IDs, FSM access, emit-event for UI side effects).
 */
export interface HandlerContext {
  /**
   * Create a correlationId tied to the command currently applying —
   * for use when an apply() wants to dispatch a follow-up command.
   */
  childCorrelation: () => string;
  /** Current command being applied (read-only). */
  currentCommand: Readonly<Command>;
}

// ── Log record (what the ring buffer holds) ────────────────────

export interface CommandLogEntry {
  readonly command: Command;
  readonly result: DispatchResult;
  /** ms spent in apply() — perf diagnostic. */
  readonly applyMs: number;
}
