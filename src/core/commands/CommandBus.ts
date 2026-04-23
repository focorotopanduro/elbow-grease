/**
 * CommandBus — synchronous command dispatcher with a 500-entry ring
 * buffer log for the God Mode console.
 *
 * Design goals:
 *   • SYNC dispatch. Return value reflects the completed state.
 *   • Zero allocations on the hot path beyond the log entry itself.
 *   • Handlers register once at boot. No mid-flight registration.
 *   • Unknown command types reject with an informative error — no silent drops.
 *   • FSM gate is OPTIONAL per handler; the bus doesn't know about FSM directly.
 *     Handlers that care read `userFSM` inside their preconditions.
 *   • Subscribers (the God Mode console) get a push notification on each log
 *     entry; subscription is a plain callback, no RxJS.
 *
 * Determinism contract: given the same initial store state + same command
 * sequence + same dispatcher version, the final store state is byte-for-byte
 * identical. This is what the Phase 1 Vitest asserts.
 */

import { newCorrelationId } from './correlationId';
import { logger } from '@core/logger/Logger';
import { useAppModeStore } from '@store/appModeStore';
import type {
  Command,
  CommandHandler,
  CommandLogEntry,
  CommandMode,
  DispatchResult,
  HandlerContext,
} from './types';

const log = logger('CommandBus');

// ── Ring buffer ─────────────────────────────────────────────────

const LOG_CAPACITY = 500;

