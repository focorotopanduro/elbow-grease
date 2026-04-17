/**
 * Cut Length Optimizer — breaks pipe routes into standard stock
 * lengths with minimal material waste.
 *
 * Pipe comes in standard stock lengths (10ft, 20ft for PVC/ABS,
 * 10ft for copper, 100ft coils for PEX). The optimizer determines
 * the most efficient way to cut stock pieces to produce all the
 * segments needed for the design.
 *
 * Algorithm: First-Fit Decreasing (FFD) bin packing.
 *   1. List all pipe segments with their lengths
 *   2. Sort by length descending
 *   3. For each segment, try to fit it into an existing stock piece
 *   4. If no fit, open a new stock piece
 *
 * Also accounts for:
 *   - Kerf waste (blade width, typically 1/8")
 *   - End preparation (deburring, chamfering: 1/4" each end)
 *   - Minimum remnant length (pieces < 6" are scrap)
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { PipeMaterial } from '../graph/GraphEdge';

// ── Stock lengths by material ───────────────────────────────────

export const STOCK_LENGTHS_FT: Record<string, number[]> = {
  pvc_sch40:         [10, 20],
  pvc_sch80:         [10, 20],
  abs:               [10, 20],
  cast_iron:         [5, 10],      // no-hub comes in 5' and 10'
  copper_type_l:     [10, 20],
  copper_type_m:     [10, 20],
  cpvc:              [10],
  pex:               [100, 300],   // coils — no cut optimization needed
  galvanized_steel:  [21],         // 21' threaded pipe
  ductile_iron:      [18, 20],
};

// ── Cut parameters ──────────────────────────────────────────────

export interface CutParams {
  /** Blade kerf in feet. */
  kerfFt: number;
  /** End prep allowance per cut end in feet. */
  endPrepFt: number;
  /** Minimum usable remnant in feet (below this → scrap). */
  minRemnantFt: number;
}

const DEFAULT_CUT_PARAMS: CutParams = {
  kerfFt: 1 / 96,        // 1/8" = 0.0104 ft
  endPrepFt: 1 / 48,     // 1/4" = 0.0208 ft per end
  minRemnantFt: 0.5,     // 6" minimum remnant
};

// ── Cut list output ─────────────────────────────────────────────

export interface CutPiece {
  /** Which pipe this cut belongs to. */
  pipeId: string;
  /** Segment index within the pipe. */
  segmentIndex: number;
  /** Required length in feet (before cut allowances). */
  requiredLength: number;
  /** Actual cut length including end prep (feet). */
  cutLength: number;
}

export interface StockPiece {
  /** Stock length purchased (feet). */
  stockLength: number;
  /** Material. */
  material: string;
  /** Diameter (inches). */
  diameter: number;
  /** Cuts made from this stock piece. */
  cuts: CutPiece[];
  /** Total used length including kerfs (feet). */
  usedLength: number;
  /** Remaining usable remnant (feet). */
  remnant: number;
  /** Waste = kerf + scrap remnant (feet). */
  waste: number;
}

export interface CutListResult {
  /** All stock pieces needed. */
  stockPieces: StockPiece[];
  /** Total stock pieces to purchase. */
  totalStockPieces: number;
  /** Total stock length to purchase (feet). */
  totalStockLength: number;
  /** Total used length (feet). */
  totalUsedLength: number;
  /** Total waste (feet). */
  totalWaste: number;
  /** Waste percentage. */
  wastePercent: number;
  /** Material-by-diameter summary. */
  summary: CutListSummary[];
}

export interface CutListSummary {
  material: string;
  diameter: number;
  stockLength: number;
  stockPiecesNeeded: number;
  totalRequiredLength: number;
  totalStockLength: number;
  wastePercent: number;
}

// ── Segment extraction ──────────────────────────────────────────

interface PipeSegment {
  pipeId: string;
  segmentIndex: number;
  length: number;
  material: string;
  diameter: number;
}

