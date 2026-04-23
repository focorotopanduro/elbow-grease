/**
 * DXFExporter — Phase 14.AA.1
 *
 * Serialize the current scene (pipes + fixtures + optional walls)
 * into AutoCAD DXF ASCII, AC1027 format (AutoCAD 2013+, universally
 * readable by every modern DWG/DXF consumer — Revit, ArchiCAD,
 * BricsCAD, Draftsight, etc.).
 *
 * Audience: contractors who need to hand off the plumbing design
 * to a general contractor or architect whose shop runs AutoCAD.
 * DXF is the universal "here is the 2D plan" hand-off format.
 *
 * Design decisions:
 *
 *   • Projection: plan view by default (drop Y → 2D X/Z). Elevation
 *     variants (X-elev, Z-elev) are options for section drawings.
 *     3D DXF is possible but rarely the deliverable — most CAD
 *     consumers import plan views as a drafting reference.
 *
 *   • Layers: one per plumbing system + fixtures / fittings /
 *     walls / dimensions. Layer names follow the AIA CAD Layer
 *     Guidelines (P-DRAN, P-VENT, P-DOMH, P-DOMC, etc.) so imports
 *     into a well-organized AutoCAD project slot into the right
 *     buckets automatically.
 *
 *   • Entities: pipes → LWPOLYLINE, fixture footprints →
 *     CIRCLE + TEXT label, fittings → CIRCLE (compact), walls →
 *     LINE. No blocks yet; every entity is inline geometry.
 *
 *   • Units: feet. DXF $INSUNITS = 2 (imperial feet).
 *
 * Pure module — no React, no Zustand, no Three. Returns a string.
 * The caller triggers a download via BOMExporter's `downloadFile`.
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';
import type { SystemType } from '../graph/GraphNode';
import type { PipeMaterial } from '../graph/GraphEdge';
import type { FittingInstance } from '../../ui/pipe/FittingGenerator';

// ── Types ─────────────────────────────────────────────────────

export type DxfProjection = 'plan' | 'elevation_x' | 'elevation_z';

export interface DxfExportOptions {
  /** Plan view (default) | X-axis elevation | Z-axis elevation. */
  projection?: DxfProjection;
  /** Project name embedded in the HEADER. */
  projectName?: string;
  /** Include walls in the output (defaults true if provided). */
  includeWalls?: boolean;
  /** Include fittings as symbol circles (defaults true). */
  includeFittings?: boolean;
  /** Include text labels with diameter + system (defaults true). */
  includeLabels?: boolean;
}

export interface DxfScene {
  pipes: readonly CommittedPipe[];
  fixtures: readonly FixtureInstance[];
  walls?: readonly { id: string; points: [number, number, number][] }[];
  fittings?: readonly FittingInstance[];
}

export interface DxfExportResult {
  content: string;
  /** Total DXF entity count (useful for progress / smoke tests). */
  entityCount: number;
  /** Byte length of the content. */
  sizeBytes: number;
  /** Layers the export wrote to (subset of the global catalog). */
  layersUsed: string[];
}

// ── AIA-guideline layer names ─────────────────────────────────

const SYSTEM_LAYERS: Record<SystemType, { name: string; colorIdx: number }> = {
  waste:       { name: 'P-DRAN-WAST', colorIdx: 1 },   // red
  vent:        { name: 'P-VENT',      colorIdx: 2 },   // yellow
  storm:       { name: 'P-DRAN-STRM', colorIdx: 6 },   // magenta
  cold_supply: { name: 'P-DOMC',      colorIdx: 5 },   // blue
  hot_supply:  { name: 'P-DOMH',      colorIdx: 1 },   // red
  // Phase 14.AA.3 — AIA P-CNDS layer for HVAC condensate,
  // AutoCAD color 150 (violet) for visual distinction.
  condensate:  { name: 'P-CNDS',      colorIdx: 150 },
};

const LAYER_FIXTURES   = { name: 'P-FIXT',     colorIdx: 3 };  // green
const LAYER_FITTINGS   = { name: 'P-FIXT-SYMB',colorIdx: 4 };  // cyan
const LAYER_WALLS      = { name: 'A-WALL',     colorIdx: 8 };  // dark gray
const LAYER_LABELS     = { name: 'P-NOTE',     colorIdx: 7 };  // white/black

// ── DXF group-code writer ────────────────────────────────────

/**
 * DXF ASCII is a stream of (groupCode, value) pairs, one per line.
 * Group codes are integers; values are strings (coordinates get
 * formatted to a fixed precision).
 */
class DxfWriter {
  private lines: string[] = [];
  private entityCount = 0;

  code(gc: number, value: string | number): void {
    this.lines.push(String(gc));
    this.lines.push(typeof value === 'number' ? formatCoord(value) : value);
  }

  bumpEntity(): void {
    this.entityCount++;
  }

  get text(): string {
    return this.lines.join('\r\n');
  }

  get count(): number {
    return this.entityCount;
  }
}

/** 4-decimal fixed precision — plenty for plumbing at foot units. */
function formatCoord(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4) : '0.0000';
}

