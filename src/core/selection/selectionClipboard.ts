/**
 * selectionClipboard — Phase 14.P
 *
 * Pure module for the copy / paste / duplicate flow on a multi-select.
 *
 * The job splits cleanly into three pure operations:
 *
 *   1. `extractForCopy` — given the multi-select's id sets + the
 *      current pipe + fixture maps, pull out a frozen `ClipboardPayload`.
 *      The payload is self-contained (no references back into the
 *      stores) so subsequent edits to the source items don't retroactively
 *      corrupt what's on the clipboard. Positions + params are deep-
 *      cloned.
 *
 *   2. `preparePaste` — given a payload, a delta vector, and an id
 *      factory, produce a fresh set of pipes + fixtures with NEW ids,
 *      positions offset by `delta`, and `selected: false` (the pasted
 *      items become the new selection, but that happens at the store
 *      layer — this module stays pure). `connectedPipeIds` on fixtures
 *      is cleared because paste breaks connectivity and the
 *      ConnectivityManager will re-run on the fresh pipes anyway.
 *
 *   3. `payloadCentroid` — arithmetic mean of every pipe point +
 *      fixture position in the payload. Used by the paste-at-cursor
 *      flow so the group drops over the cursor rather than at its
 *      original world position.
 *
 * Everything in / everything out is plain data. Zero React, zero
 * Zustand, zero Three. Testable in node.
 *
 * Relationship to Phase 7.C's `cloneFixture`: that's a fixture-only
 * single-item clone. This is the multi-entity sibling — pipes and
 * fixtures together, with the selection's own relative geometry
 * preserved.
 */

import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';

// ── Schema ─────────────────────────────────────────────────────

/** Current version. Bump on any breaking change to the payload shape. */
export const CLIPBOARD_SCHEMA_VERSION = 1 as const;

/**
 * Snapshot of a pipe at the moment of copy. Mirrors CommittedPipe but
 * drops the id (regenerated on paste) and the `selected` flag (the
 * clipboard has no selection state). Points are deep-copied.
 */
export interface ClipboardPipe {
  points: Vec3[];
  diameter: number;
  material: string;
  system: CommittedPipe['system'];
  color: string;
  visible: boolean;
}

/**
 * Snapshot of a fixture at the moment of copy. Same principle — id
 * stripped, params deep-cloned, connectivity cleared.
 */
export interface ClipboardFixture {
  subtype: FixtureInstance['subtype'];
  position: Vec3;
  params: Record<string, unknown>;
}

/**
 * Frozen copy-buffer. Carries an `anchor` so paste can translate the
 * group to land at a target point (usually the cursor's world hit).
 * Anchor is the group's centroid at copy time, so paste delta =
 * targetPoint − anchor.
 */
export interface ClipboardPayload {
  version: typeof CLIPBOARD_SCHEMA_VERSION;
  pipes: ClipboardPipe[];
  fixtures: ClipboardFixture[];
  anchor: Vec3;
  /** Wall-clock timestamp of the copy, for debug / telemetry. */
  copiedAt: number;
}

// ── Extract / copy ─────────────────────────────────────────────

/**
 * Build a clipboard payload from the current multi-select.
 *
 * Returns `null` when the selection is empty (callers treat this as
 * "nothing to copy, no-op the Ctrl+C"). An empty return is NOT an
 * error and does NOT clear the existing clipboard.
 *
 * Both id lists are filtered against the current maps — a stale id
 * (e.g. the fixture was deleted between selection and copy) is
 * silently dropped rather than blowing up.
 */
export function extractForCopy(
  pipeIds: readonly string[],
  fixtureIds: readonly string[],
  pipes: Readonly<Record<string, CommittedPipe>>,
  fixtures: Readonly<Record<string, FixtureInstance>>,
  nowMs: number = Date.now(),
): ClipboardPayload | null {
  const pipeBuf: ClipboardPipe[] = [];
  for (const id of pipeIds) {
    const p = pipes[id];
    if (!p) continue;
    pipeBuf.push({
      points: p.points.map((pt) => [pt[0], pt[1], pt[2]] as Vec3),
      diameter: p.diameter,
      material: p.material,
      system: p.system,
      color: p.color,
      visible: p.visible,
    });
  }

  const fixBuf: ClipboardFixture[] = [];
  for (const id of fixtureIds) {
    const f = fixtures[id];
    if (!f) continue;
    fixBuf.push({
      subtype: f.subtype,
      position: [f.position[0], f.position[1], f.position[2]],
      // Deep-clone params — some param values are objects (e.g.
      // nested dimensions), and a shared reference would let future
      // store edits retroactively modify the clipboard.
      params: deepClone(f.params),
    });
  }

  if (pipeBuf.length === 0 && fixBuf.length === 0) return null;

  return {
    version: CLIPBOARD_SCHEMA_VERSION,
    pipes: pipeBuf,
    fixtures: fixBuf,
    anchor: computePayloadCentroid(pipeBuf, fixBuf),
    copiedAt: nowMs,
  };
}

