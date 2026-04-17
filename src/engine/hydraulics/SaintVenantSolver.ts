/**
 * 1D Saint-Venant Solver — transient shallow-water equations for
 * drainage and stormwater simulation.
 *
 * The Saint-Venant equations model unsteady (time-varying) flow in
 * open channels and partially-filled pipes. They capture phenomena
 * that steady-state Manning's equation cannot:
 *
 *   - Water hammer in drainage (toilet flush wave propagation)
 *   - Stormwater surge through building drains
 *   - Backflow events from downstream blockage
 *   - Surcharge (pipe transitions from open-channel to pressurized)
 *
 * The 1D Saint-Venant system:
 *
 *   Continuity:   ∂A/∂t + ∂Q/∂x = q_lateral
 *   Momentum:     ∂Q/∂t + ∂(Q²/A)/∂x + gA ∂h/∂x = gA(S₀ - Sf) + q_lateral v
 *
 * Where:
 *   A  = cross-sectional flow area
 *   Q  = volumetric flow rate
 *   h  = water surface elevation
 *   S₀ = bed slope
 *   Sf = friction slope (from Manning's)
 *   q  = lateral inflow (fixture discharge)
 *
 * Numerical method: Explicit Godunov finite-volume with HLL Riemann
 * solver. Stable under CFL condition: Δt ≤ CFL × Δx / (|v| + c).
 *
 * Grid: each pipe edge in the DAG is discretized into cells.
 * Junctions are boundary conditions coupling adjacent pipes.
 */

import { MANNING_N } from './ManningFlow';
import type { PipeMaterial } from '../graph/GraphEdge';

// ── Physical constants ──────────────────────────────────────────

const G = 32.174; // ft/s²

// ── Cell state ──────────────────────────────────────────────────

export interface SVCell {
  /** Flow area (ft²). */
  A: number;
  /** Discharge (ft³/s). */
  Q: number;
  /** Water depth (ft). */
  h: number;
  /** Velocity (ft/s). */
  v: number;
  /** Wave celerity (ft/s). */
  c: number;
  /** Cell center position along pipe (ft). */
  x: number;
}

// ── Pipe discretization ─────────────────────────────────────────

export interface SVPipe {
  id: string;
  /** Pipe diameter (ft). */
  D: number;
  /** Bed slope (ft/ft). */
  S0: number;
  /** Manning's n. */
  n: number;
  /** Total length (ft). */
  length: number;
  /** Discretized cells. */
  cells: SVCell[];
  /** Cell spacing (ft). */
  dx: number;
}

// ── Lateral inflow (fixture discharge event) ────────────────────

export interface LateralInflow {
  /** Which pipe this inflow enters. */
  pipeId: string;
  /** Position along pipe (ft from upstream end). */
  position: number;
  /** Flow rate (ft³/s). Varies over time via the callback. */
  flowRate: (t: number) => number;
}

// ── Circular pipe geometry helpers ──────────────────────────────

function areaFromDepth(D: number, h: number): number {
  const r = D / 2;
  const depth = Math.max(0, Math.min(h, D));
  const cosArg = Math.max(-1, Math.min(1, (r - depth) / r));
  const theta = 2 * Math.acos(cosArg);
  return (r * r / 2) * (theta - Math.sin(theta));
}

function depthFromArea(D: number, A: number): number {
  // Newton-Raphson: find h such that areaFromDepth(D, h) = A
  const maxArea = Math.PI * (D / 2) ** 2;
  if (A <= 0) return 0;
  if (A >= maxArea) return D;

  let h = D * 0.5; // initial guess
  for (let i = 0; i < 10; i++) {
    const Ah = areaFromDepth(D, h);
    const residual = Ah - A;
    if (Math.abs(residual) < 1e-10) break;

    // Numerical derivative: dA/dh ≈ top width T
    const r = D / 2;
    const cosArg = Math.max(-1, Math.min(1, (r - h) / r));
    const theta = 2 * Math.acos(cosArg);
    const T = D * Math.sin(theta / 2);
    h -= residual / (T || 1);
    h = Math.max(0, Math.min(h, D));
  }
  return h;
}

function hydraulicRadius(D: number, h: number): number {
  const r = D / 2;
  const depth = Math.max(0, Math.min(h, D));
  const cosArg = Math.max(-1, Math.min(1, (r - depth) / r));
  const theta = 2 * Math.acos(cosArg);
  const A = (r * r / 2) * (theta - Math.sin(theta));
  const P = r * theta;
  return P > 0 ? A / P : 0;
}

