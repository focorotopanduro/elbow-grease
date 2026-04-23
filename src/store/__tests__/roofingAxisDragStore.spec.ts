/**
 * roofingAxisDragStore — Phase 14.R.23 tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useRoofingAxisDragStore } from '../roofingAxisDragStore';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

beforeEach(() => {
  useRoofingAxisDragStore.setState({
    mode: 'idle',
    sectionId: null,
    center: null,
    startPointerAngle: null,
    anchorAxisDeg: 0,
    preDragSnapshot: null,
  });
});

describe('mode transitions', () => {
  it('defaults to idle', () => {
    const s = useRoofingAxisDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.center).toBeNull();
    expect(s.startPointerAngle).toBeNull();
    expect(s.anchorAxisDeg).toBe(0);
    expect(s.preDragSnapshot).toBeNull();
  });

  it('beginDrag captures sectionId + center + pointer angle + anchor axis + snapshot', () => {
    const snap = emptyRoofSnapshot();
    useRoofingAxisDragStore.getState().beginDrag({
      sectionId: 'SEC-1',
      center: [5, 3],
      startPointerAngle: 0.5,
      anchorAxisDeg: 45,
      preDragSnapshot: snap,
    });
    const s = useRoofingAxisDragStore.getState();
    expect(s.mode).toBe('dragging');
    expect(s.sectionId).toBe('SEC-1');
    expect(s.center).toEqual([5, 3]);
    expect(s.startPointerAngle).toBeCloseTo(0.5, 6);
    expect(s.anchorAxisDeg).toBe(45);
    expect(s.preDragSnapshot).toBe(snap);
  });

  it('endDrag clears every field (no leaks)', () => {
    useRoofingAxisDragStore.getState().beginDrag({
      sectionId: 'A', center: [0, 0], startPointerAngle: 0,
      anchorAxisDeg: 30, preDragSnapshot: emptyRoofSnapshot(),
    });
    useRoofingAxisDragStore.getState().endDrag();
    const s = useRoofingAxisDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.center).toBeNull();
    expect(s.startPointerAngle).toBeNull();
    expect(s.anchorAxisDeg).toBe(0);
    expect(s.preDragSnapshot).toBeNull();
  });

  it('beginDrag overwrites stale state', () => {
    useRoofingAxisDragStore.getState().beginDrag({
      sectionId: 'A', center: [0, 0], startPointerAngle: 0,
      anchorAxisDeg: 0, preDragSnapshot: emptyRoofSnapshot(),
    });
    const snap2 = emptyRoofSnapshot();
    useRoofingAxisDragStore.getState().beginDrag({
      sectionId: 'B', center: [100, 200], startPointerAngle: 1.5,
      anchorAxisDeg: 90, preDragSnapshot: snap2,
    });
    const s = useRoofingAxisDragStore.getState();
    expect(s.sectionId).toBe('B');
    expect(s.center).toEqual([100, 200]);
    expect(s.startPointerAngle).toBeCloseTo(1.5, 6);
    expect(s.anchorAxisDeg).toBe(90);
    expect(s.preDragSnapshot).toBe(snap2);
  });
});
