/**
 * selectionClipboard — Phase 14.P tests.
 *
 * Covers:
 *   • extractForCopy returns null on empty selection
 *   • extractForCopy drops stale ids (selection referenced a deleted item)
 *   • extractForCopy deep-copies points + params (no shared refs with source)
 *   • preparePaste assigns fresh ids via idGen
 *   • preparePaste offsets every point + position by delta
 *   • preparePaste strips `selected` / connectedPipeIds (renewed on add)
 *   • deltaForTarget: anchor → target vector
 *   • computePayloadCentroid averages all points + fixtures
 *   • Round-trip: extract → paste with delta=0 preserves geometry (up to new ids)
 *   • Schema version constant is 1
 */

import { describe, it, expect } from 'vitest';
import {
  CLIPBOARD_SCHEMA_VERSION,
  DEFAULT_DUPLICATE_OFFSET,
  extractForCopy,
  preparePaste,
  deltaForTarget,
  computePayloadCentroid,
  type ClipboardPayload,
} from '../selectionClipboard';
import type { CommittedPipe } from '../../../store/pipeStore';
import type { FixtureInstance } from '../../../store/fixtureStore';

// ── Fixtures ───────────────────────────────────────────────────

function makePipe(id: string, points: [number, number, number][]): CommittedPipe {
  return {
    id,
    points,
    diameter: 3,
    material: 'pvc',
    system: 'waste',
    color: '#66bb6a',
    visible: true,
    selected: false,
  };
}

function makeFixture(id: string, pos: [number, number, number]): FixtureInstance {
  return {
    id,
    subtype: 'water_closet',
    position: pos,
    params: { flushValveType: 'tank', bowlHeight: 'standard' },
    createdTs: 1000,
    connectedPipeIds: ['some-pipe'],
  };
}

// ── extractForCopy ─────────────────────────────────────────────

describe('extractForCopy', () => {
  it('returns null when both id lists are empty', () => {
    expect(extractForCopy([], [], {}, {})).toBeNull();
  });

  it('returns null when every id is stale', () => {
    const pipes = { a: makePipe('a', [[0, 0, 0], [1, 0, 0]]) };
    // Request 'b' which doesn't exist; 'a' is in map but we don't ask for it.
    expect(extractForCopy(['b'], ['missing'], pipes, {})).toBeNull();
  });

  it('drops stale ids silently', () => {
    const pipes = { a: makePipe('a', [[0, 0, 0], [1, 0, 0]]) };
    const result = extractForCopy(['a', 'doesntExist'], [], pipes, {});
    expect(result).not.toBeNull();
    expect(result!.pipes).toHaveLength(1);
  });

  it('captures pipes + fixtures together', () => {
    const pipes = { p1: makePipe('p1', [[0, 0, 0], [2, 0, 0]]) };
    const fixtures = { f1: makeFixture('f1', [1, 0, 1]) };
    const result = extractForCopy(['p1'], ['f1'], pipes, fixtures);
    expect(result).not.toBeNull();
    expect(result!.pipes).toHaveLength(1);
    expect(result!.fixtures).toHaveLength(1);
    expect(result!.version).toBe(CLIPBOARD_SCHEMA_VERSION);
  });

  it('deep-copies pipe points (no shared reference)', () => {
    const pipes = { p1: makePipe('p1', [[0, 0, 0], [5, 0, 0]]) };
    const result = extractForCopy(['p1'], [], pipes, {})!;
    // Mutate the original points — clipboard must not follow
    pipes.p1.points[0]![0] = 999;
    expect(result.pipes[0]!.points[0]![0]).toBe(0);
  });

  it('deep-copies fixture params (no shared reference)', () => {
    const fixtures = { f1: makeFixture('f1', [1, 0, 1]) };
    const result = extractForCopy([], ['f1'], {}, fixtures)!;
    // Mutate original params — clipboard must not follow
    (fixtures.f1.params as Record<string, unknown>).flushValveType = 'flushometer';
    expect(result.fixtures[0]!.params.flushValveType).toBe('tank');
  });

  it('does NOT carry `selected` flag on pipes', () => {
    const pipes = { p1: { ...makePipe('p1', [[0, 0, 0], [1, 0, 0]]), selected: true } };
    const result = extractForCopy(['p1'], [], pipes, {})!;
    expect('selected' in result.pipes[0]!).toBe(false);
  });

  it('does NOT carry connectedPipeIds on fixtures', () => {
    const fixtures = { f1: makeFixture('f1', [1, 0, 1]) };
    const result = extractForCopy([], ['f1'], {}, fixtures)!;
    expect('connectedPipeIds' in result.fixtures[0]!).toBe(false);
  });

  it('records copiedAt timestamp', () => {
    const fixtures = { f1: makeFixture('f1', [1, 0, 1]) };
    const result = extractForCopy([], ['f1'], {}, fixtures, 42)!;
    expect(result.copiedAt).toBe(42);
  });

  it('computes anchor as centroid of payload', () => {
    const fixtures = {
      f1: makeFixture('f1', [0, 0, 0]),
      f2: makeFixture('f2', [10, 0, 0]),
    };
    const result = extractForCopy([], ['f1', 'f2'], {}, fixtures)!;
    expect(result.anchor).toEqual([5, 0, 0]);
  });
});

// ── preparePaste ───────────────────────────────────────────────

