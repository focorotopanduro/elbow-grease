/**
 * BOMExporter — Phase 13.A audit tests.
 *
 * Covers the audit-discovered guarantees that must hold on any bid:
 *
 *   Accuracy:
 *     • Labor hours are present + non-zero for pipes (non-consumable)
 *       and for fittings, zero for primer/cement (consumables).
 *     • Subtotal invariant — subtotals sum to grandTotal within float
 *       tolerance (no silent categorization bugs).
 *     • Labor line total = Σ item.laborHours (matches grandLaborHours).
 *     • Same-(type, diameter) fittings collapse into one line with
 *       count + correct per-line totals.
 *
 *   Formatting:
 *     • CSV exports the "Unit Labor Hrs" + "Total Labor Hrs" columns
 *       and the TOTAL LABOR HRS summary row.
 *     • Numeric fields use .toFixed(2) — no raw 12.10000000001.
 *
 *   Roundtrip:
 *     • An empty scene produces a valid BOM (empty items, $0 totals).
 *     • A known scene produces predictable item counts.
 */

import { describe, it, expect } from 'vitest';
import { generateBOM, bomToCSV, bomToJSON } from '../BOMExporter';
import type { CommittedPipe } from '@store/pipeStore';
import type { FittingInstance } from '@ui/pipe/FittingGenerator';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: overrides.id ?? 'p1',
    points: overrides.points ?? [[0, 0, 0], [10, 0, 0]],
    diameter: overrides.diameter ?? 2,
    material: overrides.material ?? 'pvc_sch40',
    system: overrides.system ?? 'waste',
    color: '#ffa726',
    visible: true,
    selected: false,
  };
}

function mkFitting(overrides: Partial<FittingInstance> = {}): FittingInstance {
  return {
    id: overrides.id ?? 'f1',
    type: overrides.type ?? 'elbow_90',
    position: overrides.position ?? [0, 0, 0],
    quaternion: overrides.quaternion ?? [0, 0, 0, 1],
    diameter: overrides.diameter ?? 2,
    material: overrides.material ?? 'pvc_sch40',
    pipeId: overrides.pipeId ?? 'p1',
  };
}

// ── Subtotal invariant ────────────────────────────────────────

