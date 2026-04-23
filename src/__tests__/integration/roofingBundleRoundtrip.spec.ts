/**
 * Integration: roofing bundle save → clear → load roundtrip.
 *
 * ARCHITECTURE.md §4.4 — the "insurance" test that roofing state
 * survives a .elbow save/load. If the user draws a roof, commits
 * sections, tweaks the FL estimator form, places penetrations,
 * drags a section, calibrates a PDF, and then saves + reopens,
 * everything they put in their project MUST come back exactly.
 *
 * Coverage split:
 *
 *   1. `roofStore` + `roofingProjectStore` round-trip bit-equal —
 *      the two persistent roofing stores. Any new field added to
 *      either without a corresponding capture/apply update fails
 *      this spec.
 *
 *   2. PDF underlay image data round-trips when included; is
 *      correctly dropped when autosave passes `omitPdfImageData`.
 *
 *   3. Transient-by-design stores (`roofingCalibrationStore`,
 *      `roofingSectionDragStore`) are NOT serialized. The
 *      calibration DRAFT sequence and mid-drag anchors are
 *      deliberately out of scope; their persistent output
 *      (`roofStore.pdf.scale`, `sections[id].x/y`) is what
 *      actually lands in the bundle.
 *
 *   4. `roofingEstimateScopeStore` is a per-machine preference
 *      (localStorage), NOT part of the bundle — opening someone
 *      else's project should not flip the contractor's UI
 *      preference.
 *
 *   5. Mixed-domain round-trip: seeding both plumbing and
 *      roofing data in the same capture → neither side clobbers
 *      the other.
 *
 * If any of (1) or (5) fail, Bundle.ts is missing roofing state
 * and needs fixing (per ARCHITECTURE.md §4.4 "Rule").
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useRoofStore, selectSectionsArray, selectPenetrationsArray } from '@store/roofStore';
import {
  useRoofingProjectStore,
  __testables as projectTestables,
} from '@store/roofingProjectStore';
import { useRoofingCalibrationStore } from '@store/roofingCalibrationStore';
import { useRoofingSectionDragStore } from '@store/roofingSectionDragStore';
import {
  useRoofingEstimateScopeStore,
  __testables as scopeTestables,
} from '@store/roofingEstimateScopeStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  captureBundle,
  captureBundleSerialized,
  applyBundle,
  parseBundle,
} from '@core/bundle/Bundle';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

// ── Helpers ───────────────────────────────────────────────────

/** Wipe everything this spec touches back to a predictable baseline. */
function resetAll() {
  useRoofStore.setState({
    sections: {},
    sectionOrder: [],
    vertices: {},
    measures: {},
    layers: emptyRoofSnapshot().layers.map((l) => ({ ...l })),
    pdf: emptyRoofSnapshot().pdf,
    selectedSectionId: null,
    penetrations: {},
    penetrationOrder: [],
    undoStack: [],
    redoStack: [],
    batchDepth: 0,
    dirtyDuringBatch: false,
  });

  useRoofingProjectStore.getState().set({ ...projectTestables.DEFAULTS });

  useRoofingCalibrationStore.setState({
    mode: 'idle',
    firstPoint: null,
    secondPoint: null,
  });

  useRoofingSectionDragStore.setState({
    mode: 'idle',
    sectionId: null,
    pointerStart: null,
    sectionStart: null,
  });

  useRoofingEstimateScopeStore.setState({ scope: 'all' });

  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });

  try {
    localStorage.removeItem(projectTestables.STORAGE_KEY);
    localStorage.removeItem(scopeTestables.STORAGE_KEY);
  } catch { /* ignore */ }
}

/** Build a "realistic" seed scene — mixed rect + polygon section,
 *  custom PDF pose, a handful of penetrations, bespoke project
 *  input. Everything deliberately differs from defaults so a
 *  missing-field regression would show up as a diff. */
