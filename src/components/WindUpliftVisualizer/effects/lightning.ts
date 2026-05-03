/**
 * L-system lightning bolt generator.
 *
 * Industry pattern (used by Houdini's `bolt` SOP, Unreal's particle system,
 * After Effects' Advanced Lightning effect): start with a primary segmented
 * path, then probabilistically spawn branches at each node. Each branch
 * recurses with reduced length, opacity, and stroke width.
 *
 * Pure function. Seedable for reproducibility in tests.
 */

export interface BoltSegment {
  d: string;
  width: number;
  opacity: number;
}

interface BoltOptions {
  startX: number;
  startY?: number;
  endY?: number;
  segLen?: number;
  jitter?: number;
  branchProb?: number;
  maxDepth?: number;
}

/** Cheap deterministic PRNG so a (seed, opts) pair always returns the same bolt */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateBolt(seed: number, opts: BoltOptions): BoltSegment[] {
  const {
    startX,
    startY = 0,
    endY = 280,
    segLen = 28,
    jitter = 38,
    branchProb = 0.28,
    maxDepth = 2,
  } = opts;

  const rand = mulberry32(seed);
  const segments: BoltSegment[] = [];

  const walk = (x: number, y: number, targetY: number, depth: number, width: number, opacity: number) => {
    let cx = x;
    let cy = y;
    const path: string[] = [`M ${cx.toFixed(1)} ${cy.toFixed(1)}`];
    const safety = 80;
    let i = 0;
    while (cy < targetY && i < safety) {
      const nx = cx + (rand() - 0.5) * jitter;
      const ny = cy + segLen * (0.7 + rand() * 0.6);
      path.push(`L ${nx.toFixed(1)} ${ny.toFixed(1)}`);
      // Branch?
      if (depth < maxDepth && rand() < branchProb) {
        const childTarget = ny + (targetY - ny) * (0.4 + rand() * 0.4);
        walk(nx, ny, childTarget, depth + 1, width * 0.55, opacity * 0.55);
      }
      cx = nx;
      cy = ny;
      i++;
    }
    segments.push({ d: path.join(' '), width, opacity });
  };

  walk(startX, startY, endY, 0, 1.8, 1);
  return segments;
}
