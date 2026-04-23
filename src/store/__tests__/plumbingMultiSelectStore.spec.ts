/**
 * plumbingMultiSelectStore — Phase 14.I tests.
 *
 * Covers:
 *   • addPipe / addFixture / removePipe / removeFixture (idempotent)
 *   • togglePipe / toggleFixture
 *   • clear, setSelection, addMany
 *   • queries: isPipeSelected, isFixtureSelected, count, isEmpty,
 *     selectedPipeIds, selectedFixtureIds
 *   • independence: pipe ops don't affect fixture state and vice versa
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePlumbingMultiSelectStore } from '../plumbingMultiSelectStore';

function reset(): void {
  usePlumbingMultiSelectStore.setState({ pipeIds: {}, fixtureIds: {} });
}

beforeEach(reset);

// ── Add / remove ──────────────────────────────────────────────

describe('add / remove', () => {
  it('addPipe puts a pipe in the selection', () => {
    usePlumbingMultiSelectStore.getState().addPipe('p1');
    expect(usePlumbingMultiSelectStore.getState().isPipeSelected('p1')).toBe(true);
  });

  it('addPipe is idempotent (no double-add)', () => {
    usePlumbingMultiSelectStore.getState().addPipe('p1');
    usePlumbingMultiSelectStore.getState().addPipe('p1');
    expect(usePlumbingMultiSelectStore.getState().count()).toBe(1);
  });

  it('removePipe removes an item', () => {
    usePlumbingMultiSelectStore.getState().addPipe('p1');
    usePlumbingMultiSelectStore.getState().addPipe('p2');
    usePlumbingMultiSelectStore.getState().removePipe('p1');
    expect(usePlumbingMultiSelectStore.getState().isPipeSelected('p1')).toBe(false);
    expect(usePlumbingMultiSelectStore.getState().isPipeSelected('p2')).toBe(true);
  });

  it('removePipe is no-op if absent', () => {
    usePlumbingMultiSelectStore.getState().removePipe('p-missing');
    expect(usePlumbingMultiSelectStore.getState().count()).toBe(0);
  });

  it('addFixture and removeFixture are symmetric to the pipe variants', () => {
    usePlumbingMultiSelectStore.getState().addFixture('f1');
    expect(usePlumbingMultiSelectStore.getState().isFixtureSelected('f1')).toBe(true);
    usePlumbingMultiSelectStore.getState().removeFixture('f1');
    expect(usePlumbingMultiSelectStore.getState().isFixtureSelected('f1')).toBe(false);
  });
});

// ── Toggle ────────────────────────────────────────────────────

describe('toggle', () => {
  it('togglePipe flips membership', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.togglePipe('p1');
    expect(s.isPipeSelected('p1')).toBe(true);
    s.togglePipe('p1');
    expect(s.isPipeSelected('p1')).toBe(false);
  });

  it('toggleFixture flips membership', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.toggleFixture('f1');
    expect(s.isFixtureSelected('f1')).toBe(true);
    s.toggleFixture('f1');
    expect(s.isFixtureSelected('f1')).toBe(false);
  });
});

// ── Bulk ──────────────────────────────────────────────────────

describe('bulk operations', () => {
  it('clear wipes both pipe and fixture selections', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.addFixture('f1');
    s.clear();
    expect(s.count()).toBe(0);
    expect(s.isEmpty()).toBe(true);
  });

  it('setSelection replaces entirely', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p-old');
    s.addFixture('f-old');
    s.setSelection(['p-new1', 'p-new2'], ['f-new1']);
    expect(s.selectedPipeIds().sort()).toEqual(['p-new1', 'p-new2']);
    expect(s.selectedFixtureIds()).toEqual(['f-new1']);
  });

  it('addMany unions with the existing selection', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.addFixture('f1');
    s.addMany(['p2', 'p3'], ['f2']);
    expect(s.selectedPipeIds().sort()).toEqual(['p1', 'p2', 'p3']);
    expect(s.selectedFixtureIds().sort()).toEqual(['f1', 'f2']);
  });

  it('setSelection with empty arrays clears', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.setSelection([], []);
    expect(s.isEmpty()).toBe(true);
  });
});

// ── Queries ───────────────────────────────────────────────────

describe('queries', () => {
  it('count sums pipes + fixtures', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.addPipe('p2');
    s.addFixture('f1');
    expect(s.count()).toBe(3);
  });

  it('isEmpty reflects total', () => {
    const s = usePlumbingMultiSelectStore.getState();
    expect(s.isEmpty()).toBe(true);
    s.addPipe('p1');
    expect(s.isEmpty()).toBe(false);
    s.clear();
    expect(s.isEmpty()).toBe(true);
  });

  it('selectedPipeIds returns only pipes, not fixtures', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.addFixture('f1');
    const ids = s.selectedPipeIds();
    expect(ids).toEqual(['p1']);
  });

  it('selectedFixtureIds returns only fixtures, not pipes', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.addFixture('f1');
    expect(s.selectedFixtureIds()).toEqual(['f1']);
  });
});

// ── Independence ──────────────────────────────────────────────

describe('pipe ↔ fixture independence', () => {
  it('adding a pipe does not add a fixture with the same id', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('shared-id');
    expect(s.isPipeSelected('shared-id')).toBe(true);
    expect(s.isFixtureSelected('shared-id')).toBe(false);
  });

  it('removing a pipe does not affect fixture state', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('x');
    s.addFixture('x');
    s.removePipe('x');
    expect(s.isPipeSelected('x')).toBe(false);
    expect(s.isFixtureSelected('x')).toBe(true);
  });

  it('toggling a fixture leaves pipes alone', () => {
    const s = usePlumbingMultiSelectStore.getState();
    s.addPipe('p1');
    s.toggleFixture('p1');
    expect(s.isPipeSelected('p1')).toBe(true);
    expect(s.isFixtureSelected('p1')).toBe(true);
    s.toggleFixture('p1');
    expect(s.isPipeSelected('p1')).toBe(true);
    expect(s.isFixtureSelected('p1')).toBe(false);
  });
});
