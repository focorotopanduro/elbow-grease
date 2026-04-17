/**
 * Pressure Drop Calculator — Darcy-Weisbach per-edge pressure loss.
 *
 * Pass 3 of the solver. Uses the Darcy-Weisbach equation with
 * ADAPTIVE friction factor selection (Phase 2.4):
 *
 *   Real-time:  Swamee-Jain (1 pass, ≤3% error, ~10× faster)
 *   Idle:       Colebrook-White (iterative, gold standard)
 *   Transition: Churchill (smooth laminar↔turbulent bridging)
 *   Budget out: Moody lookup (instant, ~5% error)
 *
 * The AdaptiveSolverSelector auto-picks the best method per edge
 * based on Re range and remaining frame time budget.
 *
 * Darcy-Weisbach:  hf = f × (L/D) × (v²/2g)
 *
 * For drainage: Manning's equation for open-channel gravity flow
 * replaces Darcy-Weisbach (waste pipes are not pressurized).
 */

import type { PlumbingDAG } from '../graph/PlumbingDAG';
import type { GraphEdge } from '../graph/GraphEdge';
import { ROUGHNESS_FT } from '../graph/GraphEdge';
import { calculatePeakDemand, branchPeakGPM } from '../demand/ModifiedWistortMethod';
import { solverSelector } from '../hydraulics/AdaptiveSolverSelector';
import { pipeCapacity } from '../hydraulics/ManningFlow';

// ── Physical constants ──────────────────────────────────────────

const G = 32.174;             // ft/s²
const WATER_DENSITY = 62.4;   // lb/ft³ at 60°F
const PSI_PER_FT_HEAD = WATER_DENSITY / 144; // ≈ 0.433 psi per foot of head

// ── Kinematic viscosity (temperature dependent) ─────────────────

/**
 * Kinematic viscosity of water in ft²/s.
 * Approximation valid for 40–200°F.
 */
function kinematicViscosity(tempF: number): number {
  const tempC = (tempF - 32) * 5 / 9;
  // Empirical fit (ft²/s)
  const nuM2s = 0.00000178 / (1 + 0.0337 * tempC + 0.000221 * tempC * tempC);
  return nuM2s * 10.7639; // m²/s → ft²/s
}

// ── Friction factor (delegated to AdaptiveSolverSelector) ───────
// The old inline Colebrook-White has been replaced by the adaptive
// solver suite (Phase 2.4). In real-time mode it uses Swamee-Jain
// (single-pass, ≤3% error). In idle/report mode it falls back to
// full iterative Colebrook-White.

// ── Flow rate estimation ────────────────────────────────────────

/**
 * Convert WSFU to estimated GPM using modified Wistort method.
 * (2024 UPC Appendix M peak water demand calculator)
 *
 * The Hunter curve historically overestimates demand. The modified
 * Wistort method uses probability theory to better estimate
 * simultaneous use.
 *
 * Simplified: GPM ≈ 0.6936 × WSFU^0.5154 (regression fit)
 */
export function wsfuToGPM(wsfu: number): number {
  if (wsfu <= 0) return 0;
  return 0.6936 * Math.pow(wsfu, 0.5154);
}

/**
 * Convert DFU to estimated GPM for drainage flow.
 * Uses IPC Table 709.2 simplified regression.
 */
export function dfuToGPM(dfu: number): number {
  if (dfu <= 0) return 0;
  return 1.0 * Math.pow(dfu, 0.5); // conservative approximation
}

// ── Per-edge pressure drop ──────────────────────────────────────

export interface PressureResult {
  edgeId: string;
  velocity: number;         // ft/s
  reynolds: number;
  frictionFactor: number;
  frictionMethod: string;   // which solver was used
  headLoss: number;          // ft
  pressureDrop: number;      // psi
  staticHeadChange: number;  // psi (from elevation)
  totalPressureChange: number; // psi (friction + static)
}

/**
 * Calculate pressure drop for a single SUPPLY edge (pressurized flow).
 * Uses Darcy-Weisbach with adaptive friction solver selection.
 */
export function calculateEdgePressureDrop(
  edge: GraphEdge,
  flowGPM: number,
  tempF: number = 60,
): PressureResult {
  const D_in = edge.diameter;
  const D_ft = D_in / 12;
  const L_ft = edge.computed.equivalentLength;
  const epsilon = ROUGHNESS_FT[edge.material];

  // Flow area (ft²)
  const area = Math.PI * (D_ft / 2) ** 2;

  // Convert GPM to ft³/s
  const Q_cfs = flowGPM / 448.831;

  // Velocity (ft/s)
  const velocity = area > 0 ? Q_cfs / area : 0;

  // Reynolds number
  const nu = kinematicViscosity(tempF);
  const reynolds = D_ft > 0 ? (velocity * D_ft) / nu : 0;

  // Friction factor via adaptive solver (Swamee-Jain in real-time,
  // Colebrook-White in idle/report mode, Churchill for transition zone)
  const frictionResult = reynolds > 0
    ? solverSelector.solve(reynolds, epsilon, D_ft)
    : { f: 0, method: 'none' as const, regime: 'laminar' as const, estimatedError: 0 };
  const f = frictionResult.f;

  // Darcy-Weisbach head loss (ft)
  const headLoss = D_ft > 0 ? f * (L_ft / D_ft) * (velocity ** 2 / (2 * G)) : 0;

  // Convert to psi
  const pressureDrop = headLoss * PSI_PER_FT_HEAD;

  // Static head from elevation change
  const staticHeadChange = edge.elevationDelta * PSI_PER_FT_HEAD;

  // Write computed values back to edge
  edge.computed.velocity = velocity;
  edge.computed.reynolds = reynolds;
  edge.computed.frictionFactor = f;
  edge.computed.frictionLoss = headLoss;
  edge.computed.pressureDrop = pressureDrop;

  return {
    edgeId: edge.id,
    velocity,
    reynolds,
    frictionFactor: f,
    frictionMethod: frictionResult.method,
    headLoss,
    pressureDrop,
    staticHeadChange,
    totalPressureChange: pressureDrop + staticHeadChange,
  };
}

