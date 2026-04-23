/**
 * wallInstanceBuckets — Phase 12.C tests.
 *
 * Covers:
 *   • basic bucket routing (full vs dim vs selected vs hidden)
 *   • floor-ghost routes off-floor walls to dim with interactive=false
 *   • walls-down mode puts every visible wall in dim
 *   • cutaway mode puts only cutawaySet members in dim
 *   • selected wall bypasses dim/cutaway/ghost buckets
 *   • geometry correctness: midpoint, rotation, scale match a known wall
 *   • edge writer: 24 vertices per wall × 3 floats each, transformed
 *     correctly for a simple axis-aligned case
 *   • edge writer: rotated wall puts vertices at expected rotated coords
 */

import { describe, it, expect } from 'vitest';
import type { Wall, WallType } from '@store/wallStore';
import {
  bucketWalls,
  writeWallEdges,
  EDGE_VERTS_PER_WALL,
  type FloorParams,
  type GetFloorParams,
} from '../wallInstanceBuckets';

// ── Fixtures ───────────────────────────────────────────────────

function mkWall(overrides: Partial<Wall> = {}): Wall {
  return {
    id: overrides.id ?? 'w1',
    start: overrides.start ?? [0, 0],
    end: overrides.end ?? [4, 0],
    thickness: overrides.thickness ?? 0.5,
    height: overrides.height ?? 8,
    floorY: overrides.floorY ?? 0,
    type: overrides.type ?? 'interior',
    hidden: overrides.hidden,
  };
}

const VISIBLE_FP: FloorParams = {
  visible: true, opacity: 1, disableInteraction: false, colorOverride: null,
};

const GHOST_FP: FloorParams = {
  visible: true, opacity: 0.4, disableInteraction: true, colorOverride: '#7a7a7a',
};

const HIDDEN_FP: FloorParams = {
  visible: false, opacity: 0, disableInteraction: true, colorOverride: null,
};

const allVisible: GetFloorParams = () => VISIBLE_FP;

const colorOf = (t: WallType): string => {
  // Simplified: mirror the real meta but inline so tests don't depend on it.
  return (
    {
      exterior: '#8d6e63',
      interior: '#9e9e9e',
      plumbing: '#00bcd4',
      partition: '#b0bec5',
      knee: '#ffa726',
    } as const
  )[t];
};

const baseInput = {
  selectedId: null as string | null,
  cutawaySet: new Set<string>(),
  renderMode: 'walls-up' as const,
  getFloorParams: allVisible,
  wallTypeColor: colorOf,
};

// ── Bucket routing ────────────────────────────────────────────