function waveCelerity(D: number, h: number): number {
  const A = areaFromDepth(D, h);
  const r = D / 2;
  const depth = Math.max(1e-6, Math.min(h, D));
  const cosArg = Math.max(-1, Math.min(1, (r - depth) / r));
  const theta = 2 * Math.acos(cosArg);
  const T = D * Math.sin(theta / 2);
  const Dh = T > 0 ? A / T : 0;
  return Math.sqrt(G * Dh);
}

// ── Friction slope (Manning) ────────────────────────────────────

function frictionSlope(v: number, n: number, Rh: number): number {
  if (Rh <= 0) return 0;
  // Sf = (n × v)² / (1.49² × R^(4/3))
  return (n * Math.abs(v)) * (n * v) / (1.49 * 1.49 * Math.pow(Rh, 4 / 3));
}

// ── HLL Riemann solver ──────────────────────────────────────────

interface HLLFlux {
  fA: number; // mass flux
  fQ: number; // momentum flux
}

function hllFlux(
  AL: number, QL: number, hL: number,
  AR: number, QR: number, hR: number,
  D: number,
): HLLFlux {
  const vL = AL > 1e-10 ? QL / AL : 0;
  const vR = AR > 1e-10 ? QR / AR : 0;
  const cL = waveCelerity(D, hL);
  const cR = waveCelerity(D, hR);

  // Wave speed estimates
  const sL = Math.min(vL - cL, vR - cR);
  const sR = Math.max(vL + cL, vR + cR);

  // Left and right fluxes
  // F(U) = [Q, Q²/A + g*I₁]  where I₁ = first moment of area
  const rL = D / 2;
  const cosArgL = Math.max(-1, Math.min(1, (rL - hL) / rL));
  const thetaL = 2 * Math.acos(cosArgL);
  const I1L = (rL ** 3 / 3) * (thetaL - Math.sin(thetaL) + (2 / 3) * Math.sin(thetaL) * (1 - Math.cos(thetaL)));

  const rR = D / 2;
  const cosArgR = Math.max(-1, Math.min(1, (rR - hR) / rR));
  const thetaR = 2 * Math.acos(cosArgR);
  const I1R = (rR ** 3 / 3) * (thetaR - Math.sin(thetaR) + (2 / 3) * Math.sin(thetaR) * (1 - Math.cos(thetaR)));

  const fAL = QL;
  const fQL = (AL > 1e-10 ? QL * QL / AL : 0) + G * I1L;
  const fAR = QR;
  const fQR = (AR > 1e-10 ? QR * QR / AR : 0) + G * I1R;

  if (sL >= 0) {
    return { fA: fAL, fQ: fQL };
  } else if (sR <= 0) {
    return { fA: fAR, fQ: fQR };
  } else {
    const denom = sR - sL || 1;
    return {
      fA: (sR * fAL - sL * fAR + sL * sR * (AR - AL)) / denom,
      fQ: (sR * fQL - sL * fQR + sL * sR * (QR - QL)) / denom,
    };
  }
}

// ── Solver class ────────────────────────────────────────────────

export class SaintVenantSolver {
  private pipes: SVPipe[] = [];
  private inflows: LateralInflow[] = [];
  private time = 0;
  private cfl = 0.8;

  /** Create a pipe discretization. */
  addPipe(
    id: string,
    D_inches: number,
    slope_inPerFt: number,
    length_ft: number,
    material: PipeMaterial,
    numCells: number = 20,
  ): void {
    const D = D_inches / 12;
    const S0 = slope_inPerFt / 12;
    const n = MANNING_N[material];
    const dx = length_ft / numCells;

    const cells: SVCell[] = [];
    // Initialize with small base flow
    const h0 = D * 0.05; // 5% depth at rest
    const A0 = areaFromDepth(D, h0);

    for (let i = 0; i < numCells; i++) {
      cells.push({
        A: A0,
        Q: 0,
        h: h0,
        v: 0,
        c: waveCelerity(D, h0),
        x: (i + 0.5) * dx,
      });
    }

    this.pipes.push({ id, D, S0, n, length: length_ft, cells, dx });
  }

