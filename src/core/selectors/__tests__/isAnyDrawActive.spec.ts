/**
 * isAnyDrawActive — Phase 2b (ARCHITECTURE.md §4.2) tests.
 *
 * Covers the three combinations the selector must classify:
 *   • Both stores idle → false
 *   • Plumbing mid-draw → true
 *   • Roofing mid-draw → true (both rect and polygon sub-modes)
 *   • Both active (unusual but possible during workspace toggle
 *     mid-interaction) → true
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isAnyDrawActive } from '../isAnyDrawActive';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';

function resetStores() {
  usePlumbingDrawStore.setState({
    mode: 'navigate',
    drawPoints: [],
    isDrawing: false,
  });
  useRoofingDrawStore.setState({
    mode: 'idle',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
  });
}

describe('isAnyDrawActive (ARCHITECTURE.md §4.2)', () => {
  beforeEach(() => resetStores());

  it('returns false when both stores are idle', () => {
    expect(isAnyDrawActive()).toBe(false);
  });

  it("returns true when plumbingDrawStore.mode === 'draw'", () => {
    usePlumbingDrawStore.setState({ mode: 'draw' });
    expect(isAnyDrawActive()).toBe(true);
  });

  it("returns false when plumbingDrawStore is in 'select' mode (select ≠ draw)", () => {
    usePlumbingDrawStore.setState({ mode: 'select' });
    expect(isAnyDrawActive()).toBe(false);
  });

  it("returns true when roofingDrawStore is mid-rectangle", () => {
    useRoofingDrawStore.setState({ mode: 'draw-rect' });
    expect(isAnyDrawActive()).toBe(true);
  });

  it("returns true when roofingDrawStore is mid-polygon", () => {
    useRoofingDrawStore.setState({ mode: 'draw-polygon' });
    expect(isAnyDrawActive()).toBe(true);
  });

  it("returns true when roofingDrawStore is placing a penetration", () => {
    useRoofingDrawStore.setState({ mode: 'place-penetration' });
    expect(isAnyDrawActive()).toBe(true);
  });

  it('returns true when BOTH stores hold active draw sessions', () => {
    usePlumbingDrawStore.setState({ mode: 'draw' });
    useRoofingDrawStore.setState({ mode: 'draw-rect' });
    expect(isAnyDrawActive()).toBe(true);
  });
});
