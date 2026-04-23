/**
 * hangerPlanner — Phase 14.H
 *
 * Auto-plans pipe hangers + risers at per-material spacing per plumbing
 * code. The existing BOMExporter rolls up a single "HANGER-STRAP" line
 * at a flat 4 ft spacing — accurate for PVC, but wrong for:
 *
 *   • PEX          — 32" horizontal (2.67 ft) — undercount of ~33%
 *   • Copper ≥ 1¼" — 6 ft horizontal — overcount of ~33%
 *   • Cast iron    — 5 ft horizontal + every joint — undercount
 *   • CPVC small   — 3 ft horizontal                  — undercount
 *   • Steel        — 12 ft horizontal                 — large overcount
 *
 * This module replaces that flat rollup with a per-material plan that
 * reflects real install cost: more hangers on a PEX-heavy supply run,
 * fewer on a copper one, riser clamps at each story for vertical stacks.
 *
 * Code references:
 *   • IPC 308.5  — horizontal piping support intervals (table)
 *   • IPC 308.7  — vertical piping support intervals (story spacing)
 *   • IPC 308.9  — change-of-direction support (at each change > 45°)
 *
 * Scope: pure. No Zustand, no React, no Three. Takes pipes in, returns
 * a plan + ready-to-consume BOMItem[] for direct BOMExporter injection.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import { PIPE_MATERIALS, type PipeMaterial } from '../../engine/graph/GraphEdge';
import type { BOMItem } from '../../engine/export/BOMExporter';

// ── Types ─────────────────────────────────────────────────────

export type HangerReason =
  | 'horizontal_spacing'   // IPC 308.5 — midspan horizontal hanger
  | 'end_of_horizontal'    // Support near termination of a horizontal run
  | 'direction_change'     // IPC 308.9 — support at bend > 45°
  | 'riser_floor';         // IPC 308.7 — vertical riser clamp at floor level

export type HangerKind = 'horizontal_hanger' | 'riser_clamp';

export interface HangerRequirement {
  pipeId: string;
  position: Vec3;
  diameterInches: number;
  material: PipeMaterial;
  kind: HangerKind;
  reason: HangerReason;
  codeRef: string;
  description: string;
}

export interface HangerPlan {
  hangers: HangerRequirement[];
  summary: {
    hangerCount: number;
    byReason: Record<HangerReason, number>;
    byKind: Record<HangerKind, number>;
  };
}

export interface HangerRules {
  /**
   * Max distance in feet between horizontal hangers, keyed by material.
   * Sourced from IPC 308.5 Table (rounded conservatively).
   */
  horizontalSpacingFt: Partial<Record<PipeMaterial, number>>;
  /**
   * Max distance in feet between vertical supports (riser clamps).
   * Sourced from IPC 308.7. In practice this equals story height in
   * most residential jobs, but we enforce a max anyway.
   */
  verticalSpacingFt: Partial<Record<PipeMaterial, number>>;
  /**
   * If true, inject an extra hanger at each horizontal change of
   * direction (> 45°) per IPC 308.9 intent.
   */
  hangerAtDirectionChange: boolean;
  /**
   * If true, inject a hanger near the ends of each horizontal segment
   * so pipe terminations don't cantilever. The hanger lands ~0.5 ft in
   * from each endpoint; skipped if the run is already shorter than that.
   */
  hangerAtHorizontalEnds: boolean;
  /** Segment-classification tolerance (feet). */
  axisToleranceFt: number;
  /** Proximity tolerance for deduping coincident hangers. */
  dedupeToleranceFt: number;
  /**
   * Fallback horizontal spacing when the material isn't in the map.
   * Phase 14.B's existing rollup used 4 ft; we keep that as the fallback.
   */
  fallbackHorizontalFt: number;
  /** Fallback vertical spacing for unknown materials. */
  fallbackVerticalFt: number;
}

// ── Default rules (IPC 308.5 + manufacturer recommendations) ──