function seedRichRoofingScene() {
  const sid1 = useRoofStore.getState().addSection({
    x: 5, y: 10, length: 30, run: 20, slope: 6, roofType: 'hip',
    sectionType: 'main_roof', overhang: 1.5, z: 0, label: 'Main',
  });
  const sid2 = useRoofStore.getState().addSection({
    x: 40, y: 10, length: 12, run: 8, slope: 4, roofType: 'gable',
    sectionType: 'garage', overhang: 1, z: 0, label: 'Garage',
  });

  // Mutate the PDF underlay as if the user had loaded one and calibrated.
  useRoofStore.setState((s) => ({
    pdf: {
      ...s.pdf,
      pdfPath: 'blueprint.pdf',
      page: 2,
      calX1: 100, calY1: 50, calX2: 800, calY2: 50, calDistanceFt: 40,
      offsetX: 3.25, offsetY: -1.5,
      scale: 17.5,
      opacity: 0.45,
      visible: true,
      locked: false,
      imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAA',
      widthPx: 1200, heightPx: 800,
      fileName: 'blueprint.pdf',
      rotationDeg: 15,
    },
  }));

  // Spatial penetrations.
  const pid1 = useRoofStore.getState().addPenetration({
    kind: 'chimney', x: 15, y: 15, label: 'Fireplace chimney',
  });
  const pid2 = useRoofStore.getState().addPenetration({
    kind: 'skylight', x: 25, y: 18, widthFt: 3, lengthFt: 5, label: 'Master suite',
  });
  const pid3 = useRoofStore.getState().addPenetration({
    kind: 'plumbing_vent', x: 42, y: 12,
  });

  // FL estimator form — tweak enough fields to prove the whole
  // RoofingProjectInput round-trips.
  useRoofingProjectStore.getState().update({
    county: 'Miami-Dade',
    length_ft: 42,
    width_ft: 28,
    mean_height_ft: 12,
    slope_pitch: '6:12',
    roof_type: 'hip',
    complexity: 'complex',
    system: 'concrete_tile',
    install_method: 'mortar_set',
    risk_category: 2,
    distance_to_saltwater_ft: 400,
    skylight_count: 2,
    chimney_count: 1,
    plumbing_vent_count: 3,
    customer_name: 'Rodriguez Residence',
    address: '1200 Ocean Dr, Miami Beach FL',
    job_type: 'new_roof',
    product_family: 'Eagle Malibu',
  });

  return { sid1, sid2, pid1, pid2, pid3 };
}

// ── Tests ─────────────────────────────────────────────────────

beforeEach(() => {
  resetAll();
});

describe('roofing bundle roundtrip — persistent stores (ARCHITECTURE.md §4.4)', () => {
  it('roofStore + roofingProjectStore survive capture → wipe → apply bit-equal', () => {
    const seed = seedRichRoofingScene();

    // Take a structural snapshot of the persistent roofing state
    // BEFORE capture so we can diff after the roundtrip.
    const roofBefore = useRoofStore.getState().serialize();
    const projectBefore = { ...useRoofingProjectStore.getState().input };

    const bundle = captureBundle();
    // Bundle MUST carry the roof slice.
    expect(bundle.data.roof).toBeDefined();
    expect(bundle.data.roof?.graph).toBeDefined();
    expect(bundle.data.roof?.projectInput).toBeDefined();

    // Wipe all stores.
    resetAll();
    expect(selectSectionsArray(useRoofStore.getState())).toHaveLength(0);
    expect(selectPenetrationsArray(useRoofStore.getState())).toHaveLength(0);
    expect(useRoofingProjectStore.getState().input.county).not.toBe('Miami-Dade');

    // Restore.
    const result = applyBundle(bundle);
    expect(result.ok).toBe(true);

    const roofAfter = useRoofStore.getState().serialize();
    const projectAfter = { ...useRoofingProjectStore.getState().input };

    // Ignore non-content store bits (selectedSectionId, undo stacks,
    // batch counters) — the roof GRAPH snapshot shape is the
    // user-facing "everything I drew" concept.
    expect(roofAfter.sections).toEqual(roofBefore.sections);
    expect(roofAfter.vertices).toEqual(roofBefore.vertices);
    expect(roofAfter.measures).toEqual(roofBefore.measures);
    expect(roofAfter.layers).toEqual(roofBefore.layers);
    expect(roofAfter.pdf).toEqual(roofBefore.pdf);
    expect(roofAfter.penetrations).toEqual(roofBefore.penetrations);
    expect(roofAfter.penetrationOrder).toEqual(roofBefore.penetrationOrder);
    expect(projectAfter).toEqual(projectBefore);

    // Sanity: every seeded ID still present.
    const st = useRoofStore.getState();
    expect(st.sections[seed.sid1]).toBeDefined();
    expect(st.sections[seed.sid2]).toBeDefined();
    expect(st.penetrations[seed.pid1]).toBeDefined();
    expect(st.penetrations[seed.pid2]).toBeDefined();
    expect(st.penetrations[seed.pid3]).toBeDefined();
  });

  it('JSON text roundtrip (capture → serialize → parse → apply) preserves roofing content', () => {
    seedRichRoofingScene();
    const roofBefore = useRoofStore.getState().serialize();
    const projectBefore = { ...useRoofingProjectStore.getState().input };

    const jsonA = captureBundleSerialized();
    resetAll();
    const parsed = parseBundle(jsonA);
    applyBundle(parsed);

    const roofAfter = useRoofStore.getState().serialize();
    const projectAfter = { ...useRoofingProjectStore.getState().input };

    expect(roofAfter.sections).toEqual(roofBefore.sections);
    expect(roofAfter.penetrations).toEqual(roofBefore.penetrations);
    expect(roofAfter.pdf).toEqual(roofBefore.pdf);
    expect(projectAfter).toEqual(projectBefore);
  });
});

