/**
 * ALG-018 — `material_cost_line` tests.
 */

import { describe, it, expect } from 'vitest';
import { material_cost_line } from '../costing/materialCost';
import { InvalidGeometry } from '../errors';

describe('ALG-018 material_cost_line — formula', () => {
  it('typical plywood install: 2400 sf, 10% waste, $1.25/sf → qty 2640, ext $3300', () => {
    const line = material_cost_line(2400, 0.1, 1.25, '15/32 plywood');
    expect(line.quantity).toBe(2640);
    expect(line.extended_usd).toBe(3300);
    expect(line.unit).toBe('SF');
    expect(line.unit_cost_usd).toBe(1.25);
    expect(line.description).toBe('15/32 plywood');
  });

  it('zero waste → qty = area exactly', () => {
    const line = material_cost_line(1000, 0, 2.0, 'board sheathing');
    expect(line.quantity).toBe(1000);
    expect(line.extended_usd).toBe(2000);
  });

  it('zero unit cost → extended = 0 (bundled / complimentary)', () => {
    const line = material_cost_line(2400, 0.1, 0, 'bundled panel');
    expect(line.quantity).toBeCloseTo(2640, 6);
    expect(line.extended_usd).toBe(0);
  });

  it('fractional waste: 15% → qty = area * 1.15', () => {
    const line = material_cost_line(1000, 0.15, 1.0, 'test');
    expect(line.quantity).toBe(1150);
  });
});

describe('ALG-018 — validation', () => {
  it('roof_area_sf = 0 → InvalidGeometry', () => {
    expect(() => material_cost_line(0, 0.1, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('roof_area_sf negative → InvalidGeometry', () => {
    expect(() => material_cost_line(-1, 0.1, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('roof_area_sf NaN → InvalidGeometry', () => {
    expect(() => material_cost_line(Number.NaN, 0.1, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('roof_area_sf Infinity → InvalidGeometry', () => {
    expect(() => material_cost_line(Number.POSITIVE_INFINITY, 0.1, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('waste_factor negative → InvalidGeometry', () => {
    expect(() => material_cost_line(2400, -0.1, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('waste_factor = 1.0 (boundary — must be < 1) → InvalidGeometry', () => {
    expect(() => material_cost_line(2400, 1.0, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('waste_factor = 0.9999 → passes (just under boundary)', () => {
    expect(() => material_cost_line(2400, 0.9999, 1.25, 'x')).not.toThrow();
  });

  it('waste_factor NaN → InvalidGeometry', () => {
    expect(() => material_cost_line(2400, Number.NaN, 1.25, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('material_cost_per_sf_usd negative → InvalidGeometry', () => {
    expect(() => material_cost_line(2400, 0.1, -0.5, 'x'))
      .toThrow(InvalidGeometry);
  });

  it('material_cost_per_sf_usd NaN → InvalidGeometry', () => {
    expect(() => material_cost_line(2400, 0.1, Number.NaN, 'x'))
      .toThrow(InvalidGeometry);
  });
});

describe('ALG-018 — CostLine shape invariants', () => {
  it('always unit = "SF"', () => {
    const line = material_cost_line(100, 0.1, 1.0, 'x');
    expect(line.unit).toBe('SF');
  });

  it('description preserved verbatim', () => {
    const desc = 'some-weird-DESC with (parens) and numbers 15/32"';
    const line = material_cost_line(100, 0.1, 1.0, desc);
    expect(line.description).toBe(desc);
  });

  it('extended_usd = quantity × unit_cost_usd exactly', () => {
    const line = material_cost_line(2400, 0.1, 1.25, 'x');
    expect(line.extended_usd).toBe(line.quantity * line.unit_cost_usd);
  });
});