// ── Projection ────────────────────────────────────────────────

function project(
  p: [number, number, number],
  projection: DxfProjection,
): [number, number] {
  switch (projection) {
    case 'plan':         return [p[0], p[2]];    // drop Y → (X, Z) plan
    case 'elevation_x':  return [p[0], p[1]];    // X-axis elev → (X, Y)
    case 'elevation_z':  return [p[2], p[1]];    // Z-axis elev → (Z, Y)
  }
}

// ── Section writers ──────────────────────────────────────────

function writeHeader(w: DxfWriter, projectName: string): void {
  w.code(0, 'SECTION');
  w.code(2, 'HEADER');
  // AutoCAD version (AC1027 = AutoCAD 2013+)
  w.code(9, '$ACADVER'); w.code(1, 'AC1027');
  // Project name (displayed by the consumer)
  w.code(9, '$PROJECTNAME'); w.code(1, projectName);
  // Units: 2 = decimal feet (US customary plumbing convention)
  w.code(9, '$INSUNITS'); w.code(70, '2');
  // Measurement system: 0 = imperial
  w.code(9, '$MEASUREMENT'); w.code(70, '0');
  w.code(0, 'ENDSEC');
}

function writeLayerTable(w: DxfWriter, usedSystems: Set<SystemType>,
    hasFixtures: boolean, hasFittings: boolean, hasWalls: boolean,
    hasLabels: boolean): string[] {
  const layersUsed: string[] = [];
  const writeLayer = (name: string, colorIdx: number): void => {
    w.code(0, 'LAYER');
    w.code(2, name);
    w.code(70, '0');        // flags
    w.code(62, String(colorIdx));
    w.code(6, 'CONTINUOUS'); // linetype
    layersUsed.push(name);
  };

  w.code(0, 'SECTION');
  w.code(2, 'TABLES');
  w.code(0, 'TABLE');
  w.code(2, 'LAYER');
  // Layer count placeholder — DXF doesn't strictly enforce match,
  // but writing the correct total avoids importer warnings.
  const total =
    usedSystems.size
    + (hasFixtures ? 1 : 0)
    + (hasFittings ? 1 : 0)
    + (hasWalls ? 1 : 0)
    + (hasLabels ? 1 : 0);
  w.code(70, String(total));

  for (const sys of usedSystems) {
    const meta = SYSTEM_LAYERS[sys];
    writeLayer(meta.name, meta.colorIdx);
  }
  if (hasFixtures) writeLayer(LAYER_FIXTURES.name, LAYER_FIXTURES.colorIdx);
  if (hasFittings) writeLayer(LAYER_FITTINGS.name, LAYER_FITTINGS.colorIdx);
  if (hasWalls) writeLayer(LAYER_WALLS.name, LAYER_WALLS.colorIdx);
  if (hasLabels) writeLayer(LAYER_LABELS.name, LAYER_LABELS.colorIdx);

  w.code(0, 'ENDTAB');
  w.code(0, 'ENDSEC');
  return layersUsed;
}

function writePolyline(
  w: DxfWriter,
  layer: string,
  colorIdx: number,
  projectedPoints: [number, number][],
): void {
  if (projectedPoints.length < 2) return;
  w.code(0, 'LWPOLYLINE');
  w.code(8, layer);
  w.code(62, String(colorIdx));
  w.code(90, String(projectedPoints.length));
  // 70 = flags (0 = open polyline)
  w.code(70, '0');
  for (const [x, y] of projectedPoints) {
    w.code(10, x);
    w.code(20, y);
  }
  w.bumpEntity();
}

function writeCircle(
  w: DxfWriter,
  layer: string,
  colorIdx: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  w.code(0, 'CIRCLE');
  w.code(8, layer);
  w.code(62, String(colorIdx));
  w.code(10, cx);
  w.code(20, cy);
  w.code(40, radius); // radius
  w.bumpEntity();
}

function writeText(
  w: DxfWriter,
  layer: string,
  colorIdx: number,
  x: number,
  y: number,
  height: number,
  text: string,
): void {
  w.code(0, 'TEXT');
  w.code(8, layer);
  w.code(62, String(colorIdx));
  w.code(10, x);
  w.code(20, y);
  w.code(40, height);
  w.code(1, text);
  w.bumpEntity();
}

function writeLine(
  w: DxfWriter,
  layer: string,
  colorIdx: number,
  a: [number, number],
  b: [number, number],
): void {
  w.code(0, 'LINE');
  w.code(8, layer);
  w.code(62, String(colorIdx));
  w.code(10, a[0]); w.code(20, a[1]);
  w.code(11, b[0]); w.code(21, b[1]);
  w.bumpEntity();
}

// ── Entity writers ────────────────────────────────────────────