/**
 * Calculate flow for a DRAINAGE edge (open-channel gravity flow).
 * Uses Manning's equation instead of Darcy-Weisbach because waste
 * pipes operate partially filled, not pressurized.
 */
export function calculateEdgeDrainageFlow(
  edge: GraphEdge,
  fillRatio: number = 0.5,
): PressureResult {
  const manning = pipeCapacity(edge.diameter, edge.slope, edge.material, fillRatio);

  edge.computed.velocity = manning.velocity;
  edge.computed.reynolds = 0; // not applicable for open-channel
  edge.computed.frictionFactor = 0;
  edge.computed.frictionLoss = 0;
  edge.computed.pressureDrop = 0;

  return {
    edgeId: edge.id,
    velocity: manning.velocity,
    reynolds: 0,
    frictionFactor: 0,
    frictionMethod: 'manning',
    headLoss: 0,
    pressureDrop: 0,
    staticHeadChange: edge.elevationDelta * PSI_PER_FT_HEAD,
    totalPressureChange: 0,
  };
}

// ── Full graph pressure solve ───────────────────────────────────

/**
 * Solve pressure across the entire DAG.
 *
 * Supply side: ZTPBD Modified Wistort Method for 99th-percentile demand.
 * Waste side:   Manning's open-channel equation (gravity drainage).
 *
 * Friction solver is adaptively selected per-edge:
 *   Real-time → Swamee-Jain (1 pass, ≤3% error)
 *   Idle      → Colebrook-White (iterative gold standard)
 */
export function solveGraphPressure(
  dag: PlumbingDAG,
  tempF: number = 60,
  mode: 'realtime' | 'idle' | 'report' = 'realtime',
): PressureResult[] {
  const topo = dag.topologicalSort();
  const results: PressureResult[] = [];

  // Configure adaptive solver for this pass
  solverSelector.setMode(mode);
  solverSelector.resetFrame();

  // Pre-compute MWM peak demand for the entire network (supply side)
  const mwmResult = calculatePeakDemand(dag);

  // Build a map of downstream fixture subtypes per node for branch-level MWM
  const downstreamFixtures = new Map<string, import('../graph/GraphNode').FixtureSubtype[]>();

  // Walk reverse topo to accumulate fixture lists
  const reverseTopo = [...topo].reverse();
  for (const nodeId of reverseTopo) {
    const node = dag.getNode(nodeId)!;
    const subtypes: import('../graph/GraphNode').FixtureSubtype[] = [];

    if (node.type === 'fixture' && node.fixtureSubtype) {
      subtypes.push(node.fixtureSubtype);
    }

    // Collect from downstream
    for (const downId of dag.getDownstream(nodeId)) {
      const downFixtures = downstreamFixtures.get(downId);
      if (downFixtures) subtypes.push(...downFixtures);
    }

    downstreamFixtures.set(nodeId, subtypes);
  }

  for (const nodeId of topo) {
    const node = dag.getNode(nodeId)!;
    const outEdges = dag.getOutgoingEdges(nodeId);

    for (const edge of outEdges) {
      const downNode = dag.getNode(edge.to)!;
      const isSupply = node.system === 'cold_supply' || node.system === 'hot_supply';

      if (isSupply) {
        // ── SUPPLY: Darcy-Weisbach with adaptive friction solver ──
        const fixtures = downstreamFixtures.get(edge.to) ?? [];
        const flowGPM = fixtures.length > 0
          ? branchPeakGPM(fixtures, 0.99)
          : wsfuToGPM(downNode.computed.accumulatedWSFU);

        const result = calculateEdgePressureDrop(edge, flowGPM, tempF);
        downNode.computed.pressure = node.computed.pressure - result.totalPressureChange;
        downNode.computed.flowRate = flowGPM;
        results.push(result);
      } else {
        // ── DRAINAGE: Manning's open-channel gravity flow ──
        // Waste pipes run partially filled (50% branches, 75% drains)
        const fillRatio = downNode.type === 'drain' ? 0.75 : 0.5;
        const result = calculateEdgeDrainageFlow(edge, fillRatio);
        const flowGPM = dfuToGPM(downNode.computed.accumulatedDFU);
        downNode.computed.flowRate = flowGPM;
        results.push(result);
      }
    }
  }

  return results;
}
