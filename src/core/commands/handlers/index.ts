/**
 * Handler registry — registers every CommandHandler with the bus at boot.
 *
 * Call `registerAllHandlers()` exactly once, from the app bootstrap in
 * App.tsx. Safe to call multiple times (register() overwrites, which
 * we use in tests for mock swaps).
 */

import { commandBus } from '../CommandBus';
import type { CommandHandler } from '../types';
import { pipeHandlers } from './pipeHandlers';
import { fixtureHandlers } from './fixtureHandlers';
import { interactionHandlers } from './interactionHandlers';
import { systemHandlers } from './systemHandlers';
import { manifoldHandlers } from './manifoldHandlers';

// Iterate through heterogeneous handler arrays as a type-erased
// `CommandHandler<unknown, unknown>` — the individual handler types
// stay precise at their definitions; only the bus's internal handler
// table stores them after registration.
function registerAll(list: readonly CommandHandler<any, any>[]): void {
  for (const h of list) commandBus.register(h);
}

export function registerAllHandlers(): void {
  registerAll(systemHandlers);
  registerAll(pipeHandlers);
  registerAll(fixtureHandlers);
  registerAll(interactionHandlers);
  registerAll(manifoldHandlers);
}

export {
  pipeHandlers, fixtureHandlers, interactionHandlers, systemHandlers,
  manifoldHandlers,
};