describe('roofing bundle roundtrip — PDF image data flag (ARCHITECTURE.md §4.4)', () => {
  it('default capture preserves the PDF image data URL', () => {
    seedRichRoofingScene();
    const json = captureBundleSerialized();
    resetAll();
    applyBundle(parseBundle(json));
    expect(useRoofStore.getState().pdf.imageDataUrl).toMatch(/^data:image\/png/);
  });

  it('autosave path (omitPdfImageData: true) strips imageDataUrl but keeps calibration metadata', () => {
    seedRichRoofingScene();
    const json = captureBundleSerialized({ omitPdfImageData: true });
    resetAll();
    applyBundle(parseBundle(json));

    const pdf = useRoofStore.getState().pdf;
    // Raw image bytes are gone.
    expect(pdf.imageDataUrl).toBeUndefined();
    // Everything else useful for "reattach this blueprint" is preserved.
    expect(pdf.pdfPath).toBe('blueprint.pdf');
    expect(pdf.fileName).toBe('blueprint.pdf');
    expect(pdf.scale).toBe(17.5);
    expect(pdf.offsetX).toBe(3.25);
    expect(pdf.rotationDeg).toBe(15);
    expect(pdf.calDistanceFt).toBe(40);
  });
});

describe('roofing bundle roundtrip — transient stores are out of scope', () => {
  // These stores hold draft / in-progress interaction state by
  // design. Their docstrings flag them as NOT persisted. The
  // bundle deliberately omits them so opening a file never
  // resumes a stranger's mid-drag or calibrate-click sequence.
  //
  // What IS persisted (the calibration RESULT, the section's
  // final x/y after a drag) lives in `roofStore` — which is
  // tested above.

  it('roofingCalibrationStore draft state is NOT serialized by the bundle', () => {
    // Put the calibrate-sequence into a mid-flight state.
    useRoofingCalibrationStore.setState({
      mode: 'calibrate-2',
      firstPoint: [5, 10],
      secondPoint: null,
    });
    seedRichRoofingScene();

    const bundle = captureBundle();
    // The captured bundle's shape has no slot for the calib store;
    // this asserts intent, not just absence.
    const roofSlice = bundle.data.roof;
    expect(roofSlice).toBeDefined();
    expect(roofSlice && 'pdfCalib' in roofSlice).toBe(false);

    // Applying a bundle does not touch the calib store — its
    // draft state remains whatever the local UI had. That's the
    // correct default: a file open shouldn't jump the user into
    // someone else's half-finished calibration.
    const calibBefore = useRoofingCalibrationStore.getState();
    applyBundle(bundle);
    const calibAfter = useRoofingCalibrationStore.getState();
    expect(calibAfter.mode).toBe(calibBefore.mode);
    expect(calibAfter.firstPoint).toEqual(calibBefore.firstPoint);
  });

  it('roofingSectionDragStore in-progress session is NOT serialized', () => {
    // Simulate a user mid-drag.
    useRoofingSectionDragStore.setState({
      mode: 'dragging',
      sectionId: 'SEC-TEST',
      pointerStart: [10, 10],
      sectionStart: [5, 5],
    });
    seedRichRoofingScene();

    const bundle = captureBundle();
    const roofSlice = bundle.data.roof;
    expect(roofSlice && 'sectionDrag' in roofSlice).toBe(false);

    const dragBefore = useRoofingSectionDragStore.getState();
    applyBundle(bundle);
    const dragAfter = useRoofingSectionDragStore.getState();
    expect(dragAfter).toEqual(dragBefore);
  });
});