function writePipes(
  w: DxfWriter,
  pipes: readonly CommittedPipe[],
  projection: DxfProjection,
  includeLabels: boolean,
  usedSystems: Set<SystemType>,
): void {
  for (const p of pipes) {
    if (!p.visible) continue;
    const layerMeta = SYSTEM_LAYERS[p.system];
    if (!layerMeta) continue;
    usedSystems.add(p.system);
    const pts: [number, number][] = p.points.map((v) => project(v, projection));
    writePolyline(w, layerMeta.name, layerMeta.colorIdx, pts);

    if (includeLabels && pts.length >= 2) {
      // Label at midpoint: diameter + material abbreviation
      const midIdx = Math.floor(pts.length / 2);
      const mid = pts[midIdx]!;
      const label = `${fmtDiameter(p.diameter)} ${shortMaterial(p.material as PipeMaterial)}`;
      writeText(w, LAYER_LABELS.name, LAYER_LABELS.colorIdx,
        mid[0] + 0.15, mid[1] + 0.15, 0.25, label);
    }
  }
}

function writeFixtures(
  w: DxfWriter,
  fixtures: readonly FixtureInstance[],
  projection: DxfProjection,
  includeLabels: boolean,
): void {
  for (const f of fixtures) {
    const p = project(f.position, projection);
    writeCircle(w, LAYER_FIXTURES.name, LAYER_FIXTURES.colorIdx, p[0], p[1], 0.5);
    if (includeLabels) {
      writeText(w, LAYER_LABELS.name, LAYER_LABELS.colorIdx,
        p[0] + 0.6, p[1] + 0.1, 0.3, prettySubtype(f.subtype));
    }
  }
}

function writeFittings(
  w: DxfWriter,
  fittings: readonly FittingInstance[],
  projection: DxfProjection,
): void {
  for (const f of fittings) {
    const p = project(f.position, projection);
    const r = Math.max(0.12, (f.diameter / 24) * 1.2); // diameter in feet, small symbol
    writeCircle(w, LAYER_FITTINGS.name, LAYER_FITTINGS.colorIdx, p[0], p[1], r);
  }
}

function writeWalls(
  w: DxfWriter,
  walls: readonly { id: string; points: [number, number, number][] }[],
  projection: DxfProjection,
): void {
  for (const wall of walls) {
    for (let i = 1; i < wall.points.length; i++) {
      const a = project(wall.points[i - 1]!, projection);
      const b = project(wall.points[i]!, projection);
      writeLine(w, LAYER_WALLS.name, LAYER_WALLS.colorIdx, a, b);
    }
  }
}

// ── Public API ────────────────────────────────────────────────

export function exportToDXF(
  scene: DxfScene,
  options: DxfExportOptions = {},
): DxfExportResult {
  const {
    projection = 'plan',
    projectName = 'ELBOW GREASE Plumbing Plan',
    includeWalls = true,
    includeFittings = true,
    includeLabels = true,
  } = options;

  const usedSystems = new Set<SystemType>();
  for (const p of scene.pipes) {
    if (p.visible) usedSystems.add(p.system);
  }

  const hasFixtures = scene.fixtures.length > 0;
  const hasFittings = includeFittings && (scene.fittings?.length ?? 0) > 0;
  const hasWalls = includeWalls && (scene.walls?.length ?? 0) > 0;
  const hasLabels = includeLabels;

  const w = new DxfWriter();
  writeHeader(w, projectName);
  const layersUsed = writeLayerTable(
    w, usedSystems, hasFixtures, hasFittings, hasWalls, hasLabels,
  );

  // ENTITIES section
  w.code(0, 'SECTION');
  w.code(2, 'ENTITIES');

  writePipes(w, scene.pipes, projection, includeLabels, usedSystems);
  if (hasFixtures) writeFixtures(w, scene.fixtures, projection, includeLabels);
  if (hasFittings && scene.fittings) writeFittings(w, scene.fittings, projection);
  if (hasWalls && scene.walls) writeWalls(w, scene.walls, projection);

  w.code(0, 'ENDSEC');
  w.code(0, 'EOF');

  const content = w.text;
  return {
    content,
    entityCount: w.count,
    sizeBytes: new Blob([content]).size,
    layersUsed,
  };
}

// ── Formatting helpers ────────────────────────────────────────

function fmtDiameter(dIn: number): string {
  if (dIn === 0.375) return '3/8"';
  if (dIn === 0.5)   return '1/2"';
  if (dIn === 0.75)  return '3/4"';
  if (dIn === 1.25)  return '1-1/4"';
  if (dIn === 1.5)   return '1-1/2"';
  if (dIn === 2.5)   return '2-1/2"';
  return `${dIn}"`;
}

function shortMaterial(m: PipeMaterial): string {
  switch (m) {
    case 'pvc_sch40':        return 'PVC';
    case 'pvc_sch80':        return 'PVC-80';
    case 'abs':              return 'ABS';
    case 'cast_iron':        return 'CI';
    case 'copper_type_l':    return 'CU-L';
    case 'copper_type_m':    return 'CU-M';
    case 'cpvc':             return 'CPVC';
    case 'pex':              return 'PEX';
    case 'galvanized_steel': return 'GALV';
    case 'ductile_iron':     return 'DI';
  }
}

function prettySubtype(s: string): string {
  return s.replace(/_/g, ' ').toUpperCase();
}
