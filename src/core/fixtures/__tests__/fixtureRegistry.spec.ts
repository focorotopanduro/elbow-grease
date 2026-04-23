/**
 * fixtureRegistry — Phase 14.Y.1 tests.
 *
 * Locks the invariants the auto-router + hot-supply propagation
 * (14.Y.3 / 14.Y.4) will depend on:
 *
 *   1. Every FixtureSubtype has a registered geometry with
 *      a non-zero footprint.
 *   2. Every FixtureSubtype has a registered connection-point set.
 *   3. Water heater has BOTH a cold inlet AND a hot outlet.
 *   4. Tankless water heater has both connections + a gas stub.
 *   5. DFU_TABLE is exhaustive (touched in GraphNode).
 *   6. SUPPLY_TABLE is exhaustive + the new supply-side entries
 *      have a minBranchSize.
 *   7. FLOW_PROFILES is exhaustive.
 *   8. PARAM_SCHEMA is exhaustive.
 *   9. Water heater capacity option exists.
 */

import { describe, it, expect } from 'vitest';
import { getFixtureGeometry } from '../ConnectionPoints';
import {
  DFU_TABLE,
  SUPPLY_TABLE,
  type FixtureSubtype,
} from '../../../engine/graph/GraphNode';
import { FLOW_PROFILES } from '../../../engine/demand/FixtureFlowProfile';
import { PARAM_SCHEMA } from '../FixtureParams';

// Every subtype the type union covers.
const ALL_SUBTYPES: FixtureSubtype[] = [
  'water_closet', 'lavatory', 'kitchen_sink', 'bathtub', 'shower',
  'floor_drain', 'laundry_standpipe', 'dishwasher', 'clothes_washer',
  'hose_bibb', 'urinal', 'mop_sink', 'drinking_fountain',
  // Phase 14.Y additions
  'water_heater', 'tankless_water_heater', 'bidet', 'laundry_tub',
  'utility_sink', 'expansion_tank', 'backflow_preventer',
  'pressure_reducing_valve', 'cleanout_access',
];

describe('Fixture geometry registry', () => {
  it('every subtype returns a non-zero footprint', () => {
    for (const sub of ALL_SUBTYPES) {
      const g = getFixtureGeometry(sub);
      expect(g.footprint.width).toBeGreaterThan(0);
      expect(g.footprint.depth).toBeGreaterThan(0);
      expect(g.footprint.height).toBeGreaterThan(0);
    }
  });

  it('every subtype has at least one connection point', () => {
    for (const sub of ALL_SUBTYPES) {
      const g = getFixtureGeometry(sub);
      expect(g.points.length).toBeGreaterThan(0);
    }
  });
});

describe('Water heater connection points', () => {
  it('has a cold inlet', () => {
    const g = getFixtureGeometry('water_heater');
    expect(g.points.some((p) => p.role === 'cold')).toBe(true);
  });

  it('has a hot outlet', () => {
    const g = getFixtureGeometry('water_heater');
    expect(g.points.some((p) => p.role === 'hot')).toBe(true);
  });

  it('has a T&P overflow', () => {
    const g = getFixtureGeometry('water_heater');
    expect(g.points.some((p) => p.role === 'overflow')).toBe(true);
  });

  it('has a drain spigot', () => {
    const g = getFixtureGeometry('water_heater');
    expect(g.points.some((p) => p.role === 'drain')).toBe(true);
  });

  it('default 50-gal footprint is ~22" × 60"', () => {
    const g = getFixtureGeometry('water_heater');
    expect(g.footprint.width).toBeCloseTo(22 / 12, 2);
    expect(g.footprint.height).toBeCloseTo(60 / 12, 2);
  });

  it('capacity parameter changes footprint', () => {
    const small = getFixtureGeometry('water_heater', { capacityGal: 40 });
    const large = getFixtureGeometry('water_heater', { capacityGal: 75 });
    expect(large.footprint.height).toBeGreaterThan(small.footprint.height);
    expect(large.footprint.width).toBeGreaterThan(small.footprint.width);
  });
});

describe('Tankless water heater', () => {
  it('has cold + hot + gas connection points', () => {
    const g = getFixtureGeometry('tankless_water_heater');
    expect(g.points.some((p) => p.role === 'cold')).toBe(true);
    expect(g.points.some((p) => p.role === 'hot')).toBe(true);
    expect(g.points.some((p) => p.id === 'gas')).toBe(true);
  });

  it('much smaller footprint than tank', () => {
    const tankless = getFixtureGeometry('tankless_water_heater');
    const tank = getFixtureGeometry('water_heater', { capacityGal: 50 });
    expect(tankless.footprint.width).toBeLessThan(tank.footprint.width);
    expect(tankless.footprint.height).toBeLessThan(tank.footprint.height);
  });
});

