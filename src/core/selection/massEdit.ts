/**
 * massEdit — Phase 14.N
 *
 * Pure functions for bulk property changes across a multi-selection.
 * A change-set is "sparse": each field is optional, and absent fields
 * leave the entity untouched. The caller applies the change-set once
 * per selected entity; the store actions fire only for properties
 * that actually differ, to minimize re-render churn.
 *
 * Input shape:
 *   • `EditablePipe`   — minimal pipe fields we can mass-edit
 *   • `PipeChangeSet`  — which fields to apply
 *
 * Output shape:
 *   • `applyPipeEdit(pipe, changes)` — returns the new pipe OR null
 *     when nothing actually changed (so caller can skip setState).
 *
 * Also exports `summarizeSelection` which produces a histogram of
 * "currently in selection" for the panel's preview strip — shows
 * mixed-value states like "3× PVC Sch 40, 2× Copper Type L" so the
 * user knows what they're about to overwrite.
 */

import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType } from '../../engine/graph/GraphNode';

// ── Types ─────────────────────────────────────────────────────

export interface EditablePipe {
  id: string;
  material: string;
  diameter: number;
  system: SystemType;
  visible: boolean;
}

export interface EditableFixture {
  id: string;
  visible?: boolean; // Fixtures don't have this today; reserved for v2.
}

export type VisibilityOp = 'show' | 'hide' | 'unchanged';

export interface PipeChangeSet {
  /** If set, override every pipe's material. Undefined = leave alone. */
  material?: PipeMaterial;
  /** If set, override every pipe's diameter. */
  diameter?: number;
  /** If set, override every pipe's system. */
  system?: SystemType;
  /** Bulk visibility operation for pipes. */
  visibility?: VisibilityOp;
}

export interface FixtureChangeSet {
  /** Bulk visibility for fixtures. Not implemented in MVP stores but
   *  reserved here so the UI can show the control consistently. */
  visibility?: VisibilityOp;
}

export interface MassEditSet {
  pipes?: PipeChangeSet;
  fixtures?: FixtureChangeSet;
}

// ── Per-entity application ───────────────────────────────────

export interface PipeEditResult {
  id: string;
  changed: boolean;
  /** Only fields that changed. Undefined = no change on that field. */
  material?: PipeMaterial;
  diameter?: number;
  system?: SystemType;
  visible?: boolean;
}

/**
 * Compute the minimal diff between `pipe` and `changes`. A field is
 * emitted only when the new value differs from the current one —
 * lets the caller decide whether to call setState at all.
 */
export function applyPipeEdit(pipe: EditablePipe, changes: PipeChangeSet): PipeEditResult {
  const out: PipeEditResult = { id: pipe.id, changed: false };
  if (changes.material !== undefined && changes.material !== pipe.material) {
    out.material = changes.material;
    out.changed = true;
  }
  if (changes.diameter !== undefined && changes.diameter !== pipe.diameter) {
    out.diameter = changes.diameter;
    out.changed = true;
  }
  if (changes.system !== undefined && changes.system !== pipe.system) {
    out.system = changes.system;
    out.changed = true;
  }
  if (changes.visibility && changes.visibility !== 'unchanged') {
    const next = changes.visibility === 'show';
    if (next !== pipe.visible) {
      out.visible = next;
      out.changed = true;
    }
  }
  return out;
}

// ── Selection summary (histograms) ───────────────────────────

export interface PipeHistogram {
  materials: Array<{ value: string; count: number }>;
  diameters: Array<{ value: number; count: number }>;
  systems: Array<{ value: SystemType; count: number }>;
  hiddenCount: number;
  visibleCount: number;
}

export interface SelectionSummary {
  pipeCount: number;
  fixtureCount: number;
  pipes: PipeHistogram;
}

/**
 * Produce a per-field histogram of the selected pipes so the panel
 * can show "3× PVC Sch 40, 2× Copper Type L" and the user knows
 * the current mixed-value state before committing.
 */
export function summarizeSelection(
  pipes: readonly EditablePipe[],
  fixtureCount: number,
): SelectionSummary {
  const matMap = new Map<string, number>();
  const diaMap = new Map<number, number>();
  const sysMap = new Map<SystemType, number>();
  let hidden = 0;
  let visible = 0;
  for (const p of pipes) {
    matMap.set(p.material, (matMap.get(p.material) ?? 0) + 1);
    diaMap.set(p.diameter, (diaMap.get(p.diameter) ?? 0) + 1);
    sysMap.set(p.system, (sysMap.get(p.system) ?? 0) + 1);
    if (p.visible) visible++; else hidden++;
  }
  const materials = Array.from(matMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  const diameters = Array.from(diaMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value - b.value);
  const systems = Array.from(sysMap.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return {
    pipeCount: pipes.length,
    fixtureCount,
    pipes: {
      materials,
      diameters,
      systems,
      hiddenCount: hidden,
      visibleCount: visible,
    },
  };
}

// ── Change-set introspection ─────────────────────────────────

/** True when the change-set would alter nothing on any entity. */
export function isEmptyChangeSet(set: MassEditSet): boolean {
  const p = set.pipes;
  const f = set.fixtures;
  const pNoop = !p
    || (p.material === undefined
      && p.diameter === undefined
      && p.system === undefined
      && (!p.visibility || p.visibility === 'unchanged'));
  const fNoop = !f || !f.visibility || f.visibility === 'unchanged';
  return pNoop && fNoop;
}

/** True when applying `set` to `pipes` would change at least one pipe. */
export function changeSetAffectsAny(
  pipes: readonly EditablePipe[],
  set: MassEditSet,
): boolean {
  if (!set.pipes) return false;
  for (const p of pipes) {
    if (applyPipeEdit(p, set.pipes).changed) return true;
  }
  return false;
}

// ── Human-readable formatters (shared with the UI) ──────────

export function humanMaterial(m: string): string {
  const map: Record<string, string> = {
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
  return map[m] ?? m;
}

export function humanSystem(s: SystemType): string {
  const map: Record<SystemType, string> = {
    waste: 'Waste',
    vent: 'Vent',
    cold_supply: 'Cold Supply',
    hot_supply: 'Hot Supply',
    storm: 'Storm',
    condensate: 'Condensate',
  };
  return map[s];
}

export function humanDiameter(d: number): string {
  if (d < 1) {
    const frac = d === 0.5 ? '½' : d === 0.75 ? '¾' : d === 0.25 ? '¼' : null;
    if (frac) return `${frac}″`;
  }
  if (Number.isInteger(d)) return `${d}″`;
  if (d === 1.5) return '1½″';
  if (d === 2.5) return '2½″';
  return `${d}″`;
}