export const DEFAULT_HANGER_RULES: HangerRules = {
  horizontalSpacingFt: {
    pvc_sch40: 4,
    pvc_sch80: 4,
    abs: 4,
    cast_iron: 5,    // cast iron + "every joint" — we conservatively use 5 ft
    copper_type_l: 6,
    copper_type_m: 6,
    cpvc: 3,
    pex: 2.67,       // 32" per mfr — IPC 308.5 footnote (g)
    galvanized_steel: 12,
    ductile_iron: 10,
  },
  verticalSpacingFt: {
    pvc_sch40: 10,
    pvc_sch80: 10,
    abs: 10,
    cast_iron: 15,
    copper_type_l: 10,
    copper_type_m: 10,
    cpvc: 10,
    pex: 4,          // 4 ft per mfr for mid-span on vertical
    galvanized_steel: 15,
    ductile_iron: 15,
  },
  hangerAtDirectionChange: true,
  hangerAtHorizontalEnds: true,
  axisToleranceFt: 0.1,
  dedupeToleranceFt: 0.3,
  fallbackHorizontalFt: 4,
  fallbackVerticalFt: 10,
};

// ── Entry point ───────────────────────────────────────────────

export function planHangers(
  pipes: readonly CommittedPipe[],
  rules: HangerRules = DEFAULT_HANGER_RULES,
): HangerPlan {
  const hangers: HangerRequirement[] = [];

  for (const pipe of pipes) {
    const pts = pipe.points;
    if (pts.length < 2) continue;
    const material = asPipeMaterial(pipe.material);
    if (!material) continue;

    const horizSpacing = rules.horizontalSpacingFt[material] ?? rules.fallbackHorizontalFt;
    const vertSpacing = rules.verticalSpacingFt[material] ?? rules.fallbackVerticalFt;

    // Walk each segment and inject hangers along it.
    let accumHorizFt = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const seg = sub(b, a);
      const segLen = length(seg);
      if (segLen === 0) continue;

      const cls = classifySegment(seg, rules.axisToleranceFt);

      if (cls === 'horizontal') {
        // Midspan hangers at `horizSpacing` intervals.
        let remain = segLen;
        let cursor: Vec3 = a;
        while (accumHorizFt + remain >= horizSpacing) {
          const distToNext = horizSpacing - accumHorizFt;
          const cursorToB = sub(b, cursor);
          const cursorToBLen = length(cursorToB);
          if (cursorToBLen === 0) break;
          const ratio = distToNext / cursorToBLen;
          const injectPt: Vec3 = [
            cursor[0] + cursorToB[0] * ratio,
            cursor[1] + cursorToB[1] * ratio,
            cursor[2] + cursorToB[2] * ratio,
          ];
          hangers.push({
            pipeId: pipe.id,
            position: injectPt,
            diameterInches: pipe.diameter,
            material,
            kind: 'horizontal_hanger',
            reason: 'horizontal_spacing',
            codeRef: 'IPC 308.5',
            description: `Hanger every ${horizSpacing.toFixed(horizSpacing < 1 ? 2 : 0)} ft for ${humanMaterial(material)} ${pipe.diameter}″`,
          });
          accumHorizFt = 0;
          remain -= distToNext;
          cursor = injectPt;
        }
        accumHorizFt += remain;

        // End-of-horizontal support (0.5 ft from each endpoint) when
        // the segment is at the start or end of the pipe, and the
        // rule is on.
        if (rules.hangerAtHorizontalEnds) {
          const isFirst = i === 1;
          const isLast = i === pts.length - 1;
          if (isFirst && segLen > 1.0) {
            hangers.push({
              pipeId: pipe.id,
              position: pointAlong(a, b, 0.5 / segLen),
              diameterInches: pipe.diameter,
              material,
              kind: 'horizontal_hanger',
              reason: 'end_of_horizontal',
              codeRef: 'IPC 308.5',
              description: `Support near start of ${humanMaterial(material)} run`,
            });
          }
          if (isLast && segLen > 1.0) {
            hangers.push({
              pipeId: pipe.id,
              position: pointAlong(b, a, 0.5 / segLen),
              diameterInches: pipe.diameter,
              material,
              kind: 'horizontal_hanger',
              reason: 'end_of_horizontal',
              codeRef: 'IPC 308.5',
              description: `Support near end of ${humanMaterial(material)} run`,
            });
          }
        }
      } else if (cls === 'vertical') {
        // Riser clamps at story intervals (or material's max vertical).
        let remain = segLen;
        let cursor: Vec3 = a;
        while (remain >= vertSpacing) {
          const cursorToB = sub(b, cursor);
          const cursorToBLen = length(cursorToB);
          if (cursorToBLen === 0) break;
          const ratio = vertSpacing / cursorToBLen;
          const injectPt: Vec3 = [
            cursor[0] + cursorToB[0] * ratio,
            cursor[1] + cursorToB[1] * ratio,
            cursor[2] + cursorToB[2] * ratio,
          ];
          hangers.push({
            pipeId: pipe.id,
            position: injectPt,
            diameterInches: pipe.diameter,
            material,
            kind: 'riser_clamp',
            reason: 'riser_floor',
            codeRef: 'IPC 308.7',
            description: `Riser clamp every ${vertSpacing.toFixed(0)} ft for ${humanMaterial(material)} ${pipe.diameter}″`,
          });
          remain -= vertSpacing;
          cursor = injectPt;
        }
        // Reset horizontal counter — a vertical break starts a new run.
        accumHorizFt = 0;
      } else {
        // Diagonal — treat conservatively as horizontal for spacing
        // (rarely encountered except in short transitions).
        accumHorizFt += segLen;
      }
    }

    // Direction-change hangers (interior vertices where both adjacent
    // segments are horizontal and the bend angle exceeds 45°).
    if (rules.hangerAtDirectionChange) {
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1]!;
        const curr = pts[i]!;
        const next = pts[i + 1]!;
        const d1 = sub(curr, prev);
        const d2 = sub(next, curr);
        const cls1 = classifySegment(d1, rules.axisToleranceFt);
        const cls2 = classifySegment(d2, rules.axisToleranceFt);
        if (cls1 !== 'horizontal' || cls2 !== 'horizontal') continue;
        const angle = angleDegBetween(d1, d2);
        if (angle <= 45) continue;
        hangers.push({
          pipeId: pipe.id,
          position: curr,
          diameterInches: pipe.diameter,
          material,
          kind: 'horizontal_hanger',
          reason: 'direction_change',
          codeRef: 'IPC 308.9',
          description: `Support at horizontal bend (${angle.toFixed(0)}°)`,
        });
      }
    }
  }

  const deduped = dedupeHangers(hangers, rules.dedupeToleranceFt);

  // Summary counters.
  const byReason: Record<HangerReason, number> = {
    horizontal_spacing: 0,
    end_of_horizontal: 0,
    direction_change: 0,
    riser_floor: 0,
  };
  const byKind: Record<HangerKind, number> = {
    horizontal_hanger: 0,
    riser_clamp: 0,
  };
  for (const h of deduped) {
    byReason[h.reason]++;
    byKind[h.kind]++;
  }

  return {
    hangers: deduped,
    summary: { hangerCount: deduped.length, byReason, byKind },
  };
}

