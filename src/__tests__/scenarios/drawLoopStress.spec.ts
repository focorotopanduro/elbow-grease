/**
 * drawLoopStress — Phase 14.W stress tests.
 *
 * Pushes the draw loop harder than a human could to expose
 * algorithmic weaknesses + perf regressions. Every test has a wall-
 * clock budget that's deliberately conservative (2–5× typical
 * measured runtime) so CI noise doesn't flake it.
 *
 * Goal: if one of these slows down meaningfully, we catch it in
 * the test run instead of by a user report after release.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useInteractionStore } from '../../store/interactionStore';
import { usePipeStore } from '../../store/pipeStore';
import { useFixtureStore } from '../../store/fixtureStore';
import { FittingCache } from '../../core/pipe/fittingCache';
import { generateAllFittings } from '../../ui/pipe/FittingGenerator';
import { applyDrawConstraints } from '../../core/pipe/angleSnap';
import type { Vec3 } from '@core/events';
import type { CommittedPipe } from '../../store/pipeStore';

// ── Setup ─────────────────────────────────────────────────────

function resetStores() {
  useInteractionStore.setState({
    mode: 'draw', drawPoints: [], isDrawing: false,
    cursorPos: null, gridSnap: 0.5, drawPlane: 'horizontal',
    drawDiameter: 2, drawMaterial: 'pvc_sch40',
    verticalAnchorY: 0, navFrozen: false,
  });
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
}

function makePipe(
  id: string,
  points: Vec3[],
  material: CommittedPipe['material'] = 'pvc_sch40',
): CommittedPipe {
  return {
    id, points,
    diameter: 2, material,
    system: 'waste', color: '#ffa726',
    visible: true, selected: false,
  };
}

// ── Stress: addDrawPoint at 1000 random positions ─────────────

describe('Stress — addDrawPoint high-throughput', () => {
  beforeEach(resetStores);

  it('1000 constrained clicks complete in < 500 ms', () => {
    const s = useInteractionStore.getState();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      // Walk along +X with random micro-offsets that should snap
      // to legal angles + length multiples.
      const x = i * 2 + Math.random() * 0.3;
      const z = Math.random() * 0.3;
      s.addDrawPoint([x, 0, z]);
    }
    const elapsed = performance.now() - t0;
    // Per-point cost must stay modest. 500ms for 1000 points =
    // 0.5ms each, which is comfortable on any modern CPU + well
    // under the 16ms frame budget even if the user clicks once.
    expect(elapsed).toBeLessThan(500);
    // Not every click commits (near-duplicates dropped), but
    // we should at least have some points.
    expect(useInteractionStore.getState().drawPoints.length).toBeGreaterThan(100);
  });

  it('no NaN/Infinity after 1000 constrained clicks', () => {
    const s = useInteractionStore.getState();
    for (let i = 0; i < 1000; i++) {
      s.addDrawPoint([i * 0.01, 0, Math.random() * 10]);
    }
    for (const p of useInteractionStore.getState().drawPoints) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
  });
});

// ── Stress: applyDrawConstraints pure path ────────────────────

describe('Stress — applyDrawConstraints pure path', () => {
  it('10000 constraint calls complete in < 200 ms', () => {
    const ctx = {
      points: [[0, 0, 0], [5, 0, 0]] as Vec3[],
      material: 'pvc_sch40',
      drawPlane: 'horizontal' as const,
      gridStep: 0.5,
    };
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const x = 10 + Math.random() * 5;
      const z = Math.random() * 5;
      applyDrawConstraints([x, 0, z], ctx);
    }
    const elapsed = performance.now() - t0;
    // Pure math, should be fast. 200ms for 10K calls = 20 µs each.
    expect(elapsed).toBeLessThan(200);
  });
});

// ── Stress: material switch churn ─────────────────────────────

describe('Stress — rapid material switch', () => {
  beforeEach(resetStores);

  it('100 back-and-forth switches leave store in consistent state', () => {
    const s = useInteractionStore.getState();
    for (let i = 0; i < 100; i++) {
      s.setDrawMaterial(i % 2 === 0 ? 'pex' : 'pvc_sch40');
    }
    // End state: PVC (because i=99 is odd)
    const end = useInteractionStore.getState();
    expect(end.drawMaterial).toBe('pvc_sch40');
    // Diameter should be one of the well-known defaults for PVC
    expect(end.drawDiameter).toBe(2);
  });
});

// ── Stress: fitting cache growth + eviction ───────────────────

describe('Stress — fitting cache 500-pipe mutate loop', () => {
  it('mutate 500 pipes in sequence, cache stays bounded + correct', () => {
    const cache = new FittingCache();
    const pipes: CommittedPipe[] = [];
    for (let i = 0; i < 500; i++) {
      pipes.push(makePipe(
        `p${i}`,
        [[0, 0, 0], [5, 0, 0], [5, 0, 5]],
      ));
    }
    // First pass — all misses.
    cache.collectPerPipe(pipes);
    const s1 = cache.stats();
    expect(s1.misses).toBe(500);
    expect(s1.hits).toBe(0);
    expect(s1.size).toBe(500);

    // Mutate ONE pipe's points; expect 499 hits + 1 miss.
    pipes[250] = {
      ...pipes[250]!,
      points: [[0, 0, 0], [6, 0, 0], [6, 0, 6]],
    };
    cache.collectPerPipe(pipes);
    const s2 = cache.stats();
    expect(s2.hits).toBe(499);
    expect(s2.misses - s1.misses).toBe(1);

    // Drop 100 pipes; prune should remove them.
    const remaining = pipes.slice(0, 400);
    cache.collectPerPipe(remaining);
    const s3 = cache.stats();
    expect(s3.size).toBe(400);
    expect(s3.evictions).toBeGreaterThanOrEqual(100);
  });

  it('500 mutations of the SAME pipe grow cache by 1, not 500', () => {
    const cache = new FittingCache();
    for (let i = 0; i < 500; i++) {
      cache.getPerPipe(makePipe(
        'p',
        [[0, 0, 0], [i + 1, 0, 0], [i + 1, 0, i + 1]],
      ));
    }
    // Content changed every call → all misses. Size stays at 1
    // because they all share the same id.
    const s = cache.stats();
    expect(s.size).toBe(1);
    expect(s.misses).toBe(500);
  });
});

// ── Stress: fittings on a 200-pipe PEX + PVC mix ──────────────

describe('Stress — mixed-material scene fittings', () => {
  it('200 pipes, half PEX + half PVC, generate all fittings in < 500 ms', () => {
    const pipes: CommittedPipe[] = [];
    for (let i = 0; i < 200; i++) {
      const isPex = i % 2 === 0;
      pipes.push({
        id: `p${i}`,
        points: [
          [i * 2, 0, 0],
          [i * 2 + 3, 0, 0],
          [i * 2 + 3, 0, 3],
        ],
        diameter: isPex ? 0.75 : 2,
        material: isPex ? 'pex' : 'pvc_sch40',
        system: isPex ? 'cold_supply' : 'waste',
        color: isPex ? '#2a6fd6' : '#ffa726',
        visible: true, selected: false,
      });
    }
    const t0 = performance.now();
    const fittings = generateAllFittings(pipes);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500);
    // Each pipe has a 90° bend → expect ≥ 200 bend fittings
    const bends = fittings.filter(
      (f) => f.type === 'bend_90' || f.type === 'elbow_90'
        || f.type === 'pex_elbow_90' || f.type === 'bend_90_ls',
    );
    expect(bends.length).toBeGreaterThanOrEqual(200);
    // PEX pipes emit pex_elbow_90, PVC pipes emit rigid bend_90
    const pexBends = fittings.filter((f) => f.type === 'pex_elbow_90');
    expect(pexBends.length).toBe(100);
  });
});

// ── Stress: deep backspace cycle ──────────────────────────────

describe('Stress — deep draw + full backspace', () => {
  beforeEach(resetStores);

  it('add 50 points, backspace 50 times, store lands empty + ready', () => {
    const s = useInteractionStore.getState();
    for (let i = 0; i < 50; i++) {
      s.addDrawPoint([i * 2, 0, 0]);
    }
    expect(useInteractionStore.getState().drawPoints.length).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      // Over-pops silently on empty
      useInteractionStore.getState().popDrawPoint();
    }
    expect(useInteractionStore.getState().drawPoints).toEqual([]);
    expect(useInteractionStore.getState().isDrawing).toBe(false);
    // Mode should stay 'draw' so the user can keep clicking
    expect(useInteractionStore.getState().mode).toBe('draw');
  });
});
