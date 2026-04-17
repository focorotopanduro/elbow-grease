/**
 * Graph Node — atomic functional unit in the plumbing network DAG.
 *
 * Nodes are NOT geometry. They are abstract engineering entities that
 * carry hydraulic properties. The visual engine never touches these
 * directly — it subscribes to state change messages via the MessageBus.
 *
 * Node taxonomy (IPC / UPC aligned):
 *
 *   Fixture     — terminal load (toilet, sink, shower, etc.)
 *                 Carries DFU value, trap size, hot/cold demand.
 *
 *   Junction    — connection point where pipes meet (tee, wye, cross).
 *                 Accumulates DFU from upstream. Determines fitting type.
 *
 *   Stack       — vertical riser or waste stack node.
 *                 Receives DFU from horizontal branches, sizes per IPC 710.
 *
 *   Vent        — vent terminal or loop vent connection.
 *                 Must satisfy trap arm distance constraints (IPC 906).
 *
 *   Cleanout    — access point for drain maintenance.
 *                 Required per IPC 708 at direction changes > 45°.
 *
 *   Manifold    — supply manifold (PEX home-run systems).
 *                 Distributes supply pressure to multiple branches.
 *
 *   Source      — water supply entry point (meter, well, booster).
 *                 Defines available static pressure and flow.
 *
 *   Drain       — terminal drain exit (building sewer connection).
 *                 Terminal sink for the entire waste DAG.
 */

export type NodeType =
  | 'fixture'
  | 'junction'
  | 'stack'
  | 'vent'
  | 'cleanout'
  | 'manifold'
  | 'source'
  | 'drain';

export type SystemType = 'waste' | 'vent' | 'cold_supply' | 'hot_supply' | 'storm';

// ── Fixture subtypes ────────────────────────────────────────────

export type FixtureSubtype =
  | 'water_closet'     // toilet
  | 'lavatory'         // bathroom sink
  | 'kitchen_sink'
  | 'bathtub'
  | 'shower'
  | 'floor_drain'
  | 'laundry_standpipe'
  | 'dishwasher'
  | 'clothes_washer'
  | 'hose_bibb'
  | 'urinal'
  | 'mop_sink'
  | 'drinking_fountain';

// ── DFU lookup (IPC Table 709.1 / 710.1) ───────────────────────

export const DFU_TABLE: Record<FixtureSubtype, number> = {
  water_closet:      4,
  lavatory:          1,
  kitchen_sink:      2,
  bathtub:           2,
  shower:            2,
  floor_drain:       2,
  laundry_standpipe: 2,
  dishwasher:        2,
  clothes_washer:    2,
  hose_bibb:         2,
  urinal:            2,
  mop_sink:          3,
  drinking_fountain: 0.5,
};

// ── Trap arm max distance (IPC Table 906.1) ─────────────────────

export const TRAP_ARM_MAX_FT: Record<number, number> = {
  1.25: 2.5,    // 1-1/4" trap → 2.5 ft max
  1.5:  3.5,    // 1-1/2" trap → 3.5 ft max
  2:    5,      // 2" trap    → 5 ft max
  3:    6,      // 3" trap    → 6 ft max
  4:    10,     // 4" trap    → 10 ft max
};

// ── Supply demand (WSFU — Water Supply Fixture Units) ───────────

export interface SupplyDemand {
  /** Cold water supply fixture units. */
  coldWSFU: number;
  /** Hot water supply fixture units. */
  hotWSFU: number;
  /** Combined WSFU for sizing. */
  totalWSFU: number;
  /** Minimum branch size (inches). */
  minBranchSize: number;
}

export const SUPPLY_TABLE: Record<FixtureSubtype, SupplyDemand> = {
  water_closet:      { coldWSFU: 2.5, hotWSFU: 0,   totalWSFU: 2.5, minBranchSize: 0.375 },
  lavatory:          { coldWSFU: 0.5, hotWSFU: 0.5,  totalWSFU: 1,   minBranchSize: 0.375 },
  kitchen_sink:      { coldWSFU: 0.7, hotWSFU: 0.7,  totalWSFU: 1.4, minBranchSize: 0.5   },
  bathtub:           { coldWSFU: 1,   hotWSFU: 1,    totalWSFU: 2,   minBranchSize: 0.5   },
  shower:            { coldWSFU: 1,   hotWSFU: 1,    totalWSFU: 2,   minBranchSize: 0.5   },
  floor_drain:       { coldWSFU: 0,   hotWSFU: 0,    totalWSFU: 0,   minBranchSize: 0     },
  laundry_standpipe: { coldWSFU: 1,   hotWSFU: 1,    totalWSFU: 2,   minBranchSize: 0.5   },
  dishwasher:        { coldWSFU: 0,   hotWSFU: 1.4,  totalWSFU: 1.4, minBranchSize: 0.375 },
  clothes_washer:    { coldWSFU: 1,   hotWSFU: 1,    totalWSFU: 2,   minBranchSize: 0.5   },
  hose_bibb:         { coldWSFU: 2.5, hotWSFU: 0,    totalWSFU: 2.5, minBranchSize: 0.5   },
  urinal:            { coldWSFU: 2.5, hotWSFU: 0,    totalWSFU: 2.5, minBranchSize: 0.375 },
  mop_sink:          { coldWSFU: 0.7, hotWSFU: 0.7,  totalWSFU: 1.4, minBranchSize: 0.5   },
  drinking_fountain: { coldWSFU: 0.25,hotWSFU: 0,    totalWSFU: 0.25,minBranchSize: 0.375 },
};

