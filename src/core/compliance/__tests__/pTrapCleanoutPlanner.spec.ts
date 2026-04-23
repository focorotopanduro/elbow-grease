/**
 * pTrapCleanoutPlanner — Phase 14.D tests.
 *
 * Covers:
 *   • P-traps emitted for drain fixtures (lavatory, sink, shower, tub…)
 *   • No p-trap for water_closet or floor_drain (integral traps)
 *   • No p-trap for hose_bibb (supply only)
 *   • Trap diameter defaults to 1.5" for most fixtures, 2" for floor drain,
 *     3" for water closet (the latter two skipped, but diameter metadata
 *     still exposed via helper)
 *   • Material inference: p-trap picks the nearest drain pipe's material
 *     and falls back to rules.defaultDrainMaterial if none found
 *   • Cleanouts only on waste + storm pipes (not supply, not vent)
 *   • Stack-base cleanout at vertical → horizontal transition
 *   • Direction-change cleanout at horizontal bends > 45°
 *   • No cleanout on shallow horizontal bends (e.g. 30°)
 *   • Long-run cleanouts injected at 100 ft intervals (one @ 100, two @ 210, etc.)
 *   • End-of-run cleanout at dangling pipe endpoints
 *   • Fixture-terminated endpoint is NOT flagged as dangling
 *   • Junction-connected endpoint is NOT flagged as dangling
 *   • Dedupe of position-overlapping cleanouts
 *   • planToFittings produces valid FittingInstance objects for BOM
 */

import { describe, it, expect } from 'vitest';
import {
  planPTrapsAndCleanouts,
  planToFittings,
  classifySegment,
  angleDegBetween,
  DEFAULT_PLANNER_RULES,
  type CleanoutReason,
} from '../pTrapCleanoutPlanner';
import type { CommittedPipe } from '@store/pipeStore';
import type { FixtureInstance } from '@store/fixtureStore';
import type { FixtureSubtype } from '../../../engine/graph/GraphNode';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p-test',
    points: [[0, 0, 0], [10, 0, 0]],
    diameter: 2,
    material: 'pvc_sch40',
    system: 'waste',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...overrides,
  };
}

function mkFixture(
  subtype: FixtureSubtype,
  position: [number, number, number] = [0, 0, 0],
  id = `f-${subtype}`,
): FixtureInstance {
  return {
    id,
    subtype,
    position,
    params: {},
    createdTs: 0,
    connectedPipeIds: [],
  };
}

// ── P-trap rules ──────────────────────────────────────────────

describe('p-traps — fixture trap requirements', () => {
  it('emits a p-trap for each drain fixture that lacks an integral trap', () => {
    const plan = planPTrapsAndCleanouts(
      [],
      [
        mkFixture('lavatory', [5, 0, 0], 'f1'),
        mkFixture('kitchen_sink', [10, 0, 0], 'f2'),
        mkFixture('shower', [15, 0, 0], 'f3'),
        mkFixture('bathtub', [20, 0, 0], 'f4'),
      ],
    );
    expect(plan.pTraps).toHaveLength(4);
    expect(plan.pTraps.map((t) => t.fixtureId).sort()).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(plan.summary.pTrapCount).toBe(4);
  });

  it('skips water_closet (integral 3" trap)', () => {
    const plan = planPTrapsAndCleanouts([], [mkFixture('water_closet', [0, 0, 0])]);
    expect(plan.pTraps).toEqual([]);
  });

  it('skips floor_drain (integral 2" trap)', () => {
    const plan = planPTrapsAndCleanouts([], [mkFixture('floor_drain', [0, 0, 0])]);
    expect(plan.pTraps).toEqual([]);
  });

  it('skips hose_bibb (supply only, no drain)', () => {
    const plan = planPTrapsAndCleanouts([], [mkFixture('hose_bibb', [0, 0, 0])]);
    expect(plan.pTraps).toEqual([]);
  });

  it('assigns 1.5" trap for lavatory / sink / shower / tub / laundry_standpipe', () => {
    const plan = planPTrapsAndCleanouts(
      [],
      [
        mkFixture('lavatory'),
        mkFixture('kitchen_sink'),
        mkFixture('shower'),
        mkFixture('bathtub'),
        mkFixture('laundry_standpipe'),
      ],
    );
    expect(plan.pTraps.every((t) => t.trapDiameterInches === 1.5)).toBe(true);
  });

  it('tags each p-trap with IPC 1002.1 and a plain-English reason', () => {
    const plan = planPTrapsAndCleanouts([], [mkFixture('lavatory')]);
    expect(plan.pTraps[0]!.codeRef).toBe('IPC 1002.1');
    expect(plan.pTraps[0]!.reason).toMatch(/lavatory/i);
    expect(plan.pTraps[0]!.reason).toMatch(/p-trap/i);
  });
});

