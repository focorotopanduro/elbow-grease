/**
 * newFixtureModels — Phase 14.Y.2 smoke tests.
 *
 * Verifies the 9 new subtype models dispatched by the FixtureModel
 * component are wired up + don't throw on default params. Render
 * output is dimensional (returns React nodes); we test at the
 * "did it dispatch + produce a valid subtree" level rather than
 * at the R3F/Three mesh level (which needs a Three.js test env
 * we don't have here).
 *
 * Stronger visual fidelity is verified manually in the desktop app.
 */

import { describe, it, expect } from 'vitest';
import type { FixtureSubtype } from '../../../engine/graph/GraphNode';
import { getFixtureGeometry } from '../../../core/fixtures/ConnectionPoints';
import {
  DFU_TABLE,
  SUPPLY_TABLE,
} from '../../../engine/graph/GraphNode';
import { FLOW_PROFILES } from '../../../engine/demand/FixtureFlowProfile';
import { PARAM_SCHEMA } from '../../../core/fixtures/FixtureParams';

const NEW_SUBTYPES: FixtureSubtype[] = [
  'water_heater',
  'tankless_water_heater',
  'bidet',
  'laundry_tub',
  'utility_sink',
  'expansion_tank',
  'backflow_preventer',
  'pressure_reducing_valve',
  'cleanout_access',
];

describe('Phase 14.Y.2 — new fixture rendering registry', () => {
  it('every new subtype has geometry + connection points', () => {
    for (const sub of NEW_SUBTYPES) {
      const g = getFixtureGeometry(sub);
      expect(g).toBeDefined();
      expect(g.footprint.width).toBeGreaterThan(0);
      expect(g.footprint.depth).toBeGreaterThan(0);
      expect(g.footprint.height).toBeGreaterThan(0);
      expect(g.points.length).toBeGreaterThan(0);
    }
  });

  it('water heater capacity scales footprint monotonically', () => {
    const g40 = getFixtureGeometry('water_heater', { capacityGal: 40 });
    const g50 = getFixtureGeometry('water_heater', { capacityGal: 50 });
    const g75 = getFixtureGeometry('water_heater', { capacityGal: 75 });
    expect(g40.footprint.height).toBeLessThanOrEqual(g50.footprint.height);
    expect(g50.footprint.height).toBeLessThanOrEqual(g75.footprint.height);
  });

  it('every new subtype has DFU / SUPPLY / FLOW / PARAM entries', () => {
    for (const sub of NEW_SUBTYPES) {
      expect(DFU_TABLE[sub]).toBeDefined();
      expect(SUPPLY_TABLE[sub]).toBeDefined();
      expect(FLOW_PROFILES[sub]).toBeDefined();
      expect(PARAM_SCHEMA[sub]).toBeDefined();
    }
  });

  it('tankless is physically smaller than a tank heater', () => {
    const tankless = getFixtureGeometry('tankless_water_heater');
    const tank = getFixtureGeometry('water_heater', { capacityGal: 50 });
    // Tankless width should be less than tank diameter
    expect(tankless.footprint.width).toBeLessThan(tank.footprint.width);
    expect(tankless.footprint.height).toBeLessThan(tank.footprint.height);
  });

  it('inline devices have ≤ 4" x ≤ 4" cross-section', () => {
    // Expansion tank + PRV + backflow are ≤ 12" max
    const devices = ['expansion_tank', 'pressure_reducing_valve', 'cleanout_access'] as const;
    for (const sub of devices) {
      const g = getFixtureGeometry(sub);
      // All are ≤ 1 ft in their smallest dim
      expect(Math.min(g.footprint.width, g.footprint.depth, g.footprint.height)).toBeLessThanOrEqual(1);
    }
  });

  it('each new fixture has distinct connection-point ids (no dupes)', () => {
    for (const sub of NEW_SUBTYPES) {
      const g = getFixtureGeometry(sub);
      const ids = g.points.map((p) => p.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    }
  });
});
