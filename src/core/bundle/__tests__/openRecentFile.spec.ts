/**
 * openRecentFile — Phase 11.E tests.
 *
 * Covers:
 *   • happy path: readFromPath resolves, parseBundle succeeds, applyBundle
 *     lands the scene + setCurrent runs + returns ok: true.
 *   • readFromPath throws → entry is removed from recents, returns
 *     ok: false + removedFromRecents: true.
 *   • parseBundle throws → entry IS KEPT in recents, returns ok: false
 *     + removedFromRecents: false.
 *
 * fsAdapter.readFromPath is module-mocked via vi.mock so we can control
 * success vs throw without standing up a Tauri runtime.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useWallStore } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useCustomerStore } from '@store/customerStore';
import { useCurrentFileStore } from '../currentFileStore';
import { __setTauriProbeForTest } from '../fsAdapter';

// Mock fsAdapter.readFromPath — replace with a per-test controller.
// vi.mock runs before imports, so we capture a writable holder first.
const readState = {
  impl: null as ((path: string) => Promise<string>) | null,
};

vi.mock('../fsAdapter', async () => {
  // Pull the real module so we only override readFromPath.
  const actual = await vi.importActual<typeof import('../fsAdapter')>('../fsAdapter');
  return {
    ...actual,
    readFromPath: (path: string) => {
      if (!readState.impl) throw new Error('test: readFromPath not configured');
      return readState.impl(path);
    },
  };
});

// Import AFTER vi.mock so the mock is in effect.
// eslint-disable-next-line import/first
import { openRecentFile } from '../openRecentFile';

// ── Fixtures ──────────────────────────────────────────────────

function makeBundleJson(): string {
  return JSON.stringify({
    version: 2,
    meta: { createdAt: 1, savedAt: 2, appVersion: 'test' },
    data: {
      pipes: [{
        id: 'p1', points: [[0, 0, 0], [1, 0, 0]], diameter: 2,
        material: 'pvc_sch40', system: 'waste', color: '#ffa726',
        visible: true, selected: false,
      }],
      fixtures: [], walls: [], measurements: [],
    },
  });
}

beforeEach(() => {
  readState.impl = null;

  // Reset stores so each test starts clean.
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  useWallStore.setState({ walls: {}, selectedWallId: null, drawSession: null });
  useMeasureStore.setState({
    measurements: {}, pendingStart: null, previewEnd: null, pendingScalePair: null,
  });
  useCustomerStore.setState({
    profiles: useCustomerStore.getState().profiles,
    activeCustomerId: 'default',
    pendingFixture: null, editingFixture: null,
  });

  // Seed recents with the path we'll test against.
  useCurrentFileStore.setState({
    currentPath: null,
    recents: [{ path: '/fake/project.elbow', savedAt: Date.now(), name: 'project' }],
  });

  // fsAdapter.isRealPath depends on the Tauri probe — force it on so
  // setCurrent actually pushes back into recents after a successful open.
  __setTauriProbeForTest(true);
});

// ── Tests ──────────────────────────────────────────────────────

describe('happy path', () => {
  it('reads, parses, applies, and returns ok', async () => {
    readState.impl = () => Promise.resolve(makeBundleJson());

    const result = await openRecentFile('/fake/project.elbow');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applyResult.counts.pipes).toBe(1);
    }
    expect(usePipeStore.getState().pipes['p1']).toBeDefined();
    expect(useCurrentFileStore.getState().currentPath).toBe('/fake/project.elbow');
  });
});

describe('read failure (stale path)', () => {
  it('removes the entry from recents and returns ok: false, removed: true', async () => {
    readState.impl = () => Promise.reject(new Error('ENOENT: no such file'));

    const before = useCurrentFileStore.getState().recents.length;
    expect(before).toBeGreaterThan(0);

    const result = await openRecentFile('/fake/project.elbow');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.removedFromRecents).toBe(true);
      expect(result.error).toContain('ENOENT');
    }

    const after = useCurrentFileStore.getState().recents;
    expect(after.find((r) => r.path === '/fake/project.elbow')).toBeUndefined();
  });
});

describe('parse failure (corrupt bundle)', () => {
  it('KEEPS the entry in recents and returns ok: false, removed: false', async () => {
    readState.impl = () => Promise.resolve('not json');

    const result = await openRecentFile('/fake/project.elbow');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.removedFromRecents).toBe(false);
      expect(result.error).toMatch(/not valid JSON|invalid/i);
    }

    // Entry is still in the recents list.
    const recents = useCurrentFileStore.getState().recents;
    expect(recents.find((r) => r.path === '/fake/project.elbow')).toBeDefined();
  });

  it('future-version bundle is treated as parse failure, entry kept', async () => {
    readState.impl = () => Promise.resolve(JSON.stringify({
      version: 999,
      meta: {}, data: {},
    }));

    const result = await openRecentFile('/fake/project.elbow');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.removedFromRecents).toBe(false);
      expect(result.error).toMatch(/newer than the app|invalid/i);
    }
  });
});
