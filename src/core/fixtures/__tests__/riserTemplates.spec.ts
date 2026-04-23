/**
 * riserTemplates — Phase 14.Z tests.
 *
 * Locks the catalog + basic placement geometry for every template.
 */

import { describe, it, expect } from 'vitest';
import {
  placeRiser,
  listRiserTemplates,
  RISER_CATALOG,
  type RiserId,
} from '../riserTemplates';

const ALL_IDS: RiserId[] = [
  'two_story_dwv',
  'three_story_dwv',
  'two_story_supply',
  'water_heater_stub',
];

// ── Catalog ──────────────────────────────────────────────────

describe('RISER_CATALOG', () => {
  it('exposes 4 templates', () => {
    expect(listRiserTemplates()).toHaveLength(4);
  });

  it('every template has required metadata', () => {
    for (const t of listRiserTemplates()) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.floorCount).toBeGreaterThanOrEqual(1);
      expect(t.height).toBeGreaterThan(0);
    }
  });

  it('floorCount scales height (rough sanity)', () => {
    expect(RISER_CATALOG.two_story_dwv.height).toBeLessThan(
      RISER_CATALOG.three_story_dwv.height,
    );
  });
});

// ── Template outputs ─────────────────────────────────────────

describe('placeRiser — every template returns pipes + no fatal warnings', () => {
  for (const id of ALL_IDS) {
    it(id, () => {
      const r = placeRiser(id, [0, 0, 0]);
      expect(r.pipes.length).toBeGreaterThan(0);
      expect(r.warnings).toEqual([]);
      for (const p of r.pipes) {
        expect(p.points.length).toBeGreaterThanOrEqual(2);
        expect(p.diameter).toBeGreaterThan(0);
      }
    });
  }
});

describe('2-story DWV riser', () => {
  it('spans slab → 2× 9ft = ~18ft vertical', () => {
    const r = placeRiser('two_story_dwv', [0, 0, 0]);
    const drain = r.pipes.find((p) => p.diameter === 3 && p.system === 'waste');
    expect(drain).toBeDefined();
    const topY = drain!.points[drain!.points.length - 1]![1];
    const botY = drain!.points[0]![1];
    expect(topY - botY).toBeCloseTo(18, 0);
  });

  it('includes a cleanout fixture at base', () => {
    const r = placeRiser('two_story_dwv', [0, 0, 0]);
    const co = r.fixtures.find((f) => f.subtype === 'cleanout_access');
    expect(co).toBeDefined();
    expect(co!.position[1]).toBeLessThan(1); // near slab
  });

  it('drain is 3", vent is 2"', () => {
    const r = placeRiser('two_story_dwv', [0, 0, 0]);
    expect(r.pipes.filter((p) => p.diameter === 3 && p.system === 'waste')).toHaveLength(1);
    expect(r.pipes.filter((p) => p.diameter === 2 && p.system === 'vent').length).toBeGreaterThanOrEqual(1);
  });
});

describe('3-story DWV riser', () => {
  it('uses 4" drain (upsized from 2-story 3")', () => {
    const r = placeRiser('three_story_dwv', [0, 0, 0]);
    const drain = r.pipes.find((p) => p.system === 'waste');
    expect(drain!.diameter).toBe(4);
  });

  it('spans ~27 ft vertical', () => {
    const r = placeRiser('three_story_dwv', [0, 0, 0]);
    const drain = r.pipes.find((p) => p.system === 'waste')!;
    const span = drain.points[drain.points.length - 1]![1] - drain.points[0]![1];
    expect(span).toBeCloseTo(27, 0);
  });

  it('has wet-vent takeoffs at both floor levels', () => {
    const r = placeRiser('three_story_dwv', [0, 0, 0]);
    const wetVents = r.pipes.filter((p) => p.system === 'vent' && p.diameter === 2);
    // 1 main vent + 2 wet-vent crossconnects = 3
    expect(wetVents.length).toBeGreaterThanOrEqual(3);
  });
});

describe('2-story supply riser', () => {
  it('has both cold + hot 3/4" PEX risers', () => {
    const r = placeRiser('two_story_supply', [0, 0, 0]);
    const cold = r.pipes.filter((p) => p.system === 'cold_supply' && p.diameter === 0.75);
    const hot = r.pipes.filter((p) => p.system === 'hot_supply' && p.diameter === 0.75);
    expect(cold.length).toBeGreaterThanOrEqual(1);
    expect(hot.length).toBeGreaterThanOrEqual(1);
  });

  it('all pipes are PEX', () => {
    const r = placeRiser('two_story_supply', [0, 0, 0]);
    for (const p of r.pipes) expect(p.material).toBe('pex');
  });

  it('no fixtures placed (pure piping)', () => {
    const r = placeRiser('two_story_supply', [0, 0, 0]);
    expect(r.fixtures).toEqual([]);
  });
});

describe('water-heater stub', () => {
  it('provides cold + hot stubs + expansion tank fixture', () => {
    const r = placeRiser('water_heater_stub', [0, 0, 0]);
    expect(r.pipes.filter((p) => p.system === 'cold_supply').length).toBeGreaterThanOrEqual(1);
    expect(r.pipes.filter((p) => p.system === 'hot_supply').length).toBeGreaterThanOrEqual(1);
    expect(r.fixtures.filter((f) => f.subtype === 'expansion_tank')).toHaveLength(1);
  });
});

// ── Anchor offset ────────────────────────────────────────────

describe('anchor translation', () => {
  it('moving anchor shifts every produced entity by the same delta', () => {
    const a = placeRiser('two_story_dwv', [0, 0, 0]);
    const b = placeRiser('two_story_dwv', [100, 50, 25]);
    // Drain base X should be 0 and 100 respectively
    const aDrain = a.pipes.find((p) => p.system === 'waste')!;
    const bDrain = b.pipes.find((p) => p.system === 'waste')!;
    expect(bDrain.points[0]![0] - aDrain.points[0]![0]).toBe(100);
    expect(bDrain.points[0]![1] - aDrain.points[0]![1]).toBe(50);
    expect(bDrain.points[0]![2] - aDrain.points[0]![2]).toBe(25);
  });
});

// ── Id uniqueness ────────────────────────────────────────────

describe('entity ids', () => {
  it('every pipe in a single placement has a unique id', () => {
    const r = placeRiser('three_story_dwv', [0, 0, 0]);
    const ids = new Set(r.pipes.map((p) => p.id));
    expect(ids.size).toBe(r.pipes.length);
  });

  it('back-to-back placements produce distinct ids', () => {
    const a = placeRiser('two_story_dwv', [0, 0, 0]);
    const b = placeRiser('two_story_dwv', [0, 0, 0]);
    const allIds = new Set([...a.pipes.map((p) => p.id), ...b.pipes.map((p) => p.id)]);
    expect(allIds.size).toBe(a.pipes.length + b.pipes.length);
  });
});
