/**
 * roofingRotationDragStore — Phase 14.R.19 tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingRotationDragStore,
  rotationAngleDelta,
  snapDegrees,
} from '../roofingRotationDragStore';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

beforeEach(() => {
  useRoofingRotationDragStore.setState({
    mode: 'idle',
    sectionId: null,
    center: null,
    startPointerAngle: null,
    anchorRotation: 0,
    anchorPolygon: null,
    preDragSnapshot: null,
  });
});

describe('mode transitions', () => {
  it('defaults to idle with empty anchors', () => {
    const s = useRoofingRotationDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.center).toBeNull();
    expect(s.startPointerAngle).toBeNull();
    expect(s.anchorPolygon).toBeNull();
    expect(s.preDragSnapshot).toBeNull();
  });

  it('beginRotate captures everything atomically', () => {
    const snap = emptyRoofSnapshot();
    useRoofingRotationDragStore.getState().beginRotate({
      sectionId: 'SEC-1',
      center: [5, 3],
      startPointerAngle: 1.23,
      anchorRotation: 30,
      anchorPolygon: [[0, 0], [10, 0], [5, 8]],
      preDragSnapshot: snap,
    });
    const s = useRoofingRotationDragStore.getState();
    expect(s.mode).toBe('rotating');
    expect(s.sectionId).toBe('SEC-1');
    expect(s.center).toEqual([5, 3]);
    expect(s.startPointerAngle).toBeCloseTo(1.23, 6);
    expect(s.anchorRotation).toBe(30);
    expect(s.anchorPolygon).toEqual([[0, 0], [10, 0], [5, 8]]);
    expect(s.preDragSnapshot).toBe(snap);
  });

  it('endRotate clears everything (no leaks)', () => {
    useRoofingRotationDragStore.getState().beginRotate({
      sectionId: 'S', center: [0, 0], startPointerAngle: 0,
      anchorRotation: 45, anchorPolygon: [[0, 0], [1, 0], [0, 1]],
      preDragSnapshot: emptyRoofSnapshot(),
    });
    useRoofingRotationDragStore.getState().endRotate();
    const s = useRoofingRotationDragStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.sectionId).toBeNull();
    expect(s.center).toBeNull();
    expect(s.startPointerAngle).toBeNull();
    expect(s.anchorPolygon).toBeNull();
    expect(s.preDragSnapshot).toBeNull();
  });
});

describe('rotationAngleDelta', () => {
  it('returns zero when angles match', () => {
    expect(rotationAngleDelta(1.0, 1.0)).toBe(0);
  });

  it('positive delta when current > start', () => {
    expect(rotationAngleDelta(0.5, 1.0)).toBeCloseTo(0.5, 6);
  });

  it('negative delta when current < start', () => {
    expect(rotationAngleDelta(1.0, 0.5)).toBeCloseTo(-0.5, 6);
  });

  it('wraps around at +\u03c0 (crossing the branch cut)', () => {
    // start = 3.0 (close to \u03c0), current = -3.0 (close to -\u03c0).
    // Raw delta = -6.0. After wrap: +0.283...
    const d = rotationAngleDelta(3.0, -3.0);
    expect(d).toBeCloseTo(-6.0 + 2 * Math.PI, 6);
    expect(d).toBeGreaterThan(0);
  });

  it('wraps around at -\u03c0', () => {
    const d = rotationAngleDelta(-3.0, 3.0);
    expect(d).toBeCloseTo(6.0 - 2 * Math.PI, 6);
    expect(d).toBeLessThan(0);
  });

  it('result is in (-\u03c0, \u03c0]', () => {
    for (const s of [-3, -2, -1, 0, 1, 2, 3]) {
      for (const c of [-3, -2, -1, 0, 1, 2, 3]) {
        const d = rotationAngleDelta(s, c);
        expect(d).toBeGreaterThan(-Math.PI - 1e-9);
        expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });
});

describe('snapDegrees', () => {
  it('snaps to 15\u00b0 multiples', () => {
    expect(snapDegrees(0, 15)).toBe(0);
    expect(snapDegrees(14, 15)).toBe(15);
    expect(snapDegrees(22, 15)).toBe(15);
    expect(snapDegrees(23, 15)).toBe(30);
  });

  it('snaps negatives consistently', () => {
    expect(snapDegrees(-14, 15)).toBe(-15);
    expect(snapDegrees(-22, 15)).toBe(-15);
    expect(snapDegrees(-23, 15)).toBe(-30);
  });

  it('step \u2264 0 returns input unchanged (disables snap)', () => {
    expect(snapDegrees(17.3, 0)).toBe(17.3);
    expect(snapDegrees(17.3, -1)).toBe(17.3);
  });

  it('fine 1\u00b0 snap rounds to integer degrees', () => {
    expect(snapDegrees(17.3, 1)).toBe(17);
    expect(snapDegrees(17.7, 1)).toBe(18);
  });
});
