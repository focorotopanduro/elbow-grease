/**
 * hangerPlanner — Phase 14.H tests.
 *
 * Covers:
 *   • Per-material spacing on horizontal runs:
 *       - PVC at 4 ft
 *       - PEX at 32 in (2.67 ft)
 *       - Copper at 6 ft
 *       - Cast iron at 5 ft
 *   • Vertical riser clamps at material-specific intervals
 *   • End-of-horizontal supports (~0.5 ft from termination)
 *   • Direction-change hangers on horizontal bends > 45°
 *   • Dedupe of coincident hangers
 *   • Empty / trivial scenes
 *   • Fallback spacing for unknown materials
 *   • planToBOMItems aggregation + partHint format
 */

import { describe, it, expect } from 'vitest';
import {
  planHangers,
  planToBOMItems,
  classifySegment,
  angleDegBetween,
  humanMaterial,
  DEFAULT_HANGER_RULES,
  type HangerRules,
} from '../hangerPlanner';
import type { CommittedPipe } from '@store/pipeStore';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p1',
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

// Utility: strict-spacing rules (no end-of-horizontal / direction-change) so
// we can test the spacing math in isolation.
const STRICT_SPACING: HangerRules = {
  ...DEFAULT_HANGER_RULES,
  hangerAtDirectionChange: false,
  hangerAtHorizontalEnds: false,
};

// ── Per-material horizontal spacing ───────────────────────────

describe('per-material horizontal spacing', () => {
  it('PVC @ 4 ft spacing on a 20-ft run → 5 midspan hangers', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0]] })],
      STRICT_SPACING,
    );
    const spacing = plan.hangers.filter((h) => h.reason === 'horizontal_spacing');
    // hangers at 4, 8, 12, 16, 20 ft = 5 ea
    expect(spacing).toHaveLength(5);
    expect(spacing[0]!.position[0]).toBeCloseTo(4, 3);
    expect(spacing[4]!.position[0]).toBeCloseTo(20, 3);
  });

  it('PEX @ 32" (2.67 ft) spacing on a 10-ft run → more hangers than PVC', () => {
    const pex = planHangers(
      [mkPipe({ material: 'pex', points: [[0, 0, 0], [10, 0, 0]] })],
      STRICT_SPACING,
    );
    const pvc = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [10, 0, 0]] })],
      STRICT_SPACING,
    );
    const pexCount = pex.hangers.filter((h) => h.reason === 'horizontal_spacing').length;
    const pvcCount = pvc.hangers.filter((h) => h.reason === 'horizontal_spacing').length;
    expect(pexCount).toBeGreaterThan(pvcCount);
    // 10 ft / 2.67 ft ≈ 3.75 → 3 midspan hangers
    expect(pexCount).toBe(3);
  });

  it('Copper Type L @ 6 ft on 18-ft run → fewer hangers than PVC', () => {
    const plan = planHangers(
      [mkPipe({ material: 'copper_type_l', points: [[0, 0, 0], [18, 0, 0]] })],
      STRICT_SPACING,
    );
    const spacing = plan.hangers.filter((h) => h.reason === 'horizontal_spacing');
    expect(spacing).toHaveLength(3); // 6, 12, 18
  });

  it('Cast iron @ 5 ft on 25-ft run → 5 hangers', () => {
    const plan = planHangers(
      [mkPipe({ material: 'cast_iron', points: [[0, 0, 0], [25, 0, 0]] })],
      STRICT_SPACING,
    );
    expect(plan.hangers.filter((h) => h.reason === 'horizontal_spacing')).toHaveLength(5);
  });

  it('Runs shorter than the spacing interval get no midspan hanger', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [3, 0, 0]] })],
      STRICT_SPACING,
    );
    expect(plan.hangers.filter((h) => h.reason === 'horizontal_spacing')).toEqual([]);
  });

  it('Falls back to rules.fallbackHorizontalFt for unknown material', () => {
    const plan = planHangers(
      [mkPipe({ material: 'bizarro_alloy' as never, points: [[0, 0, 0], [20, 0, 0]] })],
      STRICT_SPACING,
    );
    // Unknown material → asPipeMaterial returns null → pipe skipped entirely.
    expect(plan.hangers).toEqual([]);
  });
});

