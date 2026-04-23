/**
 * priceListMapper — Phase 14.AB.2 tests.
 *
 * Covers type normalization, diameter parsing, row mapping,
 * warning aggregation, and merge strategies.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveCanonicalType,
  parseDiameter,
  mapPriceListRows,
  mergePriceOverrides,
  type PriceListMapping,
} from '../priceListMapper';

// ── resolveCanonicalType ─────────────────────────────────────

describe('resolveCanonicalType', () => {
  it('exact match on canonical type', () => {
    expect(resolveCanonicalType('elbow_90')).toBe('elbow_90');
    expect(resolveCanonicalType('pex_elbow_90')).toBe('pex_elbow_90');
  });

  it('case-insensitive', () => {
    expect(resolveCanonicalType('ELBOW_90')).toBe('elbow_90');
    expect(resolveCanonicalType('Bend_45')).toBe('bend_45');
  });

  it('hyphen → underscore normalization', () => {
    expect(resolveCanonicalType('elbow-90')).toBe('elbow_90');
    expect(resolveCanonicalType('bend-22-5')).toBe('bend_22_5');
  });

  it('vendor alias resolution', () => {
    const aliases = { 'ELL_90_DEG': 'elbow_90' as const, 'SS_TEE': 'sanitary_tee' as const };
    expect(resolveCanonicalType('ELL_90_DEG', aliases)).toBe('elbow_90');
    expect(resolveCanonicalType('SS_TEE', aliases)).toBe('sanitary_tee');
  });

  it('alias case-insensitive', () => {
    const aliases = { 'ELL-90-DEG': 'elbow_90' as const };
    expect(resolveCanonicalType('ell_90_deg', aliases)).toBe('elbow_90');
  });

  it('unknown type → null', () => {
    expect(resolveCanonicalType('mystery_fitting')).toBeNull();
    expect(resolveCanonicalType('')).toBeNull();
  });
});

// ── parseDiameter ────────────────────────────────────────────

describe('parseDiameter', () => {
  it('decimal', () => {
    expect(parseDiameter('0.75')).toBe(0.75);
    expect(parseDiameter('2')).toBe(2);
    expect(parseDiameter('4.0')).toBe(4);
  });

  it('simple fraction', () => {
    expect(parseDiameter('3/4')).toBeCloseTo(0.75, 6);
    expect(parseDiameter('1/2')).toBeCloseTo(0.5, 6);
  });

  it('mixed fraction', () => {
    expect(parseDiameter('1-1/2')).toBeCloseTo(1.5, 6);
    expect(parseDiameter('1 1/2')).toBeCloseTo(1.5, 6);
    expect(parseDiameter('2-1/2')).toBeCloseTo(2.5, 6);
  });

  it('inch suffix stripped', () => {
    expect(parseDiameter('2"')).toBe(2);
    expect(parseDiameter('3/4"')).toBeCloseTo(0.75);
    expect(parseDiameter('2 in')).toBe(2);
    expect(parseDiameter('3 inches')).toBe(3);
  });

  it('alias map', () => {
    const aliases = { '19mm': 0.75, '25mm': 1 };
    expect(parseDiameter('19mm', aliases)).toBe(0.75);
    expect(parseDiameter('25mm', aliases)).toBe(1);
  });

  it('unparseable → null', () => {
    expect(parseDiameter('abc')).toBeNull();
    expect(parseDiameter('')).toBeNull();
    expect(parseDiameter('0')).toBeNull(); // 0 is not a valid diameter
  });
});

// ── mapPriceListRows ─────────────────────────────────────────

describe('mapPriceListRows — happy path', () => {
  const mapping: PriceListMapping = {
    typeColumn: 'Type',
    diameterColumn: 'Size',
    priceColumn: 'Price',
  };

  it('maps clean rows', () => {
    const rows = [
      { Type: 'elbow_90', Size: '2', Price: '5.85' },
      { Type: 'sanitary_tee', Size: '3', Price: '22.15' },
    ];
    const r = mapPriceListRows(rows, mapping);
    expect(r.summary).toEqual({ total: 2, accepted: 2, rejected: 0 });
    expect(r.rows).toEqual([
      { sourceRow: 2, type: 'elbow_90', diameter: 2, price: 5.85 },
      { sourceRow: 3, type: 'sanitary_tee', diameter: 3, price: 22.15 },
    ]);
  });

  it('currency formatting $ and commas', () => {
    const rows = [{ Type: 'pex_elbow_90', Size: '3/4', Price: '$1,234.56' }];
    const r = mapPriceListRows(rows, mapping);
    expect(r.rows[0]!.price).toBeCloseTo(1234.56);
  });
});

describe('mapPriceListRows — warnings', () => {
  const mapping: PriceListMapping = {
    typeColumn: 'Type',
    diameterColumn: 'Size',
    priceColumn: 'Price',
  };

  it('unknown type → warning', () => {
    const rows = [{ Type: 'mystery', Size: '2', Price: '5.00' }];
    const r = mapPriceListRows(rows, mapping);
    expect(r.rows).toHaveLength(0);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.reason).toBe('unknown_type');
    expect(r.warnings[0]!.rawValue).toBe('mystery');
  });

  it('invalid diameter → warning', () => {
    const rows = [{ Type: 'elbow_90', Size: 'N/A', Price: '5.00' }];
    const r = mapPriceListRows(rows, mapping);
    expect(r.warnings[0]!.reason).toBe('unknown_diameter');
  });

  it('zero / negative price → warning', () => {
    const rows = [
      { Type: 'elbow_90', Size: '2', Price: '0' },
      { Type: 'elbow_90', Size: '2', Price: '-5' },
    ];
    const r = mapPriceListRows(rows, mapping);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.every((w) => w.reason === 'invalid_price')).toBe(true);
  });

  it('aliases resolve vendor-specific names', () => {
    const aliasMapping: PriceListMapping = {
      typeColumn: 'Type', diameterColumn: 'Size', priceColumn: 'Price',
      typeAliases: { 'ELL_90': 'elbow_90' },
    };
    const rows = [{ Type: 'ELL_90', Size: '2', Price: '5.00' }];
    const r = mapPriceListRows(rows, aliasMapping);
    expect(r.rows[0]!.type).toBe('elbow_90');
  });
});

// ── mergePriceOverrides ──────────────────────────────────────

describe('mergePriceOverrides', () => {
  const existing = {
    elbow_90: { 2: 5.0, 3: 12.0 },
    bend_45: { 2: 4.5 },
  };

  it('replace: new imports overwrite existing entries, preserves untouched ones', () => {
    const imported = [
      { sourceRow: 2, type: 'elbow_90' as const, diameter: 2, price: 7.5 },
    ];
    const merged = mergePriceOverrides(existing, imported, 'replace');
    expect(merged.elbow_90![2]).toBe(7.5);
    expect(merged.elbow_90![3]).toBe(12.0); // preserved
    expect(merged.bend_45![2]).toBe(4.5);    // preserved
  });

  it('skip_existing: keeps existing prices, adds new ones', () => {
    const imported = [
      { sourceRow: 2, type: 'elbow_90' as const, diameter: 2, price: 7.5 }, // exists
      { sourceRow: 3, type: 'elbow_90' as const, diameter: 4, price: 25 },   // new
    ];
    const merged = mergePriceOverrides(existing, imported, 'skip_existing');
    expect(merged.elbow_90![2]).toBe(5.0);   // kept
    expect(merged.elbow_90![4]).toBe(25);    // added
  });

  it('overwrite_all: replaces entire record with imported set', () => {
    const imported = [
      { sourceRow: 2, type: 'elbow_90' as const, diameter: 2, price: 99 },
    ];
    const merged = mergePriceOverrides(existing, imported, 'overwrite_all');
    // bend_45 + elbow_90.3 are gone
    expect(merged.bend_45).toBeUndefined();
    expect(merged.elbow_90![3]).toBeUndefined();
    expect(merged.elbow_90![2]).toBe(99);
  });

  it('merge returns new object (does not mutate existing)', () => {
    const imported = [
      { sourceRow: 2, type: 'elbow_90' as const, diameter: 2, price: 7.5 },
    ];
    mergePriceOverrides(existing, imported, 'replace');
    // Original untouched
    expect(existing.elbow_90[2]).toBe(5.0);
  });

  it('empty imported set is a no-op for replace + skip', () => {
    expect(mergePriceOverrides(existing, [], 'replace')).toEqual(existing);
    expect(mergePriceOverrides(existing, [], 'skip_existing')).toEqual(existing);
  });

  it('empty imported set + overwrite_all wipes profile', () => {
    expect(mergePriceOverrides(existing, [], 'overwrite_all')).toEqual({});
  });
});

// ── End-to-end: CSV → mapped rows → merged overrides ─────────

describe('end-to-end integration', () => {
  it('CSV-shaped rows map + merge into a clean profile', () => {
    const rows = [
      { Type: 'elbow_90', Size: '2', Price: '5.00' },
      { Type: 'bend_45',  Size: '3/4', Price: '$2.15' },
      { Type: 'unknown',  Size: '1',   Price: '3.00' },
    ];
    const mapping: PriceListMapping = {
      typeColumn: 'Type', diameterColumn: 'Size', priceColumn: 'Price',
    };
    const mapped = mapPriceListRows(rows, mapping);
    expect(mapped.summary).toEqual({ total: 3, accepted: 2, rejected: 1 });

    const merged = mergePriceOverrides({}, mapped.rows, 'replace');
    expect(merged.elbow_90![2]).toBe(5.0);
    expect(merged.bend_45![0.75]).toBe(2.15);
  });
});
