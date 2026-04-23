/**
 * KeyboardHandler — Phase 2a (ARCHITECTURE.md §4.1) tests.
 *
 * Covers the mode-guard behaviour: with `appMode === 'roofing'`,
 * bare-key plumbing shortcuts must NOT mutate `plumbingDrawStore`.
 * Global shortcuts (undo, workspace toggle) must still fire.
 *
 * Uses the exported pure `handleKeyboardEvent` function rather than
 * booting the React component — the tiers of the dispatcher are
 * independent of React's lifecycle, and reading store state after
 * a synthetic keydown is the most direct assertion we can make.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { handleKeyboardEvent } from '../KeyboardHandler';
import { useAppModeStore } from '@store/appModeStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';

/** Fabricate a KeyboardEvent jsdom will accept. */
function key(
  k: string,
  mods: Partial<{
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }> = {},
): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: k,
    shiftKey: mods.shiftKey ?? false,
    ctrlKey: mods.ctrlKey ?? false,
    metaKey: mods.metaKey ?? false,
    altKey: mods.altKey ?? false,
    cancelable: true,
  });
}

function resetPlumbingDraw() {
  usePlumbingDrawStore.setState({
    mode: 'navigate',
    drawPoints: [],
    isDrawing: false,
    drawPlane: 'horizontal',
    drawDiameter: 2,
  });
}

describe('KeyboardHandler — mode guard (ARCHITECTURE.md §4.1)', () => {
  beforeEach(() => {
    resetPlumbingDraw();
  });

  it("D in roofing mode does NOT flip plumbingDrawStore into 'draw'", () => {
    useAppModeStore.setState({ mode: 'roofing' });
    handleKeyboardEvent(key('d'));
    expect(usePlumbingDrawStore.getState().mode).toBe('navigate');
  });

  it("D in plumbing mode DOES flip plumbingDrawStore into 'draw'", () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    handleKeyboardEvent(key('d'));
    expect(usePlumbingDrawStore.getState().mode).toBe('draw');
  });

  it("N in roofing mode does NOT change plumbing mode", () => {
    useAppModeStore.setState({ mode: 'roofing' });
    usePlumbingDrawStore.setState({ mode: 'draw' }); // start in draw
    handleKeyboardEvent(key('n'));
    expect(usePlumbingDrawStore.getState().mode).toBe('draw');
  });

  it("Q (pipe quality toggle) is a no-op in roofing mode", () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const before = usePlumbingDrawStore.getState().pipeQuality;
    handleKeyboardEvent(key('q'));
    expect(usePlumbingDrawStore.getState().pipeQuality).toBe(before);
  });

  it("number keys 1-6 don't change plumbing diameter in roofing mode", () => {
    useAppModeStore.setState({ mode: 'roofing' });
    usePlumbingDrawStore.setState({ mode: 'draw', drawDiameter: 2 });
    handleKeyboardEvent(key('1'));
    handleKeyboardEvent(key('6'));
    expect(usePlumbingDrawStore.getState().drawDiameter).toBe(2);
  });

  it("H / V (draw plane) are no-ops in roofing mode even when plumbingDrawStore.mode === 'draw'", () => {
    useAppModeStore.setState({ mode: 'roofing' });
    usePlumbingDrawStore.setState({ mode: 'draw', drawPlane: 'horizontal' });
    handleKeyboardEvent(key('v'));
    expect(usePlumbingDrawStore.getState().drawPlane).toBe('horizontal');
  });
});

describe('KeyboardHandler — global shortcuts still fire (ARCHITECTURE.md §4.1)', () => {
  beforeEach(() => {
    resetPlumbingDraw();
  });

  it('Shift+M toggles workspace from either mode', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    handleKeyboardEvent(key('m', { shiftKey: true }));
    expect(useAppModeStore.getState().mode).toBe('roofing');

    handleKeyboardEvent(key('m', { shiftKey: true }));
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });

  it('Ctrl+Z / Ctrl+Y work regardless of workspace (no throw)', () => {
    // Undo / redo walk the command log; asserting they don't throw
    // when dispatched in the "wrong" mode is enough — they're global
    // by ARCHITECTURE.md §4.1 and shouldn't be gated.
    useAppModeStore.setState({ mode: 'roofing' });
    expect(() => handleKeyboardEvent(key('z', { ctrlKey: true }))).not.toThrow();
    expect(() => handleKeyboardEvent(key('y', { ctrlKey: true }))).not.toThrow();
  });
});