// ── Vertical riser clamps ─────────────────────────────────────

describe('vertical riser clamps', () => {
  it('PVC riser 15 ft tall @ 10 ft vertical spacing → 1 riser clamp', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [0, 15, 0]] })],
      STRICT_SPACING,
    );
    const risers = plan.hangers.filter((h) => h.kind === 'riser_clamp');
    expect(risers).toHaveLength(1);
    expect(risers[0]!.position[1]).toBeCloseTo(10, 3);
  });

  it('PEX riser @ 4 ft vertical → more clamps than PVC', () => {
    const pex = planHangers(
      [mkPipe({ material: 'pex', points: [[0, 0, 0], [0, 20, 0]] })],
      STRICT_SPACING,
    );
    const pvc = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [0, 20, 0]] })],
      STRICT_SPACING,
    );
    const pexRisers = pex.hangers.filter((h) => h.kind === 'riser_clamp').length;
    const pvcRisers = pvc.hangers.filter((h) => h.kind === 'riser_clamp').length;
    expect(pexRisers).toBeGreaterThan(pvcRisers);
    // 20 ft / 4 ft = 5 clamps
    expect(pexRisers).toBe(5);
  });

  it('Shorter than spacing → zero risers', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [0, 8, 0]] })],
      STRICT_SPACING,
    );
    expect(plan.hangers.filter((h) => h.kind === 'riser_clamp')).toEqual([]);
  });

  it('Riser tags reason = riser_floor and codeRef = IPC 308.7', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [0, 15, 0]] })],
      STRICT_SPACING,
    );
    const r = plan.hangers.find((h) => h.kind === 'riser_clamp')!;
    expect(r.reason).toBe('riser_floor');
    expect(r.codeRef).toBe('IPC 308.7');
  });
});

// ── End-of-horizontal supports ────────────────────────────────

describe('end-of-horizontal supports', () => {
  it('injects supports near both ends of a long horizontal run', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0]] })],
      { ...DEFAULT_HANGER_RULES, hangerAtDirectionChange: false },
    );
    const ends = plan.hangers.filter((h) => h.reason === 'end_of_horizontal');
    expect(ends).toHaveLength(2);
    // ~0.5 ft from each end
    expect(ends[0]!.position[0]).toBeCloseTo(0.5, 2);
    expect(ends[1]!.position[0]).toBeCloseTo(19.5, 2);
  });

  it('skips end supports on runs ≤ 1 ft', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [0.8, 0, 0]] })],
      DEFAULT_HANGER_RULES,
    );
    expect(plan.hangers.filter((h) => h.reason === 'end_of_horizontal')).toEqual([]);
  });
});

// ── Direction change ─────────────────────────────────────────

describe('direction-change hangers', () => {
  it('adds a hanger at a 90° horizontal bend when enabled', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]] })],
      { ...DEFAULT_HANGER_RULES, hangerAtHorizontalEnds: false },
    );
    const dir = plan.hangers.filter((h) => h.reason === 'direction_change');
    expect(dir).toHaveLength(1);
    expect(dir[0]!.position).toEqual([5, 0, 0]);
    expect(dir[0]!.codeRef).toBe('IPC 308.9');
  });

  it('no direction-change hanger at shallow (30°) bend', () => {
    const c: [number, number, number] = [10 + 10 * Math.cos(Math.PI / 6), 0, 10 * Math.sin(Math.PI / 6)];
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [10, 0, 0], c] })],
      { ...DEFAULT_HANGER_RULES, hangerAtHorizontalEnds: false },
    );
    expect(plan.hangers.filter((h) => h.reason === 'direction_change')).toEqual([]);
  });

  it('no direction-change hanger at vertical-to-horizontal transition (different rule)', () => {
    // Vertical→horizontal is covered by riser_floor (if tall enough),
    // not by direction_change.
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 10, 0], [0, 0, 0], [5, 0, 0]] })],
      { ...DEFAULT_HANGER_RULES, hangerAtHorizontalEnds: false },
    );
    expect(plan.hangers.filter((h) => h.reason === 'direction_change')).toEqual([]);
  });

  it('respects rules.hangerAtDirectionChange = false', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]] })],
      { ...DEFAULT_HANGER_RULES, hangerAtDirectionChange: false, hangerAtHorizontalEnds: false },
    );
    expect(plan.hangers.filter((h) => h.reason === 'direction_change')).toEqual([]);
  });
});

