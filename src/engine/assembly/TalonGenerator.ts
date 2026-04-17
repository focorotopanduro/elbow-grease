/**
 * TalonGenerator — procedural pipe support placement.
 *
 * Plumbing code (IPC 308) mandates pipe supports at maximum intervals
 * that vary by pipe material. This module walks the committed pipe
 * network and deterministically injects support hardware (talons,
 * hangers, clevises, or straps) at legal intervals.
 *
 * Support spacing per IPC 308.5 (horizontal runs):
 *   PVC Sch 40 / ABS:    4 ft
 *   PVC Sch 80:          4 ft
 *   Cast iron no-hub:    5 ft (at every joint + midspan)
 *   Copper Type L/M:     6 ft (≤1"), 10 ft (>1")
 *   PEX:                 32" (2.67 ft)
 *   Galvanized steel:    12 ft
 *   Ductile iron:        At every joint
 *
 * Support hardware types:
 *   TALON           — overhead cast-iron style hanger with saddle
 *   CLEVIS_HANGER   — threaded rod + clevis for suspended runs
 *   PIPE_STRAP      — metal strap for wall-mounted runs
 *   RISER_CLAMP     — vertical pipe wall anchor
 *   ISOLATOR_PAD    — seismic/thermal isolator (CA/FL zones)
 *
 * The generator selects the appropriate hardware based on:
 *   1. Pipe orientation (horizontal → strap/clevis, vertical → riser clamp)
 *   2. Installation context (overhead joist vs wall stud vs slab)
 *   3. Pipe size (larger pipes need heavier hardware)
 *   4. Regional seismic zone (IBC 1616 requires bracing in high-risk areas)
 *
 * Output is an array of TalonInstance objects keyed back to the
 * parent pipe. The UI renders these via an InstancedMesh for
 * performance (one InstancedMesh per hardware type × diameter).
 */

import type { CommittedPipe } from '@store/pipeStore';
import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../graph/GraphEdge';

// ── Support type enum ───────────────────────────────────────────

export type SupportType =
  | 'talon'
  | 'clevis_hanger'
  | 'pipe_strap'
  | 'riser_clamp'
  | 'isolator_pad';

// ── Seismic zone designations ───────────────────────────────────

export type SeismicZone = 'none' | 'low' | 'moderate' | 'high';

// ── Support instance ────────────────────────────────────────────

export interface TalonInstance {
  id: string;
  supportType: SupportType;
  /** World-space position. */
  position: Vec3;
  /** Direction the support attaches to (normal pointing to anchor surface). */
  anchorNormal: Vec3;
  /** Which pipe this support serves. */
  pipeId: string;
  /** Pipe diameter this support fits (inches). */
  diameter: number;
  /** Support rating (load capacity, lbs). */
  loadCapacityLbs: number;
  /** Unit cost (USD). */
  unitCost: number;
  /** Part number hint. */
  partNumber: string;
  /** Is this a code-required support, or supplemental? */
  required: boolean;
}

// ── Spacing tables ──────────────────────────────────────────────

/** IPC 308.5 max horizontal support spacing (feet) by material. */
const HORIZ_SPACING_FT: Partial<Record<PipeMaterial, number>> = {
  pvc_sch40:        4.0,
  pvc_sch80:        4.0,
  abs:              4.0,
  cpvc:             3.0,
  pex:              2.67, // 32"
  copper_type_l:    6.0,  // ≤1" size; bumped to 10ft for larger sizes in code
  copper_type_m:    6.0,
  cast_iron:        5.0,
  galvanized_steel: 12.0,
  ductile_iron:     5.0,
};

/** Vertical support spacing (feet) — typically wider than horizontal. */
const VERT_SPACING_FT: Partial<Record<PipeMaterial, number>> = {
  pvc_sch40:        10.0,
  pvc_sch80:        10.0,
  abs:              10.0,
  cpvc:             10.0,
  pex:              4.0,
  copper_type_l:    10.0,
  copper_type_m:    10.0,
  cast_iron:        15.0, // mid-story + base of stack
  galvanized_steel: 15.0,
  ductile_iron:     15.0,
};

/**
 * Copper spacing upgrades for larger sizes (per ASME/IPC):
 *   1" and smaller: 6 ft
 *   1.25" to 2":    10 ft
 *   Over 2":        10 ft
 */
function copperHorizSpacing(diameter: number): number {
  if (diameter <= 1) return 6;
  return 10;
}

// ── Unit cost tables ────────────────────────────────────────────

