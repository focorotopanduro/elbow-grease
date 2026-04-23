/**
 * roofingDrawStore — Phase 14.R.4 tests.
 *
 * Covers:
 *   • idle ↔ draw-rect mode transitions
 *   • draft start / end wiring
 *   • default setters clamp at 0 where documented
 *   • `draftRectToSection()` normalizes corner order (min-origin)
 *   • `snapToGrid()` rounds to the documented resolution
 *   • cancelDraft clears both start + end regardless of entry path
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingDrawStore,
  draftRectToSection,
  snapToGrid,
  __testables,
  type GroundPoint,
} from '../roofingDrawStore';

beforeEach(() => {
  // Force a clean slate — Zustand retains state across `it()` cases
  // within a file, and other tests in the suite may have left the
  // store mid-draft.
  useRoofingDrawStore.setState({
    mode: 'idle',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
    ...__testables.DEFAULTS,
  });
});

describe('mode transitions', () => {
  it('defaults to idle', () => {
    expect(useRoofingDrawStore.getState().mode).toBe('idle');
  });

  it('beginDrawRect flips to draw-rect + clears any stale draft', () => {
    useRoofingDrawStore.setState({
      draftStart: [1, 2],
      draftEnd: [3, 4],
      polygonVertices: [[9, 9]],
    });
    useRoofingDrawStore.getState().beginDrawRect();
    const s = useRoofingDrawStore.getState();
    expect(s.mode).toBe('draw-rect');
    expect(s.draftStart).toBeNull();
    expect(s.draftEnd).toBeNull();
    expect(s.polygonVertices).toEqual([]);
  });

  it('cancelDraft returns to idle + clears draft', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-rect',
      draftStart: [5, 5],
      draftEnd: [10, 10],
      polygonVertices: [[0, 0], [1, 1]],
    });
    useRoofingDrawStore.getState().cancelDraft();
    const s = useRoofingDrawStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.draftStart).toBeNull();
    expect(s.draftEnd).toBeNull();
    expect(s.polygonVertices).toEqual([]);
  });
});

// ── Phase 14.R.9 polygon-mode transitions ──────────────────────

describe('polygon mode', () => {
  it('beginDrawPolygon flips to draw-polygon with empty vertices', () => {
    useRoofingDrawStore.setState({
      draftStart: [5, 5], draftEnd: [10, 10],
      polygonVertices: [[1, 1]],
    });
    useRoofingDrawStore.getState().beginDrawPolygon();
    const s = useRoofingDrawStore.getState();
    expect(s.mode).toBe('draw-polygon');
    expect(s.polygonVertices).toEqual([]);
    expect(s.draftStart).toBeNull();
    expect(s.draftEnd).toBeNull();
  });

  it('addPolygonVertex appends in order', () => {
    useRoofingDrawStore.getState().beginDrawPolygon();
    useRoofingDrawStore.getState().addPolygonVertex([1, 1]);
    useRoofingDrawStore.getState().addPolygonVertex([5, 1]);
    useRoofingDrawStore.getState().addPolygonVertex([5, 4]);
    expect(useRoofingDrawStore.getState().polygonVertices).toEqual([
      [1, 1], [5, 1], [5, 4],
    ]);
  });

  it('removeLastPolygonVertex pops the tail', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [[1, 1], [5, 1], [5, 4]],
    });
    useRoofingDrawStore.getState().removeLastPolygonVertex();
    expect(useRoofingDrawStore.getState().polygonVertices).toEqual([
      [1, 1], [5, 1],
    ]);
  });

  it('removeLastPolygonVertex on empty list is a no-op', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [],
    });
    useRoofingDrawStore.getState().removeLastPolygonVertex();
    expect(useRoofingDrawStore.getState().polygonVertices).toEqual([]);
  });

  it('beginDrawRect after polygon clears the polygon vertices', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [[0, 0], [5, 0], [5, 5], [0, 5]],
    });
    useRoofingDrawStore.getState().beginDrawRect();
    expect(useRoofingDrawStore.getState().polygonVertices).toEqual([]);
    expect(useRoofingDrawStore.getState().mode).toBe('draw-rect');
  });

  it('cancelDraft from draw-polygon clears everything', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [[0, 0], [5, 0], [5, 5]],
      draftEnd: [3, 3],
    });
    useRoofingDrawStore.getState().cancelDraft();
    const s = useRoofingDrawStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.polygonVertices).toEqual([]);
    expect(s.draftEnd).toBeNull();
  });
});

describe('draft endpoints', () => {
  it('setDraftStart stores the given point', () => {
    useRoofingDrawStore.getState().setDraftStart([3, 4]);
    expect(useRoofingDrawStore.getState().draftStart).toEqual([3, 4]);
  });

  it('setDraftEnd stores the given point', () => {
    useRoofingDrawStore.getState().setDraftEnd([7, 8]);
    expect(useRoofingDrawStore.getState().draftEnd).toEqual([7, 8]);
  });

  it('setDraftStart(null) clears without affecting draftEnd', () => {
    useRoofingDrawStore.setState({ draftStart: [1, 1], draftEnd: [2, 2] });
    useRoofingDrawStore.getState().setDraftStart(null);
    expect(useRoofingDrawStore.getState().draftStart).toBeNull();
    expect(useRoofingDrawStore.getState().draftEnd).toEqual([2, 2]);
  });
});

describe('default setters', () => {
  it('setDefaultRoofType accepts each valid RoofType', () => {
    const types = ['hip', 'gable', 'shed', 'flat'] as const;
    for (const t of types) {
      useRoofingDrawStore.getState().setDefaultRoofType(t);
      expect(useRoofingDrawStore.getState().defaultRoofType).toBe(t);
    }
  });

  it('setDefaultSlope clamps negatives to 0', () => {
    useRoofingDrawStore.getState().setDefaultSlope(-3);
    expect(useRoofingDrawStore.getState().defaultSlope).toBe(0);
  });

  it('setDefaultSlope passes positives through', () => {
    useRoofingDrawStore.getState().setDefaultSlope(9.5);
    expect(useRoofingDrawStore.getState().defaultSlope).toBe(9.5);
  });

  it('setDefaultOverhang clamps negatives to 0', () => {
    useRoofingDrawStore.getState().setDefaultOverhang(-2);
    expect(useRoofingDrawStore.getState().defaultOverhang).toBe(0);
  });

  it('setDefaultElevation accepts negatives (basements, sunken rooms)', () => {
    useRoofingDrawStore.getState().setDefaultElevation(-4);
    expect(useRoofingDrawStore.getState().defaultElevation).toBe(-4);
  });
});

describe('draftRectToSection()', () => {
  const cases: {
    a: GroundPoint;
    b: GroundPoint;
    expected: { x: number; y: number; length: number; run: number };
    label: string;
  }[] = [
    {
      label: 'bottom-left → top-right',
      a: [0, 0], b: [10, 20],
      expected: { x: 0, y: 0, length: 10, run: 20 },
    },
    {
      label: 'top-right → bottom-left (reversed)',
      a: [10, 20], b: [0, 0],
      expected: { x: 0, y: 0, length: 10, run: 20 },
    },
    {
      label: 'mixed-sign corners (negative → positive)',
      a: [-5, -5], b: [5, 5],
      expected: { x: -5, y: -5, length: 10, run: 10 },
    },
    {
      label: 'top-left → bottom-right (cross-axis swap)',
      a: [10, 0], b: [0, 20],
      expected: { x: 0, y: 0, length: 10, run: 20 },
    },
    {
      label: 'identical points → zero-area rectangle',
      a: [7, 7], b: [7, 7],
      expected: { x: 7, y: 7, length: 0, run: 0 },
    },
  ];

  for (const c of cases) {
    it(c.label, () => {
      expect(draftRectToSection(c.a, c.b)).toEqual(c.expected);
    });
  }
});

describe('snapToGrid()', () => {
  it('rounds to nearest 0.5 by default', () => {
    expect(snapToGrid([1.2, 3.8])).toEqual([1.0, 4.0]);
    expect(snapToGrid([1.25, 3.75])).toEqual([1.5, 4.0]); // banker's-like
    expect(snapToGrid([2.4, 2.6])).toEqual([2.5, 2.5]);
  });

  it('supports custom grid size', () => {
    expect(snapToGrid([1.2, 3.7], 1)).toEqual([1, 4]);
    expect(snapToGrid([1.24, 1.26], 0.25)).toEqual([1.25, 1.25]);
  });

  it('passes through unchanged for grid ≤ 0', () => {
    expect(snapToGrid([1.23, 4.56], 0)).toEqual([1.23, 4.56]);
    expect(snapToGrid([1.23, 4.56], -1)).toEqual([1.23, 4.56]);
  });

  it('preserves negatives', () => {
    expect(snapToGrid([-1.2, -3.7])).toEqual([-1.0, -3.5]);
  });
});