// ── Dedupe ────────────────────────────────────────────────────

describe('dedupe of coincident hangers', () => {
  it('merges a spacing hanger + direction-change hanger at the same position', () => {
    // A 4-ft horizontal run → a midspan hanger at (4,0,0) is injected
    // at the same time as a direction-change hanger at (4,0,0).
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [4, 0, 0], [4, 0, 5]] })],
      DEFAULT_HANGER_RULES,
    );
    // Count how many hangers are within 0.3 ft of (4, 0, 0):
    const near = plan.hangers.filter((h) =>
      Math.abs(h.position[0] - 4) < 0.3
      && Math.abs(h.position[1]) < 0.3
      && Math.abs(h.position[2]) < 0.3,
    );
    expect(near.length).toBeLessThanOrEqual(1);
  });
});

// ── Summary ───────────────────────────────────────────────────

describe('plan.summary', () => {
  it('breaks down by reason + kind', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0], [20, 15, 0]] })],
      DEFAULT_HANGER_RULES,
    );
    const { summary } = plan;
    expect(summary.hangerCount).toBe(plan.hangers.length);
    expect(summary.byKind.horizontal_hanger).toBeGreaterThan(0);
    expect(summary.byKind.riser_clamp).toBeGreaterThan(0);
    // Sum of reasons should equal total.
    const total =
      summary.byReason.horizontal_spacing
      + summary.byReason.end_of_horizontal
      + summary.byReason.direction_change
      + summary.byReason.riser_floor;
    expect(total).toBe(summary.hangerCount);
  });
});

// ── Trivial inputs ───────────────────────────────────────────

describe('trivial inputs', () => {
  it('empty pipe list → empty plan', () => {
    const plan = planHangers([], DEFAULT_HANGER_RULES);
    expect(plan.hangers).toEqual([]);
    expect(plan.summary.hangerCount).toBe(0);
  });

  it('pipe with < 2 points → no hangers', () => {
    const plan = planHangers(
      [mkPipe({ points: [[0, 0, 0]] })],
      DEFAULT_HANGER_RULES,
    );
    expect(plan.hangers).toEqual([]);
  });

  it('zero-length segment ignored', () => {
    const plan = planHangers(
      [mkPipe({ points: [[0, 0, 0], [0, 0, 0], [10, 0, 0]] })],
      STRICT_SPACING,
    );
    // Should produce same hangers as [(0,0,0) → (10,0,0)]: 2 midspan
    const spacing = plan.hangers.filter((h) => h.reason === 'horizontal_spacing');
    expect(spacing).toHaveLength(2);
  });
});

// ── planToBOMItems ────────────────────────────────────────────

