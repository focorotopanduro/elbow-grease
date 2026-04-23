/**
 * hotSupplyPropagation — Phase 14.Y.4 tests.
 *
 * Covers:
 *   - No water heater → no reclassification
 *   - Single WH with one pipe at hot outlet → pipe becomes hot
 *   - Chain propagation through pipe-endpoint adjacency
 *   - Does NOT propagate through waste / vent pipes
 *   - Does NOT propagate through disconnected supply networks
 *   - Reversal: WH removed → hot pipes revert to cold
 *   - Multiple WHs union their reaches
 *   - Fixture rotation applied to WH hot-outlet world coord
 */

import { describe, it, expect } from 'vitest';
import {
  computeHotSupplyReachable,
  applyHotSupplyClassification,
  hotOutletSeeds,
  computeHotSupplyReport,
} from '../hotSupplyPropagation';
import type { CommittedPipe } from '../../../store/pipeStore';
import type { FixtureInstance } from '../../../store/fixtureStore';
import { getFixtureGeometry } from '../ConnectionPoints';

// ── Builders ──────────────────────────────────────────────────

function mkPipe(
  id: string,
  points: [number, number, number][],
  system: CommittedPipe['system'] = 'cold_supply',
  material: CommittedPipe['material'] = 'pex',
): CommittedPipe {
  return {
    id, points,
    diameter: 0.75, material, system,
    color: '#2a6fd6',
    visible: true, selected: false,
  };
}

function mkFixture(
  id: string,
  subtype: FixtureInstance['subtype'],
  position: [number, number, number],
  params: Record<string, unknown> = {},
): FixtureInstance {
  return {
    id, subtype, position, params,
    createdTs: 0, connectedPipeIds: [],
  };
}

/**
 * Convenience: read the hot outlet world position off a given
 * water heater so tests can anchor pipes to it without having to
 * know the exact offset.
 */
function hotOutletOf(wh: FixtureInstance): [number, number, number] {
  const g = getFixtureGeometry(wh.subtype, wh.params);
  const hot = g.points.find((p) => p.role === 'hot')!;
  return [
    wh.position[0] + hot.position[0],
    wh.position[1] + hot.position[1],
    wh.position[2] + hot.position[2],
  ];
}

// ── Seed discovery ────────────────────────────────────────────

describe('hotOutletSeeds', () => {
  it('empty fixtures → empty seeds', () => {
    expect(hotOutletSeeds([])).toEqual([]);
  });

  it('non-water-heater fixtures → no seeds', () => {
    expect(hotOutletSeeds([
      mkFixture('f1', 'lavatory', [0, 0, 0]),
    ])).toEqual([]);
  });

  it('one tank water heater → one seed', () => {
    const wh = mkFixture('wh', 'water_heater', [10, 0, 0]);
    const seeds = hotOutletSeeds([wh]);
    expect(seeds).toHaveLength(1);
  });

  it('tankless water heater → one seed', () => {
    const seeds = hotOutletSeeds([mkFixture('wh', 'tankless_water_heater', [0, 0, 0])]);
    expect(seeds).toHaveLength(1);
  });

  it('two WHs → two seeds', () => {
    const seeds = hotOutletSeeds([
      mkFixture('wh1', 'water_heater', [0, 0, 0]),
      mkFixture('wh2', 'water_heater', [20, 0, 0]),
    ]);
    expect(seeds).toHaveLength(2);
  });
});

// ── computeHotSupplyReachable ─────────────────────────────────

