/**
 * domainPresence — Phase 5 (ARCHITECTURE.md §4.8) tests.
 *
 * Covers:
 *   • `computeDomainPresence` — pure helper, all 4 combinations
 *     of {plumbing present, roofing present}.
 *   • `getDomainPresence` — reads live stores; seed each store to
 *     force the flag and verify the readout.
 *   • Presence is entity existence, not pricing. Fixtures alone
 *     count as plumbing present; sections alone count as roofing
 *     present.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeDomainPresence,
  getDomainPresence,
} from '../domainPresence';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useManifoldStore } from '@store/manifoldStore';
import { useRoofStore } from '@store/roofStore';

function resetStores() {
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });
  useRoofStore.setState({
    sections: {}, sectionOrder: [],
    vertices: {}, measures: {}, layers: [],
    pdf: useRoofStore.getState().pdf,
    selectedSectionId: null,
    penetrations: {}, penetrationOrder: [],
    undoStack: [], redoStack: [], batchDepth: 0, dirtyDuringBatch: false,
  });
}

// ── Pure helper: all 4 cases ──────────────────────────────────

describe('computeDomainPresence (pure)', () => {
  it('neither domain present: both false', () => {
    expect(computeDomainPresence({
      pipeCount: 0, fixtureCount: 0, manifoldCount: 0, sectionCount: 0,
    })).toEqual({ plumbing: false, roofing: false });
  });

  it('plumbing only (pipes): plumbing true, roofing false', () => {
    expect(computeDomainPresence({
      pipeCount: 3, fixtureCount: 0, manifoldCount: 0, sectionCount: 0,
    })).toEqual({ plumbing: true, roofing: false });
  });

  it('roofing only: plumbing false, roofing true', () => {
    expect(computeDomainPresence({
      pipeCount: 0, fixtureCount: 0, manifoldCount: 0, sectionCount: 2,
    })).toEqual({ plumbing: false, roofing: true });
  });

  it('both domains present: both true', () => {
    expect(computeDomainPresence({
      pipeCount: 1, fixtureCount: 1, manifoldCount: 0, sectionCount: 1,
    })).toEqual({ plumbing: true, roofing: true });
  });

  it('fixtures alone are enough to mark plumbing present (§4.8 — entity existence, not pricing)', () => {
    expect(computeDomainPresence({
      pipeCount: 0, fixtureCount: 1, manifoldCount: 0, sectionCount: 0,
    })).toEqual({ plumbing: true, roofing: false });
  });

  it('manifolds alone are enough to mark plumbing present', () => {
    expect(computeDomainPresence({
      pipeCount: 0, fixtureCount: 0, manifoldCount: 1, sectionCount: 0,
    })).toEqual({ plumbing: true, roofing: false });
  });
});

// ── Live helper: live store reads ─────────────────────────────

describe('getDomainPresence (live stores)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('empty stores: both false', () => {
    expect(getDomainPresence()).toEqual({ plumbing: false, roofing: false });
  });

  it('plumbing-only (seeded pipe): plumbing true, roofing false', () => {
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1', points: [[0, 0, 0], [1, 0, 0]], diameter: 2,
          material: 'pvc_sch40', system: 'waste', color: '#ef5350',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });
    expect(getDomainPresence()).toEqual({ plumbing: true, roofing: false });
  });

  it('plumbing-only via fixture (no pipes, no manifolds): plumbing true', () => {
    useFixtureStore.setState({
      fixtures: {
        f1: {
          id: 'f1', subtype: 'water_closet', position: [0, 0, 0],
          params: {}, createdTs: 1, connectedPipeIds: [],
        },
      },
      selectedFixtureId: null,
    });
    expect(getDomainPresence()).toEqual({ plumbing: true, roofing: false });
  });

  it('roofing-only (seeded section): plumbing false, roofing true', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    expect(getDomainPresence()).toEqual({ plumbing: false, roofing: true });
  });

  it('mixed (pipe + section): both true', () => {
    usePipeStore.setState({
      pipes: {
        p1: {
          id: 'p1', points: [[0, 0, 0], [1, 0, 0]], diameter: 2,
          material: 'pvc_sch40', system: 'waste', color: '#ef5350',
          visible: true, selected: false,
        },
      },
      pipeOrder: ['p1'],
      selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
    });
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    expect(getDomainPresence()).toEqual({ plumbing: true, roofing: true });
  });
});