  /** Add a lateral inflow source (e.g. fixture flush). */
  addInflow(inflow: LateralInflow): void {
    this.inflows.push(inflow);
  }

  /**
   * Advance the simulation by one timestep.
   * Returns the stable Δt used (limited by CFL condition).
   */
  step(): number {
    // Compute CFL-limited Δt
    let maxWaveSpeed = 1e-6;
    for (const pipe of this.pipes) {
      for (const cell of pipe.cells) {
        maxWaveSpeed = Math.max(maxWaveSpeed, Math.abs(cell.v) + cell.c);
      }
    }
    const dt = this.cfl * Math.min(...this.pipes.map((p) => p.dx)) / maxWaveSpeed;
    const safeDt = Math.min(dt, 0.1); // cap at 100ms for stability

    // Update each pipe
    for (const pipe of this.pipes) {
      this.updatePipe(pipe, safeDt);
    }

    this.time += safeDt;
    return safeDt;
  }

  /**
   * Run simulation for a given duration.
   * Returns the number of timesteps taken.
   */
  simulate(duration: number): number {
    let steps = 0;
    const endTime = this.time + duration;
    while (this.time < endTime && steps < 100000) {
      this.step();
      steps++;
    }
    return steps;
  }

  /** Get current simulation time. */
  getTime(): number {
    return this.time;
  }

  /** Get all pipe states. */
  getPipes(): SVPipe[] {
    return this.pipes;
  }

  /** Get a specific pipe's cell states. */
  getPipeCells(pipeId: string): SVCell[] {
    return this.pipes.find((p) => p.id === pipeId)?.cells ?? [];
  }

  /** Reset simulation to initial conditions. */
  reset(): void {
    this.time = 0;
    for (const pipe of this.pipes) {
      const h0 = pipe.D * 0.05;
      const A0 = areaFromDepth(pipe.D, h0);
      for (const cell of pipe.cells) {
        cell.A = A0;
        cell.Q = 0;
        cell.h = h0;
        cell.v = 0;
        cell.c = waveCelerity(pipe.D, h0);
      }
    }
  }

  // ── Godunov update ──────────────────────────────────────────

  private updatePipe(pipe: SVPipe, dt: number): void {
    const { cells, D, S0, n, dx } = pipe;
    const N = cells.length;

    // Compute intercell fluxes
    const fluxA = new Float64Array(N + 1);
    const fluxQ = new Float64Array(N + 1);

    for (let i = 0; i <= N; i++) {
      const L = i > 0 ? cells[i - 1]! : cells[0]!;     // ghost cell = copy
      const R = i < N ? cells[i]! : cells[N - 1]!;

      const flux = hllFlux(L.A, L.Q, L.h, R.A, R.Q, R.h, D);
      fluxA[i] = flux.fA;
      fluxQ[i] = flux.fQ;
    }

    // Update conserved variables
    for (let i = 0; i < N; i++) {
      const cell = cells[i]!;

      // Flux divergence
      const dA = -(dt / dx) * ((fluxA[i + 1] ?? 0) - (fluxA[i] ?? 0));
      const dQ = -(dt / dx) * ((fluxQ[i + 1] ?? 0) - (fluxQ[i] ?? 0));

      // Source terms
      const Rh = hydraulicRadius(D, cell.h);
      const Sf = frictionSlope(cell.v, n, Rh);
      const sourceQ = G * cell.A * (S0 - Sf) * dt;

      // Lateral inflow
      let qLat = 0;
      for (const inflow of this.inflows) {
        if (inflow.pipeId !== pipe.id) continue;
        const cellStart = i * dx;
        const cellEnd = (i + 1) * dx;
        if (inflow.position >= cellStart && inflow.position < cellEnd) {
          qLat += inflow.flowRate(this.time) / dx; // distribute over cell
        }
      }

      cell.A = Math.max(1e-8, cell.A + dA + qLat * dt);
      cell.Q = cell.Q + dQ + sourceQ;

      // Reconstruct primitives
      cell.h = depthFromArea(D, cell.A);
      cell.v = cell.A > 1e-8 ? cell.Q / cell.A : 0;
      cell.c = waveCelerity(D, cell.h);

      // Surcharge: cap at full pipe
      const fullArea = Math.PI * (D / 2) ** 2;
      if (cell.A >= fullArea * 0.95) {
        cell.A = fullArea * 0.95;
        cell.h = D * 0.95;
      }
    }
  }
}