describe('subtotal invariant', () => {
  it('subtotals sum to grandTotal (empty scene)', () => {
    const r = generateBOM([], []);
    expect(r.grandTotal).toBe(0);
    expect(Object.values(r.subtotals).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it('subtotals sum to grandTotal (populated scene) within float tolerance', () => {
    const r = generateBOM(
      [mkPipe(), mkPipe({ id: 'p2', diameter: 3, points: [[0, 0, 0], [10, 0, 0], [10, 0, 10]] })],
      [mkFitting(), mkFitting({ id: 'f2', type: 'tee', diameter: 3 })],
    );
    const sum = Object.values(r.subtotals).reduce((s, v) => s + v, 0);
    expect(Math.abs(sum - r.grandTotal)).toBeLessThan(0.01);
  });

  it('grandTotal equals Σ item.totalCost', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const itemSum = r.items.reduce((s, i) => s + i.totalCost, 0);
    expect(Math.abs(itemSum - r.grandTotal)).toBeLessThan(0.01);
  });
});

// ── Labor hours ───────────────────────────────────────────────

describe('labor hours (Phase 13.A)', () => {
  it('pipe items carry non-zero labor', () => {
    const r = generateBOM([mkPipe()], []);
    const pipeItem = r.items.find((i) => i.category === 'pipe');
    expect(pipeItem).toBeDefined();
    expect(pipeItem!.laborHours).toBeGreaterThan(0);
    expect(pipeItem!.unitLaborHours).toBeGreaterThan(0);
  });

  it('fitting items carry non-zero labor', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const fit = r.items.find((i) => i.category === 'fitting');
    expect(fit).toBeDefined();
    expect(fit!.laborHours).toBeGreaterThan(0);
  });

  it('consumables (primer, cement) carry zero labor', () => {
    const r = generateBOM([mkPipe()], []);
    const primer = r.items.find((i) => i.description.toLowerCase().includes('primer'));
    const cement = r.items.find((i) => i.description.toLowerCase().includes('cement'));
    expect(primer).toBeDefined();
    expect(cement).toBeDefined();
    expect(primer!.laborHours).toBe(0);
    expect(cement!.laborHours).toBe(0);
    expect(primer!.unitLaborHours).toBe(0);
  });

  it('grandLaborHours equals Σ item.laborHours', () => {
    const r = generateBOM(
      [mkPipe(), mkPipe({ id: 'p2', diameter: 3 })],
      [mkFitting(), mkFitting({ id: 'f2', type: 'tee', diameter: 3 })],
    );
    const sum = r.items.reduce((s, i) => s + i.laborHours, 0);
    expect(Math.abs(sum - r.grandLaborHours)).toBeLessThan(0.001);
    expect(r.grandLaborHours).toBeGreaterThan(0);
  });

  it('labor scales with quantity (2 elbows = 2x unit labor)', () => {
    const r = generateBOM(
      [mkPipe()],
      [mkFitting({ id: 'a' }), mkFitting({ id: 'b' })], // two identical elbows
    );
    const fit = r.items.find((i) => i.category === 'fitting');
    expect(fit!.quantity).toBe(2);
    expect(Math.abs(fit!.laborHours - fit!.unitLaborHours * 2)).toBeLessThan(0.001);
  });

  it('different pipe materials carry different labor rates (copper > pvc)', () => {
    const pvc = generateBOM([mkPipe({ material: 'pvc_sch40' })], []);
    const copper = generateBOM([mkPipe({ material: 'copper_type_l' })], []);
    const pvcPipeLabor = pvc.items.find((i) => i.category === 'pipe')!.laborHours;
    const copperPipeLabor = copper.items.find((i) => i.category === 'pipe')!.laborHours;
    expect(copperPipeLabor).toBeGreaterThan(pvcPipeLabor);
  });
});

// ── Fitting aggregation ───────────────────────────────────────

describe('fitting aggregation', () => {
  it('same-(type, diameter) fittings collapse into one line with count = sum', () => {
    const r = generateBOM(
      [mkPipe()],
      [
        mkFitting({ id: 'a', type: 'elbow_90', diameter: 2 }),
        mkFitting({ id: 'b', type: 'elbow_90', diameter: 2 }),
        mkFitting({ id: 'c', type: 'elbow_90', diameter: 2 }),
      ],
    );
    const elbows = r.items.filter((i) =>
      i.category === 'fitting' && i.description.includes('elbow 90'),
    );
    expect(elbows).toHaveLength(1);
    expect(elbows[0]!.quantity).toBe(3);
  });

  it('different diameters produce separate lines', () => {
    const r = generateBOM(
      [mkPipe()],
      [
        mkFitting({ id: 'a', type: 'elbow_90', diameter: 2 }),
        mkFitting({ id: 'b', type: 'elbow_90', diameter: 3 }),
      ],
    );
    const elbows = r.items.filter((i) =>
      i.category === 'fitting' && i.description.includes('elbow 90'),
    );
    expect(elbows).toHaveLength(2);
  });

  it('cross fitting is priced (Phase 13.A — new 4-way support)', () => {
    const r = generateBOM(
      [mkPipe()],
      [mkFitting({ type: 'cross', diameter: 2 })],
    );
    const cross = r.items.find((i) =>
      i.category === 'fitting' && i.description.includes('cross'),
    );
    expect(cross).toBeDefined();
    expect(cross!.unitCost).toBeGreaterThan(0);
    expect(cross!.laborHours).toBeGreaterThan(0);
  });
});

// ── CSV formatting ────────────────────────────────────────────

describe('CSV formatting', () => {
  it('includes labor columns in the header', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const csv = bomToCSV(r);
    const header = csv.split('\n')[0]!;
    expect(header).toContain('Unit Labor Hrs');
    expect(header).toContain('Total Labor Hrs');
  });

  it('emits TOTAL LABOR HRS summary row', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const csv = bomToCSV(r);
    expect(csv).toContain('TOTAL LABOR HRS:');
  });

  it('monetary fields use .toFixed(2) — no raw float artifacts', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const csv = bomToCSV(r);
    // Check: no runaway decimals like "12.100000001" appear in the CSV.
    expect(csv).not.toMatch(/\d\.\d{4,}/);
  });

  it('roundtrips through bomToJSON', () => {
    const r = generateBOM([mkPipe()], [mkFitting()]);
    const json = bomToJSON(r);
    const parsed = JSON.parse(json);
    expect(parsed.grandTotal).toBe(r.grandTotal);
    expect(parsed.grandLaborHours).toBe(r.grandLaborHours);
    expect(parsed.items.length).toBe(r.items.length);
  });
});

// ── Empty-scene safety ────────────────────────────────────────

describe('empty scene', () => {
  it('produces an empty, zero-value report', () => {
    const r = generateBOM([], []);
    expect(r.items).toHaveLength(0);
    expect(r.grandTotal).toBe(0);
    expect(r.grandLaborHours).toBe(0);
    expect(r.subtotals.pipe).toBe(0);
    expect(r.subtotals.fitting).toBe(0);
    expect(r.cutList.wastePercent).toBe(0);
  });
});