const SUPPORT_COSTS: Record<SupportType, Record<number, number>> = {
  talon: {
    1.5: 3, 2: 4, 3: 6, 4: 10, 6: 18,
  },
  clevis_hanger: {
    0.5: 2.5, 0.75: 3, 1: 3.5, 1.5: 5, 2: 6, 3: 10, 4: 15, 6: 25,
  },
  pipe_strap: {
    0.375: 0.4, 0.5: 0.5, 0.75: 0.6, 1: 0.8, 1.5: 1.2, 2: 1.8, 3: 3.5, 4: 5,
  },
  riser_clamp: {
    1.5: 8, 2: 10, 3: 15, 4: 22, 6: 35,
  },
  isolator_pad: {
    1.5: 5, 2: 7, 3: 12, 4: 18, 6: 30,
  },
};

function costFor(type: SupportType, diameter: number): number {
  const table = SUPPORT_COSTS[type];
  const sizes = Object.keys(table).map(Number).sort((a, b) => a - b);
  const closest = sizes.reduce((prev, curr) =>
    Math.abs(curr - diameter) < Math.abs(prev - diameter) ? curr : prev,
  );
  return table[closest] ?? 5;
}

// ── Load capacity lookup ────────────────────────────────────────

function loadCapacity(type: SupportType, diameter: number): number {
  // Rough approximations (lbs) — real engineering data would come from
  // manufacturer catalogs (Caddy, Unistrut, Eaton B-Line)
  const base: Record<SupportType, number> = {
    talon: 100,
    clevis_hanger: 250,
    pipe_strap: 40,
    riser_clamp: 200,
    isolator_pad: 150,
  };
  return base[type] * (diameter / 2); // scale with pipe size
}

// ── Path traversal ──────────────────────────────────────────────

interface PathSegment {
  start: Vec3;
  end: Vec3;
  length: number;
  direction: Vec3;
  isHorizontal: boolean;
  isVertical: boolean;
}

function segmentsFromPipe(pipe: CommittedPipe): PathSegment[] {
  const segments: PathSegment[] = [];
  for (let i = 1; i < pipe.points.length; i++) {
    const a = pipe.points[i - 1]!;
    const b = pipe.points[i]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) continue;

    const dir: Vec3 = [dx / len, dy / len, dz / len];
    const horizRun = Math.sqrt(dx * dx + dz * dz);
    const verticalDominance = Math.abs(dy) / (len + 1e-6);

    segments.push({
      start: a,
      end: b,
      length: len,
      direction: dir,
      isHorizontal: verticalDominance < 0.3, // mostly horizontal
      isVertical: verticalDominance > 0.7,  // mostly vertical
    });
  }
  return segments;
}

// ── Support type selector ───────────────────────────────────────

function pickSupportType(
  segment: PathSegment,
  _pipe: CommittedPipe,
  overhead: boolean,
): SupportType {
  if (segment.isVertical) return 'riser_clamp';
  if (overhead) return 'clevis_hanger';
  return 'pipe_strap';
}

// ── Anchor normal calculation ───────────────────────────────────

/**
 * Compute the vector from pipe axis to anchor surface.
 * Overhead horizontal: up (+Y)
 * Wall-mount horizontal: horizontal perpendicular to pipe
 * Vertical: perpendicular to pipe axis in the horizontal plane
 */
function anchorNormalFor(segment: PathSegment, overhead: boolean): Vec3 {
  if (segment.isVertical) {
    // For vertical pipes, anchor to nearest wall stud (perpendicular horizontal)
    return [1, 0, 0]; // default — could be improved by querying nearby walls
  }
  if (overhead) return [0, 1, 0]; // up to joist
  return [0, 1, 0]; // default up — wall-mount would need wall detection
}

// ── Main generator ──────────────────────────────────────────────

export interface TalonGenConfig {
  /** Seismic zone affects spacing reduction and bracing requirement. */
  seismicZone: SeismicZone;
  /** Pipes running above 8ft are considered "overhead" and get clevis hangers. */
  overheadThresholdFt: number;
  /** Pipes below slab (negative Y) get no supports (embedded). */
  slabLevelFt: number;
  /** Apply seismic spacing factor (reduces spacing in high zones). */
  applySeismicReduction: boolean;
}

export const DEFAULT_TALON_CONFIG: TalonGenConfig = {
  seismicZone: 'moderate', // Florida default
  overheadThresholdFt: 7,
  slabLevelFt: 0,
  applySeismicReduction: true,
};

/**
 * Seismic spacing reduction factors (IBC 1616.5).
 * High-risk zones require supports at ~70% of max spacing.
 */
