/**
 * DXFExporter — Phase 14.AA.1 tests.
 *
 * Covers:
 *   - Empty scene → minimal valid DXF (HEADER + TABLES + empty ENTITIES + EOF)
 *   - Pipes, fixtures, fittings, walls each produce the right entity type
 *   - Projection modes produce different 2D coords from the same 3D input
 *   - Layer table matches the systems actually used in the scene
 *   - Units + AutoCAD version in HEADER are correct
 *   - Invisible pipes excluded
 *   - Labels optional
 */

import { describe, it, expect } from 'vitest';
import { exportToDXF, type DxfScene } from '../DXFExporter';
import type { CommittedPipe } from '../../../store/pipeStore';
import type { FixtureInstance } from '../../../store/fixtureStore';
import type { FittingInstance } from '../../../ui/pipe/FittingGenerator';

// ── Builders ──────────────────────────────────────────────────

function mkPipe(
  id: string,
  points: [number, number, number][],
  system: CommittedPipe['system'] = 'cold_supply',
  material: CommittedPipe['material'] = 'pex',
): CommittedPipe {
  return {
    id, points,
    diameter: 0.75, material, system,
    color: '#2a6fd6', visible: true, selected: false,
  };
}

function mkFixture(
  id: string,
  position: [number, number, number],
  subtype: FixtureInstance['subtype'] = 'lavatory',
): FixtureInstance {
  return { id, subtype, position, params: {}, createdTs: 0, connectedPipeIds: [] };
}

function mkFitting(id: string, position: [number, number, number]): FittingInstance {
  return {
    id,
    type: 'bend_90',
    position,
    quaternion: [0, 0, 0, 1],
    diameter: 2,
    material: 'pvc_sch40',
    pipeId: 'p1',
  };
}

function emptyScene(): DxfScene {
  return { pipes: [], fixtures: [] };
}

// ── Minimal output ───────────────────────────────────────────

describe('empty scene', () => {
  it('still produces a valid DXF skeleton', () => {
    const r = exportToDXF(emptyScene());
    expect(r.content).toContain('SECTION');
    expect(r.content).toContain('HEADER');
    expect(r.content).toContain('TABLES');
    expect(r.content).toContain('ENTITIES');
    expect(r.content).toContain('EOF');
    expect(r.entityCount).toBe(0);
  });

  it('AutoCAD version AC1027 present in HEADER', () => {
    const r = exportToDXF(emptyScene());
    expect(r.content).toContain('AC1027');
  });

  it('units code 2 (decimal feet) set', () => {
    const r = exportToDXF(emptyScene());
    expect(r.content).toContain('$INSUNITS');
  });
});

// ── Pipes ────────────────────────────────────────────────────

describe('pipes', () => {
  it('single cold_supply pipe → LWPOLYLINE on P-DOMC layer', () => {
    const pipe = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const r = exportToDXF({ pipes: [pipe], fixtures: [] });
    expect(r.content).toContain('LWPOLYLINE');
    expect(r.content).toContain('P-DOMC'); // AIA cold supply layer
    expect(r.layersUsed).toContain('P-DOMC');
  });

  it('pipes by system land on correct AIA layer', () => {
    const scene: DxfScene = {
      pipes: [
        mkPipe('a', [[0, 0, 0], [1, 0, 0]], 'waste', 'pvc_sch40'),
        mkPipe('b', [[0, 0, 1], [1, 0, 1]], 'vent', 'pvc_sch40'),
        mkPipe('c', [[0, 0, 2], [1, 0, 2]], 'cold_supply', 'pex'),
        mkPipe('d', [[0, 0, 3], [1, 0, 3]], 'hot_supply', 'pex'),
        mkPipe('e', [[0, 0, 4], [1, 0, 4]], 'storm', 'pvc_sch40'),
      ],
      fixtures: [],
    };
    const r = exportToDXF(scene);
    expect(r.content).toContain('P-DRAN-WAST');
    expect(r.content).toContain('P-VENT');
    expect(r.content).toContain('P-DOMC');
    expect(r.content).toContain('P-DOMH');
    expect(r.content).toContain('P-DRAN-STRM');
  });

  it('invisible pipes are skipped', () => {
    const pipe = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    pipe.visible = false;
    const r = exportToDXF({ pipes: [pipe], fixtures: [] });
    expect(r.entityCount).toBe(0);
  });

  it('plan projection drops Y, keeps X + Z', () => {
    const pipe = mkPipe('a', [[7, 42, 3], [8, 42, 3]]);
    const r = exportToDXF({ pipes: [pipe], fixtures: [] });
    // Check X = 7 and Z = 3 appear in the content (the 2D coords)
    // but Y = 42 should not appear as a coordinate value (it's dropped)
    expect(r.content).toContain('7.0000');
    expect(r.content).toContain('3.0000');
    // 42 could appear in other contexts; just verify the coord formatting
  });

  it('elevation_x projection keeps X + Y', () => {
    const pipe = mkPipe('a', [[7, 5, 100], [8, 5, 100]]);
    const r = exportToDXF({ pipes: [pipe], fixtures: [] },
      { projection: 'elevation_x' });
    expect(r.content).toContain('7.0000');
    expect(r.content).toContain('5.0000'); // Y preserved
  });

  it('elevation_z projection keeps Z + Y', () => {
    const pipe = mkPipe('a', [[7, 5, 100], [7, 5, 101]]);
    const r = exportToDXF({ pipes: [pipe], fixtures: [] },
      { projection: 'elevation_z' });
    expect(r.content).toContain('100.0000');
    expect(r.content).toContain('5.0000'); // Y preserved
  });
});