describe('Inline devices', () => {
  it('expansion tank has a single inline connection', () => {
    const g = getFixtureGeometry('expansion_tank');
    expect(g.points).toHaveLength(1);
  });

  it('backflow preventer has inlet + outlet + relief', () => {
    const g = getFixtureGeometry('backflow_preventer');
    expect(g.points.some((p) => p.id === 'in')).toBe(true);
    expect(g.points.some((p) => p.id === 'out')).toBe(true);
    expect(g.points.some((p) => p.role === 'overflow')).toBe(true);
  });

  it('pressure-reducing valve has inlet + outlet', () => {
    const g = getFixtureGeometry('pressure_reducing_valve');
    expect(g.points.some((p) => p.id === 'in')).toBe(true);
    expect(g.points.some((p) => p.id === 'out')).toBe(true);
  });

  it('cleanout access has inline + plug', () => {
    const g = getFixtureGeometry('cleanout_access');
    expect(g.points.some((p) => p.id === 'in')).toBe(true);
    expect(g.points.some((p) => p.id === 'plug')).toBe(true);
  });
});

describe('DFU table exhaustiveness', () => {
  it('every subtype has a DFU entry', () => {
    for (const sub of ALL_SUBTYPES) {
      expect(DFU_TABLE[sub]).toBeDefined();
      expect(typeof DFU_TABLE[sub]).toBe('number');
    }
  });

  it('equipment + inline devices contribute 0 DFU', () => {
    expect(DFU_TABLE.water_heater).toBe(0);
    expect(DFU_TABLE.tankless_water_heater).toBe(0);
    expect(DFU_TABLE.expansion_tank).toBe(0);
    expect(DFU_TABLE.backflow_preventer).toBe(0);
    expect(DFU_TABLE.pressure_reducing_valve).toBe(0);
    expect(DFU_TABLE.cleanout_access).toBe(0);
  });

  it('new drainage fixtures have non-zero DFU', () => {
    expect(DFU_TABLE.bidet).toBeGreaterThan(0);
    expect(DFU_TABLE.laundry_tub).toBeGreaterThan(0);
    expect(DFU_TABLE.utility_sink).toBeGreaterThan(0);
  });
});

describe('SUPPLY_TABLE exhaustiveness', () => {
  it('every subtype has a SupplyDemand entry', () => {
    for (const sub of ALL_SUBTYPES) {
      expect(SUPPLY_TABLE[sub]).toBeDefined();
    }
  });

  it('water heater inlet needs ≥ 3/4" branch', () => {
    expect(SUPPLY_TABLE.water_heater.minBranchSize).toBeGreaterThanOrEqual(0.75);
  });

  it('tankless needs bigger branch than tank', () => {
    expect(SUPPLY_TABLE.tankless_water_heater.minBranchSize)
      .toBeGreaterThanOrEqual(SUPPLY_TABLE.water_heater.minBranchSize);
  });

  it('bidet has both cold + hot WSFU', () => {
    expect(SUPPLY_TABLE.bidet.coldWSFU).toBeGreaterThan(0);
    expect(SUPPLY_TABLE.bidet.hotWSFU).toBeGreaterThan(0);
  });
});

describe('FLOW_PROFILES exhaustiveness', () => {
  it('every subtype has a flow profile', () => {
    for (const sub of ALL_SUBTYPES) {
      expect(FLOW_PROFILES[sub]).toBeDefined();
    }
  });

  it('inline devices report 0 flow', () => {
    expect(FLOW_PROFILES.expansion_tank.q).toBe(0);
    expect(FLOW_PROFILES.backflow_preventer.q).toBe(0);
    expect(FLOW_PROFILES.pressure_reducing_valve.q).toBe(0);
    expect(FLOW_PROFILES.cleanout_access.q).toBe(0);
  });
});

describe('PARAM_SCHEMA exhaustiveness', () => {
  it('every subtype has a parameter schema', () => {
    for (const sub of ALL_SUBTYPES) {
      expect(PARAM_SCHEMA[sub]).toBeDefined();
      expect(Array.isArray(PARAM_SCHEMA[sub].sections)).toBe(true);
    }
  });

  it('water heater schema exposes capacity + energy', () => {
    const wh = PARAM_SCHEMA.water_heater;
    const fieldKeys = wh.sections.flatMap((s) => s.fields.map((f) => f.key));
    expect(fieldKeys).toContain('capacityGal');
    expect(fieldKeys).toContain('energy');
  });
});
