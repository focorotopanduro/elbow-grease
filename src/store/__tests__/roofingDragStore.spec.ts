/**
 * roofingDragStore — Phase 14.R.8 tests.
 *
 * Covers:
 *   • idle ↔ dragging transitions
 *   • anchors captured on beginDrag + cleared on endDrag
 *   • dragDelta() with + without grid snap, reversed corners, etc.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingDragStore,
  dragDelta,
  type GroundPoint,
} from '../roofingDragStore';

beforeEach(() => {
  useRoofingDragStore.setState({
    mode: 'idle',
    sectionId: null,
    pointerStart: null,
    sectionStart: null,
  });
});

describe('mode transitions', () => {
  it('defaults to idle with null anchors', () => {
    const s = useRoofingDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.pointerStart).toBeNull();
    expect(s.sectionStart).toBeNull();
  });

  it('beginDrag captures sectionId + both anchors', () => {
    useRoofingDragStore.getState().beginDrag(
      'SEC-001',
      [5, 7],
      [10, 20],
    );
    const s = useRoofingDragStore.getState();
    expect(s.mode).toBe('dragging');
    expect(s.sectionId).toBe('SEC-001');
    expect(s.pointerStart).toEqual([5, 7]);
    expect(s.sectionStart).toEqual([10, 20]);
  });

  it('endDrag returns to idle + clears anchors', () => {
    useRoofingDragStore.getState().beginDrag('SEC-001', [1, 1], [0, 0]);
    useRoofingDragStore.getState().endDrag();
    const s = useRoofingDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.pointerStart).toBeNull();
    expect(s.sectionStart).toBeNull();
  });

  it('beginDrag overwrites stale anchors from a previous drag', () => {
    useRoofingDragStore.getState().beginDrag('A', [0, 0], [0, 0]);
    useRoofingDragStore.getState().beginDrag('B', [50, 60], [100, 200]);
    const s = useRoofingDragStore.getState();
    expect(s.sectionId).toBe('B');
    expect(s.pointerStart).toEqual([50, 60]);
    expect(s.sectionStart).toEqual([100, 200]);
  });
});

describe('dragDelta', () => {
  it('returns the sectionStart when pointer has not moved', () => {
    const r = dragDelta([5, 7], [10, 20], [5, 7]);
    expect(r).toEqual({ x: 10, y: 20 });
  });

  it('adds the pointer delta to the section start', () => {
    // Pointer moved by (+3, +4). Section at (10, 20) should land at (13, 24).
    const r = dragDelta([5, 7], [10, 20], [8, 11]);
    // Default snap = 0.5; (13, 24) is already on the grid.
    expect(r).toEqual({ x: 13, y: 24 });
  });

  it('handles negative deltas', () => {
    const r = dragDelta([10, 10], [100, 100], [5, 7]);
    // Delta: (-5, -3). Expected: (95, 97).
    expect(r).toEqual({ x: 95, y: 97 });
  });

  it('snaps the RESULT to the grid, not the delta', () => {
    const r = dragDelta([0, 0], [10, 20], [3.17, 4.29], 0.5);
    // Raw: (13.17, 24.29) → snapped: (13.0, 24.5)
    expect(r.x).toBeCloseTo(13.0, 6);
    expect(r.y).toBeCloseTo(24.5, 6);
  });

  it('supports a custom grid size', () => {
    const r = dragDelta([0, 0], [1.25, 3.5], [0.1, 0.2], 1);
    // Raw: (1.35, 3.7) → snap to 1-ft grid → (1, 4)
    expect(r).toEqual({ x: 1, y: 4 });
  });

  it('disables snap when gridSnap <= 0', () => {
    const r = dragDelta([0, 0], [10.123, 20.456], [0, 0], 0);
    expect(r).toEqual({ x: 10.123, y: 20.456 });
    const r2 = dragDelta([0, 0], [10.123, 20.456], [0, 0], -1);
    expect(r2).toEqual({ x: 10.123, y: 20.456 });
  });

  it('is consistent across pointer-move callbacks (no drift)', () => {
    // A drag from pointerStart → end that passes through two
    // intermediate points must land at the same final spot
    // regardless of the intermediate samples.
    const pStart: GroundPoint = [0, 0];
    const sStart: GroundPoint = [100, 100];
    const pEnd: GroundPoint = [5, 5];
    const via1 = dragDelta(pStart, sStart, [2.3, 1.7]);
    const via2 = dragDelta(pStart, sStart, [4.1, 4.9]);
    const viaEnd = dragDelta(pStart, sStart, pEnd);
    // Final position depends ONLY on pEnd, not on the intermediate
    // samples (the section's position in the store is immaterial
    // because dragDelta always references sectionStart, not current).
    expect(viaEnd).toEqual({ x: 105, y: 105 });
    // Intermediate samples are not expected to equal viaEnd (they
    // aren't at the same pointer position), but they are self-
    // consistent — the function is pure in (pStart, sStart, current).
    expect(via1.x).not.toBe(viaEnd.x);
    expect(via2.x).not.toBe(viaEnd.x);
  });
});