describe('bucket routing', () => {
  it('walls-up, visible, not selected → full bucket', () => {
    const r = bucketWalls({ ...baseInput, walls: [mkWall()] });
    expect(r.full).toHaveLength(1);
    expect(r.dim).toHaveLength(0);
    expect(r.selected).toBeNull();
  });

  it('wall.hidden = true → excluded entirely', () => {
    const r = bucketWalls({ ...baseInput, walls: [mkWall({ hidden: true })] });
    expect(r.full).toHaveLength(0);
    expect(r.dim).toHaveLength(0);
    expect(r.selected).toBeNull();
  });

  it('floor params visible=false → excluded entirely', () => {
    const r = bucketWalls({
      ...baseInput,
      walls: [mkWall()],
      getFloorParams: () => HIDDEN_FP,
    });
    expect(r.full).toHaveLength(0);
    expect(r.dim).toHaveLength(0);
  });

  it('off-floor (ghost) → dim bucket with interactive=false and ghost color', () => {
    const r = bucketWalls({
      ...baseInput,
      walls: [mkWall()],
      getFloorParams: () => GHOST_FP,
    });
    expect(r.dim).toHaveLength(1);
    expect(r.dim[0]!.interactive).toBe(false);
    expect(r.dim[0]!.color).toBe('#7a7a7a'); // colorOverride wins
  });

  it('walls-down mode → every visible wall goes to dim', () => {
    const walls = [mkWall({ id: 'a' }), mkWall({ id: 'b' }), mkWall({ id: 'c' })];
    const r = bucketWalls({ ...baseInput, walls, renderMode: 'walls-down' });
    expect(r.full).toHaveLength(0);
    expect(r.dim).toHaveLength(3);
  });

  it('cutaway mode → only cutawaySet members go to dim', () => {
    const walls = [mkWall({ id: 'a' }), mkWall({ id: 'b' }), mkWall({ id: 'c' })];
    const r = bucketWalls({
      ...baseInput,
      walls,
      renderMode: 'cutaway',
      cutawaySet: new Set(['b']),
    });
    expect(r.full.map((i) => i.wall.id)).toEqual(['a', 'c']);
    expect(r.dim.map((i) => i.wall.id)).toEqual(['b']);
  });

  it('selected wall bypasses cutaway/dim routing', () => {
    const walls = [mkWall({ id: 'a' }), mkWall({ id: 'b' })];
    const r = bucketWalls({
      ...baseInput,
      walls,
      selectedId: 'b',
      renderMode: 'cutaway',
      cutawaySet: new Set(['b']),
    });
    expect(r.selected?.wall.id).toBe('b');
    expect(r.dim).toHaveLength(0);
    expect(r.full.map((i) => i.wall.id)).toEqual(['a']);
  });

  it('selected wall that would be hidden → still excluded (hidden wins)', () => {
    const r = bucketWalls({
      ...baseInput,
      walls: [mkWall({ id: 'h', hidden: true })],
      selectedId: 'h',
    });
    expect(r.selected).toBeNull();
  });

  it('wall-type color applied when no ghost override', () => {
    const r = bucketWalls({
      ...baseInput,
      walls: [mkWall({ type: 'exterior' })],
    });
    expect(r.full[0]!.color).toBe('#8d6e63');
  });
});

// ── Geometry: position, rotation, scale ───────────────────────

