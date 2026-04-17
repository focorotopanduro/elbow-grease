/**
 * BOM Exporter — generates procurement-ready Bill of Materials.
 *
 * Combines data from:
 *   - CutLengthOptimizer (stock pieces with minimal waste)
 *   - FittingGenerator (fitting counts by type/size)
 *   - FixtureFlowProfile (fixture specifications)
 *   - PipeMaterial cost tables (2026 contractor pricing)
 *
 * Output formats:
 *   - CSV  — importable into Excel, QuickBooks, contractor spreadsheets
 *   - JSON — machine-readable for API integration / procurement systems
 *
 * Each line item includes:
 *   - Description, material, size, quantity, unit, unit cost, total cost
 *   - Supplier part number hint (generic, not brand-specific)
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { FittingInstance } from '../../ui/pipe/FittingGenerator';
import { optimizeCutList, type CutListResult } from './CutLengthOptimizer';
import { COST_PER_FT, type PipeMaterial, type FittingType } from '../graph/GraphEdge';

// ── Fitting costs (per unit, approximate 2026 contractor pricing) ─

const FITTING_COSTS: Record<string, Record<number, number>> = {
  elbow_90:     { 0.5: 0.85, 0.75: 1.20, 1: 1.80, 1.5: 3.50, 2: 5.00, 3: 12, 4: 22 },
  elbow_45:     { 0.5: 0.75, 0.75: 1.00, 1: 1.50, 1.5: 3.00, 2: 4.50, 3: 10, 4: 18 },
  tee:          { 0.5: 1.20, 0.75: 1.80, 1: 2.50, 1.5: 5.00, 2: 8.00, 3: 18, 4: 32 },
  sanitary_tee: { 1.5: 6.00, 2: 9.00, 3: 22, 4: 38 },
  wye:          { 1.5: 5.50, 2: 8.50, 3: 20, 4: 35 },
  coupling:     { 0.5: 0.40, 0.75: 0.55, 1: 0.80, 1.5: 1.50, 2: 2.50, 3: 5, 4: 9 },
  reducer:      { 0.75: 1.50, 1: 2.00, 1.5: 3.50, 2: 5.50, 3: 12, 4: 20 },
  cap:          { 0.5: 0.30, 0.75: 0.40, 1: 0.60, 1.5: 1.00, 2: 1.50, 3: 3, 4: 5 },
  p_trap:       { 1.25: 8.00, 1.5: 10.00, 2: 14.00 },
  cleanout_adapter: { 1.5: 4.00, 2: 5.50, 3: 9.00, 4: 14.00 },
};

function fittingCost(type: string, diameter: number): number {
  const table = FITTING_COSTS[type];
  if (!table) return 5; // default

  const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
  const closest = sizes.reduce((prev, curr) =>
    Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
  );
  return table[closest] ?? 5;
}

// ── BOM line item ───────────────────────────────────────────────

export interface BOMItem {
  category: 'pipe' | 'fitting' | 'fixture' | 'support' | 'misc';
  description: string;
  material: string;
  size: string;
  quantity: number;
  unit: string;
  unitCost: number;
  totalCost: number;
  partHint: string;
}

export interface BOMReport {
  items: BOMItem[];
  subtotals: {
    pipe: number;
    fitting: number;
    fixture: number;
    support: number;
    misc: number;
  };
  grandTotal: number;
  cutList: CutListResult;
  generatedAt: string;
}

// ── Generate BOM ────────────────────────────────────────────────

export function generateBOM(
  pipes: CommittedPipe[],
  fittings: FittingInstance[],
): BOMReport {
  const items: BOMItem[] = [];

  // ── Pipe stock (from cut list optimizer) ────────────────────
  const cutList = optimizeCutList(pipes);

  for (const summary of cutList.summary) {
    const mat = summary.material as PipeMaterial;
    const costTable = COST_PER_FT[mat];
    const sizes = costTable ? Object.keys(costTable).map(Number) : [];
    const closestSize = sizes.reduce(
      (prev, curr) => Math.abs(curr - summary.diameter) < Math.abs(prev - summary.diameter) ? curr : prev,
      sizes[0] ?? 0,
    );
    const costPerFt = costTable?.[closestSize] ?? 5;

    items.push({
      category: 'pipe',
      description: `${summary.material.replace(/_/g, ' ')} ${summary.diameter}" pipe`,
      material: summary.material,
      size: `${summary.diameter}"`,
      quantity: summary.stockPiecesNeeded,
      unit: `${summary.stockLength}ft stick`,
      unitCost: costPerFt * summary.stockLength,
      totalCost: costPerFt * summary.totalStockLength,
      partHint: `${summary.material.toUpperCase()}-${summary.diameter}-${summary.stockLength}FT`,
    });
  }

  // ── Fittings (counted by type + diameter) ───────────────────
  const fittingCounts = new Map<string, { type: string; diameter: number; count: number }>();
  for (const f of fittings) {
    const key = `${f.type}|${f.diameter}`;
    const existing = fittingCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      fittingCounts.set(key, { type: f.type, diameter: f.diameter, count: 1 });
    }
  }

  for (const [, { type, diameter, count }] of fittingCounts) {
    const cost = fittingCost(type, diameter);
    items.push({
      category: 'fitting',
      description: `${type.replace(/_/g, ' ')} ${diameter}"`,
      material: 'PVC', // infer from pipe material if needed
      size: `${diameter}"`,
      quantity: count,
      unit: 'ea',
      unitCost: cost,
      totalCost: cost * count,
      partHint: `FIT-${type.toUpperCase()}-${diameter}`,
    });
  }

  // ── Pipe supports (estimated from cut list) ─────────────────
  const totalHorizLength = cutList.totalUsedLength;
  const supportCount = Math.ceil(totalHorizLength / 4); // one every 4ft
  if (supportCount > 0) {
    items.push({
      category: 'support',
      description: 'Pipe hanger / strap',
      material: 'Steel',
      size: 'assorted',
      quantity: supportCount,
      unit: 'ea',
      unitCost: 1.50,
      totalCost: supportCount * 1.50,
      partHint: 'HANGER-STRAP',
    });
  }

  // ── Primer and cement (PVC/ABS/CPVC) ────────────────────────
  const pvcPipes = pipes.filter((p) =>
    p.material.includes('pvc') || p.material.includes('abs') || p.material.includes('cpvc'),
  );
  if (pvcPipes.length > 0) {
    items.push({
      category: 'misc',
      description: 'PVC primer (purple)',
      material: 'Chemical',
      size: '8oz',
      quantity: Math.ceil(cutList.totalUsedLength / 200), // 1 can per 200ft
      unit: 'can',
      unitCost: 6.50,
      totalCost: Math.ceil(cutList.totalUsedLength / 200) * 6.50,
      partHint: 'PRIMER-PVC-8OZ',
    });
    items.push({
      category: 'misc',
      description: 'PVC cement (clear/blue)',
      material: 'Chemical',
      size: '8oz',
      quantity: Math.ceil(cutList.totalUsedLength / 200),
      unit: 'can',
      unitCost: 7.50,
      totalCost: Math.ceil(cutList.totalUsedLength / 200) * 7.50,
      partHint: 'CEMENT-PVC-8OZ',
    });
  }

  // ── Subtotals ───────────────────────────────────────────────
  const subtotals = {
    pipe: items.filter((i) => i.category === 'pipe').reduce((s, i) => s + i.totalCost, 0),
    fitting: items.filter((i) => i.category === 'fitting').reduce((s, i) => s + i.totalCost, 0),
    fixture: items.filter((i) => i.category === 'fixture').reduce((s, i) => s + i.totalCost, 0),
    support: items.filter((i) => i.category === 'support').reduce((s, i) => s + i.totalCost, 0),
    misc: items.filter((i) => i.category === 'misc').reduce((s, i) => s + i.totalCost, 0),
  };

  return {
    items,
    subtotals,
    grandTotal: Object.values(subtotals).reduce((s, v) => s + v, 0),
    cutList,
    generatedAt: new Date().toISOString(),
  };
}

// ── CSV export ──────────────────────────────────────────────────

export function bomToCSV(report: BOMReport): string {
  const header = 'Category,Description,Material,Size,Qty,Unit,Unit Cost,Total Cost,Part #';
  const rows = report.items.map((item) =>
    `${item.category},"${item.description}",${item.material},${item.size},${item.quantity},${item.unit},$${item.unitCost.toFixed(2)},$${item.totalCost.toFixed(2)},${item.partHint}`,
  );

  rows.push('');
  rows.push(`,,,,,,SUBTOTAL PIPE:,$${report.subtotals.pipe.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL FITTINGS:,$${report.subtotals.fitting.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL SUPPORTS:,$${report.subtotals.support.toFixed(2)}`);
  rows.push(`,,,,,,SUBTOTAL MISC:,$${report.subtotals.misc.toFixed(2)}`);
  rows.push(`,,,,,,GRAND TOTAL:,$${report.grandTotal.toFixed(2)}`);
  rows.push('');
  rows.push(`,,,,,,Waste %:,${report.cutList.wastePercent.toFixed(1)}%`);
  rows.push(`,,,,,,Generated:,${report.generatedAt}`);

  return [header, ...rows].join('\n');
}

// ── JSON export ─────────────────────────────────────────────────

export function bomToJSON(report: BOMReport): string {
  return JSON.stringify(report, null, 2);
}

// ── File download helper ────────────────────────────────────────

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