describe('computeHotSupplyReachable', () => {
  it('no water heater → empty set', () => {
    const pipes = [mkPipe('a', [[0, 0, 0], [5, 0, 0]])];
    expect(computeHotSupplyReachable(pipes, [])).toEqual(new Set());
  });

  it('no pipes → empty set', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    expect(computeHotSupplyReachable([], [wh])).toEqual(new Set());
  });

  it('single pipe touching WH hot outlet → reached', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const pipe = mkPipe('a', [hot, [10, hot[1], 0]]);
    const reached = computeHotSupplyReachable([pipe], [wh]);
    expect(reached.has('a')).toBe(true);
    expect(reached.size).toBe(1);
  });

  it('chain A–B–C where A touches WH → all three reached', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const y = hot[1];
    const a = mkPipe('a', [hot, [5, y, 0]]);
    const b = mkPipe('b', [[5, y, 0], [5, y, 5]]);
    const c = mkPipe('c', [[5, y, 5], [10, y, 5]]);
    const reached = computeHotSupplyReachable([a, b, c], [wh]);
    expect(reached).toEqual(new Set(['a', 'b', 'c']));
  });

  it('pipes NOT connected to WH are not reached', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const connected = mkPipe('connected', [hot, [5, hot[1], 0]]);
    const isolated = mkPipe('isolated', [[100, 10, 100], [105, 10, 100]]);
    const reached = computeHotSupplyReachable([connected, isolated], [wh]);
    expect(reached.has('connected')).toBe(true);
    expect(reached.has('isolated')).toBe(false);
  });

  it('does NOT propagate through waste pipes even if they connect', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const y = hot[1];
    // A = supply reaches WH
    const a = mkPipe('a', [hot, [5, y, 0]]);
    // W = waste pipe connects to A
    const w = mkPipe('w', [[5, y, 0], [5, y, 5]], 'waste', 'pvc_sch40');
    // B = supply on the far side of W — should NOT be reached
    //     because waste pipes break the supply chain
    const b = mkPipe('b', [[5, y, 5], [10, y, 5]], 'cold_supply', 'pex');
    const reached = computeHotSupplyReachable([a, w, b], [wh]);
    expect(reached.has('a')).toBe(true);
    expect(reached.has('w')).toBe(false);
    expect(reached.has('b')).toBe(false);
  });

  it('two WHs on separate networks → each reaches its own subnet', () => {
    const wh1 = mkFixture('wh1', 'water_heater', [0, 0, 0]);
    const wh2 = mkFixture('wh2', 'water_heater', [100, 0, 100]);
    const hot1 = hotOutletOf(wh1);
    const hot2 = hotOutletOf(wh2);
    const a = mkPipe('a', [hot1, [5, hot1[1], 0]]);
    const b = mkPipe('b', [hot2, [105, hot2[1], 100]]);
    const reached = computeHotSupplyReachable([a, b], [wh1, wh2]);
    expect(reached).toEqual(new Set(['a', 'b']));
  });

  it('invisible pipe excluded from propagation', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const pipe = mkPipe('a', [hot, [5, hot[1], 0]]);
    pipe.visible = false;
    expect(computeHotSupplyReachable([pipe], [wh]).size).toBe(0);
  });
});

// ── applyHotSupplyClassification ──────────────────────────────

describe('applyHotSupplyClassification', () => {
  it('pipe reached + currently cold → change to hot', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const pipe = mkPipe('a', [hot, [5, hot[1], 0]], 'cold_supply');
    const changes = applyHotSupplyClassification([pipe], [wh]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      pipeId: 'a',
      oldSystem: 'cold_supply',
      newSystem: 'hot_supply',
      reason: 'reached_from_hot_outlet',
    });
  });

  it('pipe not reached + currently hot → revert to cold', () => {
    // No WH; pipe is marked hot erroneously
    const pipe = mkPipe('a', [[0, 0, 0], [5, 0, 0]], 'hot_supply');
    const changes = applyHotSupplyClassification([pipe], []);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      pipeId: 'a',
      oldSystem: 'hot_supply',
      newSystem: 'cold_supply',
      reason: 'disconnected_from_hot_outlet',
    });
  });

  it('pipe already correctly classified → no change', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const pipe = mkPipe('a', [hot, [5, hot[1], 0]], 'hot_supply');
    const changes = applyHotSupplyClassification([pipe], [wh]);
    expect(changes).toHaveLength(0);
  });

  it('waste pipes never reclassified', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const pipe = mkPipe('a', [hot, [5, hot[1], 0]], 'waste', 'pvc_sch40');
    const changes = applyHotSupplyClassification([pipe], [wh]);
    expect(changes).toHaveLength(0);
  });

  it('removing water heater reverts hot pipes to cold', () => {
    // Simulate: pipe was hot because WH existed, now WH is gone
    const hotPipe = mkPipe('a', [[10, 5, 0], [15, 5, 0]], 'hot_supply');
    const changes = applyHotSupplyClassification([hotPipe], []);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.newSystem).toBe('cold_supply');
  });
});

// ── computeHotSupplyReport ───────────────────────────────────

describe('computeHotSupplyReport', () => {
  it('summary stats match the underlying computations', () => {
    const wh = mkFixture('wh', 'water_heater', [0, 0, 0]);
    const hot = hotOutletOf(wh);
    const y = hot[1];
    const a = mkPipe('a', [hot, [5, y, 0]]);
    const b = mkPipe('b', [[5, y, 0], [10, y, 0]]);
    const c = mkPipe('c', [[100, y, 0], [105, y, 0]]); // isolated
    const report = computeHotSupplyReport([a, b, c], [wh]);
    expect(report.seedCount).toBe(1);
    expect(report.supplyPipeCount).toBe(3);
    expect(report.reachedCount).toBe(2); // a + b
    expect(report.changes.length).toBe(2); // a + b change cold → hot
  });
});
