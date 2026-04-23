/**
 * pTrapCleanoutPlanner — Phase 14.D
 *
 * Detects where p-traps and cleanouts are required by plumbing code
 * (IPC / FL residential) and emits a plan that can be:
 *   1. Surfaced in a compliance panel for the user to review.
 *   2. Rolled into the BOM automatically (as `FittingInstance[]`) so
 *      the material takeoff and labor hours reflect real install cost.
 *
 * Scope: this module is pure. It takes arrays in, returns plain data.
 * It does not touch Zustand, R3F, Three.js, or the ComplianceEngine
 * PCSP solver — that engine is too heavyweight for a straightforward
 * "did you remember to add a p-trap?" check.
 *
 * Code references:
 *   • IPC 1002.1    — every trap-required fixture must have a trap
 *                     (water closets + floor drains have integral traps).
 *   • IPC 708.1.1   — cleanout at every horizontal change-of-direction > 45°
 *   • IPC 708.1.2   — cleanout at the base of every vertical stack
 *   • IPC 708.1.4   — cleanout at the end of each horizontal drain run
 *   • IPC 708.1.5   — cleanouts at 100 ft max spacing (pipes ≤ 4")
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import type { FixtureInstance } from '@store/fixtureStore';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';
import type { FittingInstance } from '@ui/pipe/FittingGenerator';
import { PIPE_MATERIALS, type PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Types ─────────────────────────────────────────────────────

export type CleanoutReason =
  | 'end_of_run'
  | 'direction_change_gt_45'
  | 'long_run_exceeds_100ft'
  | 'stack_base';

export interface PTrapRequirement {
  fixtureId: string;
  fixtureSubtype: FixtureSubtype;
  /** Fixture's own position; contractor places the trap physically below. */
  position: Vec3;
  trapDiameterInches: number;
  /** Inferred from the closest drain pipe, or `defaultDrainMaterial`. */
  material: PipeMaterial;
  /** IPC code reference — e.g. "IPC 1002.1". */
  codeRef: string;
  /** Plain-English description for the compliance panel. */
  reason: string;
}

export interface CleanoutRequirement {
  pipeId: string;
  position: Vec3;
  /** Cleanout adapter diameter matches the pipe it's installed on. */
  diameterInches: number;
  material: PipeMaterial;
  reason: CleanoutReason;
  codeRef: string;
  description: string;
}

export interface TrapCleanoutPlan {
  pTraps: PTrapRequirement[];
  cleanouts: CleanoutRequirement[];
  /** Flat counts so UI + BOM can summarize without iterating arrays. */
  summary: {
    pTrapCount: number;
    cleanoutCount: number;
    cleanoutsByReason: Record<CleanoutReason, number>;
  };
}

export interface PlannerRules {
  /** IPC 708.1.5 — max horizontal run before another cleanout is required. */
  maxHorizontalRunFt: number;
  /** IPC 708.1.1 — cleanout required at horizontal bends beyond this angle. */
  directionChangeThresholdDeg: number;
  /** Vector-component threshold (feet) for classifying segments as
   *  purely horizontal vs purely vertical. Segments whose off-axis
   *  component is ≤ this count as "on axis." */
  axisToleranceFt: number;
  /** Distance threshold (feet) for position-matching — endpoints
   *  within this distance of a fixture or another pipe count as
   *  "connected." Also used to dedupe near-identical cleanout positions. */
  junctionToleranceFt: number;
  /** Material to use for p-traps when no drain pipe is found near
   *  the fixture. FL residential default is PVC Schedule 40. */
  defaultDrainMaterial: PipeMaterial;
}

export const DEFAULT_PLANNER_RULES: PlannerRules = {
  maxHorizontalRunFt: 100,
  directionChangeThresholdDeg: 45,
  axisToleranceFt: 0.1,
  junctionToleranceFt: 0.5,
  defaultDrainMaterial: 'pvc_sch40',
};

// Fixtures whose trap is built INTO the fixture body (no external p-trap).
const INTEGRAL_TRAP_SUBTYPES: ReadonlySet<FixtureSubtype> = new Set([
  'water_closet',
  'floor_drain',
]);

// Fixtures that don't drain at all (supply-only) — never need a trap.
const NO_TRAP_SUBTYPES: ReadonlySet<FixtureSubtype> = new Set(['hose_bibb']);

/** Per-fixture trap size (IPC Table 709.1 — partial). */
function trapDiameterFor(subtype: FixtureSubtype): number {
  // Integral traps listed here for completeness, but the planner skips them.
  if (subtype === 'water_closet') return 3;
  if (subtype === 'floor_drain') return 2;
  return 1.5;
}

function humanFixtureName(subtype: FixtureSubtype): string {
  return subtype.replace(/_/g, ' ');
}

// ── Entry point ───────────────────────────────────────────────

