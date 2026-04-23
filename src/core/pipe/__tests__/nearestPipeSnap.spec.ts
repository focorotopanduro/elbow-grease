/**
 * nearestPipeSnap — Phase 9 tests.
 *
 * Encodes the snap priority rules:
 *   • Endpoint within threshold → always wins over body snap.
 *   • Body snap only returned when no endpoint is in range.
 *   • Neither returns null when cursor is far from everything.
 *   • Tighter endpoint wins over farther endpoint.
 *   • Invisible pipes are skipped.
 */

import { describe, it, expect } from 'vitest';
import { nearestPipeSnap, ENDPOINT_SNAP_EPS_FT, BODY_SNAP_EPS_FT } from '../nearestPipeSnap';
import type { CommittedPipe } from '@store/pipeStore';
import type { Vec3 } from '@core/events';

function pipe(
  id: string, points: Vec3[],
  visible = true,
): CommittedPipe {
  return {
    id, points,
    diameter: 2, material: 'pvc_sch40', system: 'waste',
    color: '#ffa726', visible, selected: false,
  };
}

// ── Empty world ───────────────────────────────────────────────

describe('nearestPipeSnap — empty world', () => {
  it('no pipes → null', () => {
    expect(nearestPipeSnap([0, 0, 0], [])).toBeNull();
  });

  it('cursor far from every pipe → null', () => {
    const p = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    expect(nearestPipeSnap([100, 0, 100], [p])).toBeNull();
  });
});

// ── Endpoint wins ─────────────────────────────────────────────

describe('nearestPipeSnap — endpoint snap', () => {
  it('cursor near first endpoint → snap to it with which=start', () => {
    const p = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const r = nearestPipeSnap([0.2, 0, 0.1], [p]);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('endpoint');
    expect(r!.position).toEqual([0, 0, 0]);
    expect(r!.which).toBe('start');
    expect(r!.pipeId).toBe('a');
  });

  it('cursor near last endpoint → snap to it with which=end', () => {
    const p = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const r = nearestPipeSnap([5.1, 0, 0.05], [p]);
    expect(r!.kind).toBe('endpoint');
    expect(r!.position).toEqual([5, 0, 0]);
    expect(r!.which).toBe('end');
  });

  it('tighter endpoint wins over farther endpoint', () => {
    const a = pipe('a', [[0, 0, 0], [5, 0, 0]]);
    const b = pipe('b', [[10, 0, 0], [15, 0, 0]]);
    // Cursor closer to a's end (5,0,0) than to b's start (10,0,0).
    const r = nearestPipeSnap([5.3, 0, 0.1], [a, b]);
    expect(r!.pipeId).toBe('a');
    expect(r!.which).toBe('end');
  });

  it('endpoint snap wins even when body of SAME pipe is also in range', () => {
    // Pipe runs along X-axis. Cursor is right at (0.2, 0, 0) — both
    // near the start endpoint AND on the pipe body. Endpoint wins.
    const p = pipe('a', [[0, 0, 0], [10, 0, 0]]);
    const r = nearestPipeSnap([0.2, 0, 0], [p]);
    expect(r!.kind).toBe('endpoint');
  });
});

// ── Body snap ─────────────────────────────────────────────────

describe('nearestPipeSnap — body snap', () => {
  it('cursor perpendicular to mid-segment → body snap with segmentIdx + t', () => {
    const p = pipe('a', [[0, 0, 0], [10, 0, 0]]);
    // (5, 0, 0.1) is 0.1 ft off the segment, well under BODY_SNAP_EPS_FT.
    const r = nearestPipeSnap([5, 0, 0.1], [p]);
    expect(r!.kind).toBe('body');
    expect(r!.segmentIdx).toBe(0);
    expect(r!.segmentT).toBeCloseTo(0.5, 3);
    expect(r!.position[0]).toBeCloseTo(5, 3);
  });

  it('cursor far from body (beyond bodyEps) → null', () => {
    const p = pipe('a', [[0, 0, 0], [10, 0, 0]]);
    // 1 ft off the segment, way past BODY_SNAP_EPS_FT.
    const r = nearestPipeSnap([5, 0, 1.0], [p]);
    expect(r).toBeNull();
  });
});

// ── Visibility filter ────────────────────────────────────────

describe('nearestPipeSnap — visibility', () => {
  it('invisible pipe is skipped', () => {
    const visible = pipe('vis', [[100, 0, 100], [110, 0, 100]]);
    const hidden = pipe('hid', [[0, 0, 0], [5, 0, 0]], false);
    const r = nearestPipeSnap([0.1, 0, 0], [hidden, visible]);
    // Would have snapped to hidden's start, but visibility=false skips it.
    // Cursor is far from 'visible' → overall null.
    expect(r).toBeNull();
  });
});

// ── Thresholds sanity ─────────────────────────────────────────

describe('nearestPipeSnap — threshold constants', () => {
  it('endpoint threshold is larger than body threshold (snap priority)', () => {
    expect(ENDPOINT_SNAP_EPS_FT).toBeGreaterThan(BODY_SNAP_EPS_FT);
  });

  it('thresholds are within sane CAD ranges (inches-level)', () => {
    // Both under 1 ft — we never want to snap to something a foot away.
    expect(ENDPOINT_SNAP_EPS_FT).toBeLessThan(1.0);
    expect(BODY_SNAP_EPS_FT).toBeLessThan(1.0);
  });
});
