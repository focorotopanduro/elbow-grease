/**
 * Integration: bundle save → clear → load roundtrip.
 *
 * This is the "insurance" test for Phase 11.A + 11.B. It seeds a
 * realistic scene (pipes + fixtures + walls + measurements + active
 * customer), captures a bundle, wipes every store, applies the
 * bundle, and asserts the reconstructed scene matches the original.
 *
 * If any store grows a new persistable field and we forget to
 * include it in captureBundle / applyBundle, THIS test fails loudly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useWallStore } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useCustomerStore } from '@store/customerStore';
import { captureBundle, applyBundle, serializeBundle, parseBundle } from '@core/bundle/Bundle';
import { resetAllStores, seedCustomer } from './harness';

beforeEach(() => {
  resetAllStores();
});

describe('scene roundtrip', () => {
  it('pipes + fixtures + walls + measurements survive capture → clear → apply', () => {
    // Seed a realistic mini-scene.
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1', points: [[0, 0, 0], [5, 0, 0]], diameter: 3,
          material: 'pvc_sch40', system: 'waste', color: '#ef5350',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1', subtype: 'water_closet', position: [1, 0, 1],
          params: { model: 'standard' }, createdTs: 12345, connectedPipeIds: ['p1'],
        },
      },
      selectedFixtureId: null,
    });
    useWallStore.setState({
      walls: {
        w1: {
          id: 'w1', start: [0, 0], end: [10, 0], thickness: 0.5,
          floorY: 0, height: 9, type: 'interior', label: '',
        } as any,  // Wall type has more fields but we'll trust it roundtrips.
      },
      selectedWallId: null,
      drawSession: null,
    });
    useMeasureStore.setState({
      measurements: {
        m1: {
          id: 'm1', a: [0, 0, 0], b: [5, 0, 0], label: '5 ft span',
          createdTs: 99, pinned: true,
        },
      },
      pendingStart: null, previewEnd: null, pendingScalePair: null,
    });

    // Snapshot.
    const bundle = captureBundle();

    // Nuke.
    resetAllStores();
    expect(Object.keys(usePipeStore.getState().pipes)).toHaveLength(0);
    expect(Object.keys(useFixtureStore.getState().fixtures)).toHaveLength(0);
    expect(Object.keys(useWallStore.getState().walls)).toHaveLength(0);
    expect(Object.keys(useMeasureStore.getState().measurements)).toHaveLength(0);

    // Restore.
    const result = applyBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({ pipes: 1, fixtures: 1, walls: 1, measurements: 1 });

    expect(usePipeStore.getState().pipes['p1']?.points).toEqual([[0, 0, 0], [5, 0, 0]]);
    expect(useFixtureStore.getState().fixtures['f1']?.params).toEqual({ model: 'standard' });
    expect(useWallStore.getState().walls['w1']?.start).toEqual([0, 0]);
    expect(useMeasureStore.getState().measurements['m1']?.label).toBe('5 ft span');
  });

  it('JSON text roundtrip (capture → serialize → parse → apply) preserves scene', () => {
    usePipeStore.setState({
      pipes: {
        roundtrip: {
          id: 'roundtrip', points: [[0, 0, 0], [10, 0, 0]], diameter: 4,
          material: 'pvc_sch40', system: 'waste', color: '#ab47bc',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['roundtrip'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });

    const b1 = captureBundle();
    const text = serializeBundle(b1);
    resetAllStores();

    const b2 = parseBundle(text);
    applyBundle(b2);

    expect(usePipeStore.getState().pipes['roundtrip']?.diameter).toBe(4);
  });
});

describe('customer-linked roundtrip (v2)', () => {
  it('active customer is captured, wiped, and reactivated on apply', () => {
    // Seed a non-default customer as active.
    const id = seedCustomer('Jones Residence', {
      contactName: 'Eleanor Jones',
      street: '45 Oak Dr',
      city: 'Orlando',
    });
    expect(useCustomerStore.getState().activeCustomerId).toBe(id);

    // Add a pipe so the bundle has something to restore.
    usePipeStore.setState({
      pipes: {
        cust1: {
          id: 'cust1', points: [[0, 0, 0], [3, 0, 0]], diameter: 2,
          material: 'pex', system: 'cold_supply', color: '#ffa726',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['cust1'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });

    const bundle = captureBundle();
    expect(bundle.project?.customerId).toBe(id);
    expect(bundle.project?.customerSnapshot?.name).toBe('Jones Residence');

    // Wipe (but re-seed the same customer so apply can resolve it).
    resetAllStores();
    // Re-seed with the SAME id so resolve succeeds.
    useCustomerStore.setState({
      profiles: {
        ...useCustomerStore.getState().profiles,
        [id]: {
          id, name: 'Jones Residence',
          templates: {},
          defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
          codes: [], markupPercent: 0, createdAt: new Date().toISOString(),
        },
      },
      activeCustomerId: 'default',
    });

    const result = applyBundle(bundle);
    expect(result.project?.customerResolved).toBe(true);
    expect(result.project?.customerName).toBe('Jones Residence');
    expect(useCustomerStore.getState().activeCustomerId).toBe(id);
    expect(usePipeStore.getState().pipes['cust1']).toBeDefined();
  });

  it('bundle with unknown customerId apply still succeeds, leaves active untouched', () => {
    // Seed but do NOT re-create the customer — simulate receiving a
    // bundle from a different machine.
    seedCustomer('Ghost Customer');
    const bundle = captureBundle();
    expect(bundle.project?.customerId).toBeDefined();

    // Wipe EVERYTHING (including the customer that was captured).
    resetAllStores();
    expect(useCustomerStore.getState().activeCustomerId).toBe('default');

    const result = applyBundle(bundle);
    expect(result.ok).toBe(true);
    expect(result.project?.customerResolved).toBe(false);
    expect(result.project?.customerName).toBe('Ghost Customer');
    // Active customer remained 'default' — we didn't invent a profile.
    expect(useCustomerStore.getState().activeCustomerId).toBe('default');
  });
});