describe('p-traps — material inference', () => {
  it('picks the nearest waste-pipe material', () => {
    const plan = planPTrapsAndCleanouts(
      [
        mkPipe({ id: 'w1', material: 'pvc_sch40', points: [[0, 0, 0], [5, 0, 0]] }),
        mkPipe({ id: 'w2', material: 'cast_iron', points: [[100, 0, 0], [105, 0, 0]] }),
      ],
      [mkFixture('lavatory', [1, 0, 0])],
    );
    expect(plan.pTraps[0]!.material).toBe('pvc_sch40');
  });

  it('prefers closer pipe even if farther pipe has different material', () => {
    const plan = planPTrapsAndCleanouts(
      [
        mkPipe({ id: 'w1', material: 'cast_iron', points: [[0, 0, 0], [5, 0, 0]] }),
        mkPipe({ id: 'w2', material: 'pvc_sch40', points: [[50, 0, 0], [55, 0, 0]] }),
      ],
      [mkFixture('lavatory', [1, 0, 0])],
    );
    expect(plan.pTraps[0]!.material).toBe('cast_iron');
  });

  it('falls back to rules.defaultDrainMaterial when no drain pipe exists', () => {
    const plan = planPTrapsAndCleanouts(
      [],
      [mkFixture('lavatory', [1, 0, 0])],
      { ...DEFAULT_PLANNER_RULES, defaultDrainMaterial: 'abs' },
    );
    expect(plan.pTraps[0]!.material).toBe('abs');
  });

  it('ignores supply pipes when inferring trap material', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ system: 'cold_supply', material: 'copper_type_l', points: [[0, 0, 0], [5, 0, 0]] })],
      [mkFixture('lavatory', [1, 0, 0])],
    );
    // No drain found → fallback to default.
    expect(plan.pTraps[0]!.material).toBe(DEFAULT_PLANNER_RULES.defaultDrainMaterial);
  });
});

// ── Cleanout rules ────────────────────────────────────────────

describe('cleanouts — system filtering', () => {
  it('skips supply pipes', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ system: 'cold_supply', points: [[0, 0, 0], [10, 0, 0], [10, 0, 10]] })],
      [],
    );
    expect(plan.cleanouts).toHaveLength(0);
  });

  it('skips vent pipes', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ system: 'vent', points: [[0, 0, 0], [0, 10, 0], [5, 10, 0]] })],
      [],
    );
    expect(plan.cleanouts).toHaveLength(0);
  });

  it('processes waste pipes', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ system: 'waste', points: [[0, 0, 0], [10, 0, 0]] })],
      [],
    );
    // Two dangling endpoints.
    expect(plan.cleanouts.length).toBeGreaterThanOrEqual(2);
  });

  it('processes storm pipes', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ system: 'storm', points: [[0, 0, 0], [50, 0, 0]] })],
      [],
    );
    expect(plan.cleanouts.length).toBeGreaterThan(0);
  });
});

describe('cleanouts — stack base', () => {
  it('emits stack_base at vertical → horizontal transition', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 10, 0], [0, 0, 0], [10, 0, 0]] })],
      [],
    );
    const stackBase = plan.cleanouts.filter((c) => c.reason === 'stack_base');
    expect(stackBase).toHaveLength(1);
    expect(stackBase[0]!.position).toEqual([0, 0, 0]);
    expect(stackBase[0]!.codeRef).toBe('IPC 708.1.2');
  });

  it('emits stack_base at horizontal → vertical transition too', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [5, 0, 0], [5, 10, 0]] })],
      [],
    );
    const stackBase = plan.cleanouts.filter((c) => c.reason === 'stack_base');
    expect(stackBase).toHaveLength(1);
    expect(stackBase[0]!.position).toEqual([5, 0, 0]);
  });
});

