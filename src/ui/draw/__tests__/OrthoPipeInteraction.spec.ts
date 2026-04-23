/**
 * OrthoPipeInteraction pure helpers — Phase 14.AD.23.
 *
 * The full React component drives R3F + window pointer events which
 * are awkward to unit-test without a DOM harness. This spec covers
 * the PURE helpers that feed the interaction — anchor classification,
 * grid snap, distance, ortho-view detection, drag-threshold math —
 * so regressions in the core decision logic get caught fast.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAnchorKind,
  snapToGrid,
  dist,
  isOrthoView,
  isDragLargeEnough,
  dragAngleDeg,
  snapDirectionTo45,
  type AnchorKind,
} from '../OrthoPipeInteraction';
import type { Vec3 } from '@core/events';

// ── classifyAnchorKind ───────────────────────────────────────────

describe('classifyAnchorKind', () => {
  const pipe = {
    points: [[0, 0, 0], [10, 0, 0]] as Vec3[],
  };

  it('hit near the start vertex → start anchor', () => {
    const r = classifyAnchorKind(pipe, [0.3, 0, 0]);
    expect(r.kind).toBe('start');
    expect(r.anchor).toEqual([0, 0, 0]);
  });

  it('hit near the end vertex → end anchor', () => {
    const r = classifyAnchorKind(pipe, [9.8, 0, 0]);
    expect(r.kind).toBe('end');
    expect(r.anchor).toEqual([10, 0, 0]);
  });

  it('hit near the middle → mid anchor (at the hit point)', () => {
    const r = classifyAnchorKind(pipe, [5, 0, 0]);
    expect(r.kind).toBe('mid');
    expect(r.anchor).toEqual([5, 0, 0]);
  });

  it('custom snap distance expands the endpoint hit zone', () => {
    // Default 1.0 ft → 2.0 ft would catch this hit as start.
    const farish = classifyAnchorKind(pipe, [1.5, 0, 0]);
    expect(farish.kind).toBe('mid');
    const snappier = classifyAnchorKind(pipe, [1.5, 0, 0], 2.0);
    expect(snappier.kind).toBe('start');
  });

  it('3+ point pipe: endpoint classification still targets first/last, not internal', () => {
    const polyline = {
      points: [[0, 0, 0], [5, 0, 0], [5, 0, 5], [10, 0, 5]] as Vec3[],
    };
    // Hit at (5, 0, 0) — an INTERNAL vertex. Far from first (0,0,0)
    // and far from last (10,0,5). Should be classified as MID.
    const r = classifyAnchorKind(polyline, [5, 0, 0]);
    expect(r.kind).toBe('mid');
  });

  it('hit equidistant to both endpoints prefers start', () => {
    const shortPipe = { points: [[0, 0, 0], [0.5, 0, 0]] as Vec3[] };
    // Exactly in the middle (0.25, 0, 0) — distance to both endpoints
    // is 0.25 ft (within the 1.0 ft snap). Tie → start wins.
    const r = classifyAnchorKind(shortPipe, [0.25, 0, 0]);
    expect(r.kind).toBe('start');
  });
});

// ── snapToGrid ───────────────────────────────────────────────────

describe('snapToGrid', () => {
  it('snaps to 0.5 ft grid (default plumbing grid)', () => {
    expect(snapToGrid([0.2, 0.3, 0.8], 0.5)).toEqual([0, 0.5, 1]);
  });

  it('snaps negative coordinates correctly', () => {
    expect(snapToGrid([-0.7, -1.2, -3.1], 0.5)).toEqual([-0.5, -1, -3]);
  });

  it('pass-through when already on grid', () => {
    expect(snapToGrid([1, 2, 3], 0.5)).toEqual([1, 2, 3]);
  });

  it('1/12 ft grid (1 inch) for finer drawing', () => {
    const inch = 1 / 12;
    const r = snapToGrid([0.1, 0.2, 0.3], inch);
    expect(r[0]).toBeCloseTo(Math.round(0.1 * 12) / 12, 5);
    expect(r[1]).toBeCloseTo(Math.round(0.2 * 12) / 12, 5);
    expect(r[2]).toBeCloseTo(Math.round(0.3 * 12) / 12, 5);
  });
});

// ── dist ─────────────────────────────────────────────────────────

describe('dist', () => {
  it('Euclidean distance in 3D', () => {
    expect(dist([0, 0, 0], [3, 4, 0])).toBeCloseTo(5, 5);
    expect(dist([0, 0, 0], [1, 2, 2])).toBeCloseTo(3, 5);
  });

  it('symmetric', () => {
    expect(dist([1, 2, 3], [4, 5, 6])).toBeCloseTo(dist([4, 5, 6], [1, 2, 3]), 5);
  });

  it('zero for identical points', () => {
    expect(dist([1, 1, 1], [1, 1, 1])).toBe(0);
  });
});

// ── isOrthoView ──────────────────────────────────────────────────

describe('isOrthoView', () => {
  it('returns true for top / front / side / bottom', () => {
    expect(isOrthoView('top')).toBe(true);
    expect(isOrthoView('front')).toBe(true);
    expect(isOrthoView('side')).toBe(true);
    expect(isOrthoView('bottom')).toBe(true);
  });

  it('returns false for perspective / isometric', () => {
    expect(isOrthoView('perspective')).toBe(false);
    expect(isOrthoView('iso_true')).toBe(false);
    expect(isOrthoView('iso_30')).toBe(false);
    expect(isOrthoView('iso_45')).toBe(false);
  });

  it('returns false for unrecognized strings', () => {
    expect(isOrthoView('')).toBe(false);
    expect(isOrthoView('Top')).toBe(false); // case-sensitive
    expect(isOrthoView('plan')).toBe(false);
  });
});

// ── isDragLargeEnough ────────────────────────────────────────────

describe('isDragLargeEnough', () => {
  it('zero movement → not a drag', () => {
    expect(isDragLargeEnough([0, 0, 0], [0, 0, 0], 0.5)).toBe(false);
  });

  it('sub-threshold movement → not a drag', () => {
    // 0.1 ft movement, floor = max(0.25, 0.5*0.6) = 0.3
    expect(isDragLargeEnough([0, 0, 0], [0.1, 0, 0], 0.5)).toBe(false);
  });

  it('above threshold → is a drag', () => {
    expect(isDragLargeEnough([0, 0, 0], [0.5, 0, 0], 0.5)).toBe(true);
  });

  it('gridSnap ceiling prevents snap-collapsed drags from counting', () => {
    // gridSnap 0.5 ft, floor = max(0.25, 0.3) = 0.3. A movement of
    // 0.2 ft that rounds to 0 would NOT count as drag.
    expect(isDragLargeEnough([0, 0, 0], [0.2, 0, 0], 0.5)).toBe(false);
  });

  it('tight gridSnap (1") still uses 0.25 floor (more sensitive)', () => {
    const inch = 1 / 12;
    // floor = max(0.25, inch * 0.6 ≈ 0.05) = 0.25
    expect(isDragLargeEnough([0, 0, 0], [0.2, 0, 0], inch)).toBe(false);
    expect(isDragLargeEnough([0, 0, 0], [0.3, 0, 0], inch)).toBe(true);
  });

  it('diagonal drag measures Euclidean distance', () => {
    expect(isDragLargeEnough([0, 0, 0], [0.3, 0.3, 0], 0.5)).toBe(true); // ≈ 0.42
    expect(isDragLargeEnough([0, 0, 0], [0.1, 0.1, 0], 0.5)).toBe(false); // ≈ 0.14
  });
});

// ── dragAngleDeg ─────────────────────────────────────────────────

describe('dragAngleDeg', () => {
  // Session helper — only the fields dragAngleDeg reads.
  function mkSession(
    anchor: Vec3,
    cursor: Vec3,
    anchorKind: AnchorKind,
    segmentIdx: number = 0,
  ) {
    return {
      pipeId: 'p1',
      anchor,
      anchorKind,
      segmentIdx,
      pointerStart: anchor,
      cursor,
      dragging: true,
      orthoSnap: false,
    };
  }

  it('end-anchor extension perpendicular to pipe → 90°', () => {
    // Pipe runs east from origin to (5, 0, 0); extension drags up (Y).
    const pipe = { points: [[0, 0, 0], [5, 0, 0]] as Vec3[] };
    const s = mkSession([5, 0, 0], [5, 3, 0], 'end');
    const a = dragAngleDeg(s, pipe);
    expect(a).toBeCloseTo(90, 1);
  });

  it('end-anchor extension straight along pipe → 0° (continuing)', () => {
    const pipe = { points: [[0, 0, 0], [5, 0, 0]] as Vec3[] };
    const s = mkSession([5, 0, 0], [10, 0, 0], 'end');
    // refDir at end = (last - prev) = (5,0,0) - (0,0,0) = +X.
    // dragDir = +X. Angle = 0.
    const a = dragAngleDeg(s, pipe);
    expect(a).toBeCloseTo(0, 1);
  });

  it('start-anchor extension along pipe → 0° (back away)', () => {
    const pipe = { points: [[5, 0, 0], [10, 0, 0]] as Vec3[] };
    // refDir at start = (first - next) = (5,0,0) - (10,0,0) = -X.
    // extending from start back to (0,0,0) → dragDir = -X. Angle 0°.
    const s = mkSession([5, 0, 0], [0, 0, 0], 'start');
    const a = dragAngleDeg(s, pipe);
    expect(a).toBeCloseTo(0, 1);
  });

  it('mid-pipe branch 90° → 90°', () => {
    const pipe = { points: [[0, 0, 0], [10, 0, 0]] as Vec3[] };
    const s = mkSession([5, 0, 0], [5, 0, 5], 'mid', 0);
    const a = dragAngleDeg(s, pipe);
    expect(a).toBeCloseTo(90, 1);
  });

  it('mid-pipe branch 45° → 45°', () => {
    const pipe = { points: [[0, 0, 0], [10, 0, 0]] as Vec3[] };
    // Drag from (5,0,0) at 45° into +X+Z.
    const s = mkSession([5, 0, 0], [10, 0, 5], 'mid', 0);
    const a = dragAngleDeg(s, pipe);
    expect(a).toBeCloseTo(45, 1);
  });

  it('zero-length drag returns null', () => {
    const pipe = { points: [[0, 0, 0], [10, 0, 0]] as Vec3[] };
    const s = mkSession([5, 0, 0], [5, 0, 0], 'mid', 0);
    expect(dragAngleDeg(s, pipe)).toBeNull();
  });

  it('1-point pipe returns null (no ref direction)', () => {
    const pipe = { points: [[5, 0, 0]] as Vec3[] };
    const s = mkSession([5, 0, 0], [10, 0, 0], 'end');
    expect(dragAngleDeg(s, pipe)).toBeNull();
  });
});

// ── snapDirectionTo45 ────────────────────────────────────────────

describe('snapDirectionTo45', () => {
  // Top view: camera looks straight down, viewNormal = -Y.
  // Drag plane is the XZ plane; snapping happens in that plane.
  const viewNormalTop: Vec3 = [0, -1, 0];
  // Front view: camera looks along -Z, viewNormal = -Z, plane = XY.
  const viewNormalFront: Vec3 = [0, 0, -1];

  it('cursor exactly along +X from anchor → unchanged (0° snap)', () => {
    const r = snapDirectionTo45([0, 0, 0], [5, 0, 0], viewNormalTop);
    expect(r[0]).toBeCloseTo(5, 3);
    expect(r[1]).toBeCloseTo(0, 3);
    expect(r[2]).toBeCloseTo(0, 3);
  });

  it('cursor at ~20° off-axis snaps DOWN to 0° (near +X axis)', () => {
    // 20° off +X → nearest 45° increment is 0°.
    const c = 5 * Math.cos((20 * Math.PI) / 180);
    const z = 5 * Math.sin((20 * Math.PI) / 180);
    const r = snapDirectionTo45([0, 0, 0], [c, 0, z], viewNormalTop);
    expect(r[0]).toBeCloseTo(5, 3);
    expect(r[2]).toBeCloseTo(0, 3);
  });

  it('cursor at ~30° snaps UP to 45° (diagonal)', () => {
    const c = 5 * Math.cos((30 * Math.PI) / 180);
    const z = 5 * Math.sin((30 * Math.PI) / 180);
    const r = snapDirectionTo45([0, 0, 0], [c, 0, z], viewNormalTop);
    // 45° in XZ plane: x = z = 5 / √2 ≈ 3.536
    expect(r[0]).toBeCloseTo(5 / Math.SQRT2, 2);
    expect(r[2]).toBeCloseTo(5 / Math.SQRT2, 2);
  });

  it('preserves the drag LENGTH across the snap', () => {
    const startLen = 7.3;
    const raw: Vec3 = [startLen * Math.cos(0.6), 0, startLen * Math.sin(0.6)];
    const r = snapDirectionTo45([0, 0, 0], raw, viewNormalTop);
    const snapLen = Math.sqrt(r[0] * r[0] + r[2] * r[2]);
    expect(snapLen).toBeCloseTo(startLen, 2);
  });

  it('zero-length drag returns cursor unchanged', () => {
    expect(snapDirectionTo45([1, 2, 3], [1, 2, 3], viewNormalTop))
      .toEqual([1, 2, 3]);
  });

  it('front view (XY plane): +Y drag stays +Y after snap', () => {
    const r = snapDirectionTo45([0, 0, 0], [0, 5, 0], viewNormalFront);
    expect(r[0]).toBeCloseTo(0, 3);
    expect(r[1]).toBeCloseTo(5, 3);
    expect(r[2]).toBeCloseTo(0, 3);
  });

  it('front view: 30° off +Y → snaps to 45° diagonal in XY', () => {
    const deg = 30;
    const x = 5 * Math.sin((deg * Math.PI) / 180); // 30° from +Y in XY plane
    const y = 5 * Math.cos((deg * Math.PI) / 180);
    const r = snapDirectionTo45([0, 0, 0], [x, y, 0], viewNormalFront);
    // 45° in XY from +Y should give x = y = 5/√2 (or -5/√2 for the
    // other diagonal — depends on which side of Y the drag was).
    expect(Math.abs(r[0])).toBeCloseTo(5 / Math.SQRT2, 2);
    expect(Math.abs(r[1])).toBeCloseTo(5 / Math.SQRT2, 2);
    expect(r[2]).toBeCloseTo(0, 3);
  });

  it('anchor offset → snap reconstructs from anchor, not origin', () => {
    const anchor: Vec3 = [10, 5, -3];
    const r = snapDirectionTo45(anchor, [15, 5, -3], viewNormalTop);
    expect(r[0]).toBeCloseTo(15, 3);
    expect(r[1]).toBeCloseTo(5, 3);
    expect(r[2]).toBeCloseTo(-3, 3);
  });
});