describe('instance geometry', () => {
  it('horizontal wall [0,0]→[4,0] at floorY=0, height=8, thickness=0.5', () => {
    const r = bucketWalls({ ...baseInput, walls: [mkWall()] });
    const i = r.full[0]!;
    expect(i.position).toEqual([2, 4, 0]);      // midpoint XZ + Y at H/2
    expect(i.scale).toEqual([4, 8, 0.5]);       // [length, height, thickness]
    // Horizontal wall → angle 0 → quaternion identity-ish (0,0,0,1).
    expect(i.quaternion[0]).toBeCloseTo(0, 6);
    expect(i.quaternion[1]).toBeCloseTo(0, 6);
    expect(i.quaternion[2]).toBeCloseTo(0, 6);
    expect(i.quaternion[3]).toBeCloseTo(1, 6);
  });

  it('vertical wall [0,0]→[0,4] rotates 90° negative around Y', () => {
    const r = bucketWalls({
      ...baseInput,
      walls: [mkWall({ start: [0, 0], end: [0, 4] })],
    });
    const i = r.full[0]!;
    expect(i.position).toEqual([0, 4, 2]);
    expect(i.scale).toEqual([4, 8, 0.5]);
    // angle = atan2(4, 0) = π/2 → half = -π/4 → sin(-π/4) = -0.707, cos = 0.707
    expect(i.quaternion[1]).toBeCloseTo(-Math.SQRT1_2, 5);
    expect(i.quaternion[3]).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

// ── Edge writer ────────────────────────────────────────────────

describe('writeWallEdges', () => {
  it('writes exactly EDGE_VERTS_PER_WALL × 3 floats per wall', () => {
    const r = bucketWalls({ ...baseInput, walls: [mkWall()] });
    const i = r.full[0]!;
    const dst = new Float32Array(EDGE_VERTS_PER_WALL * 3);
    const out = writeWallEdges(i, dst, 0);
    expect(out).toBe(EDGE_VERTS_PER_WALL * 3);
  });

  it('axis-aligned wall: min/max corners land at expected world coords', () => {
    // Horizontal wall centered at origin, length 2, height 4, thickness 1.
    const wall = mkWall({ start: [-1, 0], end: [1, 0], height: 4, thickness: 1, floorY: 0 });
    // Position should be (0, 2, 0), scale (2, 4, 1), quaternion identity.
    const r = bucketWalls({ ...baseInput, walls: [wall] });
    const inst = r.full[0]!;
    const dst = new Float32Array(EDGE_VERTS_PER_WALL * 3);
    writeWallEdges(inst, dst, 0);

    // Collect all unique vertex positions and confirm box extent.
    const verts = new Set<string>();
    for (let k = 0; k < dst.length; k += 3) {
      verts.add(`${dst[k]!.toFixed(3)},${dst[k + 1]!.toFixed(3)},${dst[k + 2]!.toFixed(3)}`);
    }
    // Unit box corners (before transform): ±0.5 each axis.
    // Scaled: x in ±1, y in ±2 (then +2 for position.y), z in ±0.5.
    // Final expected corner positions:
    const expectedCorners = [
      '-1.000,0.000,-0.500', '1.000,0.000,-0.500',
      '1.000,4.000,-0.500',  '-1.000,4.000,-0.500',
      '-1.000,0.000,0.500',  '1.000,0.000,0.500',
      '1.000,4.000,0.500',   '-1.000,4.000,0.500',
    ];
    for (const c of expectedCorners) {
      expect(verts.has(c)).toBe(true);
    }
  });

  it('90°-rotated wall: corners rotate correctly around Y', () => {
    // Wall along +Z axis: start [0,0] → end [0,2]. Length 2, thickness 0.2.
    const wall = mkWall({ start: [0, 0], end: [0, 2], height: 2, thickness: 0.2, floorY: 0 });
    const r = bucketWalls({ ...baseInput, walls: [wall] });
    const inst = r.full[0]!;
    const dst = new Float32Array(EDGE_VERTS_PER_WALL * 3);
    writeWallEdges(inst, dst, 0);

    // Before rotation the box spans length=2 in x, but after -90° rotation
    // around Y, what was +X now points in +Z. Wall should span +Z from 0→2,
    // with thickness 0.2 extending in ±X. Check x range of all vertices.
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let k = 0; k < dst.length; k += 3) {
      const x = dst[k]!, z = dst[k + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // Thickness 0.2 in X (±0.1 around center 0).
    expect(minX).toBeCloseTo(-0.1, 5);
    expect(maxX).toBeCloseTo(0.1, 5);
    // Length 2 in Z, centered on midpoint z=1.
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(2, 5);
  });

  it('writes into a shared buffer at the supplied offset', () => {
    // Use walls that don't straddle the origin so the first vertex is
    // guaranteed non-zero — that makes the "did it actually write?"
    // assertion meaningful.
    const walls = [
      mkWall({ id: 'a', start: [1, 1], end: [3, 1] }),
      mkWall({ id: 'b', start: [1, 3], end: [3, 3] }),
    ];
    const r = bucketWalls({ ...baseInput, walls });
    const total = EDGE_VERTS_PER_WALL * 3 * 2;
    const dst = new Float32Array(total);
    let offset = 0;
    offset = writeWallEdges(r.full[0]!, dst, offset);
    offset = writeWallEdges(r.full[1]!, dst, offset);
    // Full buffer produced.
    expect(offset).toBe(total);
    // First wall wrote its data into the first half.
    const firstHalfAny = dst.slice(0, total / 2).some((v) => v !== 0);
    expect(firstHalfAny).toBe(true);
    // Second wall wrote its data into the second half.
    const secondHalfAny = dst.slice(total / 2).some((v) => v !== 0);
    expect(secondHalfAny).toBe(true);
  });
});