// ── Paste / apply ──────────────────────────────────────────────

export interface PreparedPaste {
  pipes: Array<{
    id: string;
    points: Vec3[];
    diameter: number;
    material: string;
    system: CommittedPipe['system'];
    color: string;
    visible: boolean;
  }>;
  fixtures: Array<{
    id: string;
    subtype: FixtureInstance['subtype'];
    position: Vec3;
    params: Record<string, unknown>;
  }>;
}

/**
 * Produce the concrete "add these" list from a payload + offset.
 *
 * `delta` is the vector added to every point / position. For paste-
 * at-cursor, callers pass `delta = cursorHit - payload.anchor`. For
 * duplicate-in-place (Ctrl+D), callers pass a small fixed offset like
 * `[1, 0, 1]`.
 *
 * `idGen` mints a fresh id for every produced pipe / fixture. The
 * caller owns uniqueness — usually the same `newId()` used by the
 * stores on addPipe/addFixture, so collisions with existing ids are
 * impossible.
 *
 * Positions + params are deep-copied again here so the returned
 * structures are independent of the clipboard (the clipboard stays
 * usable for another paste).
 */
export function preparePaste(
  payload: Readonly<ClipboardPayload>,
  delta: Vec3,
  idGen: () => string,
): PreparedPaste {
  const pipes = payload.pipes.map((p) => ({
    id: idGen(),
    points: p.points.map(
      (pt) => [pt[0] + delta[0], pt[1] + delta[1], pt[2] + delta[2]] as Vec3,
    ),
    diameter: p.diameter,
    material: p.material,
    system: p.system,
    color: p.color,
    visible: p.visible,
  }));

  const fixtures = payload.fixtures.map((f) => ({
    id: idGen(),
    subtype: f.subtype,
    position: [
      f.position[0] + delta[0],
      f.position[1] + delta[1],
      f.position[2] + delta[2],
    ] as Vec3,
    params: deepClone(f.params),
  }));

  return { pipes, fixtures };
}

// ── Delta helpers ──────────────────────────────────────────────

/**
 * Given a payload's `anchor` and a target world point, return the
 * delta to pass to `preparePaste` so the pasted group's centroid
 * lands exactly on `target`.
 */
export function deltaForTarget(anchor: Vec3, target: Vec3): Vec3 {
  return [target[0] - anchor[0], target[1] - anchor[1], target[2] - anchor[2]];
}

/**
 * Default duplicate offset when the user has no cursor target (e.g.
 * keyboard-only Ctrl+D). 1 ft in +X and +Z puts the copy adjacent
 * without overlapping — matches the convention
 * `fixtureStore.cloneFixture` already uses.
 */
export const DEFAULT_DUPLICATE_OFFSET: Vec3 = [1, 0, 1];

// ── Centroid ──────────────────────────────────────────────────

/**
 * Arithmetic mean of every pipe point + fixture position in the
 * payload. Exported so the UI can show a ghost preview at the
 * payload's "center of mass" before the paste commits.
 */
export function computePayloadCentroid(
  pipes: readonly ClipboardPipe[],
  fixtures: readonly ClipboardFixture[],
): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (const p of pipes) {
    for (const pt of p.points) {
      sx += pt[0];
      sy += pt[1];
      sz += pt[2];
      n++;
    }
  }
  for (const f of fixtures) {
    sx += f.position[0];
    sy += f.position[1];
    sz += f.position[2];
    n++;
  }
  if (n === 0) return [0, 0, 0];
  return [sx / n, sy / n, sz / n];
}

// ── Internal helpers ───────────────────────────────────────────

/**
 * JSON round-trip deep clone. Params are plain JSON-safe records by
 * contract (see FixtureParams.ts), so JSON.parse/stringify is the
 * cheapest correct clone. No Date / Function / undefined survives,
 * which is fine for param maps.
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
