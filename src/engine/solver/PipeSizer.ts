/**
 * Pipe Sizer — auto-sizes pipe diameters from accumulated DFU/WSFU.
 *
 * Pass 2 of the solver. Reads DFU (waste) or WSFU (supply) from each
 * edge's downstream node and selects the minimum compliant pipe diameter.
 *
 * IPC references:
 *   Table 710.1(1) — Horizontal branch/drain sizing by DFU
 *   Table 710.1(2) — Building drains/sewers by DFU and slope
 *   Table 710.2     — Vertical stack sizing by DFU and stories
 *   Table 604.4     — Supply pipe sizing by WSFU
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import type { GraphEdge } from '../graph/GraphEdge';

// ── IPC Table 710.1(1): Horizontal branches ────────────────────
// { maxDFU: nominalDiameter }

interface SizingEntry {
  maxDFU: number;
  diameter: number; // inches
}

const HORIZONTAL_BRANCH_TABLE: SizingEntry[] = [
  { maxDFU: 1,   diameter: 1.5 },
  { maxDFU: 3,   diameter: 2   },
  { maxDFU: 6,   diameter: 2.5 },
  { maxDFU: 12,  diameter: 3   },
  { maxDFU: 20,  diameter: 3   },
  { maxDFU: 160, diameter: 4   },
  { maxDFU: 360, diameter: 5   },
  { maxDFU: 620, diameter: 6   },
  { maxDFU: 1400,diameter: 8   },
  { maxDFU: 2500,diameter: 10  },
  { maxDFU: 3900,diameter: 12  },
];

// ── IPC Table 710.1(2): Building drains by slope ────────────────

interface DrainSizingEntry {
  maxDFU_quarter: number;  // at 1/4" per foot slope
  maxDFU_eighth: number;   // at 1/8" per foot slope
  diameter: number;
}

const BUILDING_DRAIN_TABLE: DrainSizingEntry[] = [
  { maxDFU_quarter: 21,   maxDFU_eighth: 0,    diameter: 3  },
  { maxDFU_quarter: 180,  maxDFU_eighth: 68,   diameter: 4  },
  { maxDFU_quarter: 390,  maxDFU_eighth: 180,  diameter: 5  },
  { maxDFU_quarter: 700,  maxDFU_eighth: 350,  diameter: 6  },
  { maxDFU_quarter: 1600, maxDFU_eighth: 1000, diameter: 8  },
  { maxDFU_quarter: 2900, maxDFU_eighth: 2000, diameter: 10 },
  { maxDFU_quarter: 4600, maxDFU_eighth: 3500, diameter: 12 },
];

// ── IPC Table 710.2: Vertical stacks ────────────────────────────

const VERTICAL_STACK_TABLE: SizingEntry[] = [
  { maxDFU: 2,    diameter: 1.5 },
  { maxDFU: 6,    diameter: 2   },
  { maxDFU: 16,   diameter: 2.5 },
  { maxDFU: 48,   diameter: 3   },
  { maxDFU: 256,  diameter: 4   },
  { maxDFU: 600,  diameter: 5   },
  { maxDFU: 1380, diameter: 6   },
  { maxDFU: 3600, diameter: 8   },
  { maxDFU: 5600, diameter: 10  },
  { maxDFU: 8400, diameter: 12  },
];

// ── Supply pipe sizing (IPC Table 604.4 simplified) ─────────────

const SUPPLY_SIZING_TABLE: SizingEntry[] = [
  { maxDFU: 1,   diameter: 0.375 },
  { maxDFU: 2,   diameter: 0.5   },
  { maxDFU: 6,   diameter: 0.75  },
  { maxDFU: 15,  diameter: 1     },
  { maxDFU: 30,  diameter: 1.25  },
  { maxDFU: 60,  diameter: 1.5   },
  { maxDFU: 100, diameter: 2     },
  { maxDFU: 250, diameter: 2.5   },
  { maxDFU: 500, diameter: 3     },
];

// ── Sizing functions ────────────────────────────────────────────

function sizeFromTable(dfu: number, table: SizingEntry[]): number {
  for (const entry of table) {
    if (dfu <= entry.maxDFU) return entry.diameter;
  }
  return table[table.length - 1]!.diameter;
}

function sizeBuildingDrain(dfu: number, slopeInPerFt: number): number {
  const useQuarter = slopeInPerFt >= 0.25;
  for (const entry of BUILDING_DRAIN_TABLE) {
    const maxDFU = useQuarter ? entry.maxDFU_quarter : entry.maxDFU_eighth;
    if (maxDFU > 0 && dfu <= maxDFU) return entry.diameter;
  }
  return BUILDING_DRAIN_TABLE[BUILDING_DRAIN_TABLE.length - 1]!.diameter;
}

// ── Public API ──────────────────────────────────────────────────

export interface SizingResult {
  edgeId: string;
  previousDiameter: number;
  newDiameter: number;
  sizedBy: 'horizontal_branch' | 'building_drain' | 'vertical_stack' | 'supply';
  dfu: number;
  changed: boolean;
}

/**
 * Auto-size all edges in the DAG based on accumulated DFU/WSFU.
 * Returns a list of sizing changes.
 */