describe('cleanouts — direction change > 45°', () => {
  it('emits direction_change at a 90° horizontal bend', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0], [10, 0, 10]] })],
      [],
    );
    const bend = plan.cleanouts.filter((c) => c.reason === 'direction_change_gt_45');
    expect(bend).toHaveLength(1);
    expect(bend[0]!.position).toEqual([10, 0, 0]);
    expect(bend[0]!.codeRef).toBe('IPC 708.1.1');
  });

  it('does NOT emit cleanout for a 30° horizontal bend', () => {
    // Approximately 30° bend: a → b = (10, 0, 0); b → c = (10*cos30, 0, 10*sin30)
    const c: [number, number, number] = [10 + 10 * Math.cos(Math.PI / 6), 0, 10 * Math.sin(Math.PI / 6)];
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0], c] })],
      [],
    );
    const bend = plan.cleanouts.filter((c2) => c2.reason === 'direction_change_gt_45');
    expect(bend).toHaveLength(0);
  });

  it('emits cleanout at a 60° bend (above threshold)', () => {
    // 60° turn: b → c direction = (cos60°, 0, sin60°)
    const c: [number, number, number] = [10 + 10 * 0.5, 0, 10 * (Math.sqrt(3) / 2)];
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0], c] })],
      [],
    );
    const bend = plan.cleanouts.filter((c2) => c2.reason === 'direction_change_gt_45');
    expect(bend).toHaveLength(1);
  });
});

describe('cleanouts — long horizontal run', () => {
  it('injects a cleanout at 100 ft on a 150-ft straight horizontal run', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [150, 0, 0]] })],
      [],
    );
    const long = plan.cleanouts.filter((c) => c.reason === 'long_run_exceeds_100ft');
    expect(long).toHaveLength(1);
    expect(long[0]!.position[0]).toBeCloseTo(100, 3);
    expect(long[0]!.codeRef).toBe('IPC 708.1.5');
  });

  it('injects two cleanouts on a 210-ft straight run', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [210, 0, 0]] })],
      [],
    );
    const long = plan.cleanouts.filter((c) => c.reason === 'long_run_exceeds_100ft');
    expect(long).toHaveLength(2);
    expect(long[0]!.position[0]).toBeCloseTo(100, 3);
    expect(long[1]!.position[0]).toBeCloseTo(200, 3);
  });

  it('no long-run cleanout on a 50-ft run', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [50, 0, 0]] })],
      [],
    );
    const long = plan.cleanouts.filter((c) => c.reason === 'long_run_exceeds_100ft');
    expect(long).toHaveLength(0);
  });

  it('resets the 100-ft counter when a vertical segment breaks the run', () => {
    // 80 ft horizontal → 10 ft vertical → 80 ft horizontal = no 100-ft cleanout
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [80, 0, 0], [80, 10, 0], [160, 10, 0]] })],
      [],
    );
    const long = plan.cleanouts.filter((c) => c.reason === 'long_run_exceeds_100ft');
    expect(long).toHaveLength(0);
  });
});

describe('cleanouts — end of run', () => {
  it('flags both dangling endpoints as end_of_run', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
      [],
    );
    const ends = plan.cleanouts.filter((c) => c.reason === 'end_of_run');
    expect(ends).toHaveLength(2);
  });

  it('does NOT flag an endpoint that sits on a fixture', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
      [mkFixture('lavatory', [0, 0, 0])],
    );
    const ends = plan.cleanouts.filter((c) => c.reason === 'end_of_run');
    expect(ends).toHaveLength(1); // only the far end
    expect(ends[0]!.position).toEqual([10, 0, 0]);
  });

  it('does NOT flag an endpoint joined to another pipe within tolerance', () => {
    const plan = planPTrapsAndCleanouts(
      [
        mkPipe({ id: 'p1', points: [[0, 0, 0], [10, 0, 0]] }),
        mkPipe({ id: 'p2', points: [[10, 0, 0], [10, 0, 10]] }),
      ],
      [],
    );
    // The shared point (10,0,0) is NOT dangling for either pipe.
    // (0,0,0) and (10,0,10) are dangling.
    const ends = plan.cleanouts.filter((c) => c.reason === 'end_of_run');
    expect(ends).toHaveLength(2);
  });
});

describe('cleanouts — dedupe', () => {
  it('deduplicates position-overlapping cleanouts (stack base + end of run at same point)', () => {
    // Pipe: vertical section drops to origin, then horizontal.
    // Origin is both stack base AND end of another pipe's endpoint if
    // they share a point. The dedupe keeps only one.
    const plan = planPTrapsAndCleanouts(
      [
        mkPipe({ id: 'p1', points: [[0, 10, 0], [0, 0, 0], [10, 0, 0]] }),
        mkPipe({ id: 'p2', points: [[0, 0, 0], [0, -5, 0]] }),
      ],
      [],
    );
    const atOrigin = plan.cleanouts.filter((c) =>
      Math.abs(c.position[0]) < 0.01
      && Math.abs(c.position[1]) < 0.01
      && Math.abs(c.position[2]) < 0.01,
    );
    expect(atOrigin.length).toBeLessThanOrEqual(1);
  });
});

