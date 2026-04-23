/**
 * Bundle — Phase 11.A + 11.B tests.
 *
 * Covers:
 *   • captureBundle roundtrip: capture → serialize → parse → apply
 *   • migrate rejects unknown / future versions
 *   • migrate + validateV1 catch malformed payloads with helpful errors
 *   • applyBundle wipes selection + draw sessions + undo stacks
 *   • suggestFilename produces a safe filename under 128 chars
 *   • deepClone handles nested structures (no reference leaks)
 *   • Phase 11.B: active non-default customer populates bundle.project
 *   • Phase 11.B: 'default' customer id is NOT captured
 *   • Phase 11.B: migrateV1ToV2 strips nothing, adds nothing, bumps version
 *   • Phase 11.B: applyBundle activates a known customer, surfaces unknown
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureBundle,
  captureBundleSerialized,
  applyBundle,
  migrateBundle,
  migrateV1ToV2,
  migrateV2ToV3,
  serializeBundle,
  parseBundle,
  CURRENT_BUNDLE_VERSION,
  __testables,
  type Bundle,
  type BundleV1,
  type BundleV2,
} from '../Bundle';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useWallStore } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useCustomerStore } from '@store/customerStore';
import { useRoofStore } from '@store/roofStore';
import { useRoofingProjectStore } from '@store/roofingProjectStore';

beforeEach(() => {
  // Reset all persisted stores to empty.
  usePipeStore.setState({
    pipes: {},
    pipeOrder: [],
    selectedId: null,
    undoStack: [],
    redoStack: [],
    pivotSession: null,
  });
  useFixtureStore.setState({
    fixtures: {},
    selectedFixtureId: null,
  });
  useWallStore.setState({
    walls: {},
    selectedWallId: null,
    drawSession: null,
  });
  useMeasureStore.setState({
    measurements: {},
    pendingStart: null,
    previewEnd: null,
    pendingScalePair: null,
  });
  // Reset to just the default customer. Tests that need other customers
  // seed them explicitly.
  const defaultProfile = useCustomerStore.getState().profiles['default'];
  useCustomerStore.setState({
    profiles: defaultProfile ? { default: defaultProfile } : {},
    activeCustomerId: 'default',
  });
});

// ── captureBundle ──────────────────────────────────────────────

describe('captureBundle', () => {
  it('produces an empty v1 bundle when stores are empty', () => {
    const b = captureBundle();
    expect(b.version).toBe(CURRENT_BUNDLE_VERSION);
    expect(b.data.pipes).toEqual([]);
    expect(b.data.fixtures).toEqual([]);
    expect(b.data.walls).toEqual([]);
    expect(b.data.measurements).toEqual([]);
  });

  it('captures pipes + fixtures that have been seeded into the stores', () => {
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1',
          points: [[0, 0, 0], [5, 0, 0]],
          diameter: 2,
          material: 'pvc_sch40',
          system: 'waste',
          color: '#ffa726',
          visible: true,
          selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null,
      undoStack: [],
      redoStack: [],
      pivotSession: null,
    });
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1',
          subtype: 'water_closet',
          position: [1, 0, 1],
          params: { model: 'standard' },
          createdTs: 0,
          connectedPipeIds: [],
        },
      },
      selectedFixtureId: null,
    });
    const b = captureBundle();
    expect(b.data.pipes).toHaveLength(1);
    expect(b.data.pipes[0]!.id).toBe('p1');
    expect(b.data.fixtures).toHaveLength(1);
    expect(b.data.fixtures[0]!.id).toBe('f1');
  });

  it('deep-clones the captured payload (mutating live state does not affect the bundle)', () => {
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1',
          points: [[0, 0, 0], [5, 0, 0]],
          diameter: 2,
          material: 'pvc_sch40',
          system: 'waste',
          color: '#ffa726',
          visible: true,
          selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null,
      undoStack: [],
      redoStack: [],
      pivotSession: null,
    });
    const b = captureBundle();
    // Mutate live state after capture.
    usePipeStore.getState().removePipe('p1');
    // Bundle still has the pipe.
    expect(b.data.pipes[0]!.id).toBe('p1');
  });

  it('honors explicit name + createdAt + appVersion', () => {
    const b = captureBundle({ name: 'Test Project', createdAt: 1000, appVersion: '9.9.9' });
    expect(b.meta.name).toBe('Test Project');
    expect(b.meta.createdAt).toBe(1000);
    expect(b.meta.appVersion).toBe('9.9.9');
  });
});

// ── Roundtrip ──────────────────────────────────────────────────

describe('roundtrip', () => {
  it('capture → serialize → parse → apply recreates the same state', () => {
    // Seed state.
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1', points: [[0, 0, 0], [5, 0, 0]], diameter: 2,
          material: 'pvc_sch40', system: 'waste', color: '#ffa726',
          visible: true, selected: false,
        },
        p2: {
          id: 'p2', points: [[5, 0, 0], [5, 0, 5]], diameter: 3,
          material: 'copper', system: 'cold_supply', color: '#ef5350',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['p1', 'p2'],
      selectedId: null,
      undoStack: [],
      redoStack: [],
      pivotSession: null,
    });

    // Capture, serialize, reset, parse, apply.
    const b1 = captureBundle();
    const raw = serializeBundle(b1);
    // Wipe state.
    usePipeStore.setState({ pipes: {}, pipeOrder: [], selectedId: null, undoStack: [], redoStack: [], pivotSession: null });
    expect(Object.keys(usePipeStore.getState().pipes)).toHaveLength(0);

    const b2 = parseBundle(raw);
    applyBundle(b2);

    const restored = usePipeStore.getState();
    expect(Object.keys(restored.pipes)).toHaveLength(2);
    expect(restored.pipes['p1']!.diameter).toBe(2);
    expect(restored.pipes['p2']!.material).toBe('copper');
    expect(restored.pipeOrder).toEqual(['p1', 'p2']);
  });
});

// ── applyBundle ─────────────────────────────────────────────────

describe('applyBundle', () => {
  it('clears selection + undo stacks when applied', () => {
    // Pre-populate with "dirty" ephemeral state.
    usePipeStore.setState({
      pipes: {},
      pipeOrder: [],
      selectedId: 'ghost-id',
      undoStack: [{ type: 'add', pipe: {} as any }],
      redoStack: [{ type: 'remove', pipe: {} as any }],
      pivotSession: null,
    });

    const bundle: Bundle = {
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    applyBundle(bundle);

    const s = usePipeStore.getState();
    expect(s.selectedId).toBeNull();
    expect(s.undoStack).toEqual([]);
    expect(s.redoStack).toEqual([]);
  });

  it('returns counts matching the bundle contents', () => {
    const bundle: Bundle = {
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: {
        pipes: [
          { id: 'a', points: [], diameter: 2, material: 'pvc_sch40',
            system: 'waste', color: '#ffa726', visible: true, selected: false },
        ],
        fixtures: [
          { id: 'f1', subtype: 'water_closet', position: [0, 0, 0], params: {}, createdTs: 0, connectedPipeIds: [] },
          { id: 'f2', subtype: 'lavatory',    position: [1, 0, 1], params: {}, createdTs: 0, connectedPipeIds: [] },
        ],
        walls: [],
        measurements: [],
      },
    };
    const r = applyBundle(bundle);
    expect(r.ok).toBe(true);
    expect(r.counts.pipes).toBe(1);
    expect(r.counts.fixtures).toBe(2);
    expect(r.migrated).toBe(false);
  });

  it('applying a v1 bundle sets migrated=true and still lands the content', () => {
    const v1: BundleV1 = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: {
        pipes: [{ id: 'p-legacy', points: [], diameter: 2, material: 'pvc_sch40',
          system: 'waste', color: '#ffa726', visible: true, selected: false }],
        fixtures: [], walls: [], measurements: [],
      },
    };
    const r = applyBundle(v1);
    expect(r.migrated).toBe(true);
    expect(r.counts.pipes).toBe(1);
    expect(usePipeStore.getState().pipes['p-legacy']).toBeDefined();
  });
});

// ── migrateBundle ──────────────────────────────────────────────

describe('migrateBundle', () => {
  it('accepts a well-formed v1 bundle', () => {
    const b: BundleV1 = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    expect(() => migrateBundle(b)).not.toThrow();
  });

  it('migrates v1 → CURRENT_BUNDLE_VERSION through the full chain', () => {
    const b: BundleV1 = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const out = migrateBundle(b);
    // R.26 bumped the chain to v3; a v1 input walks v1→v2→v3.
    expect(out.version).toBe(CURRENT_BUNDLE_VERSION);
    expect(out.project).toBeUndefined();
  });

  it('migrateV1ToV2 is pure + does not mutate the input', () => {
    const v1: BundleV1 = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const frozen = JSON.stringify(v1);
    const out = migrateV1ToV2(v1);
    expect(out.version).toBe(2);
    expect(JSON.stringify(v1)).toBe(frozen);
  });

  it('rejects a null input', () => {
    expect(() => migrateBundle(null)).toThrow(/must be an object/);
  });

  it('rejects a missing version', () => {
    expect(() => migrateBundle({ meta: {}, data: {} })).toThrow(/missing .version./);
  });

  it('rejects a future version', () => {
    const b = { version: CURRENT_BUNDLE_VERSION + 1, meta: {}, data: {} };
    expect(() => migrateBundle(b)).toThrow(/newer than the app supports/);
  });

  it('rejects malformed meta / data', () => {
    const b = { version: 1, meta: null, data: {} };
    expect(() => migrateBundle(b)).toThrow(/meta/);
  });

  it('rejects non-array data fields', () => {
    const b = { version: 1, meta: {}, data: { pipes: 'x', fixtures: [], walls: [], measurements: [] } };
    expect(() => migrateBundle(b)).toThrow(/pipes must be an array/);
  });
});

// ── parseBundle ─────────────────────────────────────────────────

describe('parseBundle', () => {
  it('parses valid JSON via migrateBundle (v1 → latest)', () => {
    const b: BundleV1 = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const out = parseBundle(JSON.stringify(b));
    expect(out.version).toBe(CURRENT_BUNDLE_VERSION);
  });

  it('produces a helpful error on non-JSON input', () => {
    expect(() => parseBundle('not-json{')).toThrow(/not valid JSON/);
  });
});

// ── Internal helpers ───────────────────────────────────────────

describe('helpers', () => {
  it('suggestFilename strips non-safe characters and stays reasonably short', () => {
    const b: Bundle = {
      version: 3,
      meta: { createdAt: 0, savedAt: 1_700_000_000_000, appVersion: 'x', name: 'Jones Residence / 2nd Floor' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const name = __testables.suggestFilename(b);
    expect(name.endsWith('.elbow')).toBe(true);
    expect(name.length).toBeLessThan(100);
    expect(name).not.toContain('/');
    expect(name).not.toContain(' ');
  });

  it('deepClone breaks reference equality on nested objects', () => {
    const src = { a: { b: [1, 2, 3] } };
    const copy = __testables.deepClone(src);
    expect(copy).toEqual(src);
    expect(copy).not.toBe(src);
    expect(copy.a).not.toBe(src.a);
    expect(copy.a.b).not.toBe(src.a.b);
  });
});

// ── Phase 11.B — customer linking ──────────────────────────────

describe('customer linking (v2)', () => {
  it('captureBundle does NOT attach project when active customer is "default"', () => {
    // beforeEach() resets to the default customer, so this is the baseline.
    const b = captureBundle();
    expect(b.project).toBeUndefined();
  });

  it('captureBundle attaches project when a non-default customer is active', () => {
    // Seed a real customer.
    useCustomerStore.setState({
      profiles: {
        ...useCustomerStore.getState().profiles,
        'jones-1': {
          id: 'jones-1',
          name: 'Jones Residence',
          templates: {},
          defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
          codes: ['IPC-2021'],
          markupPercent: 12,
          createdAt: '2026-04-01T00:00:00Z',
          contact: { personName: 'Eleanor Jones' },
          siteAddress: { street: '45 Oak Dr', city: 'Orlando', state: 'FL', zip: '32801' },
        },
      },
      activeCustomerId: 'jones-1',
    });

    const b = captureBundle();
    expect(b.project).toBeDefined();
    expect(b.project!.customerId).toBe('jones-1');
    expect(b.project!.customerSnapshot!.name).toBe('Jones Residence');
    expect(b.project!.customerSnapshot!.contactPerson).toBe('Eleanor Jones');
    expect(b.project!.customerSnapshot!.siteStreet).toBe('45 Oak Dr');
  });

  it('applyBundle activates a known customer and reports customerResolved=true', () => {
    useCustomerStore.setState({
      profiles: {
        ...useCustomerStore.getState().profiles,
        'smith-1': {
          id: 'smith-1',
          name: 'Smith Townhome',
          templates: {},
          defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
          codes: [],
          markupPercent: 0,
          createdAt: '2026-04-01T00:00:00Z',
        },
      },
      activeCustomerId: 'default',
    });

    const bundle: Bundle = {
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: {
        customerId: 'smith-1',
        customerSnapshot: { name: 'Smith Townhome' },
      },
    };

    const r = applyBundle(bundle);
    expect(r.project?.customerResolved).toBe(true);
    expect(r.project?.customerName).toBe('Smith Townhome');
    expect(useCustomerStore.getState().activeCustomerId).toBe('smith-1');
  });

  it('applyBundle on unknown customerId reports customerResolved=false and does not change active', () => {
    useCustomerStore.setState({ activeCustomerId: 'default' });
    const bundle: Bundle = {
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: {
        customerId: 'nonexistent',
        customerSnapshot: { name: 'Ghost Customer' },
      },
    };
    const r = applyBundle(bundle);
    expect(r.project?.customerResolved).toBe(false);
    expect(r.project?.customerName).toBe('Ghost Customer');
    // Active customer untouched.
    expect(useCustomerStore.getState().activeCustomerId).toBe('default');
  });

  it('v2 bundle with no project field applies cleanly and returns project=undefined', () => {
    const bundle: Bundle = {
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const r = applyBundle(bundle);
    expect(r.project).toBeUndefined();
  });

  it('validateV2 rejects malformed project field (not an object)', () => {
    const b = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: 'not-an-object',
    };
    expect(() => migrateBundle(b)).toThrow(/project must be an object/);
  });

  it('validateV2 rejects a non-string customerId', () => {
    const b = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: { customerId: 42 },
    };
    expect(() => migrateBundle(b)).toThrow(/customerId must be a string/);
  });

  it('validateV2 rejects a customerSnapshot without a name', () => {
    const b = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: { customerSnapshot: {} },
    };
    expect(() => migrateBundle(b)).toThrow(/customerSnapshot.name is required/);
  });
});

// ── Phase 14.R.26 roof slice ───────────────────────────────────

describe('bundle v3 — roof slice', () => {
  beforeEach(() => {
    // Clear roofing stores so each test starts from a known baseline.
    useRoofStore.setState({
      sections: {},
      sectionOrder: [],
      vertices: {},
      measures: {},
      layers: [],
      pdf: {
        pdfPath: '', page: 0,
        calX1: 0, calY1: 0, calX2: 0, calY2: 0, calDistanceFt: 0,
        offsetX: 0, offsetY: 0,
        scale: 1, opacity: 0.3, visible: true, locked: false,
        rotationDeg: 0,
      },
      selectedSectionId: null,
      // Phase 14.R.27 — reset penetrations too so per-test state
      // starts clean.
      penetrations: {},
      penetrationOrder: [],
      undoStack: [], redoStack: [],
      batchDepth: 0, dirtyDuringBatch: false,
    });
  });

  it('CURRENT_BUNDLE_VERSION is 3', () => {
    expect(CURRENT_BUNDLE_VERSION).toBe(3);
  });

  it('captureBundle includes no `roof` when roofing state is untouched', () => {
    // Even an untouched roof produces a projectInput (since the
    // roofingProjectStore has defaults). So the roof slice is ALWAYS
    // present; what MUST be absent is a graph snapshot.
    const b = captureBundle();
    expect(b.data.roof).toBeDefined();
    expect(b.data.roof?.graph).toBeUndefined();
    expect(b.data.roof?.projectInput).toBeDefined();
  });

  it('captureBundle + applyBundle round-trips drawn sections', () => {
    // Seed a section manually.
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, slope: 6, roofType: 'hip',
    });
    const beforeCount = useRoofStore.getState().sectionOrder.length;
    expect(beforeCount).toBe(1);

    // Capture \u2192 serialize \u2192 parse \u2192 apply.
    const json = captureBundleSerialized();
    // Wipe roofing state to simulate a fresh boot before apply.
    useRoofStore.setState({
      sections: {}, sectionOrder: [],
      vertices: {}, measures: {}, layers: [],
      pdf: useRoofStore.getState().pdf,
      selectedSectionId: null,
      undoStack: [], redoStack: [],
      batchDepth: 0, dirtyDuringBatch: false,
    });
    expect(useRoofStore.getState().sectionOrder.length).toBe(0);

    applyBundle(JSON.parse(json));
    expect(useRoofStore.getState().sectionOrder.length).toBe(1);
    expect(useRoofStore.getState().sections[sid]?.length).toBe(10);
    expect(useRoofStore.getState().sections[sid]?.run).toBe(5);
  });

  it('captureBundle captures the PDF underlay fields (image data URL, scale, pdfPath)', () => {
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,abcd',
      widthPx: 100, heightPx: 200,
      fileName: 'plans.pdf',
      page: 1,
    });
    const b = captureBundle();
    expect(b.data.roof?.graph?.pdf.imageDataUrl).toBe('data:image/png;base64,abcd');
    expect(b.data.roof?.graph?.pdf.widthPx).toBe(100);
    expect(b.data.roof?.graph?.pdf.heightPx).toBe(200);
    expect(b.data.roof?.graph?.pdf.fileName).toBe('plans.pdf');
  });

  it('captureBundleSerialized(omitPdfImageData=true) strips the data URL but keeps everything else', () => {
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,abcd',
      widthPx: 100, heightPx: 200,
      fileName: 'plans.pdf',
      page: 1,
    });
    const json = captureBundleSerialized({ omitPdfImageData: true });
    const parsed = JSON.parse(json) as Bundle;
    expect(parsed.data.roof?.graph?.pdf.imageDataUrl).toBeUndefined();
    // Non-image fields preserved so the next boot remembers the blueprint name / transform.
    expect(parsed.data.roof?.graph?.pdf.fileName).toBe('plans.pdf');
    expect(parsed.data.roof?.graph?.pdf.widthPx).toBe(100);
    expect(parsed.data.roof?.graph?.pdf.heightPx).toBe(200);
  });

  it('captureBundleSerialized default (omit flag off) keeps the full image data URL', () => {
    useRoofStore.getState().loadPdfImage({
      imageDataUrl: 'data:image/png;base64,abcd',
      widthPx: 100, heightPx: 200,
      fileName: 'plans.pdf',
      page: 1,
    });
    const json = captureBundleSerialized();
    expect(json).toContain('data:image/png;base64,abcd');
  });

  it('applyBundle wipes existing roofing state when the bundle has no roof slice', () => {
    useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, slope: 6, roofType: 'hip',
    });
    expect(useRoofStore.getState().sectionOrder.length).toBe(1);

    // Apply a bundle without a roof slice at all.
    applyBundle({
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    });

    expect(useRoofStore.getState().sectionOrder.length).toBe(0);
    // Undo stack is cleared too \u2014 no stepping into a pre-load fiction.
    expect(useRoofStore.getState().undoStack).toEqual([]);
  });

  it('applyBundle restores roofing project input from bundle', () => {
    applyBundle({
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: {
        pipes: [], fixtures: [], walls: [], measurements: [],
        roof: {
          projectInput: {
            county: 'Orange',
            length_ft: 50, width_ft: 30, mean_height_ft: 10,
            slope_pitch: '4:12', roof_type: 'gable', complexity: 'moderate',
            system: 'architectural_shingle', product_family: '',
            address: '', wood_species: 'SYP',
            sheathing_thickness: '15/32', framing_spacing_in: 24,
            distance_to_saltwater_ft: 5000, job_type: 'reroof',
            risk_category: 2, install_method: 'direct_deck',
            plumbing_vent_count: 3, skylight_count: 0, chimney_count: 0,
            customer_name: '', project_id: '', notes: '',
          },
        },
      },
    });
    expect(useRoofingProjectStore.getState().input.county).toBe('Orange');
    expect(useRoofingProjectStore.getState().input.length_ft).toBe(50);
  });

  // ── Phase 14.R.27 — penetrations in the bundle ────────────────

  it('captureBundle + applyBundle round-trips placed penetrations', () => {
    const pid1 = useRoofStore.getState().addPenetration({
      kind: 'skylight', x: 5, y: 7, widthFt: 2, lengthFt: 4, label: 'Master',
    });
    const pid2 = useRoofStore.getState().addPenetration({
      kind: 'chimney', x: 15, y: 10, label: 'Fireplace',
    });
    expect(useRoofStore.getState().penetrationOrder).toEqual([pid1, pid2]);

    const json = captureBundleSerialized();
    // Wipe roof state
    useRoofStore.setState({
      sections: {}, sectionOrder: [],
      vertices: {}, measures: {}, layers: [],
      pdf: useRoofStore.getState().pdf,
      selectedSectionId: null,
      penetrations: {}, penetrationOrder: [],
      undoStack: [], redoStack: [],
      batchDepth: 0, dirtyDuringBatch: false,
    });
    expect(useRoofStore.getState().penetrationOrder).toEqual([]);

    applyBundle(JSON.parse(json));
    const st = useRoofStore.getState();
    expect(st.penetrationOrder).toEqual([pid1, pid2]);
    expect(st.penetrations[pid1]!.label).toBe('Master');
    expect(st.penetrations[pid1]!.widthFt).toBe(2);
    expect(st.penetrations[pid2]!.kind).toBe('chimney');
  });

  it('captureBundle includes penetrations under data.roof.graph even without sections', () => {
    useRoofStore.getState().addPenetration({ kind: 'plumbing_vent', x: 0, y: 0 });
    const b = captureBundle();
    expect(b.data.roof?.graph).toBeDefined();
    const graph = b.data.roof!.graph!;
    expect(graph.penetrationOrder).toBeDefined();
    expect(graph.penetrationOrder!.length).toBe(1);
  });

  it('applying a v3 bundle with NO penetrations field produces an empty slice (no crash)', () => {
    // Build a bundle whose roof.graph predates R.27 — the
    // `penetrations` / `penetrationOrder` keys are omitted entirely.
    applyBundle({
      version: 3,
      meta: { createdAt: 1, savedAt: 1, appVersion: 'test' },
      data: {
        pipes: [], fixtures: [], walls: [], measurements: [],
        roof: {
          graph: {
            sections: {},
            vertices: {},
            measures: {},
            layers: [],
            pdf: {
              pdfPath: '', page: 0,
              calX1: 0, calY1: 0, calX2: 0, calY2: 0, calDistanceFt: 0,
              offsetX: 0, offsetY: 0,
              scale: 1, opacity: 0.3, visible: true, locked: false,
              rotationDeg: 0,
            },
            // penetrations + penetrationOrder intentionally omitted
          },
        },
      },
    });
    const st = useRoofStore.getState();
    expect(Object.keys(st.penetrations)).toHaveLength(0);
    expect(st.penetrationOrder).toEqual([]);
  });
});

describe('migrateV2ToV3', () => {
  it('bumps version from 2 to 3, preserves meta + data', () => {
    const v2: BundleV2 = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const v3 = migrateV2ToV3(v2);
    expect(v3.version).toBe(3);
    expect(v3.meta).toEqual(v2.meta);
    expect(v3.data.pipes).toEqual([]);
    // No roof field injected.
    expect(v3.data.roof).toBeUndefined();
  });

  it('preserves project field when present', () => {
    const v2: BundleV2 = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
      project: { customerId: 'abc', customerSnapshot: { name: 'Acme' } },
    };
    const v3 = migrateV2ToV3(v2);
    expect(v3.project).toEqual(v2.project);
  });

  it('strips project field when absent (no {project: undefined} leak)', () => {
    const v2: BundleV2 = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const v3 = migrateV2ToV3(v2);
    expect('project' in v3).toBe(false);
  });
});

describe('migrateBundle — v2 bundles auto-migrate to v3', () => {
  it('v2 bundle without roof applies cleanly with blank roofing state', () => {
    // A legacy v2 file on disk (pre-R.26).
    const v2Json = {
      version: 2,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    // Pre-seed roofing state \u2014 apply should wipe it.
    useRoofStore.getState().addSection({
      x: 0, y: 0, length: 10, run: 5, slope: 6, roofType: 'hip',
    });
    const r = applyBundle(v2Json);
    expect(r.migrated).toBe(true);
    expect(useRoofStore.getState().sectionOrder.length).toBe(0);
  });

  it('v1 bundle without roof migrates v1\u2192v2\u2192v3 cleanly', () => {
    const v1Json = {
      version: 1,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: { pipes: [], fixtures: [], walls: [], measurements: [] },
    };
    const r = applyBundle(v1Json);
    expect(r.migrated).toBe(true);
    expect(r.ok).toBe(true);
  });

  it('v3 bundle with malformed roof (not an object) is rejected', () => {
    expect(() => migrateBundle({
      version: 3,
      meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
      data: {
        pipes: [], fixtures: [], walls: [], measurements: [],
        roof: 'not-an-object',
      },
    })).toThrow(/roof must be an object/);
  });
});
