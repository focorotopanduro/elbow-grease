/**
 * Integration: autosave dirty tracking via CommandBus.
 *
 * Phase 11.A ships autosave that listens to commandBus and marks the
 * document dirty on any successful non-undo/redo command. This test
 * verifies the wiring: dispatch → isDirty flips, markClean resets.
 *
 * The timer-driven write to localStorage isn't exercised here (it
 * runs every 10 s in production); we test `markDirty`, `isDirty`, and
 * `markClean` directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { bootAutosave, stopAutosave, isDirty, markClean } from '@core/bundle/autosave';
import { commandBus } from '@core/commands/CommandBus';
import { resetAllStores } from './harness';

beforeEach(() => {
  resetAllStores();
  bootAutosave();
  markClean(); // baseline
});

afterEach(() => {
  stopAutosave();
});

describe('dirty flag via CommandBus', () => {
  it('successful command flips dirty=true', () => {
    expect(isDirty()).toBe(false);

    // An unregistered command is auto-rejected — not counted.
    commandBus.dispatch({ type: 'ghost.never', payload: {}, issuedBy: 'user' });
    expect(isDirty()).toBe(false);

    // Register a minimal handler that succeeds.
    commandBus.register({
      type: 'test.mutate',
      apply: () => undefined,
    });

    commandBus.dispatch({ type: 'test.mutate', payload: {}, issuedBy: 'user' });
    expect(isDirty()).toBe(true);
  });

  it('undo/redo-origin commands do NOT flip dirty', () => {
    commandBus.register({
      type: 'test.mutate2',
      apply: () => undefined,
    });
    // A 'replay' / 'undo' / 'redo' origin is explicitly skipped in the
    // autosave subscription.
    commandBus.dispatch({ type: 'test.mutate2', payload: {}, issuedBy: 'undo' });
    expect(isDirty()).toBe(false);

    commandBus.dispatch({ type: 'test.mutate2', payload: {}, issuedBy: 'redo' });
    expect(isDirty()).toBe(false);
  });

  it('markClean resets the flag', () => {
    commandBus.register({
      type: 'test.mutate3',
      apply: () => undefined,
    });
    commandBus.dispatch({ type: 'test.mutate3', payload: {}, issuedBy: 'user' });
    expect(isDirty()).toBe(true);
    markClean();
    expect(isDirty()).toBe(false);
  });
});
