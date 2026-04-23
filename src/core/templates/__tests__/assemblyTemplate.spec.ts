/**
 * assemblyTemplate — Phase 14.C tests.
 *
 * Covers:
 *   • compose normalizes positions around centroid
 *   • compose preserves material / diameter / system / params
 *   • compose computes bounding-box extents
 *   • compose handles empty input (returns empty template, not NaN)
 *   • instantiate at origin reproduces template-relative positions
 *   • instantiate at offset shifts everything by the offset vector
 *   • round-trip: compose → instantiate at original centroid ≈ original
 *   • instantiate mints unique IDs via injected minter
 *   • computeCentroid handles empty input safely
 *   • generateTemplateId format (t_<base36>_<4rand>)
 */

import { describe, it, expect } from 'vitest';
import {
  composeTemplate,
  instantiateTemplate,
  computeCentroid,
  generateTemplateId,
  type ComposeTemplateInput,
} from '../assemblyTemplate';
import type { CommittedPipe } from '@store/pipeStore';
import type { FixtureInstance } from '@store/fixtureStore';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p-test',
    points: [
      [0, 0, 0],
      [10, 0, 0],
    ],
    diameter: 2,
    material: 'pvc_sch40',
    system: 'waste',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...overrides,
  };
}

function mkFixture(overrides: Partial<FixtureInstance> = {}): FixtureInstance {
  return {
    id: 'f-test',
    subtype: 'water_closet',
    position: [5, 0, 0],
    params: {},
    createdTs: 0,
    connectedPipeIds: [],
    ...overrides,
  };
}

function mkInput(overrides: Partial<ComposeTemplateInput> = {}): ComposeTemplateInput {
  return {
    name: 'Test Template',
    pipes: [mkPipe()],
    fixtures: [mkFixture()],
    id: 't_fixed_0001',
    createdAt: '2026-04-18T00:00:00.000Z',
    ...overrides,
  };
}

// ── Compose: centroid normalization ──────────────────────────

