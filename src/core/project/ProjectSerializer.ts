/**
 * Project Serializer — serialize/deserialize entire design state to JSON.
 *
 * Captures everything needed to fully restore a design session:
 *   - All committed pipes (points, diameter, material, system)
 *   - All placed fixtures (position, subtype)
 *   - Structural elements (obstacles)
 *   - Layer visibility state
 *   - Camera position
 *   - Project metadata (name, author, created/modified dates)
 *
 * File format: .elbow (JSON with version field for future migration)
 *
 * Does NOT serialize:
 *   - Computed solver results (re-computed on load)
 *   - Undo/redo history (fresh start on load)
 *   - Engagement/fatigue metrics (session-specific)
 */

import type { Vec3 } from '../events';
import type { CommittedPipe } from '../../store/pipeStore';
import type { SystemType, FixtureSubtype } from '../../engine/graph/GraphNode';
import type { StructuralElement, StructuralType } from '../interference/StructuralElements';

// ── Project file format ─────────────────────────────────────────

export const PROJECT_VERSION = 1;
export const FILE_EXTENSION = '.elbow';
export const MIME_TYPE = 'application/x-elbow-grease';

export interface ProjectFile {
  /** Format version (for future migration). */
  version: number;
  /** Project metadata. */
  meta: ProjectMeta;
  /** All committed pipes. */
  pipes: SerializedPipe[];
  /** All placed fixtures. */
  fixtures: SerializedFixture[];
  /** Structural elements / obstacles. */
  structures: SerializedStructure[];
  /** Layer visibility state. */
  layers: SerializedLayers;
  /** Camera state at time of save. */
  camera: SerializedCamera;
}

export interface ProjectMeta {
  name: string;
  author: string;
  createdAt: string;
  modifiedAt: string;
  /** Total pipe count at save time. */
  pipeCount: number;
  /** Total fixture count at save time. */
  fixtureCount: number;
  /** App version that created this file. */
  appVersion: string;
}

export interface SerializedPipe {
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
  system: SystemType;
}

export interface SerializedFixture {
  position: Vec3;
  subtype: FixtureSubtype;
  label?: string;
}

export interface SerializedStructure {
  id: string;
  type: StructuralType;
  label: string;
  min: Vec3;
  max: Vec3;
  depth: number;
  primaryAxis: 'x' | 'y' | 'z';
}

export interface SerializedLayers {
  systems: Record<SystemType, boolean>;
  fittings: boolean;
  fixtures: boolean;
  dimensions: boolean;
}

export interface SerializedCamera {
  position: Vec3;
  target: Vec3;
  fov: number;
}

// ── Serialize ───────────────────────────────────────────────────

export interface SerializeInput {
  pipes: CommittedPipe[];
  fixtures: { position: Vec3; subtype: FixtureSubtype }[];
  structures: StructuralElement[];
  layers: SerializedLayers;
  camera: SerializedCamera;
  projectName?: string;
  author?: string;
}

/**
 * Serialize the current design state to a ProjectFile object.
 */
export function serializeProject(input: SerializeInput): ProjectFile {
  return {
    version: PROJECT_VERSION,
    meta: {
      name: input.projectName ?? 'Untitled Project',
      author: input.author ?? 'Plumber',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      pipeCount: input.pipes.length,
      fixtureCount: input.fixtures.length,
      appVersion: '0.1.0',
    },
    pipes: input.pipes.map((p) => ({
      id: p.id,
      points: p.points,
      diameter: p.diameter,
      material: p.material,
      system: p.system,
    })),
    fixtures: input.fixtures.map((f) => ({
      position: f.position,
      subtype: f.subtype,
    })),
    structures: input.structures.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      min: s.min,
      max: s.max,
      depth: s.depth,
      primaryAxis: s.primaryAxis,
    })),
    layers: input.layers,
    camera: input.camera,
  };
}

/**
 * Serialize to a JSON string (for file export or localStorage).
 */
export function serializeToJSON(input: SerializeInput): string {
  const project = serializeProject(input);
  return JSON.stringify(project, null, 2);
}

// ── Deserialize ─────────────────────────────────────────────────

export interface DeserializeResult {
  project: ProjectFile;
  pipes: CommittedPipe[];
  fixtures: { position: Vec3; subtype: FixtureSubtype }[];
  structures: StructuralElement[];
  warnings: string[];
}

/**
 * Deserialize a ProjectFile back into application state.
 * Handles version migration if the file is from an older format.
 */
export function deserializeProject(json: string): DeserializeResult {
  const warnings: string[] = [];
  let project: ProjectFile;

  try {
    project = JSON.parse(json) as ProjectFile;
  } catch {
    throw new Error('Invalid project file: not valid JSON');
  }

  // Version check
  if (!project.version) {
    throw new Error('Invalid project file: missing version field');
  }
  if (project.version > PROJECT_VERSION) {
    warnings.push(`File version ${project.version} is newer than app version ${PROJECT_VERSION}. Some features may not load correctly.`);
  }

  // Migrate from older versions (future-proofing)
  if (project.version < PROJECT_VERSION) {
    project = migrateProject(project);
    warnings.push(`Migrated from version ${project.version} to ${PROJECT_VERSION}`);
  }

  // Reconstruct CommittedPipe objects
  const pipes: CommittedPipe[] = (project.pipes ?? []).map((p) => ({
    id: p.id,
    points: p.points,
    diameter: p.diameter,
    material: p.material,
    system: p.system,
    color: '', // will be set by pipeStore.addPipe
    visible: true,
    selected: false,
  }));

  // Reconstruct fixtures
  const fixtures = (project.fixtures ?? []).map((f) => ({
    position: f.position as [number, number, number],
    subtype: f.subtype,
  }));

  // Reconstruct structural elements
  const structures: StructuralElement[] = (project.structures ?? []).map((s) => ({
    id: s.id,
    type: s.type,
    label: s.label,
    min: s.min,
    max: s.max,
    depth: s.depth,
    primaryAxis: s.primaryAxis,
  }));

  return { project, pipes, fixtures, structures, warnings };
}

// ── Version migration ───────────────────────────────────────────

function migrateProject(project: ProjectFile): ProjectFile {
  // v0 → v1: no changes yet (this is the first version)
  // Future migrations go here:
  // if (project.version === 1) { /* migrate v1 → v2 */ project.version = 2; }
  return project;
}

// ── Validation ──────────────────────────────────────────────────

/**
 * Quick validation of a project file without full deserialization.
 */
export function validateProjectFile(json: string): { valid: boolean; error?: string } {
  try {
    const obj = JSON.parse(json);
    if (!obj.version) return { valid: false, error: 'Missing version field' };
    if (!obj.meta) return { valid: false, error: 'Missing metadata' };
    if (!Array.isArray(obj.pipes)) return { valid: false, error: 'Missing pipes array' };
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }
}
