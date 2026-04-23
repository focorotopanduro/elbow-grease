/**
 * Boot — single entry point to bring up the CommandBus subsystem.
 *
 * Called once from App.tsx. Does three things:
 *   1. Registers every CommandHandler with the bus.
 *   2. Installs the EventToCommand translator so legacy EV.* fires
 *      route through commands (when the flag is on).
 *   3. Emits a one-time boot log entry so the God Mode console's
 *      timeline has a marker.
 *
 * Legacy pipeStore / fixtureStore `boot*` functions remain unchanged.
 * Two pathways coexist during the Phase 1 rollout. When the
 * `commandBus` flag graduates to "always on", the legacy EventBus
 * subscribers inside pipeStore.bootPipeStore() will be removed in the
 * same commit that removes the flag.
 */

import { commandBus } from './CommandBus';
import { registerAllHandlers } from './handlers';
import { installEventToCommand } from './EventToCommand';
import { installUndoHook } from './UndoManager';
import { newCorrelationId } from './correlationId';

let booted = false;

export function bootCommandBus(): void {
  if (booted) return;
  booted = true;
  registerAllHandlers();
  installEventToCommand();
  // Phase 8.B — undo manager watches the bus so each user command
  // truncates any pending redo region.
  installUndoHook();

  // One-line boot marker (useful in logs and tests).
  commandBus.dispatch({
    type: 'system.boot',
    payload: { version: '0.1.0', startedAt: new Date().toISOString() },
    issuedBy: 'user',
    correlationId: newCorrelationId(),
  });
}