function extractSegments(pipes: CommittedPipe[]): PipeSegment[] {
  const segments: PipeSegment[] = [];

  for (const pipe of pipes) {
    for (let i = 1; i < pipe.points.length; i++) {
      const prev = pipe.points[i - 1]!;
      const curr = pipe.points[i]!;
      const dx = curr[0] - prev[0];
      const dy = curr[1] - prev[1];
      const dz = curr[2] - prev[2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (length > 0.01) {
        segments.push({
          pipeId: pipe.id,
          segmentIndex: i - 1,
          length,
          material: pipe.material,
          diameter: pipe.diameter,
        });
      }
    }
  }

  return segments;
}

// ── FFD bin packing ─────────────────────────────────────────────

/**
 * Generate an optimized cut list from committed pipes.
 */
export function optimizeCutList(
  pipes: CommittedPipe[],
  params: CutParams = DEFAULT_CUT_PARAMS,
): CutListResult {
  const allSegments = extractSegments(pipes);

  // Group by material + diameter (each group is packed separately)
  const groups = new Map<string, PipeSegment[]>();
  for (const seg of allSegments) {
    const key = `${seg.material}|${seg.diameter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(seg);
  }

  const allStockPieces: StockPiece[] = [];
  const summaries: CutListSummary[] = [];

  for (const [key, segments] of groups) {
    const [material, diamStr] = key.split('|');
    const diameter = Number(diamStr);

    // Get available stock lengths for this material
    const stockLengths = STOCK_LENGTHS_FT[material!] ?? [10];
    // Use the longest stock length for bin packing
    const stockLen = Math.max(...stockLengths);

    // PEX coils don't need cut optimization
    if (material === 'pex') {
      const totalLen = segments.reduce((s, seg) => s + seg.length, 0);
      const coilSize = stockLengths[0]!;
      const coilsNeeded = Math.ceil(totalLen / coilSize);
      summaries.push({
        material: material!,
        diameter,
        stockLength: coilSize,
        stockPiecesNeeded: coilsNeeded,
        totalRequiredLength: totalLen,
        totalStockLength: coilsNeeded * coilSize,
        wastePercent: ((coilsNeeded * coilSize - totalLen) / (coilsNeeded * coilSize)) * 100,
      });
      continue;
    }

    // Compute cut lengths (required + end prep)
    const cuts: CutPiece[] = segments.map((seg) => ({
      pipeId: seg.pipeId,
      segmentIndex: seg.segmentIndex,
      requiredLength: seg.length,
      cutLength: seg.length + params.endPrepFt * 2, // prep both ends
    }));

    // Sort descending (FFD)
    cuts.sort((a, b) => b.cutLength - a.cutLength);

    // Bin packing
    const bins: StockPiece[] = [];

    for (const cut of cuts) {
      // Try to fit in existing bin
      let placed = false;
      for (const bin of bins) {
        const spaceNeeded = cut.cutLength + params.kerfFt;
        if (bin.remnant >= spaceNeeded) {
          bin.cuts.push(cut);
          bin.usedLength += spaceNeeded;
          bin.remnant -= spaceNeeded;
          placed = true;
          break;
        }
      }

      // Open new bin
      if (!placed) {
        const newBin: StockPiece = {
          stockLength: stockLen,
          material: material!,
          diameter,
          cuts: [cut],
          usedLength: cut.cutLength,
          remnant: stockLen - cut.cutLength,
          waste: 0,
        };
        bins.push(newBin);
      }
    }

    // Compute waste per bin
    for (const bin of bins) {
      bin.waste = bin.remnant < params.minRemnantFt
        ? bin.remnant + bins.indexOf(bin) * params.kerfFt // scrap
        : bins.indexOf(bin) * params.kerfFt;              // just kerfs
    }

    allStockPieces.push(...bins);

    const totalRequired = segments.reduce((s, seg) => s + seg.length, 0);
    const totalStock = bins.length * stockLen;
    summaries.push({
      material: material!,
      diameter,
      stockLength: stockLen,
      stockPiecesNeeded: bins.length,
      totalRequiredLength: totalRequired,
      totalStockLength: totalStock,
      wastePercent: totalStock > 0 ? ((totalStock - totalRequired) / totalStock) * 100 : 0,
    });
  }

  const totalStockLength = allStockPieces.reduce((s, p) => s + p.stockLength, 0);
  const totalUsedLength = allStockPieces.reduce((s, p) => s + p.usedLength, 0);
  const totalWaste = totalStockLength - totalUsedLength;

  return {
    stockPieces: allStockPieces,
    totalStockPieces: allStockPieces.length,
    totalStockLength,
    totalUsedLength,
    totalWaste,
    wastePercent: totalStockLength > 0 ? (totalWaste / totalStockLength) * 100 : 0,
    summary: summaries,
  };
}