// ── Plan → BOMItem aggregation ────────────────────────────────

/** Per-hanger unit cost in USD (kind × material-family, rough 2025 pricing). */
function unitCostFor(kind: HangerKind, material: PipeMaterial): number {
  if (kind === 'riser_clamp') {
    // Riser clamps are meatier than straps; cast-iron/steel need the
    // heavier rating.
    if (isMetallic(material)) return 6.5;
    return 3.5;
  }
  // Horizontal hanger / strap.
  if (isMetallic(material)) {
    return 2.25; // copper-compatible J-hook / clevis
  }
  if (material === 'pex') return 0.85; // plastic clip per foot cheap
  return 1.25; // PVC strap
}

/** Labor hours per hanger install. Riser clamps take longer. */
function unitLaborFor(kind: HangerKind): number {
  return kind === 'riser_clamp' ? 0.18 : 0.08;
}

function isMetallic(m: PipeMaterial): boolean {
  return m === 'copper_type_l'
      || m === 'copper_type_m'
      || m === 'cast_iron'
      || m === 'galvanized_steel'
      || m === 'ductile_iron';
}

/**
 * Aggregate the plan into BOMItems grouped by (kind, material, diameter).
 * These are drop-in ready for BOMExporter's `supportItemsOverride` hook.
 */