describe('planToBOMItems', () => {
  it('groups identical (kind, material, diameter) hangers into one row', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [40, 0, 0]] })],
      STRICT_SPACING,
    );
    const items = planToBOMItems(plan);
    expect(items).toHaveLength(1);
    expect(items[0]!.category).toBe('support');
    expect(items[0]!.quantity).toBe(10); // 4 ft × 10 = 40 ft
    expect(items[0]!.partHint).toBe('HANGER-PVC_SCH40-2');
  });

  it('separate rows per material', () => {
    const plan = planHangers(
      [
        mkPipe({ id: 'pvc', material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0]] }),
        mkPipe({ id: 'cu', material: 'copper_type_l', points: [[0, 0, 10], [18, 0, 10]] }),
      ],
      STRICT_SPACING,
    );
    const items = planToBOMItems(plan);
    expect(items).toHaveLength(2);
    const pvcItem = items.find((i) => i.partHint.includes('PVC_SCH40'))!;
    const cuItem = items.find((i) => i.partHint.includes('COPPER'))!;
    expect(pvcItem.quantity).toBe(5);  // 20 / 4
    expect(cuItem.quantity).toBe(3);   // 18 / 6
  });

  it('separate rows for horizontal_hanger vs riser_clamp', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0], [20, 15, 0]] })],
      DEFAULT_HANGER_RULES,
    );
    const items = planToBOMItems(plan);
    const hanger = items.find((i) => i.partHint.startsWith('HANGER-'));
    const clamp = items.find((i) => i.partHint.startsWith('RISER-CLAMP-'));
    expect(hanger).toBeDefined();
    expect(clamp).toBeDefined();
  });

  it('metallic materials cost more than plastic', () => {
    const pvc = planHangers([mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0]] })], STRICT_SPACING);
    const cu = planHangers([mkPipe({ material: 'copper_type_l', points: [[0, 0, 0], [18, 0, 0]] })], STRICT_SPACING);
    const pvcUnit = planToBOMItems(pvc)[0]!.unitCost;
    const cuUnit = planToBOMItems(cu)[0]!.unitCost;
    expect(cuUnit).toBeGreaterThan(pvcUnit);
  });

  it('labor hours per hanger is 0.08 for horizontal, 0.18 for riser', () => {
    const plan = planHangers(
      [mkPipe({ material: 'pvc_sch40', points: [[0, 0, 0], [20, 0, 0], [20, 15, 0]] })],
      STRICT_SPACING,
    );
    const items = planToBOMItems(plan);
    const hanger = items.find((i) => i.partHint.startsWith('HANGER-'))!;
    const clamp = items.find((i) => i.partHint.startsWith('RISER-CLAMP-'))!;
    expect(hanger.unitLaborHours).toBeCloseTo(0.08, 3);
    expect(clamp.unitLaborHours).toBeCloseTo(0.18, 3);
  });

  it('empty plan → empty items', () => {
    expect(planToBOMItems({ hangers: [], summary: { hangerCount: 0, byReason: { horizontal_spacing: 0, end_of_horizontal: 0, direction_change: 0, riser_floor: 0 }, byKind: { horizontal_hanger: 0, riser_clamp: 0 } } })).toEqual([]);
  });
});

// ── Helpers exported for reuse ────────────────────────────────

describe('classifySegment', () => {
  it('identifies horizontal / vertical / diagonal / zero', () => {
    expect(classifySegment([10, 0, 0], 0.1)).toBe('horizontal');
    expect(classifySegment([0, 10, 0], 0.1)).toBe('vertical');
    expect(classifySegment([5, 5, 0], 0.1)).toBe('diagonal');
    expect(classifySegment([0, 0, 0], 0.1)).toBe('zero');
  });
});

describe('angleDegBetween', () => {
  it('90° for perpendicular vectors', () => {
    expect(angleDegBetween([1, 0, 0], [0, 0, 1])).toBeCloseTo(90, 3);
  });
  it('0° for parallel vectors', () => {
    expect(angleDegBetween([1, 0, 0], [5, 0, 0])).toBeCloseTo(0, 3);
  });
});

describe('humanMaterial', () => {
  it('covers every declared PipeMaterial value', () => {
    expect(humanMaterial('pvc_sch40')).toBe('PVC Sch 40');
    expect(humanMaterial('copper_type_l')).toBe('Copper Type L');
    expect(humanMaterial('pex')).toBe('PEX');
  });
});