class RingBuffer<T> {
  private buf: Array<T | undefined> = new Array(LOG_CAPACITY);
  private head = 0;
  private count = 0;

  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % LOG_CAPACITY;
    if (this.count < LOG_CAPACITY) this.count++;
  }

  /** Oldest → newest. */
  toArray(): T[] {
    const out: T[] = [];
    const start = this.count < LOG_CAPACITY ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % LOG_CAPACITY;
      const v = this.buf[idx];
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  clear(): void {
    this.buf.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  size(): number { return this.count; }
}

// ── Bus ─────────────────────────────────────────────────────────

class CommandBus {
  private handlers = new Map<string, CommandHandler>();
  private log = new RingBuffer<CommandLogEntry>();
  private subscribers = new Set<(entry: CommandLogEntry) => void>();
  /** Depth counter to guard against accidental infinite re-dispatch loops. */
  private depth = 0;
  private readonly MAX_DEPTH = 32;

  register<P, R>(handler: CommandHandler<P, R>): void {
    if (this.handlers.has(handler.type)) {
      // Register-after-boot overwrites are allowed but logged; this is
      // how tests swap in mock handlers. Debug-level so production
      // builds don't chatter over this.
      log.debug(`Overwriting handler for "${handler.type}"`);
    }
    this.handlers.set(handler.type, handler as CommandHandler);
  }

  /** Dispatch a command. Synchronous. Returns result of apply. */
  dispatch<P = unknown, R = unknown>(
    input:
      | Command<P>
      | (Omit<Command<P>, 'timestamp' | 'correlationId' | 'issuedBy' | 'mode'> & {
          issuedBy?: Command['issuedBy'];
          correlationId?: string;
          mode?: CommandMode;
        }),
  ): DispatchResult<R> {
    if (this.depth >= this.MAX_DEPTH) {
      const cmd = this.materialize(input, this.handlers.get(input.type));
      const rejected: DispatchResult<R> = {
        ok: false,
        reason: `CommandBus recursion limit (${this.MAX_DEPTH}) — probable infinite dispatch loop`,
        command: cmd,
      };
      this.recordAndNotify({ command: cmd, result: rejected, applyMs: 0 });
      return rejected;
    }

    const handler = this.handlers.get(input.type);
    const cmd = this.materialize(input, handler);

    if (!handler) {
      const rejected: DispatchResult<R> = {
        ok: false,
        reason: `No handler registered for command "${cmd.type}"`,
        command: cmd,
      };
      this.recordAndNotify({ command: cmd, result: rejected, applyMs: 0 });
      return rejected;
    }

    const ctx: HandlerContext = {
      childCorrelation: () => `${cmd.correlationId}>${newCorrelationId()}`,
      currentCommand: cmd,
    };

    // Precondition — skipped when this dispatch is an undo.
    // Rationale: a handler's preconditions typically assert the state
    // that `apply()` will be mutating FROM (e.g. "pipe must exist"
    // before removing it). An undo reverses that apply, so the
    // precondition will naturally fail every time. We trust the
    // handler's `undo()` to be robust on its own.
    if (handler.preconditions && cmd.issuedBy !== 'undo') {
      const reason = handler.preconditions(cmd.payload, ctx);
      if (reason !== null) {
        const rejected: DispatchResult<R> = {
          ok: false,
          reason,
          command: cmd,
        };
        this.recordAndNotify({ command: cmd, result: rejected, applyMs: 0 });
        return rejected;
      }
    }

    // Snapshot (for undo) — optional per handler
    const snapshot =
      handler.snapshot && cmd.issuedBy !== 'undo'
        ? handler.snapshot(cmd.payload, ctx)
        : undefined;

    // Apply
    this.depth++;
    const t0 = performance.now();
    let result: R | undefined;
    try {
      if (cmd.issuedBy === 'undo' && handler.undo) {
        // Caller is responsible for threading the original snapshot through
        // via the payload; see UndoManager.
        handler.undo(cmd.payload, (cmd.payload as any).__undoSnapshot, ctx);
      } else {
        result = handler.apply(cmd.payload, ctx) as R | undefined;
      }
    } catch (err) {
      const applyMs = performance.now() - t0;
      this.depth--;
      const rejected: DispatchResult<R> = {
        ok: false,
        reason: `Handler threw: ${err instanceof Error ? err.message : String(err)}`,
        command: cmd,
      };
      this.recordAndNotify({ command: cmd, result: rejected, applyMs });
      return rejected;
    }
    const applyMs = performance.now() - t0;
    this.depth--;

    const ok: DispatchResult<R> = {
      ok: true,
      result,
      snapshot,
      command: cmd,
    };
    this.recordAndNotify({ command: cmd, result: ok, applyMs });
    return ok;
  }

  /** Subscribe to every dispatched command (for God Mode console). */
  subscribe(listener: (entry: CommandLogEntry) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Read-only snapshot of the log (oldest → newest). */
  getLog(): CommandLogEntry[] {
    return this.log.toArray();
  }

  /**
   * True if the handler for `type` defines an `undo` function —
   * the canonical "is this command undoable" question. Used by
   * Phase 8.B's UndoManager to filter the log.
   */
  hasUndo(type: string): boolean {
    const h = this.handlers.get(type);
    return !!h?.undo;
  }

  clearLog(): void {
    this.log.clear();
  }

  /** Test helper: reset handler table + log. Never call from app code. */
  __reset(): void {
    this.handlers.clear();
    this.log.clear();
    this.subscribers.clear();
    this.depth = 0;
  }

  // ── internal ───────────────────────────────────────────────

  private materialize<P>(
    input: {
      type: string;
      payload: P;
      issuedBy?: Command['issuedBy'];
      correlationId?: string;
      timestamp?: number;
      mode?: CommandMode;
    },
    handler?: CommandHandler,
  ): Command<P> {
    // Phase 3 — resolve the workspace scope the Command will carry.
    // Priority: explicit input (e.g. UndoManager preserving the
    // original mode on an undo dispatch) → handler's declared mode
    // → current appMode at dispatch time. The fallback covers any
    // handler that forgets to declare, which is fine for plumbing
    // commands dispatched while the user is in plumbing mode but
    // would produce a wrong stamp for shared commands dispatched
    // in a domain mode — so every shared handler MUST declare.
    const mode: CommandMode = input.mode
      ?? handler?.mode
      ?? useAppModeStore.getState().mode;
    return {
      type: input.type,
      payload: input.payload,
      issuedBy: input.issuedBy ?? 'user',
      timestamp: input.timestamp ?? performance.now(),
      correlationId: input.correlationId ?? newCorrelationId(),
      mode,
    };
  }

  private recordAndNotify(entry: CommandLogEntry): void {
    this.log.push(entry);
    for (const s of this.subscribers) {
      try { s(entry); } catch { /* subscriber errors never break dispatch */ }
    }
  }
}

export const commandBus = new CommandBus();

/**
 * Typed shorthand for a handler registration. Infers payload/result
 * types from the handler literal.
 */
export function registerHandler<P, R>(handler: CommandHandler<P, R>): void {
  commandBus.register(handler);
}