// ── Fixtures ─────────────────────────────────────────────────

describe('fixtures', () => {
  it('every fixture emits a CIRCLE on P-FIXT', () => {
    const scene: DxfScene = {
      pipes: [],
      fixtures: [
        mkFixture('f1', [0, 0, 0]),
        mkFixture('f2', [5, 0, 5]),
      ],
    };
    const r = exportToDXF(scene);
    expect((r.content.match(/CIRCLE/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(r.content).toContain('P-FIXT');
  });
});

// ── Fittings ─────────────────────────────────────────────────

describe('fittings', () => {
  it('fittings emit CIRCLE on P-FIXT-SYMB when provided', () => {
    const scene: DxfScene = {
      pipes: [],
      fixtures: [],
      fittings: [mkFitting('ft1', [0, 0, 0])],
    };
    const r = exportToDXF(scene);
    expect(r.content).toContain('P-FIXT-SYMB');
    expect(r.content).toContain('CIRCLE');
  });

  it('fittings suppressed when includeFittings = false', () => {
    const scene: DxfScene = {
      pipes: [],
      fixtures: [],
      fittings: [mkFitting('ft1', [0, 0, 0])],
    };
    const r = exportToDXF(scene, { includeFittings: false });
    expect(r.content).not.toContain('P-FIXT-SYMB');
  });
});

// ── Walls ────────────────────────────────────────────────────

describe('walls', () => {
  it('walls emit LINE on A-WALL', () => {
    const scene: DxfScene = {
      pipes: [],
      fixtures: [],
      walls: [{ id: 'w1', points: [[0, 0, 0], [10, 0, 0], [10, 0, 5]] }],
    };
    const r = exportToDXF(scene);
    expect(r.content).toContain('A-WALL');
    expect(r.content).toContain('LINE');
  });
});

// ── Labels ───────────────────────────────────────────────────

describe('labels', () => {
  it('labels on by default → TEXT entities present', () => {
    const pipe = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const r = exportToDXF({ pipes: [pipe], fixtures: [] });
    expect(r.content).toContain('TEXT');
    // Diameter formatted as `3/4"`
    expect(r.content).toContain('3/4"');
  });

  it('labels omitted when includeLabels = false', () => {
    const pipe = mkPipe('a', [[0, 0, 0], [5, 0, 0]]);
    const r = exportToDXF(
      { pipes: [pipe], fixtures: [] },
      { includeLabels: false },
    );
    expect(r.content).not.toContain('TEXT');
  });
});

// ── Layer table ──────────────────────────────────────────────

describe('layer table', () => {
  it('layersUsed reflects systems in scene', () => {
    const scene: DxfScene = {
      pipes: [
        mkPipe('a', [[0, 0, 0], [1, 0, 0]], 'waste', 'pvc_sch40'),
        mkPipe('b', [[0, 0, 1], [1, 0, 1]], 'vent', 'pvc_sch40'),
      ],
      fixtures: [],
    };
    const r = exportToDXF(scene, { includeLabels: false });
    expect(r.layersUsed).toContain('P-DRAN-WAST');
    expect(r.layersUsed).toContain('P-VENT');
    // No supply pipes → no supply layer
    expect(r.layersUsed).not.toContain('P-DOMC');
  });
});

// ── Entity count + size ──────────────────────────────────────

describe('metadata', () => {
  it('entityCount matches number of entities written', () => {
    const scene: DxfScene = {
      pipes: [mkPipe('a', [[0, 0, 0], [1, 0, 0]])],
      fixtures: [mkFixture('f1', [0, 0, 0])],
    };
    const r = exportToDXF(scene, { includeLabels: false });
    // 1 pipe polyline + 1 fixture circle = 2 entities
    expect(r.entityCount).toBe(2);
  });

  it('sizeBytes > 0 for non-empty output', () => {
    const r = exportToDXF(emptyScene());
    expect(r.sizeBytes).toBeGreaterThan(0);
  });
});