export function planPTrapsAndCleanouts(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
  rules: PlannerRules = DEFAULT_PLANNER_RULES,
): TrapCleanoutPlan {
  const pTraps = planPTraps(pipes, fixtures, rules);
  const cleanouts = planCleanouts(pipes, fixtures, rules);

  const cleanoutsByReason: Record<CleanoutReason, number> = {
    end_of_run: 0,
    direction_change_gt_45: 0,
    long_run_exceeds_100ft: 0,
    stack_base: 0,
  };
  for (const c of cleanouts) cleanoutsByReason[c.reason]++;

  return {
    pTraps,
    cleanouts,
    summary: {
      pTrapCount: pTraps.length,
      cleanoutCount: cleanouts.length,
      cleanoutsByReason,
    },
  };
}

// ── P-traps ───────────────────────────────────────────────────

function planPTraps(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
  rules: PlannerRules,
): PTrapRequirement[] {
  const out: PTrapRequirement[] = [];
  for (const f of fixtures) {
    if (INTEGRAL_TRAP_SUBTYPES.has(f.subtype)) continue;
    if (NO_TRAP_SUBTYPES.has(f.subtype)) continue;
    const nearestDrain = findNearestDrainPipe(f.position, pipes, rules);
    const material = nearestDrain ?? rules.defaultDrainMaterial;
    out.push({
      fixtureId: f.id,
      fixtureSubtype: f.subtype,
      position: f.position,
      trapDiameterInches: trapDiameterFor(f.subtype),
      material,
      codeRef: 'IPC 1002.1',
      reason: `${humanFixtureName(f.subtype)} requires an external p-trap on its drain outlet`,
    });
  }
  return out;
}

// ── Cleanouts ─────────────────────────────────────────────────

function planCleanouts(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
  rules: PlannerRules,
): CleanoutRequirement[] {
  const out: CleanoutRequirement[] = [];

  for (const pipe of pipes) {
    // Cleanouts are a drain-side thing. Supply (cold/hot) never gets
    // cleanouts; vent pipes conventionally don't either (terminate at
    // the roof with a cap). Waste + storm are in scope.
    if (pipe.system !== 'waste' && pipe.system !== 'storm') continue;

    const pts = pipe.points;
    if (pts.length < 2) continue;

    const material = asPipeMaterial(pipe.material) ?? rules.defaultDrainMaterial;

    // ── Stack base + direction changes at interior vertices ──
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1]!;
      const curr = pts[i]!;
      const next = pts[i + 1]!;
      const d1 = sub(curr, prev);
      const d2 = sub(next, curr);
      const cls1 = classifySegment(d1, rules.axisToleranceFt);
      const cls2 = classifySegment(d2, rules.axisToleranceFt);

      // Vertical → horizontal (or vice versa) → stack-base cleanout.
      if ((cls1 === 'vertical' && cls2 === 'horizontal')
       || (cls1 === 'horizontal' && cls2 === 'vertical')) {
        out.push({
          pipeId: pipe.id,
          position: curr,
          diameterInches: pipe.diameter,
          material,
          reason: 'stack_base',
          codeRef: 'IPC 708.1.2',
          description: 'Cleanout at base of stack (vertical→horizontal transition)',
        });
        continue;
      }

      // Horizontal direction change above threshold.
      if (cls1 === 'horizontal' && cls2 === 'horizontal') {
        const angle = angleDegBetween(d1, d2);
        if (angle > rules.directionChangeThresholdDeg) {
          out.push({
            pipeId: pipe.id,
            position: curr,
            diameterInches: pipe.diameter,
            material,
            reason: 'direction_change_gt_45',
            codeRef: 'IPC 708.1.1',
            description: `Cleanout at horizontal direction change (${angle.toFixed(0)}°)`,
          });
        }
      }
    }

    // ── Long horizontal run: inject cleanouts at 100 ft spacing ──
    // `accumFt` is distance into the current unbroken horizontal run.
    // Resets to 0 whenever we hit a non-horizontal segment.
    let accumFt = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const seg = sub(b, a);
      if (classifySegment(seg, rules.axisToleranceFt) !== 'horizontal') {
        accumFt = 0;
        continue;
      }
      let remainInSeg = length(seg);
      if (remainInSeg === 0) continue;
      let cursor: Vec3 = a;
      while (accumFt + remainInSeg >= rules.maxHorizontalRunFt) {
        const distToNextCO = rules.maxHorizontalRunFt - accumFt;
        const cursorToB = sub(b, cursor);
        const cursorToBLen = length(cursorToB);
        if (cursorToBLen === 0) break;
        const ratio = distToNextCO / cursorToBLen;
        const injectPt: Vec3 = [
          cursor[0] + cursorToB[0] * ratio,
          cursor[1] + cursorToB[1] * ratio,
          cursor[2] + cursorToB[2] * ratio,
        ];
        out.push({
          pipeId: pipe.id,
          position: injectPt,
          diameterInches: pipe.diameter,
          material,
          reason: 'long_run_exceeds_100ft',
          codeRef: 'IPC 708.1.5',
          description: 'Cleanout at 100 ft max-spacing on long horizontal run',
        });
        accumFt = 0;
        remainInSeg -= distToNextCO;
        cursor = injectPt;
      }
      accumFt += remainInSeg;
    }

    // ── End-of-run cleanouts on dangling drain endpoints ──
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (isDanglingEnd(first, pipe.id, pipes, fixtures, rules)) {
      out.push({
        pipeId: pipe.id,
        position: first,
        diameterInches: pipe.diameter,
        material,
        reason: 'end_of_run',
        codeRef: 'IPC 708.1.4',
        description: 'Cleanout at end of drain run',
      });
    }
    if (isDanglingEnd(last, pipe.id, pipes, fixtures, rules)) {
      out.push({
        pipeId: pipe.id,
        position: last,
        diameterInches: pipe.diameter,
        material,
        reason: 'end_of_run',
        codeRef: 'IPC 708.1.4',
        description: 'Cleanout at end of drain run',
      });
    }
  }

  return dedupeByPosition(out, rules.junctionToleranceFt);
}