// ── Node interface ──────────────────────────────────────────────

export interface GraphNode {
  id: string;
  type: NodeType;
  system: SystemType;

  // ── Fixture-specific ────────────────────────────────────────
  fixtureSubtype?: FixtureSubtype;
  dfu: number;                    // drainage fixture units (0 for non-fixtures)
  trapSize: number;               // trap diameter in inches (0 for non-fixtures)

  // ── Supply-specific ─────────────────────────────────────────
  supply: SupplyDemand;

  // ── Computed by solver (read-only outside engine) ───────────
  computed: {
    /** Accumulated DFU from all upstream nodes. */
    accumulatedDFU: number;
    /** Accumulated WSFU from all downstream fixture demands. */
    accumulatedWSFU: number;
    /** Pressure at this node (psi). Set by pressure solver. */
    pressure: number;
    /** Flow rate at this node (gpm). Set by flow solver. */
    flowRate: number;
    /** Whether this node's constraints are satisfied. */
    compliant: boolean;
    /** List of active violations at this node. */
    violations: string[];
    /** Auto-sized pipe diameter downstream of this node. */
    sizedDiameter: number;
  };

  // ── Metadata ────────────────────────────────────────────────
  /** Elevation in feet (for slope and pressure head calculations). */
  elevation: number;
  /** Label for display. */
  label: string;
}

// ── Factory ─────────────────────────────────────────────────────

let nodeIdCounter = 0;

export function createFixtureNode(
  subtype: FixtureSubtype,
  system: SystemType,
  elevation: number,
  label?: string,
): GraphNode {
  const id = `node-${nodeIdCounter++}`;
  return {
    id,
    type: 'fixture',
    system,
    fixtureSubtype: subtype,
    dfu: DFU_TABLE[subtype],
    trapSize: subtype === 'water_closet' ? 3 : subtype === 'floor_drain' ? 2 : 1.5,
    supply: SUPPLY_TABLE[subtype],
    computed: {
      accumulatedDFU: DFU_TABLE[subtype],
      accumulatedWSFU: SUPPLY_TABLE[subtype].totalWSFU,
      pressure: 0,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0,
    },
    elevation,
    label: label ?? subtype.replace(/_/g, ' '),
  };
}

export function createJunctionNode(
  system: SystemType,
  elevation: number,
  label?: string,
): GraphNode {
  const id = `node-${nodeIdCounter++}`;
  return {
    id,
    type: 'junction',
    system,
    dfu: 0,
    trapSize: 0,
    supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 },
    computed: {
      accumulatedDFU: 0,
      accumulatedWSFU: 0,
      pressure: 0,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0,
    },
    elevation,
    label: label ?? 'junction',
  };
}

export function createSourceNode(
  staticPressure: number,
  elevation: number,
  label?: string,
): GraphNode {
  const id = `node-${nodeIdCounter++}`;
  return {
    id,
    type: 'source',
    system: 'cold_supply',
    dfu: 0,
    trapSize: 0,
    supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0.75 },
    computed: {
      accumulatedDFU: 0,
      accumulatedWSFU: 0,
      pressure: staticPressure,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0.75,
    },
    elevation,
    label: label ?? 'water supply',
  };
}

export function createDrainNode(elevation: number, label?: string): GraphNode {
  const id = `node-${nodeIdCounter++}`;
  return {
    id,
    type: 'drain',
    system: 'waste',
    dfu: 0,
    trapSize: 0,
    supply: { coldWSFU: 0, hotWSFU: 0, totalWSFU: 0, minBranchSize: 0 },
    computed: {
      accumulatedDFU: 0,
      accumulatedWSFU: 0,
      pressure: 0,
      flowRate: 0,
      compliant: true,
      violations: [],
      sizedDiameter: 0,
    },
    elevation,
    label: label ?? 'building drain',
  };
}
