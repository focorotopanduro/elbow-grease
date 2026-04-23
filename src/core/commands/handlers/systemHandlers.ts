/**
 * System command handlers — meta-level markers that don't mutate any
 * store but show up in the log for orientation.
 */

import type { CommandHandler } from '../types';

export interface SystemBootPayload {
  version: string;
  startedAt: string;
}

export const systemBootHandler: CommandHandler<SystemBootPayload, void> = {
  type: 'system.boot',
  // Phase 3 (ARCHITECTURE.md §4.3) — boot is workspace-agnostic
  // infrastructure. Stamp 'shared' so it never falls into either
  // workspace's undo stack (it's non-undoable anyway, but the
  // classification keeps the taxonomy honest).
  mode: 'shared',
  // Pure marker. No mutation, no snapshot, no undo.
  apply: () => undefined,
};

export const systemHandlers = [systemBootHandler] as const;
