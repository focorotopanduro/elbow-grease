/**
 * ALG-019 — `labor_cost_line` tests.
 */

import { describe, it, expect } from 'vitest';
import { labor_cost_line } from '../costing/laborCost';
import { InvalidGeometry, MissingRequiredInput } from '../errors';

describe('ALG-019 labor_cost_line — formula', () => {
  it('2400 sf plywood @ 0.013 mh/sf × $33.85 → mh 31.2, ext $1056.12', () => {
    const line = labor_cost_line(2400, 'plywood', 33.85);
    expect(line.quantity).toBeCloseTo(31.2, 4);
    expect(line.extended_usd).toBeCloseTo(31.2 * 33.85, 4);
    expect(line.unit).toBe('MH');
    expect(line.unit_cost_usd).toBe(33.85);
  });

  it('2400 sf board @ 0.026 mh/sf × $33.85 → mh 62.4', () => {
    const line = labor_cost_line(2400, 'board', 33.85);
    expect(line.quantity).toBeCloseTo(62.4, 4);
  });

  it('rate_override_mh_per_sf wins over default', () => {
    const line = labor_cost_line(1000, 'plywood', 40.0, 0.020);
    expect(line.quantity).toBeCloseTo(20, 4);
    expect(line.extended_usd).toBeCloseTo(20 * 40.0, 4);
  });
});

describe('ALG-019 — default-rate lookup', () => {
  it('board → uses 0.026 default', () => {
    const line = labor_cost_line(1000, 'board', 50);
    expect(line.quantity).toBeCloseTo(26, 4);
  });

  it('plywood → uses 0.013 default', () => {
    const line = labor_cost_line(1000, 'plywood', 50);
    expect(line.quantity).toBeCloseTo(13, 4);
  });

  it('osb without override → MissingRequiredInput', () => {
    expect(() => labor_cost_line(1000, 'osb', 50))
      .toThrow(MissingRequiredInput);
    try {
      labor_cost_line(1000, 'osb', 50);
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('osb');
      expect(msg).toContain('override');
    }
  });

  it('osb WITH override → computes normally', () => {
    const line = labor_cost_line(1000, 'osb', 50, 0.015);
    expect(line.quantity).toBeCloseTo(15, 4);
  });

  it('waferboard without override → MissingRequiredInput', () => {
    expect(() => labor_cost_line(1000, 'waferboard', 50))
      .toThrow(MissingRequiredInput);
  });

  it('roof_decking without override → MissingRequiredInput', () => {
    expect(() => labor_cost_line(1000, 'roof_decking', 50))
      .toThrow(MissingRequiredInput);
  });
});

describe('ALG-019 — validation', () => {
  it('roof_area_sf = 0 → InvalidGeometry', () => {
    expect(() => labor_cost_line(0, 'plywood', 50)).toThrow(InvalidGeometry);
  });

  it('roof_area_sf negative → InvalidGeometry', () => {
    expect(() => labor_cost_line(-1, 'plywood', 50)).toThrow(InvalidGeometry);
  });

  it('crew_manhour_rate_usd = 0 → InvalidGeometry', () => {
    expect(() => labor_cost_line(1000, 'plywood', 0)).toThrow(InvalidGeometry);
  });

  it('crew_manhour_rate_usd negative → InvalidGeometry', () => {
    expect(() => labor_cost_line(1000, 'plywood', -5)).toThrow(InvalidGeometry);
  });

  it('rate_override_mh_per_sf = 0 → InvalidGeometry (strictly positive)', () => {
    expect(() => labor_cost_line(1000, 'plywood', 50, 0))
      .toThrow(InvalidGeometry);
  });

  it('rate_override_mh_per_sf negative → InvalidGeometry', () => {
    expect(() => labor_cost_line(1000, 'plywood', 50, -0.01))
      .toThrow(InvalidGeometry);
  });

  it('rate_override_mh_per_sf NaN → InvalidGeometry', () => {
    expect(() => labor_cost_line(1000, 'plywood', 50, Number.NaN))
      .toThrow(InvalidGeometry);
  });
});

describe('ALG-019 — CostLine shape invariants', () => {
  it('always unit = "MH"', () => {
    const line = labor_cost_line(1000, 'plywood', 50);
    expect(line.unit).toBe('MH');
  });

  it('description = "Sheathing install labor"', () => {
    const line = labor_cost_line(1000, 'plywood', 50);
    expect(line.description).toBe('Sheathing install labor');
  });

  it('extended_usd = quantity × unit_cost_usd exactly', () => {
    const line = labor_cost_line(2400, 'plywood', 33.85);
    expect(line.extended_usd).toBe(line.quantity * line.unit_cost_usd);
  });
});
