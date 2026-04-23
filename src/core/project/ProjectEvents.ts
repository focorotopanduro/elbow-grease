/**
 * ProjectEvent — the typed mutations that ProjectBundle logs.
 *
 * This is a SUPERSET of what Phase 1 CommandBus dispatches. Not every
 * command translates 1:1 to a project event — some are UI-only
 * (`interaction.setMode`, `pipe.select`) and don't belong in a
 * persistent log; others need to be materialized for replay.
 *
 * Intentionally small and closed-set: the log must be deterministic.
 * Extensions to the union will bump `SCHEMA_VERSION` so the loader
 * can reject unknown future events on older app versions.
 */

import type { Vec3 } from '@core/events';
import type { SystemType, FixtureSubtype } from '../../engine/graph/GraphNode';

export const PROJECT_EVENT_SCHEMA_VERSION = 1;

// ── Event union ────────────────────────────────────────────────

export type ProjectEvent =
  | PipeAddEvent
  | PipeRemoveEvent
  | PipeUpdateDiameterEvent
  | FixturePlaceEvent
  | FixtureRemoveEvent
  | FixtureSetPositionEvent
  | FixtureUpdateParamEvent
  | MetaRenameEvent
  | MetaMarkEvent;

export interface PipeAddEvent {
  k: 'pipe.add';
  /** ms since app boot — purely informational. */
  t: number;
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
  system?: SystemType;
}

export interface PipeRemoveEvent {
  k: 'pipe.remove';
  t: number;
  id: string;
}

export interface PipeUpdateDiameterEvent {
  k: 'pipe.updateDiameter';
  t: number;
  id: string;
  diameter: number;
}

export interface FixturePlaceEvent {
  k: 'fixture.place';
  t: number;
  id: string;
  subtype: FixtureSubtype;
  position: Vec3;
  params?: Record<string, unknown>;
}

export interface FixtureRemoveEvent {
  k: 'fixture.remove';
  t: number;
  id: string;
}

export interface FixtureSetPositionEvent {
  k: 'fixture.setPosition';
  t: number;
  id: string;
  position: Vec3;
}

export interface FixtureUpdateParamEvent {
  k: 'fixture.updateParam';
  t: number;
  id: string;
  key: string;
  value: unknown;
}

/** User renamed the project — updates header.json on next compact. */
export interface MetaRenameEvent {
  k: 'meta.rename';
  t: number;
  name: string;
}

/** Generic annotation (e.g. "checkpoint before demo", "release build"). */
export interface MetaMarkEvent {
  k: 'meta.mark';
  t: number;
  label: string;
}

// ── Narrow helpers ────────────────────────────────────────────

export type EventKind = ProjectEvent['k'];

/** Type guard — checks the discriminant is a known kind. */
export function isProjectEvent(v: unknown): v is ProjectEvent {
  if (typeof v !== 'object' || v === null) return false;
  const rec = v as { k?: unknown };
  if (typeof rec.k !== 'string') return false;
  return KNOWN_KINDS.has(rec.k as EventKind);
}

const KNOWN_KINDS = new Set<EventKind>([
  'pipe.add',
  'pipe.remove',
  'pipe.updateDiameter',
  'fixture.place',
  'fixture.remove',
  'fixture.setPosition',
  'fixture.updateParam',
  'meta.rename',
  'meta.mark',
]);

// ── NDJSON serialization ──────────────────────────────────────

/**
 * Serialize one event to a single NDJSON line (terminator included).
 *
 * Single-line-per-event is critical: on crash recovery we read
 * line-by-line and drop anything that isn't well-formed JSON. A
 * multi-line value could split across a torn write boundary.
 */
export function serializeEvent(evt: ProjectEvent): string {
  // JSON.stringify with no indent → guaranteed single-line.
  return JSON.stringify(evt) + '\n';
}

/**
 * Parse a single line. Returns null if the line is empty or not a
 * well-formed ProjectEvent (e.g. torn). Caller treats null as "stop
 * replaying here" — standard sequence-log recovery.
 */
export function parseEventLine(line: string): ProjectEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (isProjectEvent(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}
