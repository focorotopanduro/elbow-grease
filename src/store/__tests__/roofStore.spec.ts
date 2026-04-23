/**
 * roofStore — Phase 14.R.1.
 *
 * Tests for the Zustand roof-graph store: CRUD, undo / redo,
 * batching, persistence, layers, PDF underlay, and the derived
 * selectors. Matches the test patterns established for
 * `pipeStore.spec.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofStore,
  selectSectionsArray,
  selectTotalAreaNet,
  selectTotalAreaPlan,
  selectTotalPerimeter,
  selectPenetrationsArray,
  sectionAt,
} from '../roofStore';
import {
  areaActual,
  areaPlan,
  perimeterPlan,
  emptyRoofSnapshot,
  DEFAULT_LAYERS,
  PENETRATION_DEFAULTS,
} from '../../engine/roofing/RoofGraph';

function resetStore() {
  useRoofStore.setState({
    sections: {},
    sectionOrder: [],
    vertices: {},
    measures: {},
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    pdf: emptyRoofSnapshot().pdf,
    selectedSectionId: null,
    penetrations: {},
    penetrationOrder: [],
    undoStack: [],
    redoStack: [],
    batchDepth: 0,
    dirtyDuringBatch: false,
  });
}

beforeEach(() => resetStore());

// ── Section CRUD ───────────────────────────────────────────────

describe('roofStore section CRUD', () => {
  it('addSection returns an ID and adds to sections + sectionOrder', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    const s = useRoofStore.getState();
    expect(s.sections[id]).toBeDefined();
    expect(s.sections[id]!.label).toBe('Section 1');
    expect(s.sectionOrder).toEqual([id]);
  });

  it('addSection applies overrides (length, slope, roofType, overhang)', () => {
    const id = useRoofStore.getState().addSection({
      x: 10, y: 20, length: 40, run: 25, slope: 4,
      roofType: 'hip', overhang: 2, label: 'Main',
    });
    const sec = useRoofStore.getState().sections[id]!;
    expect(sec.label).toBe('Main');
    expect(sec.length).toBe(40);
    expect(sec.run).toBe(25);
    expect(sec.slope).toBe(4);
    expect(sec.roofType).toBe('hip');
    expect(sec.overhang).toBe(2);
  });

  it('auto-numbers subsequent sections when label omitted', () => {
    const store = useRoofStore.getState();
    store.addSection({ x: 0, y: 0 });
    store.addSection({ x: 10, y: 10 });
    const s = useRoofStore.getState();
    const labels = s.sectionOrder.map((id) => s.sections[id]!.label);
    expect(labels).toEqual(['Section 1', 'Section 2']);
  });

  it('updateSection patches a single field without clobbering others', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().updateSection(id, { slope: 10 });
    const sec = useRoofStore.getState().sections[id]!;
    expect(sec.slope).toBe(10);
    expect(sec.length).toBe(30); // default preserved
  });

  it('updateSection on unknown id is a no-op', () => {
    useRoofStore.getState().updateSection('nope', { slope: 99 });
    expect(useRoofStore.getState().sections['nope']).toBeUndefined();
  });

  it('removeSection removes from sections + sectionOrder + clears selection if selected', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().selectSection(id);
    useRoofStore.getState().removeSection(id);
    const s = useRoofStore.getState();
    expect(s.sections[id]).toBeUndefined();
    expect(s.sectionOrder).toEqual([]);
    expect(s.selectedSectionId).toBeNull();
  });

  it('moveSection updates x/y unless locked', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().moveSection(id, 50, 60);
    expect(useRoofStore.getState().sections[id]!.x).toBe(50);
    expect(useRoofStore.getState().sections[id]!.y).toBe(60);

    useRoofStore.getState().updateSection(id, { locked: true });
    useRoofStore.getState().moveSection(id, 999, 999);
    expect(useRoofStore.getState().sections[id]!.x).toBe(50); // unchanged
  });
});

// ── Vertex + measure CRUD ──────────────────────────────────────

describe('vertex + measure CRUD', () => {
  it('addVertex + removeVertex', () => {
    const id = useRoofStore.getState().addVertex(5, 10, 'A');
    expect(useRoofStore.getState().vertices[id]).toBeDefined();
    useRoofStore.getState().removeVertex(id);
    expect(useRoofStore.getState().vertices[id]).toBeUndefined();
  });

  it('addMeasure + removeMeasure', () => {
    const id = useRoofStore.getState().addMeasure(0, 0, 3, 4, '5ft');
    const m = useRoofStore.getState().measures[id]!;
    expect(m.x1).toBe(0);
    expect(m.x2).toBe(3);
    useRoofStore.getState().removeMeasure(id);
    expect(useRoofStore.getState().measures[id]).toBeUndefined();
  });
});

// ── Layers ─────────────────────────────────────────────────────

describe('layers', () => {
  it('default layers are populated', () => {
    const layers = useRoofStore.getState().layers;
    expect(layers.length).toBe(DEFAULT_LAYERS.length);
    expect(layers[0]!.name).toBe('PDF Blueprint');
  });

  it('setLayerVisible toggles the flag', () => {
    useRoofStore.getState().setLayerVisible(0, false);
    expect(useRoofStore.getState().layers[0]!.visible).toBe(false);
  });

  it('setLayerOpacity clamps to [0, 1]', () => {
    useRoofStore.getState().setLayerOpacity(0, 1.5);
    expect(useRoofStore.getState().layers[0]!.opacity).toBe(1);
    useRoofStore.getState().setLayerOpacity(0, -0.2);
    expect(useRoofStore.getState().layers[0]!.opacity).toBe(0);
  });

  it('setLayerLocked toggles', () => {
    useRoofStore.getState().setLayerLocked(1, true);
    expect(useRoofStore.getState().layers[1]!.locked).toBe(true);
  });

  it('out-of-range index is a no-op', () => {
    const before = useRoofStore.getState().layers;
    useRoofStore.getState().setLayerVisible(99, true);
    expect(useRoofStore.getState().layers).toEqual(before);
  });
});

// ── Phase 14.R.19 rotation ─────────────────────────────────────

describe('rotateSectionLive (no undo)', () => {
  it('rect section: rotation = anchor.rotation + angleDeg', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    useRoofStore.getState().rotateSectionLive(sid, 45, {
      rotation: 30,
      polygon: null,
      center: [5, 2.5],
    });
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(75);
  });

  it('polygon section: rotates anchor polygon around center', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const anchor = [[0, 0], [10, 0], [10, 5], [0, 5]] as [number, number][];
    useRoofStore.getState().rotateSectionLive(sid, 180, {
      rotation: 0,
      polygon: anchor,
      center: [5, 2.5],
    });
    const sec = useRoofStore.getState().sections[sid]!;
    // Floating-point: 180\u00b0 rotation via sin/cos accrues \u2248 3e-16 error.
    expect(sec.polygon![0]![0]).toBeCloseTo(10, 6);
    expect(sec.polygon![0]![1]).toBeCloseTo(5, 6);
    expect(sec.polygon![1]![0]).toBeCloseTo(0, 6);
    expect(sec.polygon![1]![1]).toBeCloseTo(5, 6);
    expect(sec.polygon![2]![0]).toBeCloseTo(0, 6);
    expect(sec.polygon![2]![1]).toBeCloseTo(0, 6);
    expect(sec.polygon![3]![0]).toBeCloseTo(10, 6);
    expect(sec.polygon![3]![1]).toBeCloseTo(0, 6);
  });

  it('polygon section: recomputes bbox fields after rotation', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const anchor = [[0, 0], [10, 0], [10, 5], [0, 5]] as [number, number][];
    // 90° rotation around center (5, 2.5) swaps the bbox dims.
    useRoofStore.getState().rotateSectionLive(sid, 90, {
      rotation: 0, polygon: anchor, center: [5, 2.5],
    });
    const sec = useRoofStore.getState().sections[sid]!;
    // Bbox of rotated rectangle is now 5\u00d710 centered at (5, 2.5).
    expect(sec.length).toBeCloseTo(5, 6);
    expect(sec.run).toBeCloseTo(10, 6);
    expect(sec.x).toBeCloseTo(2.5, 6);
    expect(sec.y).toBeCloseTo(-2.5, 6);
  });

  it('does NOT push undo across many live calls', () => {
    const sid = useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    const undoDepthBefore = useRoofStore.getState().undoStack.length;
    for (let i = 0; i < 10; i++) {
      useRoofStore.getState().rotateSectionLive(sid, i * 5, {
        rotation: 0, polygon: null, center: [5, 2.5],
      });
    }
    expect(useRoofStore.getState().undoStack.length).toBe(undoDepthBefore);
  });

  it('no-ops on locked sections', () => {
    const sid = useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    useRoofStore.getState().updateSection(sid, { locked: true, rotation: 0 });
    useRoofStore.getState().rotateSectionLive(sid, 90, {
      rotation: 0, polygon: null, center: [5, 2.5],
    });
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(0);
  });
});

describe('rotateSectionByDelta (one-shot with undo)', () => {
  it('rect: accumulates rotation from current value', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, rotation: 30,
    });
    useRoofStore.getState().rotateSectionByDelta(sid, 15);
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(45);
    useRoofStore.getState().rotateSectionByDelta(sid, -20);
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(25);
  });

  it('polygon: rotates around current centroid by delta', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
    });
    useRoofStore.getState().rotateSectionByDelta(sid, 90);
    const sec = useRoofStore.getState().sections[sid]!;
    // Centroid of unit square at (5, 5). After 90\u00b0 CCW rotation:
    //   (0,0) \u2192 (10, 0) ... etc. (cycle vertices).
    // The bbox stays 10x10 (symmetric rotation of a square).
    expect(sec.length).toBeCloseTo(10, 6);
    expect(sec.run).toBeCloseTo(10, 6);
  });

  it('each press pushes ONE undo entry', () => {
    const sid = useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    const undoDepthBefore = useRoofStore.getState().undoStack.length;
    useRoofStore.getState().rotateSectionByDelta(sid, 15);
    useRoofStore.getState().rotateSectionByDelta(sid, 15);
    useRoofStore.getState().rotateSectionByDelta(sid, 15);
    expect(useRoofStore.getState().undoStack.length).toBe(undoDepthBefore + 3);
  });

  it('undo rolls back ONE rotation step', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, rotation: 0,
    });
    useRoofStore.getState().rotateSectionByDelta(sid, 45);
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(45);
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(0);
  });

  it('no-ops on locked sections', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, rotation: 0,
    });
    useRoofStore.getState().updateSection(sid, { locked: true });
    useRoofStore.getState().rotateSectionByDelta(sid, 45);
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(0);
  });
});

// ── Phase 14.R.18 polygon vertex editing ───────────────────────

// ── Phase 14.R.23 updateSectionLive ─────────────────────────────

describe('updateSectionLive (no-undo partial patch)', () => {
  it('applies a partial patch to the section', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    useRoofStore.getState().updateSectionLive(sid, {
      roofAxisOverrideDeg: 37,
    });
    expect(useRoofStore.getState().sections[sid]!.roofAxisOverrideDeg).toBe(37);
  });

  it('does NOT push an undo entry across many live calls', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    const undoDepthBefore = useRoofStore.getState().undoStack.length;
    for (let i = 0; i < 20; i++) {
      useRoofStore.getState().updateSectionLive(sid, {
        roofAxisOverrideDeg: i * 3,
      });
    }
    expect(useRoofStore.getState().undoStack.length).toBe(undoDepthBefore);
  });

  it('no-ops for missing section', () => {
    expect(() =>
      useRoofStore.getState().updateSectionLive('NOT-REAL', { rotation: 45 }),
    ).not.toThrow();
  });

  it('no-ops for locked sections', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, rotation: 0,
    });
    useRoofStore.getState().updateSection(sid, { locked: true });
    useRoofStore.getState().updateSectionLive(sid, { rotation: 90 });
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(0);
  });

  it('supports clearing an override by patching undefined', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    useRoofStore.getState().updateSectionLive(sid, { roofAxisOverrideDeg: 45 });
    useRoofStore.getState().updateSectionLive(sid, { roofAxisOverrideDeg: undefined });
    expect(useRoofStore.getState().sections[sid]!.roofAxisOverrideDeg).toBeUndefined();
  });

  it('pushUndoSnapshot + live updates roundtrip via Ctrl+Z', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    const snap = useRoofStore.getState().serialize();
    // Simulated axis drag: set override, then a few more live updates.
    useRoofStore.getState().updateSectionLive(sid, { roofAxisOverrideDeg: 10 });
    useRoofStore.getState().updateSectionLive(sid, { roofAxisOverrideDeg: 20 });
    useRoofStore.getState().updateSectionLive(sid, { roofAxisOverrideDeg: 45 });
    useRoofStore.getState().pushUndoSnapshot(snap);
    useRoofStore.getState().undo();
    // Should be rolled back to pre-drag state (no override).
    expect(useRoofStore.getState().sections[sid]!.roofAxisOverrideDeg).toBeUndefined();
  });
});

describe('updatePolygonVertexLive', () => {
  it('mutates the target vertex + recomputes bbox-derived rect fields', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    useRoofStore.getState().updatePolygonVertexLive(sid, 2, [12, 7]);
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.polygon).toEqual([[0, 0], [10, 0], [12, 7], [0, 5]]);
    // Bbox: minX=0, maxX=12, minY=0, maxY=7 \u2192 x=0, y=0, L=12, run=7.
    expect(sec.x).toBe(0);
    expect(sec.y).toBe(0);
    expect(sec.length).toBe(12);
    expect(sec.run).toBe(7);
  });

  it('does NOT push an undo entry (drag sessions commit just one at the end)', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const undoDepthBefore = useRoofStore.getState().undoStack.length;
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [-2, -2]);
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [-3, -3]);
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [-4, -4]);
    expect(useRoofStore.getState().undoStack.length).toBe(undoDepthBefore);
  });

  it('no-ops for non-existent section', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const before = useRoofStore.getState().sections[sid]!.polygon;
    useRoofStore.getState().updatePolygonVertexLive('NOT-A-REAL-ID', 0, [99, 99]);
    expect(useRoofStore.getState().sections[sid]!.polygon).toEqual(before);
  });

  it('no-ops for a rect-only (no polygon) section', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
    });
    const before = useRoofStore.getState().sections[sid]!;
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [99, 99]);
    const after = useRoofStore.getState().sections[sid]!;
    // x/y/length/run unchanged, polygon still undefined.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.length).toBe(before.length);
    expect(after.run).toBe(before.run);
    expect(after.polygon).toBeUndefined();
  });

  it('no-ops for a locked section', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    useRoofStore.getState().updateSection(sid, { locked: true });
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [99, 99]);
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.polygon![0]).toEqual([0, 0]); // unchanged
  });

  it('no-ops for out-of-bounds vertex index', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const before = useRoofStore.getState().sections[sid]!.polygon;
    useRoofStore.getState().updatePolygonVertexLive(sid, 10, [99, 99]);
    useRoofStore.getState().updatePolygonVertexLive(sid, -1, [99, 99]);
    expect(useRoofStore.getState().sections[sid]!.polygon).toEqual(before);
  });

  it('clones the polygon (source array not mutated)', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const sec = useRoofStore.getState().sections[sid]!;
    const beforePolygon = sec.polygon!;
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [5, 5]);
    const afterPolygon = useRoofStore.getState().sections[sid]!.polygon!;
    // New array reference (not mutated in place).
    expect(afterPolygon).not.toBe(beforePolygon);
    // Old array vertex 0 untouched.
    expect(beforePolygon[0]).toEqual([0, 0]);
  });
});

describe('pushUndoSnapshot', () => {
  it('pushes the captured snapshot onto the undo stack + clears redo', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const snap = useRoofStore.getState().serialize();
    // Do something AFTER capturing the snapshot.
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [99, 99]);
    // Push the snapshot \u2014 one undo entry representing the pre-edit state.
    const undoDepthBefore = useRoofStore.getState().undoStack.length;
    useRoofStore.getState().pushUndoSnapshot(snap);
    const undoDepthAfter = useRoofStore.getState().undoStack.length;
    expect(undoDepthAfter).toBe(undoDepthBefore + 1);
    // Redo cleared.
    expect(useRoofStore.getState().redoStack).toEqual([]);
  });

  it('undo after pushUndoSnapshot rolls back to the snapshot\u2019s state', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    const snap = useRoofStore.getState().serialize();
    // Simulated drag: 3 live updates.
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [1, 1]);
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [2, 2]);
    useRoofStore.getState().updatePolygonVertexLive(sid, 0, [3, 3]);
    // Commit at drag end.
    useRoofStore.getState().pushUndoSnapshot(snap);
    // Ctrl+Z should roll ALL three updates back in one step.
    useRoofStore.getState().undo();
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.polygon![0]).toEqual([0, 0]);
  });
});

// ── Phase 14.R.9 polygon section ───────────────────────────────

describe('addSection with polygon', () => {
  it('stores the polygon field on the section', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
    });
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.polygon).toEqual([[0, 0], [20, 0], [20, 10], [0, 10]]);
  });

  it('passes roofType through for polygon sections (R.11)', () => {
    // R.9 behavior: forced to 'flat'. R.11 behavior: passes through so
    // polygon+hip (convex) can render as a centroid pyramid. Renderer
    // + aggregator gracefully degrade unsupported combos to flat.
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      roofType: 'hip',
      polygon: [[0, 0], [10, 0], [5, 8]],
    });
    expect(useRoofStore.getState().sections[sid]!.roofType).toBe('hip');
  });

  it('defaults roofType to gable when omitted', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    // Same default as the rect path — no polygon-specific override.
    expect(useRoofStore.getState().sections[sid]!.roofType).toBe('gable');
  });

  it('auto-derives x/y/length/run from the bbox', () => {
    const sid = useRoofStore.getState().addSection({
      x: 999, y: 999, // deliberately wrong — should be overridden
      polygon: [[-3, -1], [5, -1], [5, 4], [-3, 4]],
    });
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.x).toBe(-3);
    expect(sec.y).toBe(-1);
    expect(sec.length).toBe(8);
    expect(sec.run).toBe(5);
  });

  it('forces rotation to 0 (polygon carries absolute coords)', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0,
      rotation: 45,
      polygon: [[0, 0], [10, 0], [10, 5], [0, 5]],
    });
    expect(useRoofStore.getState().sections[sid]!.rotation).toBe(0);
  });

  it('ignores polygons with fewer than 3 vertices (rect fallback)', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5,
      roofType: 'gable',
      polygon: [[0, 0], [1, 1]] as any,
    });
    const sec = useRoofStore.getState().sections[sid]!;
    expect(sec.polygon).toBeUndefined();
    expect(sec.roofType).toBe('gable'); // not forced to flat
  });

  it('clones the polygon (caller mutations do not leak in)', () => {
    const src: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const sid = useRoofStore.getState().addSection({ x: 0, y: 0, polygon: src });
    src[0] = [999, 999];
    const stored = useRoofStore.getState().sections[sid]!.polygon;
    expect(stored?.[0]).toEqual([0, 0]);
  });

  it('is undo-able — undo rolls back the polygon add', () => {
    const initialCount = useRoofStore.getState().sectionOrder.length;
    useRoofStore.getState().addSection({
      x: 0, y: 0,
      polygon: [[0, 0], [10, 0], [5, 8]],
    });
    expect(useRoofStore.getState().sectionOrder.length).toBe(initialCount + 1);
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sectionOrder.length).toBe(initialCount);
  });
});

// ── PDF underlay ───────────────────────────────────────────────

describe('PDF underlay', () => {
  it('setPdf records path + page', () => {
    useRoofStore.getState().setPdf('/blueprints/home.pdf', 2);
    expect(useRoofStore.getState().pdf.pdfPath).toBe('/blueprints/home.pdf');
    expect(useRoofStore.getState().pdf.page).toBe(2);
  });

  it('setPdfOpacity clamps', () => {
    useRoofStore.getState().setPdfOpacity(2);
    expect(useRoofStore.getState().pdf.opacity).toBe(1);
  });

  it('calibratePdfWith computes scale from pixel distance + real feet', () => {
    useRoofStore.getState().calibratePdfWith(0, 0, 100, 0, 10);
    expect(useRoofStore.getState().pdf.scale).toBe(10);
  });

  // ── Phase 14.R.5 ─────────────────────────────────────────────

  it('loadPdfImage captures the image + pixel dims + fileName', () => {
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,abc',
      widthPx: 1700,
      heightPx: 2200,
      fileName: 'plans.pdf',
      page: 3,
    });
    const p = useRoofStore.getState().pdf;
    expect(p.imageDataUrl).toBe('data:image/png;base64,abc');
    expect(p.widthPx).toBe(1700);
    expect(p.heightPx).toBe(2200);
    expect(p.fileName).toBe('plans.pdf');
    expect(p.page).toBe(3);
    expect(p.visible).toBe(true);
    expect(p.locked).toBe(false);
    expect(p.rotationDeg).toBe(0);
    expect(p.offsetX).toBe(0);
    expect(p.offsetY).toBe(0);
    expect(p.scale).toBeGreaterThan(0);
  });

  it('loadPdfImage seeds the filename into pdfPath when no path exists', () => {
    // Fresh load from a web file picker has no real filesystem path;
    // we mirror the filename into pdfPath so existing code (PDF
    // export paths, telemetry) has something meaningful to display.
    useRoofStore.getState().clearPdf();
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,xyz',
      widthPx: 100, heightPx: 200,
      fileName: 'roof.pdf',
    });
    expect(useRoofStore.getState().pdf.pdfPath).toBe('roof.pdf');
  });

  it('setPdfOffset updates both components', () => {
    useRoofStore.getState().setPdfOffset(5, -3);
    const p = useRoofStore.getState().pdf;
    expect(p.offsetX).toBe(5);
    expect(p.offsetY).toBe(-3);
  });

  it('setPdfRotation accepts any degrees', () => {
    useRoofStore.getState().setPdfRotation(45);
    expect(useRoofStore.getState().pdf.rotationDeg).toBe(45);
    useRoofStore.getState().setPdfRotation(-90);
    expect(useRoofStore.getState().pdf.rotationDeg).toBe(-90);
  });

  it('setPdfScale clamps positive', () => {
    useRoofStore.getState().setPdfScale(5);
    expect(useRoofStore.getState().pdf.scale).toBe(5);
    useRoofStore.getState().setPdfScale(-1);
    expect(useRoofStore.getState().pdf.scale).toBe(0.01);
    useRoofStore.getState().setPdfScale(0);
    expect(useRoofStore.getState().pdf.scale).toBe(0.01);
  });

  it('setPdfLocked toggles', () => {
    useRoofStore.getState().setPdfLocked(true);
    expect(useRoofStore.getState().pdf.locked).toBe(true);
    useRoofStore.getState().setPdfLocked(false);
    expect(useRoofStore.getState().pdf.locked).toBe(false);
  });

  it('updatePdf merges a partial patch', () => {
    useRoofStore.getState().updatePdf({ opacity: 0.45, offsetX: 7 });
    const p = useRoofStore.getState().pdf;
    expect(p.opacity).toBe(0.45);
    expect(p.offsetX).toBe(7);
  });

  it('calibratePdfFromWorld rescales based on world distance', () => {
    // Seed an image + scale so the helper has something to work on.
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,abc',
      widthPx: 1000, heightPx: 500,
      fileName: 'calib.pdf',
    });
    useRoofStore.getState().setPdfScale(10); // current: 10 px/ft
    // Two world points 5 ft apart under the current scale. The user
    // says they're actually 2 ft apart — so the scale should multiply
    // by 5/2 = 2.5x, giving 25 px/ft.
    useRoofStore.getState().calibratePdfFromWorld([0, 0], [5, 0], 2);
    expect(useRoofStore.getState().pdf.scale).toBeCloseTo(25, 6);
  });

  it('calibratePdfFromWorld leaves scale alone on degenerate inputs', () => {
    useRoofStore.getState().setPdfScale(12);
    // Coincident points → no-op.
    useRoofStore.getState().calibratePdfFromWorld([1, 1], [1, 1], 5);
    expect(useRoofStore.getState().pdf.scale).toBe(12);
    // Zero real distance → no-op.
    useRoofStore.getState().calibratePdfFromWorld([0, 0], [3, 4], 0);
    expect(useRoofStore.getState().pdf.scale).toBe(12);
  });

  it('calibratePdfFromWorld stamps the world anchors + distance', () => {
    useRoofStore.getState().calibratePdfFromWorld([2, 3], [5, 7], 10);
    const p = useRoofStore.getState().pdf;
    expect(p.calX1).toBe(2);
    expect(p.calY1).toBe(3);
    expect(p.calX2).toBe(5);
    expect(p.calY2).toBe(7);
    expect(p.calDistanceFt).toBe(10);
  });

  it('clearPdf resets to empty', () => {
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:x', widthPx: 1, heightPx: 1, fileName: 'x.pdf',
    });
    useRoofStore.getState().clearPdf();
    const p = useRoofStore.getState().pdf;
    expect(p.imageDataUrl).toBeUndefined();
    expect(p.fileName).toBeUndefined();
    expect(p.pdfPath).toBe('');
  });
});

// ── Undo / redo ────────────────────────────────────────────────

describe('undo / redo', () => {
  it('undo on empty stack returns false', () => {
    expect(useRoofStore.getState().undo()).toBe(false);
  });

  it('addSection → undo reverts to empty', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    expect(useRoofStore.getState().sections[id]).toBeDefined();
    const ok = useRoofStore.getState().undo();
    expect(ok).toBe(true);
    expect(useRoofStore.getState().sections[id]).toBeUndefined();
  });

  it('updateSection → undo reverts the patch', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().updateSection(id, { slope: 12 });
    expect(useRoofStore.getState().sections[id]!.slope).toBe(12);
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sections[id]!.slope).toBe(6); // original default
  });

  it('redo reapplies an undone change', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().updateSection(id, { slope: 8 });
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sections[id]!.slope).toBe(6);
    const ok = useRoofStore.getState().redo();
    expect(ok).toBe(true);
    expect(useRoofStore.getState().sections[id]!.slope).toBe(8);
  });

  it('a new mutation clears the redo stack', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().updateSection(id, { slope: 8 });
    useRoofStore.getState().undo();
    useRoofStore.getState().updateSection(id, { slope: 4 });
    // Redo should do nothing now — new mutation clobbered it.
    expect(useRoofStore.getState().redo()).toBe(false);
  });

  it('multiple undo steps walk back through history', () => {
    const s = useRoofStore.getState();
    const id1 = s.addSection({ x: 0, y: 0 });
    const id2 = s.addSection({ x: 10, y: 10 });
    expect(useRoofStore.getState().sectionOrder).toEqual([id1, id2]);
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sectionOrder).toEqual([id1]);
    useRoofStore.getState().undo();
    expect(useRoofStore.getState().sectionOrder).toEqual([]);
  });
});

// ── Persistence ────────────────────────────────────────────────

describe('serialize + loadSnapshot', () => {
  it('serialize returns a snapshot matching current state', () => {
    const id = useRoofStore.getState().addSection({ x: 5, y: 5, slope: 8 });
    const snap = useRoofStore.getState().serialize();
    expect(snap.sections[id]!.slope).toBe(8);
    expect(Object.keys(snap.sections)).toContain(id);
  });

  it('loadSnapshot replaces the store state', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0 });
    const saved = useRoofStore.getState().serialize();

    useRoofStore.getState().clear();
    expect(useRoofStore.getState().sectionOrder).toHaveLength(0);

    useRoofStore.getState().loadSnapshot(saved);
    expect(useRoofStore.getState().sectionOrder).toHaveLength(1);
  });

  it('loadSnapshot is undoable (snapshot pushed before apply)', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0 });
    const saved = useRoofStore.getState().serialize();
    useRoofStore.getState().clear();
    useRoofStore.getState().loadSnapshot(saved);
    const ok = useRoofStore.getState().undo();
    expect(ok).toBe(true);
    expect(useRoofStore.getState().sectionOrder).toHaveLength(0);
  });
});

// ── Derived selectors ──────────────────────────────────────────

describe('derived selectors', () => {
  it('selectSectionsArray respects insertion order', () => {
    const s = useRoofStore.getState();
    const a = s.addSection({ x: 0, y: 0, label: 'A' });
    const b = s.addSection({ x: 10, y: 10, label: 'B' });
    const arr = selectSectionsArray(useRoofStore.getState());
    expect(arr.map((x) => x.sectionId)).toEqual([a, b]);
  });

  it('totals match direct geometry helpers', () => {
    const s = useRoofStore.getState();
    const a = s.addSection({ x: 0, y: 0, length: 30, run: 20, slope: 6, overhang: 1 });
    const b = s.addSection({ x: 40, y: 0, length: 20, run: 15, slope: 4, overhang: 1 });
    const secA = useRoofStore.getState().sections[a]!;
    const secB = useRoofStore.getState().sections[b]!;
    const st = useRoofStore.getState();
    expect(selectTotalAreaPlan(st)).toBeCloseTo(areaPlan(secA) + areaPlan(secB), 5);
    expect(selectTotalAreaNet(st)).toBeCloseTo(areaActual(secA) + areaActual(secB), 5);
    expect(selectTotalPerimeter(st)).toBeCloseTo(
      perimeterPlan(secA) + perimeterPlan(secB), 5,
    );
  });
});

// ── Hit testing via sectionAt ──────────────────────────────────

describe('sectionAt (topmost-wins)', () => {
  it('returns id for point inside the only section', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 10 });
    expect(sectionAt(useRoofStore.getState(), 5, 5)).toBe(id);
  });

  it('returns null when no section contains the point', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 10 });
    expect(sectionAt(useRoofStore.getState(), 50, 50)).toBeNull();
  });

  it('later-added section wins on overlap (topmost)', () => {
    const a = useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 10, label: 'A' });
    const b = useRoofStore.getState().addSection({ x: 5, y: 5, length: 10, run: 10, label: 'B' });
    // (7, 7) is inside both; B added second → B wins.
    expect(sectionAt(useRoofStore.getState(), 7, 7)).toBe(b);
    expect(a).not.toBe(b);
  });
});

// ── clear ──────────────────────────────────────────────────────

describe('clear', () => {
  it('wipes sections/vertices/measures and resets PDF', () => {
    const s = useRoofStore.getState();
    s.addSection({ x: 0, y: 0 });
    s.addVertex(1, 1);
    s.addMeasure(0, 0, 5, 0);
    s.setPdf('/some.pdf');
    s.clear();
    const after = useRoofStore.getState();
    expect(after.sectionOrder).toHaveLength(0);
    expect(Object.keys(after.vertices)).toHaveLength(0);
    expect(Object.keys(after.measures)).toHaveLength(0);
    expect(after.pdf.pdfPath).toBe('');
  });

  it('clear is undoable', () => {
    const id = useRoofStore.getState().addSection({ x: 0, y: 0 });
    useRoofStore.getState().clear();
    expect(useRoofStore.getState().sections[id]).toBeUndefined();
    const ok = useRoofStore.getState().undo();
    expect(ok).toBe(true);
    expect(useRoofStore.getState().sections[id]).toBeDefined();
  });
});

// ── Phase 14.R.27 — penetration CRUD ────────────────────────────

describe('roofStore penetration CRUD', () => {
  it('addPenetration returns an ID and adds to penetrations + penetrationOrder', () => {
    const id = useRoofStore.getState().addPenetration({
      kind: 'skylight', x: 5, y: 7,
    });
    const s = useRoofStore.getState();
    expect(s.penetrations[id]).toBeDefined();
    expect(s.penetrationOrder).toEqual([id]);
    expect(s.penetrations[id]!.kind).toBe('skylight');
    expect(s.penetrations[id]!.x).toBe(5);
    expect(s.penetrations[id]!.y).toBe(7);
  });

  it('addPenetration seeds the kind-default footprint when no overrides', () => {
    const id = useRoofStore.getState().addPenetration({
      kind: 'chimney', x: 0, y: 0,
    });
    const pen = useRoofStore.getState().penetrations[id]!;
    expect(pen.widthFt).toBe(PENETRATION_DEFAULTS.chimney.widthFt);
    expect(pen.lengthFt).toBe(PENETRATION_DEFAULTS.chimney.lengthFt);
  });

  it('addPenetration honors width/length/label overrides', () => {
    const id = useRoofStore.getState().addPenetration({
      kind: 'skylight', x: 0, y: 0,
      widthFt: 4, lengthFt: 6, label: 'Master skylight',
    });
    const pen = useRoofStore.getState().penetrations[id]!;
    expect(pen.widthFt).toBe(4);
    expect(pen.lengthFt).toBe(6);
    expect(pen.label).toBe('Master skylight');
  });

  it('addPenetration auto-labels per kind ("Skylight 1", "Skylight 2")', () => {
    const a = useRoofStore.getState().addPenetration({ kind: 'skylight', x: 0, y: 0 });
    const b = useRoofStore.getState().addPenetration({ kind: 'skylight', x: 1, y: 1 });
    const c = useRoofStore.getState().addPenetration({ kind: 'chimney',  x: 2, y: 2 });
    const st = useRoofStore.getState();
    expect(st.penetrations[a]!.label).toBe('Skylight 1');
    expect(st.penetrations[b]!.label).toBe('Skylight 2');
    // Chimney count restarts per kind.
    expect(st.penetrations[c]!.label).toBe('Chimney 1');
  });

  it('updatePenetration mutates via partial patch', () => {
    const id = useRoofStore.getState().addPenetration({ kind: 'chimney', x: 0, y: 0 });
    useRoofStore.getState().updatePenetration(id, { x: 12, y: 14, label: 'Back chimney' });
    const pen = useRoofStore.getState().penetrations[id]!;
    expect(pen.x).toBe(12);
    expect(pen.y).toBe(14);
    expect(pen.label).toBe('Back chimney');
    // Untouched fields preserved.
    expect(pen.kind).toBe('chimney');
  });

  it('updatePenetrationLive mutates WITHOUT pushing an undo entry', () => {
    const id = useRoofStore.getState().addPenetration({ kind: 'skylight', x: 0, y: 0 });
    const undoLenBefore = useRoofStore.getState().undoStack.length;
    useRoofStore.getState().updatePenetrationLive(id, { x: 3, y: 4 });
    const st = useRoofStore.getState();
    expect(st.penetrations[id]!.x).toBe(3);
    // No new undo entry.
    expect(st.undoStack.length).toBe(undoLenBefore);
  });

  it('removePenetration drops from both map + order', () => {
    const a = useRoofStore.getState().addPenetration({ kind: 'skylight', x: 0, y: 0 });
    const b = useRoofStore.getState().addPenetration({ kind: 'chimney',  x: 1, y: 1 });
    useRoofStore.getState().removePenetration(a);
    const st = useRoofStore.getState();
    expect(st.penetrations[a]).toBeUndefined();
    expect(st.penetrations[b]).toBeDefined();
    expect(st.penetrationOrder).toEqual([b]);
  });

  it('addPenetration is undoable', () => {
    const id = useRoofStore.getState().addPenetration({ kind: 'plumbing_vent', x: 2, y: 3 });
    const ok = useRoofStore.getState().undo();
    expect(ok).toBe(true);
    const st = useRoofStore.getState();
    expect(st.penetrations[id]).toBeUndefined();
    expect(st.penetrationOrder).toEqual([]);
  });

  it('removePenetration is undoable', () => {
    const id = useRoofStore.getState().addPenetration({ kind: 'chimney', x: 4, y: 5 });
    useRoofStore.getState().removePenetration(id);
    const ok = useRoofStore.getState().undo();
    expect(ok).toBe(true);
    const st = useRoofStore.getState();
    expect(st.penetrations[id]).toBeDefined();
    expect(st.penetrationOrder).toEqual([id]);
  });

  it('selectPenetrationsArray returns in insertion order', () => {
    const a = useRoofStore.getState().addPenetration({ kind: 'skylight', x: 0, y: 0 });
    const b = useRoofStore.getState().addPenetration({ kind: 'chimney',  x: 1, y: 1 });
    const c = useRoofStore.getState().addPenetration({ kind: 'plumbing_vent', x: 2, y: 2 });
    const arr = selectPenetrationsArray(useRoofStore.getState());
    expect(arr.map((p) => p.id)).toEqual([a, b, c]);
  });

  it('clear wipes penetrations too', () => {
    useRoofStore.getState().addPenetration({ kind: 'skylight', x: 0, y: 0 });
    useRoofStore.getState().addPenetration({ kind: 'chimney',  x: 1, y: 1 });
    useRoofStore.getState().clear();
    const st = useRoofStore.getState();
    expect(Object.keys(st.penetrations)).toHaveLength(0);
    expect(st.penetrationOrder).toEqual([]);
  });

  it('serialize() round-trips penetrations', () => {
    const id = useRoofStore.getState().addPenetration({
      kind: 'skylight', x: 5, y: 10, widthFt: 2, lengthFt: 4, label: 'Kitchen',
    });
    const snap = useRoofStore.getState().serialize();
    expect(snap.penetrations).toBeDefined();
    expect(snap.penetrations![id]).toEqual({
      id,
      kind: 'skylight',
      x: 5,
      y: 10,
      widthFt: 2,
      lengthFt: 4,
      label: 'Kitchen',
    });
    expect(snap.penetrationOrder).toEqual([id]);
  });

  it('loadSnapshot restores penetrations', () => {
    const id = useRoofStore.getState().addPenetration({ kind: 'chimney', x: 1, y: 2 });
    const snap = useRoofStore.getState().serialize();
    // Mutate store out from under the snapshot
    useRoofStore.getState().clear();
    expect(useRoofStore.getState().penetrations[id]).toBeUndefined();
    // Restore
    useRoofStore.getState().loadSnapshot(snap);
    const st = useRoofStore.getState();
    expect(st.penetrations[id]).toBeDefined();
    expect(st.penetrationOrder).toEqual([id]);
  });

  it('loadSnapshot of a pre-R.27 snapshot (no penetrations field) gives empty state, no crash', () => {
    // Simulate an old-format snapshot: no penetrations / penetrationOrder keys.
    const legacySnap = {
      ...emptyRoofSnapshot(),
    };
    delete (legacySnap as { penetrations?: unknown }).penetrations;
    delete (legacySnap as { penetrationOrder?: unknown }).penetrationOrder;
    // Add a section so the snapshot isn't trivially empty
    legacySnap.sections = {
      'SEC-TEST': {
        sectionId: 'SEC-TEST',
        label: 'Test',
        x: 0, y: 0, length: 10, run: 5, rotation: 0,
        slope: 6, roofType: 'gable', sectionType: 'main_roof',
        overhang: 1, z: 0, wastePct: 15, colorIdx: 0, locked: false,
      },
    };
    useRoofStore.getState().loadSnapshot(legacySnap);
    const st = useRoofStore.getState();
    expect(Object.keys(st.penetrations)).toHaveLength(0);
    expect(st.penetrationOrder).toEqual([]);
    expect(Object.keys(st.sections)).toHaveLength(1);
  });
});