describe('composeTemplate — centroid normalization', () => {
  it('single fixture at (5, 0, 0) → fixture at (0, 0, 0) in template', () => {
    const t = composeTemplate({
      name: 'Just a toilet',
      pipes: [],
      fixtures: [mkFixture({ position: [5, 0, 0] })],
    });
    expect(t.fixtures[0]!.position).toEqual([0, 0, 0]);
  });

  it('pipe from (0,0,0) to (10,0,0) + fixture at (5,0,0) → centroid at (5,0,0)', () => {
    // 3 points: (0,0,0), (10,0,0), fixture(5,0,0). Mean x = (0+10+5)/3 = 5.
    const t = composeTemplate({
      name: 't',
      pipes: [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
      fixtures: [mkFixture({ position: [5, 0, 0] })],
    });
    expect(t.pipes[0]!.points[0]).toEqual([-5, 0, 0]);
    expect(t.pipes[0]!.points[1]).toEqual([5, 0, 0]);
    expect(t.fixtures[0]!.position).toEqual([0, 0, 0]);
  });

  it('3D centroid: offsets on all axes are recentered', () => {
    const t = composeTemplate({
      name: 't',
      pipes: [],
      fixtures: [
        mkFixture({ position: [10, 2, 6] }),
        mkFixture({ position: [20, 4, 12] }),
      ],
    });
    // centroid = (15, 3, 9)
    expect(t.fixtures[0]!.position).toEqual([-5, -1, -3]);
    expect(t.fixtures[1]!.position).toEqual([5, 1, 3]);
  });
});

// ── Compose: data preservation ───────────────────────────────

describe('composeTemplate — data preservation', () => {
  it('preserves diameter / material / system on pipes', () => {
    const t = composeTemplate(
      mkInput({
        pipes: [mkPipe({ diameter: 4, material: 'cast_iron', system: 'vent' })],
      }),
    );
    expect(t.pipes[0]!.diameter).toBe(4);
    expect(t.pipes[0]!.material).toBe('cast_iron');
    expect(t.pipes[0]!.system).toBe('vent');
  });

  it('preserves subtype + params on fixtures (deep-cloned, not aliased)', () => {
    const params = { flushRateGpf: 1.28, wallHung: true };
    const f = mkFixture({ subtype: 'lavatory', params });
    const t = composeTemplate(mkInput({ pipes: [], fixtures: [f] }));
    expect(t.fixtures[0]!.subtype).toBe('lavatory');
    expect(t.fixtures[0]!.params).toEqual({ flushRateGpf: 1.28, wallHung: true });
    // Mutating the template doesn't leak into the source fixture.
    (t.fixtures[0]!.params as { flushRateGpf: number }).flushRateGpf = 999;
    expect(params.flushRateGpf).toBe(1.28);
  });

  it('respects explicit id + createdAt', () => {
    const t = composeTemplate(
      mkInput({ id: 't_custom_id', createdAt: '2026-04-18T12:00:00.000Z' }),
    );
    expect(t.id).toBe('t_custom_id');
    expect(t.createdAt).toBe('2026-04-18T12:00:00.000Z');
  });

  it('captures counts snapshot', () => {
    const t = composeTemplate(
      mkInput({
        pipes: [mkPipe(), mkPipe(), mkPipe()],
        fixtures: [mkFixture(), mkFixture()],
      }),
    );
    expect(t.counts).toEqual({ pipes: 3, fixtures: 2 });
  });
});

// ── Compose: extents ─────────────────────────────────────────

describe('composeTemplate — bounding-box extents', () => {
  it('computes width/depth/height from template-relative points', () => {
    // Two fixtures: (0,0,0) and (12, 4, 8). Centroid = (6, 2, 4).
    // Template-relative: (-6,-2,-4) and (6, 2, 4). Extents:
    //   width (x) = 12, height (y) = 4, depth (z) = 8.
    const t = composeTemplate({
      name: 't',
      pipes: [],
      fixtures: [
        mkFixture({ position: [0, 0, 0] }),
        mkFixture({ position: [12, 4, 8] }),
      ],
    });
    expect(t.extents.width).toBeCloseTo(12, 3);
    expect(t.extents.height).toBeCloseTo(4, 3);
    expect(t.extents.depth).toBeCloseTo(8, 3);
  });

  it('empty scene → extents are all zero', () => {
    const t = composeTemplate({ name: 'empty', pipes: [], fixtures: [] });
    expect(t.extents).toEqual({ width: 0, depth: 0, height: 0 });
    expect(t.counts).toEqual({ pipes: 0, fixtures: 0 });
  });
});

// ── Instantiate ──────────────────────────────────────────────

describe('instantiateTemplate', () => {
  it('at origin returns template positions as-is (already template-relative)', () => {
    const t = composeTemplate(
      mkInput({
        pipes: [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
        fixtures: [mkFixture({ position: [5, 0, 0] })],
      }),
    );
    // Centroid was (5,0,0); template-relative points are now centered.
    const out = instantiateTemplate(t, [0, 0, 0], mkSeqMinter());
    expect(out.pipes[0]!.points[0]).toEqual([-5, 0, 0]);
    expect(out.pipes[0]!.points[1]).toEqual([5, 0, 0]);
    expect(out.fixtures[0]!.position).toEqual([0, 0, 0]);
  });

  it('at offset shifts every point by the offset vector', () => {
    const t = composeTemplate(
      mkInput({
        pipes: [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
        fixtures: [mkFixture({ position: [5, 0, 0] })],
      }),
    );
    const out = instantiateTemplate(t, [100, 1, 50], mkSeqMinter());
    // Template-relative pipe points: (-5,0,0), (5,0,0) → (+100,1,50) offset
    expect(out.pipes[0]!.points[0]).toEqual([95, 1, 50]);
    expect(out.pipes[0]!.points[1]).toEqual([105, 1, 50]);
    // Fixture template-relative (0,0,0) → (100,1,50)
    expect(out.fixtures[0]!.position).toEqual([100, 1, 50]);
  });

  it('round-trip: compose then instantiate at original centroid reproduces original positions', () => {
    const original: CommittedPipe = mkPipe({
      points: [[10, 0, 0], [20, 0, 0], [30, 5, 8]],
    });
    const originalFx = mkFixture({ position: [20, 0, 4] });
    // Centroid of all 4 points: x=(10+20+30+20)/4=20, y=(0+0+5+0)/4=1.25, z=(0+0+8+4)/4=3
    const t = composeTemplate({
      name: 't',
      pipes: [original],
      fixtures: [originalFx],
    });
    const out = instantiateTemplate(t, [20, 1.25, 3], mkSeqMinter());
    expect(out.pipes[0]!.points[0]).toEqual([10, 0, 0]);
    expect(out.pipes[0]!.points[1]).toEqual([20, 0, 0]);
    expect(out.pipes[0]!.points[2]).toEqual([30, 5, 8]);
    expect(out.fixtures[0]!.position).toEqual([20, 0, 4]);
  });

  it('mints one unique ID per instantiated pipe', () => {
    const t = composeTemplate(
      mkInput({ pipes: [mkPipe(), mkPipe(), mkPipe()], fixtures: [] }),
    );
    const out = instantiateTemplate(t, [0, 0, 0], mkSeqMinter());
    const ids = out.pipes.map((p) => p.id);
    expect(ids).toEqual(['id_0', 'id_1', 'id_2']);
    expect(new Set(ids).size).toBe(3);
  });

  it('empty template instantiates without crashing', () => {
    const t = composeTemplate({ name: 'empty', pipes: [], fixtures: [] });
    const out = instantiateTemplate(t, [5, 0, 5], mkSeqMinter());
    expect(out.pipes).toEqual([]);
    expect(out.fixtures).toEqual([]);
  });
});

// ── Low-level helpers ────────────────────────────────────────

describe('computeCentroid', () => {
  it('returns [0,0,0] for empty inputs', () => {
    expect(computeCentroid([], [])).toEqual([0, 0, 0]);
  });

  it('averages across every pipe point + fixture position equally', () => {
    // 2 pipe points + 2 fixture positions
    // sum_x = 0+10+4+6 = 20, n=4 → 5
    const c = computeCentroid(
      [mkPipe({ points: [[0, 0, 0], [10, 0, 0]] })],
      [mkFixture({ position: [4, 0, 0] }), mkFixture({ position: [6, 0, 0] })],
    );
    expect(c).toEqual([5, 0, 0]);
  });
});

describe('generateTemplateId', () => {
  it('matches t_<base36>_<4char> shape', () => {
    const id = generateTemplateId(Date.UTC(2026, 3, 18));
    expect(id).toMatch(/^t_[0-9a-z]+_[0-9a-z]{4}$/);
  });

  it('is time-sortable — later time produces later base36 prefix', () => {
    // Strip the 4-char random suffix; compare the time segment.
    const a = generateTemplateId(1_000_000).split('_')[1]!;
    const b = generateTemplateId(2_000_000).split('_')[1]!;
    expect(b > a || b.length > a.length).toBe(true);
  });
});

// ── Helpers for tests ────────────────────────────────────────

function mkSeqMinter(): () => string {
  let i = 0;
  return () => `id_${i++}`;
}