// ── planToFittings ────────────────────────────────────────────

describe('planToFittings', () => {
  it('emits a p_trap FittingInstance per PTrapRequirement', () => {
    const plan = planPTrapsAndCleanouts(
      [],
      [mkFixture('lavatory', [5, 0, 0])],
    );
    const fittings = planToFittings(plan);
    const traps = fittings.filter((f) => f.type === 'p_trap');
    expect(traps).toHaveLength(1);
    expect(traps[0]!.diameter).toBe(1.5);
    expect(traps[0]!.material).toBe('pvc_sch40');
  });

  it('emits cleanout_adapter FittingInstances per CleanoutRequirement', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [150, 0, 0]] })],
      [],
    );
    const fittings = planToFittings(plan);
    const cos = fittings.filter((f) => f.type === 'cleanout_adapter');
    // 2 ends + 1 long-run = 3
    expect(cos).toHaveLength(3);
    expect(cos[0]!.diameter).toBe(2);
    expect(cos[0]!.material).toBe('pvc_sch40');
  });

  it('assigns unique IDs to each generated fitting', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
      [mkFixture('lavatory', [5, 0, 0])],
    );
    const fittings = planToFittings(plan);
    const ids = fittings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces an empty array when the plan is empty', () => {
    const plan = planPTrapsAndCleanouts([], []);
    const fittings = planToFittings(plan);
    expect(fittings).toEqual([]);
  });
});

// ── summary counts ────────────────────────────────────────────

describe('summary.cleanoutsByReason', () => {
  it('breaks down cleanouts by reason code', () => {
    const plan = planPTrapsAndCleanouts(
      [mkPipe({ points: [[0, 10, 0], [0, 0, 0], [150, 0, 0]] })],
      [],
    );
    // stack_base at (0,0,0), long-run at (100,0,0), end at (150,0,0), end at (0,10,0)
    const s = plan.summary.cleanoutsByReason;
    expect(s.stack_base).toBe(1);
    expect(s.long_run_exceeds_100ft).toBe(1);
    expect(s.end_of_run).toBeGreaterThanOrEqual(2);
    // Total matches
    const totals: CleanoutReason[] = ['stack_base', 'long_run_exceeds_100ft', 'end_of_run', 'direction_change_gt_45'];
    const sum = totals.reduce((acc, k) => acc + s[k], 0);
    expect(sum).toBe(plan.summary.cleanoutCount);
  });
});

// ── Low-level helpers ─────────────────────────────────────────

describe('classifySegment', () => {
  it('identifies pure horizontal', () => {
    expect(classifySegment([10, 0, 0], 0.1)).toBe('horizontal');
    expect(classifySegment([0, 0, 5], 0.1)).toBe('horizontal');
    expect(classifySegment([3, 0, 4], 0.1)).toBe('horizontal');
  });

  it('identifies pure vertical', () => {
    expect(classifySegment([0, 10, 0], 0.1)).toBe('vertical');
    expect(classifySegment([0, -5, 0], 0.1)).toBe('vertical');
  });

  it('identifies diagonals', () => {
    expect(classifySegment([5, 5, 0], 0.1)).toBe('diagonal');
  });

  it('treats sub-tolerance vectors as zero', () => {
    expect(classifySegment([0.01, 0.01, 0.01], 0.1)).toBe('zero');
  });
});

describe('angleDegBetween', () => {
  it('90° for perpendicular vectors', () => {
    expect(angleDegBetween([10, 0, 0], [0, 0, 10])).toBeCloseTo(90, 2);
  });

  it('0° for parallel vectors', () => {
    expect(angleDegBetween([10, 0, 0], [5, 0, 0])).toBeCloseTo(0, 2);
  });

  it('180° for anti-parallel vectors', () => {
    expect(angleDegBetween([10, 0, 0], [-5, 0, 0])).toBeCloseTo(180, 2);
  });

  it('0° when either vector is zero', () => {
    expect(angleDegBetween([0, 0, 0], [1, 0, 0])).toBe(0);
  });
});
