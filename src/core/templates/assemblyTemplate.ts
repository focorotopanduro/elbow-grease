/**
 * assemblyTemplate — Phase 14.C
 *
 * A reusable snapshot of pipes + fixtures that can be saved from one
 * project and re-instantiated into another.
 *
 * Example use: a contractor draws a "standard 2-bath rough-in" once,
 * saves it as a template, then drops it pre-wired into the next bid.
 *
 * Design notes:
 *   - Positions are stored RELATIVE to the template's anchor (the
 *     centroid of all pipe-points + fixture-positions). "Instantiate
 *     at (0,0,0)" therefore plants the template centered on origin;
 *     instantiate at (10, 0, 5) shifts everything by that vector.
 *   - IDs are NOT stored. Fresh IDs are minted at instantiate time so
 *     a template can be dropped multiple times into the same scene
 *     without ID collisions.
 *   - The compose + instantiate functions are pure — no React, no
 *     Zustand, no store access. Store wiring lives in
 *     plumbingAssemblyTemplateStore.applyTemplateToScene().
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '@store/pipeStore';
import type { FixtureInstance } from '@store/fixtureStore';
import type { SystemType, FixtureSubtype } from '../../engine/graph/GraphNode';

// ── Types ─────────────────────────────────────────────────────

export interface TemplatePipe {
  /** Points RELATIVE to the template anchor (centroid). */
  points: Vec3[];
  diameter: number;
  material: string;
  system: SystemType;
}

export interface TemplateFixture {
  subtype: FixtureSubtype;
  /** Position RELATIVE to the template anchor (centroid). */
  position: Vec3;
  params: Record<string, unknown>;
}

export interface AssemblyTemplate {
  /** Stable template ID: `t_<base36-millis>_<4rand>`. */
  id: string;
  name: string;
  description?: string;
  /** ISO timestamp (UTC) of when the template was saved. */
  createdAt: string;
  pipes: TemplatePipe[];
  fixtures: TemplateFixture[];
  /** Bounding-box extents in feet (template-relative, for UI listing). */
  extents: { width: number; depth: number; height: number };
  /** Count snapshot for UI summary. Derived, but stored so list UI
   *  doesn't have to re-count on every render. */
  counts: { pipes: number; fixtures: number };
}

export interface ComposeTemplateInput {
  name: string;
  description?: string;
  pipes: CommittedPipe[];
  fixtures: FixtureInstance[];
  /** Explicit ID; generated if omitted. */
  id?: string;
  /** Explicit ISO date; `new Date().toISOString()` if omitted. */
  createdAt?: string;
}

export interface InstantiatedPipe {
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
  system: SystemType;
}

export interface InstantiatedFixture {
  subtype: FixtureSubtype;
  position: Vec3;
  params: Record<string, unknown>;
}

export interface InstantiateResult {
  pipes: InstantiatedPipe[];
  fixtures: InstantiatedFixture[];
}

// ── Pure compose ──────────────────────────────────────────────

/**
 * Snapshot a scene selection into an AssemblyTemplate.
 *
 * Positions are normalized so the centroid of every point
 * (pipe polyline points + fixture positions, equally weighted)
 * sits at the origin. This makes instantiation math symmetric:
 * the user drops a template at a target position and the template's
 * center-of-mass lands there.
 */
export function composeTemplate(input: ComposeTemplateInput): AssemblyTemplate {
  const centroid = computeCentroid(input.pipes, input.fixtures);

  const pipes: TemplatePipe[] = input.pipes.map((p) => ({
    points: p.points.map((pt) => sub(pt, centroid)),
    diameter: p.diameter,
    material: p.material,
    system: p.system,
  }));

  const fixtures: TemplateFixture[] = input.fixtures.map((f) => ({
    subtype: f.subtype,
    position: sub(f.position, centroid),
    params: { ...f.params },
  }));

  const extents = computeExtents(pipes, fixtures);

  return {
    id: input.id ?? generateTemplateId(),
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    createdAt: input.createdAt ?? new Date().toISOString(),
    pipes,
    fixtures,
    extents,
    counts: { pipes: pipes.length, fixtures: fixtures.length },
  };
}

// ── Pure instantiate ──────────────────────────────────────────

/**
 * Prepare instantiation payloads for a template dropped at `anchorPos`.
 *
 * Returns raw data for the caller to pass to `usePipeStore.addPipe` and
 * `useFixtureStore.addFixture`. The store wiring itself is handled by
 * `applyTemplateToScene()` in the store module so this function stays
 * pure + deterministic for testing.
 *
 * `mintId` is injectable so tests can assert on a stable ID sequence.
 */
export function instantiateTemplate(
  tpl: AssemblyTemplate,
  anchorPos: Vec3 = [0, 0, 0],
  mintId: () => string = defaultMintId,
): InstantiateResult {
  return {
    pipes: tpl.pipes.map((p) => ({
      id: mintId(),
      points: p.points.map((pt) => add(pt, anchorPos)),
      diameter: p.diameter,
      material: p.material,
      system: p.system,
    })),
    fixtures: tpl.fixtures.map((f) => ({
      subtype: f.subtype,
      position: add(f.position, anchorPos),
      params: { ...f.params },
    })),
  };
}

// ── Helpers ───────────────────────────────────────────────────

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Mean of every point in every pipe + every fixture position.
 * Returns [0,0,0] for an empty scene so composeTemplate is safe on
 * trivial inputs (UI disables the save button, but defense in depth).
 */
export function computeCentroid(
  pipes: readonly CommittedPipe[],
  fixtures: readonly FixtureInstance[],
): Vec3 {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const p of pipes) {
    for (const pt of p.points) {
      sx += pt[0]; sy += pt[1]; sz += pt[2]; n++;
    }
  }
  for (const f of fixtures) {
    sx += f.position[0]; sy += f.position[1]; sz += f.position[2]; n++;
  }
  if (n === 0) return [0, 0, 0];
  return [sx / n, sy / n, sz / n];
}

function computeExtents(
  pipes: readonly TemplatePipe[],
  fixtures: readonly TemplateFixture[],
): { width: number; depth: number; height: number } {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let seen = false;
  const absorb = (pt: Vec3): void => {
    seen = true;
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
    if (pt[2] < minZ) minZ = pt[2];
    if (pt[2] > maxZ) maxZ = pt[2];
  };
  for (const p of pipes) for (const pt of p.points) absorb(pt);
  for (const f of fixtures) absorb(f.position);
  if (!seen) return { width: 0, depth: 0, height: 0 };
  return {
    width: round3(maxX - minX),
    depth: round3(maxZ - minZ),
    height: round3(maxY - minY),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Stable template ID — `t_<base36-millis>_<4rand>`.
 *
 * Time-sortable (base36 millis) + random suffix so two templates
 * saved in the same millisecond still get unique IDs. `nowMs` is
 * injectable for deterministic tests.
 */
export function generateTemplateId(nowMs: number = Date.now()): string {
  const time = Math.floor(nowMs).toString(36);
  const rand = Math.floor(Math.random() * 0x100_0000)
    .toString(36)
    .padStart(4, '0')
    .slice(-4);
  return `t_${time}_${rand}`;
}

// Default pipe-instance ID minter — used when tests don't inject one.
let pipeInstanceSeq = 0;
function defaultMintId(): string {
  pipeInstanceSeq = (pipeInstanceSeq + 1) & 0xff_ff_ff;
  return `p_inst_${Date.now().toString(36)}_${pipeInstanceSeq.toString(36)}`;
}