export function planToBOMItems(plan: HangerPlan): BOMItem[] {
  const buckets = new Map<string, {
    kind: HangerKind;
    material: PipeMaterial;
    diameter: number;
    count: number;
  }>();

  for (const h of plan.hangers) {
    const key = `${h.kind}|${h.material}|${h.diameterInches}`;
    const existing = buckets.get(key);
    if (existing) existing.count++;
    else buckets.set(key, {
      kind: h.kind,
      material: h.material,
      diameter: h.diameterInches,
      count: 1,
    });
  }

  const items: BOMItem[] = [];
  for (const b of buckets.values()) {
    const unitCost = unitCostFor(b.kind, b.material);
    const unitLabor = unitLaborFor(b.kind);
    const description = b.kind === 'riser_clamp'
      ? `Riser clamp, ${humanMaterial(b.material)} ${b.diameter}″`
      : `Hanger, ${humanMaterial(b.material)} ${b.diameter}″`;
    const partHint = b.kind === 'riser_clamp'
      ? `RISER-CLAMP-${b.material.toUpperCase()}-${b.diameter}`
      : `HANGER-${b.material.toUpperCase()}-${b.diameter}`;
    items.push({
      category: 'support',
      description,
      material: humanMaterial(b.material),
      size: `${b.diameter}"`,
      quantity: b.count,
      unit: 'ea',
      unitCost,
      totalCost: +(unitCost * b.count).toFixed(2),
      unitLaborHours: unitLabor,
      laborHours: +(unitLabor * b.count).toFixed(3),
      partHint,
    });
  }
  // Sort by kind then material then diameter for stable output order.
  items.sort((a, b) =>
    a.partHint.localeCompare(b.partHint),
  );
  return items;
}

// ── Helpers ───────────────────────────────────────────────────

function asPipeMaterial(raw: string): PipeMaterial | null {
  return (PIPE_MATERIALS as readonly string[]).includes(raw) ? (raw as PipeMaterial) : null;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

function pointAlong(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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
  return Math.abs(a[0] - b[0]) < tol
      && Math.abs(a[1] - b[1]) < tol
      && Math.abs(a[2] - b[2]) < tol;
}

/** Dedupe hangers that landed within tolerance of another (e.g.
 *  direction-change + horizontal-spacing coincident at a bend). */
function dedupeHangers(items: HangerRequirement[], tol: number): HangerRequirement[] {
  const kept: HangerRequirement[] = [];
  for (const h of items) {
    const dup = kept.some((k) =>
      k.material === h.material
      && k.kind === h.kind
      && close(k.position, h.position, tol),
    );
    if (!dup) kept.push(h);
  }
  return kept;
}

export function humanMaterial(m: PipeMaterial): string {
  const map: Record<PipeMaterial, string> = {
    pvc_sch40: 'PVC Sch 40',
    pvc_sch80: 'PVC Sch 80',
    abs: 'ABS',
    cast_iron: 'Cast Iron',
    copper_type_l: 'Copper Type L',
    copper_type_m: 'Copper Type M',
    cpvc: 'CPVC',
    pex: 'PEX',
    galvanized_steel: 'Galv. Steel',
    ductile_iron: 'Ductile Iron',
  };
  return map[m];
}
