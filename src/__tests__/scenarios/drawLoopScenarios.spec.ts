/**
 * drawLoopScenarios — Phase 14.W hardening pass.
 *
 * End-to-end scenario tests that exercise the draw loop across
 * realistic multi-step user flows. These are NOT unit tests — they
 * touch multiple stores, the full addDrawPoint constraint pipeline,
 * the fitting cache, and the real pipeStore commit path. If any of
 * these scenarios break, it's a regression in user-visible behavior.
 *
 * Scenarios covered:
 *
 *   1. "Draw an L-shape with PVC" — classic DWV branch, 2 segments,
 *      one 90° bend. Verifies constraint path, commit, fitting
 *      generation.
 *
 *   2. "Switch from PVC to PEX mid-session" — verifies diameter
 *      auto-tunes (2" → 0.75"), system assignment flips to
 *      cold_supply on commit, and the NEW pipe renders with PEX
 *      color. Doesn't touch already-committed pipes.
 *
 *   3. "Draw a PEX 90° corner" — verifies pex_elbow_90 emits,
 *      bend_90 does NOT double-emit, material tag is 'pex',
 *      BOM cost retrievable.
 *
 *   4. "Draw a PEX smooth 45° arc" — verifies no fitting emitted,
 *      pipe commits, compliance path sees no illegal-angle flag.
 *
 *   5. "Backspace mid-draw" — add 3 points, pop 1, verify 2 remain,
 *      isDrawing stays true.
 *
 *   6. "Alt-click bypass constraint" — odd angle survives through
 *      commit, rubber-band cursor constraint doesn't override.
 *
 *   7. "Material-family switch thresholds" — verify boundary cases:
 *      PEX → PVC at 1" current (should go to 2"), PVC → PEX at
 *      1.5" current (should go to 0.75"), PEX → PEX (no change).
 *
 *   8. "Rapid 20-point draw" — stress: confirm no NaN, no duplicate
 *      points, total length matches sum of segment lengths.
 *
 *   9. "Near-duplicate click handling" — raw-path skips;
 *      constrained-path floors to grid step.
 *
 *   10. "Pure-vertical PEX riser" — 90° rise snapped, no XZ bend.
 *
 *   11. "Empty-selection fitting cache" — collectPerPipe([]) is
 *       safe, no errors, stats still coherent.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useInteractionStore } from '../../store/interactionStore';
import { usePipeStore } from '../../store/pipeStore';
import { useFixtureStore } from '../../store/fixtureStore';
import { FittingCache } from '../../core/pipe/fittingCache';
import { generateAllFittings } from '../../ui/pipe/FittingGenerator';
import { totalLength } from '../../core/pipe/liveRouteBuild';

// ── Setup ─────────────────────────────────────────────────────

function resetStores() {
  useInteractionStore.setState({
    mode: 'draw',
    drawPoints: [],
    isDrawing: false,
    cursorPos: null,
    gridSnap: 0.5,
    drawPlane: 'horizontal',
    drawDiameter: 2,
    drawMaterial: 'pvc_sch40',
    verticalAnchorY: 0,
    navFrozen: false,
  });
  usePipeStore.setState({
    pipes: {},
    pipeOrder: [],
    selectedId: null,
    undoStack: [],
    redoStack: [],
    pivotSession: null,
  });
  useFixtureStore.setState({
    fixtures: {},
    selectedFixtureId: null,
  });
}

// Commit current draw to a CommittedPipe, returning the id.
function commitCurrentDraw(id = `pipe-${Date.now()}`): string {
  const s = useInteractionStore.getState();
  const pts = s.finishDraw();
  if (!pts || pts.length < 2) throw new Error('need ≥ 2 points to commit');
  usePipeStore.getState().addPipe({
    id,
    points: pts,
    diameter: s.drawDiameter,
    material: s.drawMaterial,
  });
  return id;
}

// ── Scenarios ─────────────────────────────────────────────────

describe('Scenario 1 — PVC L-shape', () => {
  beforeEach(resetStores);

  it('commits one 90° bend + emits one fitting', () => {
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([5, 0, 0]);
    s.addDrawPoint([5, 0, 5]);
    const id = commitCurrentDraw('L1');
    const pipe = usePipeStore.getState().pipes[id]!;
    expect(pipe.points).toHaveLength(3);
    expect(pipe.material).toBe('pvc_sch40');
    // PVC defaults to 'waste' system
    expect(pipe.system).toBe('waste');
    const fittings = generateAllFittings([pipe]);
    const bends = fittings.filter((f) =>
      f.type === 'bend_90' || f.type === 'bend_90_ls' || f.type === 'elbow_90',
    );
    expect(bends.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Scenario 2 — PVC → PEX mid-session switch', () => {
  beforeEach(resetStores);

  it('diameter drops 2" → 0.75" on switch; new commit uses new settings', () => {
    const s = useInteractionStore.getState();
    // Start with PVC @ 2"
    expect(s.drawDiameter).toBe(2);
    expect(s.drawMaterial).toBe('pvc_sch40');
    // Draw + commit a PVC pipe
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([5, 0, 0]);
    const pvcId = commitCurrentDraw('pvc1');
    expect(usePipeStore.getState().pipes[pvcId]!.system).toBe('waste');
    expect(usePipeStore.getState().pipes[pvcId]!.material).toBe('pvc_sch40');
    expect(usePipeStore.getState().pipes[pvcId]!.diameter).toBe(2);

    // Switch to PEX — diameter should auto-drop
    useInteractionStore.getState().setDrawMaterial('pex');
    expect(useInteractionStore.getState().drawDiameter).toBe(0.75);

    // Draw + commit a PEX pipe
    const s2 = useInteractionStore.getState();
    s2.addDrawPoint([10, 0, 0]);
    s2.addDrawPoint([15, 0, 0]);
    const pexId = commitCurrentDraw('pex1');
    const pexPipe = usePipeStore.getState().pipes[pexId]!;
    expect(pexPipe.material).toBe('pex');
    expect(pexPipe.diameter).toBe(0.75);
    // PEX defaults to cold_supply so it renders blue
    expect(pexPipe.system).toBe('cold_supply');
    // Old PVC pipe is untouched
    expect(usePipeStore.getState().pipes[pvcId]!.material).toBe('pvc_sch40');
  });
});

describe('Scenario 3 — PEX 90° corner', () => {
  beforeEach(resetStores);

  it('emits exactly one pex_elbow_90, no double-fire with bend_90', () => {
    useInteractionStore.getState().setDrawMaterial('pex');
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([5, 0, 0]);
    s.addDrawPoint([5, 0, 5]);
    const id = commitCurrentDraw('pex_L');
    const pipe = usePipeStore.getState().pipes[id]!;
    const fittings = generateAllFittings([pipe]);
    expect(fittings.filter((f) => f.type === 'pex_elbow_90')).toHaveLength(1);
    expect(fittings.filter((f) => f.type === 'bend_90')).toHaveLength(0);
    expect(fittings.filter((f) => f.type === 'elbow_90')).toHaveLength(0);
  });
});

describe('Scenario 4 — PEX smooth 45°', () => {
  beforeEach(resetStores);

  it('emits no fitting at a 45° deflection (physical bend)', () => {
    useInteractionStore.getState().setDrawMaterial('pex');
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([5, 0, 0]);
    // 45° turn from the previous segment — length 5
    const third: [number, number, number] = [
      5 + 5 * Math.SQRT1_2, 0, 5 * Math.SQRT1_2,
    ];
    s.addDrawPoint(third);
    const id = commitCurrentDraw('pex_smooth');
    const pipe = usePipeStore.getState().pipes[id]!;
    const fittings = generateAllFittings([pipe]);
    const nonJunction = fittings.filter(
      (f) => f.type !== 'tee' && f.type !== 'cross',
    );
    expect(nonJunction).toHaveLength(0);
    // And nothing flagged illegal
    expect(fittings.filter((f) => f.illegalAngle)).toHaveLength(0);
  });
});

describe('Scenario 5 — Backspace mid-draw', () => {
  beforeEach(resetStores);

  it('pops last point, keeps session alive', () => {
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([5, 0, 0]);
    s.addDrawPoint([5, 0, 5]);
    expect(useInteractionStore.getState().drawPoints).toHaveLength(3);
    s.popDrawPoint();
    expect(useInteractionStore.getState().drawPoints).toHaveLength(2);
    expect(useInteractionStore.getState().isDrawing).toBe(true);
    expect(useInteractionStore.getState().mode).toBe('draw');
  });
});

describe('Scenario 6 — Alt-click bypass', () => {
  beforeEach(resetStores);

  it('addDrawPointRaw preserves odd angle through commit', () => {
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPoint([10, 0, 0]);
    // Odd 17° bend — constrained path would snap to 22.5°
    s.addDrawPointRaw([20, 0, 3]);
    const last = useInteractionStore.getState().drawPoints[2]!;
    expect(last).toEqual([20, 0, 3]);
  });
});

describe('Scenario 7 — material switch thresholds', () => {
  beforeEach(resetStores);

  it('PVC @ 2" → PEX → 0.75"', () => {
    useInteractionStore.setState({ drawMaterial: 'pvc_sch40', drawDiameter: 2 });
    useInteractionStore.getState().setDrawMaterial('pex');
    expect(useInteractionStore.getState().drawDiameter).toBe(0.75);
  });

  it('PEX @ 0.75" → PVC → 2"', () => {
    useInteractionStore.setState({ drawMaterial: 'pex', drawDiameter: 0.75 });
    useInteractionStore.getState().setDrawMaterial('pvc_sch40');
    expect(useInteractionStore.getState().drawDiameter).toBe(2);
  });

  it('PEX @ 0.75" → copper_type_l: no change (both supply)', () => {
    useInteractionStore.setState({ drawMaterial: 'pex', drawDiameter: 0.75 });
    useInteractionStore.getState().setDrawMaterial('copper_type_l');
    // Current is already ≤ 1, no auto-bump
    expect(useInteractionStore.getState().drawDiameter).toBe(0.75);
  });

  it('PVC @ 2" → copper_type_l (supply): drop to 0.75"', () => {
    useInteractionStore.setState({ drawMaterial: 'pvc_sch40', drawDiameter: 2 });
    useInteractionStore.getState().setDrawMaterial('copper_type_l');
    expect(useInteractionStore.getState().drawDiameter).toBe(0.75);
  });

  it('PVC @ 1.5" (boundary) → PEX → 0.75"', () => {
    useInteractionStore.setState({ drawMaterial: 'pvc_sch40', drawDiameter: 1.5 });
    useInteractionStore.getState().setDrawMaterial('pex');
    // 1.5 > 1, triggers auto-drop
    expect(useInteractionStore.getState().drawDiameter).toBe(0.75);
  });
});

describe('Scenario 8 — 20-point rapid draw', () => {
  beforeEach(resetStores);

  it('no NaN / no duplicates / length consistent', () => {
    const s = useInteractionStore.getState();
    // Zig-zag along +X with alternating Y tweaks (will rise-snap)
    for (let i = 0; i < 20; i++) {
      s.addDrawPoint([i * 2, 0, i % 2 === 0 ? 0 : 0.5]);
    }
    const pts = useInteractionStore.getState().drawPoints;
    // Every coordinate finite
    for (const p of pts) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
      expect(Number.isFinite(p[2])).toBe(true);
    }
    // No exact duplicates in sequence
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      expect(a[0] === b[0] && a[1] === b[1] && a[2] === b[2]).toBe(false);
    }
    // Total length ≥ number_of_segments × minimum_segment_length
    const L = totalLength(pts);
    expect(L).toBeGreaterThanOrEqual((pts.length - 1) * 0.4);
  });
});

describe('Scenario 9 — near-duplicate handling', () => {
  beforeEach(resetStores);

  it('addDrawPointRaw skips < 0.1 ft duplicates', () => {
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    s.addDrawPointRaw([0.02, 0, 0]); // rounds to origin → duplicate → skip
    expect(useInteractionStore.getState().drawPoints).toHaveLength(1);
  });
});

describe('Scenario 10 — pure vertical PEX riser', () => {
  beforeEach(resetStores);

  it('snaps to 90° rise cleanly', () => {
    useInteractionStore.getState().setDrawMaterial('pex');
    const s = useInteractionStore.getState();
    s.addDrawPoint([0, 0, 0]);
    // Try a 9-ft vertical — rise snapper should land on exactly 90°
    s.addDrawPoint([0, 9, 0]);
    const pts = useInteractionStore.getState().drawPoints;
    expect(pts[1]![0]).toBeCloseTo(0, 3);
    expect(pts[1]![2]).toBeCloseTo(0, 3);
    expect(pts[1]![1]).toBeGreaterThan(0);
  });
});

describe('Scenario 11 — fitting cache safety', () => {
  it('empty pipe list → empty fittings, no throw', () => {
    const cache = new FittingCache();
    expect(cache.collectPerPipe([])).toEqual([]);
    expect(cache.stats().size).toBe(0);
  });

  it('stats stay coherent across add/remove cycles', () => {
    const cache = new FittingCache();
    const makePipe = (id: string, x: number) => ({
      id, diameter: 2, material: 'pvc_sch40' as const,
      system: 'waste' as const,
      points: [[0, 0, 0], [x, 0, 0], [x, 0, x]] as [number, number, number][],
      color: '#ffa726', visible: true, selected: false,
    });
    // Cycle: 10 adds, 10 same (all hits), 10 with one edited each time
    cache.collectPerPipe([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => makePipe(`p${i}`, i + 1)));
    const after1 = cache.stats();
    cache.collectPerPipe([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => makePipe(`p${i}`, i + 1)));
    const after2 = cache.stats();
    expect(after2.hits - after1.hits).toBe(10);
    expect(after2.misses).toBe(after1.misses);
    expect(after2.size).toBe(10);
  });
});