function seismicFactor(zone: SeismicZone): number {
  switch (zone) {
    case 'none':     return 1.0;
    case 'low':      return 0.9;
    case 'moderate': return 0.8;
    case 'high':     return 0.7;
  }
}

let idCounter = 0;

/**
 * Generate supports for a single pipe. Called per-pipe so the layer
 * filter in the visual renderer can show/hide supports by pipe system.
 */
export function generateSupports(
  pipe: CommittedPipe,
  config: TalonGenConfig = DEFAULT_TALON_CONFIG,
): TalonInstance[] {
  const supports: TalonInstance[] = [];
  const segments = segmentsFromPipe(pipe);

  // Determine max spacing for this pipe's material + diameter
  let horizMax = HORIZ_SPACING_FT[pipe.material as PipeMaterial] ?? 4;
  const vertMax = VERT_SPACING_FT[pipe.material as PipeMaterial] ?? 10;

  // Copper scales with size
  if (pipe.material === 'copper_type_l' || pipe.material === 'copper_type_m') {
    horizMax = copperHorizSpacing(pipe.diameter);
  }

  // Apply seismic reduction
  if (config.applySeismicReduction) {
    const f = seismicFactor(config.seismicZone);
    horizMax *= f;
  }

  for (const seg of segments) {
    const maxSpacing = seg.isVertical ? vertMax : horizMax;

    // Determine if this segment is "overhead" based on average Y
    const avgY = (seg.start[1] + seg.end[1]) / 2;
    const overhead = avgY >= config.overheadThresholdFt;

    // Skip embedded (below slab) pipes
    if (avgY < config.slabLevelFt - 0.1) continue;

    // Place supports along the segment at max-spacing intervals
    // Skip the first interval if the segment starts from a fitting
    // (fittings don't need support — they're supported by adjacent pipes)
    let distanceTraveled = 0;
    const stepCount = Math.floor(seg.length / maxSpacing);

    for (let i = 1; i <= stepCount; i++) {
      const t = (i * maxSpacing) / seg.length;
      const pos: Vec3 = [
        seg.start[0] + (seg.end[0] - seg.start[0]) * t,
        seg.start[1] + (seg.end[1] - seg.start[1]) * t,
        seg.start[2] + (seg.end[2] - seg.start[2]) * t,
      ];

      const supportType = pickSupportType(seg, pipe, overhead);
      const normal = anchorNormalFor(seg, overhead);

      supports.push({
        id: `talon-${idCounter++}`,
        supportType,
        position: pos,
        anchorNormal: normal,
        pipeId: pipe.id,
        diameter: pipe.diameter,
        loadCapacityLbs: loadCapacity(supportType, pipe.diameter),
        unitCost: costFor(supportType, pipe.diameter),
        partNumber: `${supportType.toUpperCase().replace('_', '-')}-${pipe.diameter}`,
        required: true,
      });

      distanceTraveled = i * maxSpacing;
    }

    // If in a high seismic zone, add a lateral brace at every other support
    if (config.seismicZone === 'high' && supports.length > 0) {
      const lastSupport = supports[supports.length - 1]!;
      supports.push({
        id: `talon-${idCounter++}`,
        supportType: 'isolator_pad',
        position: [lastSupport.position[0], lastSupport.position[1], lastSupport.position[2] + 0.1],
        anchorNormal: [0, 0, 1],
        pipeId: pipe.id,
        diameter: pipe.diameter,
        loadCapacityLbs: loadCapacity('isolator_pad', pipe.diameter),
        unitCost: costFor('isolator_pad', pipe.diameter),
        partNumber: `SEIS-BRACE-${pipe.diameter}`,
        required: true,
      });
    }
  }

  return supports;
}

/** Generate supports for multiple pipes in one pass. */
export function generateAllSupports(
  pipes: CommittedPipe[],
  config: TalonGenConfig = DEFAULT_TALON_CONFIG,
): TalonInstance[] {
  const out: TalonInstance[] = [];
  for (const p of pipes) out.push(...generateSupports(p, config));
  return out;
}

/** Aggregate supports into a BOM-ready summary. */
export function summarizeSupports(supports: TalonInstance[]): {
  type: SupportType;
  diameter: number;
  count: number;
  totalCost: number;
}[] {
  const map = new Map<string, { type: SupportType; diameter: number; count: number; totalCost: number }>();
  for (const s of supports) {
    const key = `${s.supportType}|${s.diameter}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.totalCost += s.unitCost;
    } else {
      map.set(key, {
        type: s.supportType,
        diameter: s.diameter,
        count: 1,
        totalCost: s.unitCost,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
