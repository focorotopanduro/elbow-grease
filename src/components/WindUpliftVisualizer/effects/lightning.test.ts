/**
 * Tests for the L-system bolt generator.
 *
 * Note: walk() pushes its own segment AFTER recursing into children, so the
 * main bolt is the LAST element of the returned array — this puts it on top
 * in SVG paint order, which is what we want visually.
 */
import { describe, it, expect } from 'vitest';
import { generateBolt } from './lightning';

describe('generateBolt — L-system lightning', () => {
  it('is deterministic for the same seed', () => {
    const a = generateBolt(42, { startX: 400 });
    const b = generateBolt(42, { startX: 400 });
    expect(a.length).toBe(b.length);
    expect(a[a.length - 1].d).toBe(b[b.length - 1].d);
  });

  it('different seeds produce different paths', () => {
    const a = generateBolt(1, { startX: 400 });
    const b = generateBolt(999, { startX: 400 });
    expect(a[a.length - 1].d).not.toBe(b[b.length - 1].d);
  });

  it('main bolt path (last segment) starts at the configured startX', () => {
    const segs = generateBolt(7, { startX: 250 });
    const main = segs[segs.length - 1];
    expect(main.d.startsWith('M 250')).toBe(true);
  });

  it('main bolt (last segment) has highest opacity (1) and width (1.8)', () => {
    const segs = generateBolt(7, { startX: 250 });
    const main = segs[segs.length - 1];
    expect(main.opacity).toBe(1);
    expect(main.width).toBe(1.8);
  });

  it('branches (non-final segments) have reduced width and opacity', () => {
    let withBranch: ReturnType<typeof generateBolt> | null = null;
    for (let seed = 0; seed < 50 && !withBranch; seed++) {
      const r = generateBolt(seed, { startX: 400, branchProb: 0.7, maxDepth: 2 });
      if (r.length > 1) withBranch = r;
    }
    expect(withBranch).not.toBeNull();
    if (withBranch) {
      // Any branch (segments before the final main bolt) must be reduced
      const branch = withBranch[0];
      expect(branch.width).toBeLessThan(1.8);
      expect(branch.opacity).toBeLessThan(1);
    }
  });

  it('terminates within safety bounds (no runaway recursion)', () => {
    const segs = generateBolt(13, { startX: 400, branchProb: 0.95, maxDepth: 4 });
    expect(segs.length).toBeLessThan(500);
  });
});