export function sizeAllPipes(dag: PlumbingDAG): SizingResult[] {
  const results: SizingResult[] = [];

  for (const edge of dag.getAllEdges()) {
    const downNode = dag.getNode(edge.to);
    const upNode = dag.getNode(edge.from);
    if (!downNode || !upNode) continue;

    const result = sizeEdge(edge, dag);
    results.push(result);
  }

  return results;
}

function sizeEdge(edge: GraphEdge, dag: PlumbingDAG): SizingResult {
  const downNode = dag.getNode(edge.to)!;
  const upNode = dag.getNode(edge.from)!;
  const prevDiameter = edge.diameter;

  let newDiameter: number;
  let sizedBy: SizingResult['sizedBy'];
  let dfu: number;

  const isWaste = downNode.system === 'waste';
  const isSupply = downNode.system === 'cold_supply' || downNode.system === 'hot_supply';
  const isVertical = Math.abs(edge.elevationDelta) > edge.length * 0.5;

  if (isWaste) {
    dfu = downNode.computed.accumulatedDFU;

    if (isVertical) {
      newDiameter = sizeFromTable(dfu, VERTICAL_STACK_TABLE);
      sizedBy = 'vertical_stack';
    } else if (downNode.type === 'drain') {
      newDiameter = sizeBuildingDrain(dfu, edge.slope);
      sizedBy = 'building_drain';
    } else {
      newDiameter = sizeFromTable(dfu, HORIZONTAL_BRANCH_TABLE);
      sizedBy = 'horizontal_branch';
    }
  } else if (isSupply) {
    dfu = upNode.computed.accumulatedWSFU;
    newDiameter = sizeFromTable(dfu, SUPPLY_SIZING_TABLE);
    sizedBy = 'supply';
  } else {
    // Vent sizing follows waste sizing (simplified)
    dfu = downNode.computed.accumulatedDFU;
    newDiameter = sizeFromTable(dfu, HORIZONTAL_BRANCH_TABLE);
    sizedBy = 'horizontal_branch';
  }

  // Never downsize below what's already specified
  newDiameter = Math.max(newDiameter, prevDiameter > 0 ? 0 : newDiameter);

  edge.diameter = newDiameter;
  edge.computed.properlySized = true;

  // Update downstream node's sized diameter
  downNode.computed.sizedDiameter = Math.max(
    downNode.computed.sizedDiameter,
    newDiameter,
  );

  return {
    edgeId: edge.id,
    previousDiameter: prevDiameter,
    newDiameter,
    sizedBy,
    dfu,
    changed: prevDiameter !== newDiameter,
  };
}
