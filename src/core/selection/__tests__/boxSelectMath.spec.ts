/**
 * boxSelectMath — Phase 14.M tests.
 *
 * Covers:
 *   • normalizeRect / rectArea
 *   • projectToScreen:
 *       - identity matrix → origin projects to center of viewport
 *       - off-screen points return null
 *       - behind-camera points (clip.w ≤ 0) return null
 *   • pointInRect / anyPointInRect
 *   • filterEntitiesInRect groups pipes + fixtures correctly
 *
 * Matrix conventions: column-major 16-length arrays (Three.js).
 * Tests use small hand-calculated identity / orthographic setups
 * rather than a real camera, to keep assertions deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeRect,
  rectArea,
  projectToScreen,
  pointInRect,
  anyPointInRect,
  filterEntitiesInRect,
  type Mat4,
  type BoxSelectInput,
} from '../boxSelectMath';

// ── Matrix helpers ───────────────────────────────────────────

/** 4×4 identity, column-major. */
const IDENTITY: Mat4 = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]) as unknown as Mat4;

/** Orthographic-like clip that maps [-2, 2]³ → [-1, 1]³. */
const ORTHO_2: Mat4 = Object.freeze([
  0.5, 0, 0, 0,
  0, 0.5, 0, 0,
  0, 0, 0.5, 0,
  0, 0, 0, 1,
]) as unknown as Mat4;

// ── normalizeRect / rectArea ─────────────────────────────────

describe('normalizeRect', () => {
  it('normalizes from top-left', () => {
    expect(normalizeRect({ x1: 10, y1: 20, x2: 100, y2: 200 })).toEqual({
      minX: 10, minY: 20, maxX: 100, maxY: 200,
    });
  });

  it('normalizes when corners are flipped', () => {
    expect(normalizeRect({ x1: 100, y1: 200, x2: 10, y2: 20 })).toEqual({
      minX: 10, minY: 20, maxX: 100, maxY: 200,
    });
  });
});

describe('rectArea', () => {
  it('computes area for a normal rect', () => {
    expect(rectArea({ x1: 0, y1: 0, x2: 10, y2: 20 })).toBe(200);
  });

  it('clamps to 0 for zero-dimension rect', () => {
    expect(rectArea({ x1: 0, y1: 0, x2: 0, y2: 100 })).toBe(0);
  });
});

// ── projectToScreen ──────────────────────────────────────────

describe('projectToScreen', () => {
  it('identity: origin → viewport center', () => {
    const p = projectToScreen([0, 0, 0], IDENTITY, { width: 800, height: 600 });
    expect(p).toEqual({ x: 400, y: 300 });
  });

  it('identity: (+1, 0, 0) → (right edge, center-y)', () => {
    // NDC.x = 1 → screen.x = (1+1)/2 · 800 = 800
    const p = projectToScreen([1, 0, 0], IDENTITY, { width: 800, height: 600 });
    expect(p).toEqual({ x: 800, y: 300 });
  });

  it('identity: Y is flipped (screen Y grows downward)', () => {
    // NDC.y = 1 (top of frustum) → screen.y = 0 (top of screen)
    const p = projectToScreen([0, 1, 0], IDENTITY, { width: 800, height: 600 });
    expect(p).toEqual({ x: 400, y: 0 });
  });

  it('rejects off-screen points (|NDC.x| > 1)', () => {
    // With IDENTITY and w=1, NDC.x = 2 is off-screen.
    const p = projectToScreen([2, 0, 0], IDENTITY, { width: 800, height: 600 });
    expect(p).toBeNull();
  });

  it('rejects behind-camera points (clip.w ≤ 0)', () => {
    // Build a matrix that produces w = -1 for the origin: set m[15] = -1.
    const negativeW: Mat4 = Object.freeze([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, -1,
    ]) as unknown as Mat4;
    expect(projectToScreen([0, 0, 0], negativeW, { width: 800, height: 600 })).toBeNull();
  });

  it('orthographic: (2, 0, 0) maps to NDC.x = 1', () => {
    // Our ORTHO_2 divides by 2 so x=2 → NDC.x=1 → screen.x=width
    const p = projectToScreen([2, 0, 0], ORTHO_2, { width: 800, height: 600 });
    expect(p).toEqual({ x: 800, y: 300 });
  });
});

// ── pointInRect ──────────────────────────────────────────────

describe('pointInRect', () => {
  const input: BoxSelectInput = {
    worldToClip: IDENTITY,
    viewport: { width: 800, height: 600 },
    rect: { x1: 350, y1: 250, x2: 450, y2: 350 },
  };

  it('center of viewport is inside the center rect', () => {
    expect(pointInRect([0, 0, 0], input)).toBe(true);
  });

  it('edge of viewport is outside the small center rect', () => {
    expect(pointInRect([0.8, 0, 0], input)).toBe(false);
  });

  it('off-screen world point is false', () => {
    expect(pointInRect([10, 0, 0], input)).toBe(false);
  });
});

// ── anyPointInRect ───────────────────────────────────────────

describe('anyPointInRect', () => {
  const input: BoxSelectInput = {
    worldToClip: IDENTITY,
    viewport: { width: 800, height: 600 },
    rect: { x1: 350, y1: 250, x2: 450, y2: 350 }, // small center rect
  };

  it('true when at least one point is inside', () => {
    expect(anyPointInRect([[0.9, 0, 0], [0, 0, 0]], input)).toBe(true);
  });

  it('false when all points are outside', () => {
    expect(anyPointInRect([[0.9, 0, 0], [0.7, 0, 0]], input)).toBe(false);
  });

  it('false for empty point list', () => {
    expect(anyPointInRect([], input)).toBe(false);
  });
});

// ── filterEntitiesInRect ─────────────────────────────────────

describe('filterEntitiesInRect', () => {
  it('filters pipes + fixtures by rect containment', () => {
    const result = filterEntitiesInRect({
      worldToClip: IDENTITY,
      viewport: { width: 800, height: 600 },
      rect: { x1: 300, y1: 200, x2: 500, y2: 400 }, // covers center
      pipes: [
        { id: 'pipe-in', points: [[0.1, 0, 0.1]] },
        { id: 'pipe-out', points: [[0.8, 0, 0.8]] },
      ],
      fixtures: [
        { id: 'fx-in', position: [-0.1, 0, 0] },
        { id: 'fx-out', position: [0.9, 0, 0] },
      ],
    });
    expect(result.pipeIds).toEqual(['pipe-in']);
    expect(result.fixtureIds).toEqual(['fx-in']);
  });

  it('returns empty arrays when nothing is inside', () => {
    const result = filterEntitiesInRect({
      worldToClip: IDENTITY,
      viewport: { width: 800, height: 600 },
      rect: { x1: 0, y1: 0, x2: 10, y2: 10 }, // tiny corner rect
      pipes: [{ id: 'p1', points: [[0, 0, 0]] }],
      fixtures: [{ id: 'f1', position: [0, 0, 0] }],
    });
    expect(result.pipeIds).toEqual([]);
    expect(result.fixtureIds).toEqual([]);
  });
});