// ── Plan → FittingInstance[] for BOM ──────────────────────────

/**
 * Convert the plan into `FittingInstance[]` so BOMExporter aggregates
 * p-traps + cleanouts into the material takeoff alongside bends/tees.
 *
 * FittingInstance has been extended over phases to include quaternion,
 * pipeId, etc. — fields we don't care about for pricing. We emit
 * sensible defaults: identity quaternion, pipeId of the attached pipe
 * (or empty for p-traps that don't sit on a specific pipe), deterministic
 * IDs for idempotence.
 */
export function planToFittings(plan: TrapCleanoutPlan): FittingInstance[] {
  const out: FittingInstance[] = [];
  let seq = 0;
  for (const t of plan.pTraps) {
    out.push({
      id: `compliance-trap-${seq++}`,
      type: 'p_trap',
      position: t.position,
      quaternion: [0, 0, 0, 1],
      diameter: t.trapDiameterInches,
      material: t.material,
      pipeId: '',
    });
  }
  for (const c of plan.cleanouts) {
    out.push({
      id: `compliance-co-${seq++}`,
      type: 'cleanout_adapter',
      position: c.position,
      quaternion: [0, 0, 0, 1],
      diameter: c.diameterInches,
      material: c.material,
      pipeId: c.pipeId,
    });
  }
  return out;
}

// ── Low-level helpers ─────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function angleDegBetween(a: Vec3, b: Vec3): number {
  const la = length(a);
  const lb = length(b);
  if (la === 0 || lb === 0) return 0;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
  const clamped = Math.max(-1, Math.min(1, dot));
  return (Math.acos(clamped) * 180) / Math.PI;
}

type SegmentClass = 'horizontal' | 'vertical' | 'diagonal' | 'zero';

/** Classify a segment by which axis dominates, within `tol`. */
export function classifySegment(v: Vec3, tol: number): SegmentClass {
  const absX = Math.abs(v[0]);
  const absY = Math.abs(v[1]);
  const absZ = Math.abs(v[2]);
  if (absX < tol && absY < tol && absZ < tol) return 'zero';
  const horizMag = Math.sqrt(absX * absX + absZ * absZ);
  if (absY < tol && horizMag >= tol) return 'horizontal';
  if (absX < tol && absZ < tol && absY >= tol) return 'vertical';
  return 'diagonal';
}

function close(a: Vec3, b: Vec3, tol: number): boolean {
  return (
    Math.abs(a[0] - b[0]) < tol
    && Math.abs(a[1] - b[1]) < tol
    && Math.abs(a[2] - b[2]) < tol
  );
}

function isDanglingEnd(
  pt: Vec3,
  thisPipeId: string,
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
  rules: PlannerRules,
): boolean {
  const tol = rules.junctionToleranceFt;
  for (const f of fixtures) {
    if (close(f.position, pt, tol)) return false;
  }
  for (const p of pipes) {
    if (p.id === thisPipeId) continue;
    for (const q of p.points) {
      if (close(q, pt, tol)) return false;
    }
  }
  return true;
}

/** Keep the first occurrence of each position-cluster. */
function dedupeByPosition(
  items: readonly CleanoutRequirement[],
  tol: number,
): CleanoutRequirement[] {
  const kept: CleanoutRequirement[] = [];
  for (const c of items) {
    const dup = kept.some((k) => close(k.position, c.position, tol));
    if (!dup) kept.push(c);
  }
  return kept;
}

function findNearestDrainPipe(
  pt: Vec3,
  pipes: readonly CommittedPipe[],
  _rules: PlannerRules,
): PipeMaterial | null {
  let bestDist = Infinity;
  let bestMat: PipeMaterial | null = null;
  for (const p of pipes) {
    if (p.system !== 'waste' && p.system !== 'storm') continue;
    const mat = asPipeMaterial(p.material);
    if (!mat) continue;
    for (const q of p.points) {
      const d = length(sub(q, pt));
      if (d < bestDist) {
        bestDist = d;
        bestMat = mat;
      }
    }
  }
  return bestMat;
}

function asPipeMaterial(raw: string): PipeMaterial | null {
  return (PIPE_MATERIALS as readonly string[]).includes(raw) ? (raw as PipeMaterial) : null;
}