describe('roofing bundle roundtrip — per-machine preference stays local', () => {
  // The contractor's "show all vs selected" preference is a
  // local-machine setting, not a project setting. Opening a
  // file someone else saved must not flip it.

  it('roofingEstimateScopeStore value is NOT overwritten by applyBundle', () => {
    useRoofingEstimateScopeStore.getState().setScope('all');
    seedRichRoofingScene();
    const bundle = captureBundle();

    // Local preference flips BEFORE apply.
    useRoofingEstimateScopeStore.getState().setScope('selected');
    applyBundle(bundle);
    expect(useRoofingEstimateScopeStore.getState().scope).toBe('selected');
  });
});

describe('roofing bundle roundtrip — mixed-domain (plumbing + roofing)', () => {
  it('seeding BOTH domains and roundtripping preserves everything', () => {
    // Plumbing seed.
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1', points: [[0, 0, 0], [5, 0, 0]], diameter: 3,
          material: 'pvc_sch40', system: 'waste', color: '#ef5350',
          visible: true, selected: false,
        },
        p2: {
          id: 'p2', points: [[5, 0, 0], [5, 0, 5]], diameter: 2,
          material: 'pvc_sch40', system: 'vent', color: '#78909c',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['p1', 'p2'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1', subtype: 'water_closet', position: [0, 0, 0],
          params: { model: 'standard' }, createdTs: 1, connectedPipeIds: ['p1'],
        },
      },
      selectedFixtureId: null,
    });

    // Roofing seed.
    const seed = seedRichRoofingScene();

    const pipesBefore = { ...usePipeStore.getState().pipes };
    const fixturesBefore = { ...useFixtureStore.getState().fixtures };
    const roofBefore = useRoofStore.getState().serialize();
    const projectBefore = { ...useRoofingProjectStore.getState().input };

    const bundle = captureBundle();
    resetAll();

    // Confirm wipe.
    expect(Object.keys(usePipeStore.getState().pipes)).toHaveLength(0);
    expect(Object.keys(useFixtureStore.getState().fixtures)).toHaveLength(0);
    expect(selectSectionsArray(useRoofStore.getState())).toHaveLength(0);

    const result = applyBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.counts.pipes).toBe(2);
    expect(result.counts.fixtures).toBe(1);

    // Plumbing survives.
    expect(usePipeStore.getState().pipes).toEqual(pipesBefore);
    expect(useFixtureStore.getState().fixtures).toEqual(fixturesBefore);

    // Roofing survives.
    const roofAfter = useRoofStore.getState().serialize();
    expect(roofAfter.sections).toEqual(roofBefore.sections);
    expect(roofAfter.penetrations).toEqual(roofBefore.penetrations);
    expect(roofAfter.pdf).toEqual(roofBefore.pdf);
    expect({ ...useRoofingProjectStore.getState().input }).toEqual(projectBefore);
    expect(useRoofStore.getState().sections[seed.sid1]).toBeDefined();
    expect(useRoofStore.getState().penetrations[seed.pid2]).toBeDefined();
  });
});