describe('preparePaste', () => {
  function mkPayload(): ClipboardPayload {
    return {
      version: CLIPBOARD_SCHEMA_VERSION,
      pipes: [{
        points: [[0, 0, 0], [2, 0, 0]],
        diameter: 2,
        material: 'pvc',
        system: 'waste',
        color: '#ffa726',
        visible: true,
      }],
      fixtures: [{
        subtype: 'lavatory',
        position: [1, 0, 1],
        params: { faucetType: 'standard' },
      }],
      anchor: [1, 0, 0.5],
      copiedAt: 0,
    };
  }

  it('assigns fresh ids via idGen', () => {
    const payload = mkPayload();
    let counter = 0;
    const idGen = () => `id-${counter++}`;
    const result = preparePaste(payload, [0, 0, 0], idGen);
    expect(result.pipes[0]!.id).toBe('id-0');
    expect(result.fixtures[0]!.id).toBe('id-1');
  });

  it('offsets every point by delta', () => {
    const payload = mkPayload();
    const result = preparePaste(payload, [10, 0, 5], () => 'new');
    expect(result.pipes[0]!.points[0]).toEqual([10, 0, 5]);
    expect(result.pipes[0]!.points[1]).toEqual([12, 0, 5]);
    expect(result.fixtures[0]!.position).toEqual([11, 0, 6]);
  });

  it('preserves pipe material / system / diameter', () => {
    const payload = mkPayload();
    const r = preparePaste(payload, [0, 0, 0], () => 'new');
    expect(r.pipes[0]!.material).toBe('pvc');
    expect(r.pipes[0]!.system).toBe('waste');
    expect(r.pipes[0]!.diameter).toBe(2);
    expect(r.pipes[0]!.color).toBe('#ffa726');
  });

  it('deep-copies pasted params (clipboard stays reusable)', () => {
    const payload = mkPayload();
    const r = preparePaste(payload, [0, 0, 0], () => 'new');
    (r.fixtures[0]!.params as Record<string, unknown>).faucetType = 'mutated';
    expect(payload.fixtures[0]!.params.faucetType).toBe('standard');
  });

  it('handles empty payload sections', () => {
    const payload: ClipboardPayload = {
      version: CLIPBOARD_SCHEMA_VERSION,
      pipes: [],
      fixtures: [{
        subtype: 'shower',
        position: [0, 0, 0],
        params: {},
      }],
      anchor: [0, 0, 0],
      copiedAt: 0,
    };
    const r = preparePaste(payload, [1, 0, 1], () => 'x');
    expect(r.pipes).toHaveLength(0);
    expect(r.fixtures).toHaveLength(1);
    expect(r.fixtures[0]!.position).toEqual([1, 0, 1]);
  });
});

// ── deltaForTarget ─────────────────────────────────────────────

describe('deltaForTarget', () => {
  it('returns target − anchor', () => {
    expect(deltaForTarget([1, 2, 3], [10, 20, 30])).toEqual([9, 18, 27]);
  });

  it('is zero when anchor equals target', () => {
    expect(deltaForTarget([5, 5, 5], [5, 5, 5])).toEqual([0, 0, 0]);
  });
});

// ── computePayloadCentroid ─────────────────────────────────────

describe('computePayloadCentroid', () => {
  it('returns origin when payload is empty', () => {
    expect(computePayloadCentroid([], [])).toEqual([0, 0, 0]);
  });

  it('averages pipe points and fixture positions equally', () => {
    const pipes = [{
      points: [[0, 0, 0], [4, 0, 0]] as [number, number, number][],
      diameter: 2,
      material: 'pvc',
      system: 'waste' as const,
      color: '#fff',
      visible: true,
    }];
    const fixtures = [{
      subtype: 'water_closet' as const,
      position: [2, 0, 2] as [number, number, number],
      params: {},
    }];
    // 3 points total: (0,0,0), (4,0,0), (2,0,2)  →  mean = (2, 0, 2/3)
    const c = computePayloadCentroid(pipes, fixtures);
    expect(c[0]).toBeCloseTo(2);
    expect(c[1]).toBeCloseTo(0);
    expect(c[2]).toBeCloseTo(2 / 3);
  });
});

// ── Round-trip ─────────────────────────────────────────────────

describe('extract → preparePaste round trip', () => {
  it('preserves geometry when delta is zero (fresh ids only)', () => {
    const pipes = { p1: makePipe('p1', [[0, 0, 0], [3, 0, 0], [3, 0, 4]]) };
    const fixtures = { f1: makeFixture('f1', [7, 0, 2]) };

    const payload = extractForCopy(['p1'], ['f1'], pipes, fixtures)!;
    let n = 0;
    const r = preparePaste(payload, [0, 0, 0], () => `n${n++}`);

    expect(r.pipes[0]!.points).toEqual([[0, 0, 0], [3, 0, 0], [3, 0, 4]]);
    expect(r.pipes[0]!.id).toBe('n0');
    expect(r.pipes[0]!.id).not.toBe('p1');
    expect(r.fixtures[0]!.position).toEqual([7, 0, 2]);
    expect(r.fixtures[0]!.id).not.toBe('f1');
  });

  it('duplicate-in-place offsets by DEFAULT_DUPLICATE_OFFSET', () => {
    const pipes = { p1: makePipe('p1', [[0, 0, 0], [1, 0, 0]]) };
    const payload = extractForCopy(['p1'], [], pipes, {})!;
    const r = preparePaste(payload, DEFAULT_DUPLICATE_OFFSET, () => 'n');
    // +1 in X, +0 in Y, +1 in Z
    expect(r.pipes[0]!.points[0]).toEqual([1, 0, 1]);
    expect(r.pipes[0]!.points[1]).toEqual([2, 0, 1]);
  });
});

// ── Schema ─────────────────────────────────────────────────────

describe('schema version', () => {
  it('is locked at 1', () => {
    // Any bump requires a matching migration + review.
    expect(CLIPBOARD_SCHEMA_VERSION).toBe(1);
  });
});
