/**
 * roofingVertexDragStore — Phase 14.R.18 tests.
 *
 * Covers:
 *   • idle ↔ dragging transitions
 *   • all anchors + snapshot captured on beginDrag
 *   • endDrag clears every anchor + the snapshot reference (no leak)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useRoofingVertexDragStore } from '../roofingVertexDragStore';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

beforeEach(() => {
  useRoofingVertexDragStore.setState({
    mode: 'idle',
    sectionId: null,
    vertexIdx: -1,
    pointerStart: null,
    vertexStart: null,
    preDragSnapshot: null,
  });
});

describe('mode transitions', () => {
  it('defaults to idle with every anchor null', () => {
    const s = useRoofingVertexDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.vertexIdx).toBe(-1);
    expect(s.pointerStart).toBeNull();
    expect(s.vertexStart).toBeNull();
    expect(s.preDragSnapshot).toBeNull();
  });

  it('beginDrag captures sectionId + vertexIdx + anchors + snapshot', () => {
    const snap = emptyRoofSnapshot();
    useRoofingVertexDragStore.getState().beginDrag({
      sectionId: 'SEC-001',
      vertexIdx: 3,
      pointerStart: [5, 7],
      vertexStart: [10, 20],
      preDragSnapshot: snap,
    });
    const s = useRoofingVertexDragStore.getState();
    expect(s.mode).toBe('dragging');
    expect(s.sectionId).toBe('SEC-001');
    expect(s.vertexIdx).toBe(3);
    expect(s.pointerStart).toEqual([5, 7]);
    expect(s.vertexStart).toEqual([10, 20]);
    expect(s.preDragSnapshot).toBe(snap);
  });

  it('endDrag returns to idle + clears everything (no snapshot leak)', () => {
    const snap = emptyRoofSnapshot();
    useRoofingVertexDragStore.getState().beginDrag({
      sectionId: 'S', vertexIdx: 0,
      pointerStart: [1, 1], vertexStart: [0, 0],
      preDragSnapshot: snap,
    });
    useRoofingVertexDragStore.getState().endDrag();
    const s = useRoofingVertexDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.vertexIdx).toBe(-1);
    expect(s.pointerStart).toBeNull();
    expect(s.vertexStart).toBeNull();
    expect(s.preDragSnapshot).toBeNull();
  });

  it('beginDrag overwrites stale anchors from a previous drag', () => {
    const snap1 = emptyRoofSnapshot();
    const snap2 = emptyRoofSnapshot();
    useRoofingVertexDragStore.getState().beginDrag({
      sectionId: 'A', vertexIdx: 0,
      pointerStart: [0, 0], vertexStart: [0, 0],
      preDragSnapshot: snap1,
    });
    useRoofingVertexDragStore.getState().beginDrag({
      sectionId: 'B', vertexIdx: 5,
      pointerStart: [50, 60], vertexStart: [100, 200],
      preDragSnapshot: snap2,
    });
    const s = useRoofingVertexDragStore.getState();
    expect(s.sectionId).toBe('B');
    expect(s.vertexIdx).toBe(5);
    expect(s.pointerStart).toEqual([50, 60]);
    expect(s.vertexStart).toEqual([100, 200]);
    expect(s.preDragSnapshot).toBe(snap2);
  });
});
