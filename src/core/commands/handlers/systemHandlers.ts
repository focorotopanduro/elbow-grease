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
  // Pure marker. No mutation, no snapshot, no undo.
  apply: () => undefined,
};

export const systemHandlers = [systemBootHandler] as const;
