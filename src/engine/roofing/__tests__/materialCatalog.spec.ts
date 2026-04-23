/**
 * Material Catalog — Phase 14.R.2.
 *
 * Locks the CSV parser + catalog lookups + catalog→RoofingPrices
 * bridge. The default catalog contents are baked into the module
 * at build time from AROYH's `data/materials.csv` + `pricing.csv`,
 * so these tests also serve as a snapshot on those numbers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseCsv,
  buildCatalog,
  defaultCatalog,
  setActiveCatalog,
  resetToDefaultCatalog,
  getAllMaterials,
  getMaterial,
  getPrice,
  getCoverage,
  getName,
  pricesFromCatalog,
  CANONICAL_MATERIAL_IDS,
  type MaterialEntry,
} from '../materialCatalog';
import { estimatePricing, estimateMaterials } from '../calcEngine';
import type { RoofSectionLike } from '../calcEngine';

// Each test starts from a clean default catalog.
beforeEach(() => resetToDefaultCatalog());

// ── CSV parser ──────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses a minimal CSV with header + rows', () => {
    const rows = parseCsv('a,b,c\n1,2,3\n4,5,6', ['a', 'b', 'c']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ a: '1', b: '2', c: '3' });
    expect(rows[1]).toEqual({ a: '4', b: '5', c: '6' });
  });

  it('trims whitespace in values', () => {
    const rows = parseCsv('a,b\n  hello , world', ['a', 'b']);
    expect(rows[0]).toEqual({ a: 'hello', b: 'world' });
  });

  it('handles CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n3,4', ['a', 'b']);
    expect(rows).toHaveLength(2);
  });

  it('skips blank lines at the end', () => {
    const rows = parseCsv('a\n1\n\n\n', ['a']);
    expect(rows).toHaveLength(1);
  });

  it('skips rows with too few columns', () => {
    // Row "2" has only 1 column; skipped.
    const rows = parseCsv('a,b\n1,x\n2\n3,y', ['a', 'b']);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.a)).toEqual(['1', '3']);
  });

  it('throws if a required column is missing', () => {
    expect(() => parseCsv('a,b\n1,2', ['a', 'c']))
      .toThrow(/missing required column 'c'/);
  });

  it('empty input returns empty array', () => {
    expect(parseCsv('', ['a'])).toEqual([]);
  });
});

// ── Default catalog contents ────────────────────────────────────

describe('default catalog (baked from AROYH data)', () => {
  it('contains 12 canonical materials', () => {
    const cat = defaultCatalog();
    expect(cat).toHaveLength(CANONICAL_MATERIAL_IDS.length);
    expect(cat.length).toBe(12);
  });

  it('material IDs match CANONICAL_MATERIAL_IDS in order', () => {
    const cat = defaultCatalog();
    expect(cat.map((m) => m.materialId)).toEqual([...CANONICAL_MATERIAL_IDS]);
  });

  it('architectural shingles price ≈ $36.99 per bundle', () => {
    const m = defaultCatalog().find((x) => x.materialId === 'SHG-ARCH')!;
    expect(m.unitPrice).toBeCloseTo(36.99, 2);
    expect(m.unit).toBe('BDL');
    expect(m.coverage).toBeCloseTo(33.3, 2);
  });

  it('drip edge: per-piece pricing, 10 LF coverage', () => {
    const m = defaultCatalog().find((x) => x.materialId === 'DRP-10')!;
    expect(m.unit).toBe('PCS');
    expect(m.coverage).toBe(10);
    expect(m.coverageUnit).toBe('LF/PCS');
  });

  it('ice & water: roll unit, 200 SF coverage', () => {
    const m = defaultCatalog().find((x) => x.materialId === 'ICE-200')!;
    expect(m.unit).toBe('RLL');
    expect(m.coverage).toBe(200);
  });

  it('Spanish names are populated for all canonical materials', () => {
    for (const entry of defaultCatalog()) {
      expect(entry.nameEs.length).toBeGreaterThan(0);
    }
  });

  it('all materials carry a supplier (Home Depot by default)', () => {
    for (const entry of defaultCatalog()) {
      expect(entry.supplier).toBe('Home Depot');
    }
  });

  it('every canonical material has a positive price', () => {
    for (const entry of defaultCatalog()) {
      expect(entry.unitPrice).toBeGreaterThan(0);
    }
  });
});

// ── Active catalog singleton + overrides ────────────────────────

describe('active catalog + override API', () => {
  it('getAllMaterials returns a SNAPSHOT (caller mutations don\'t leak)', () => {
    const a = getAllMaterials();
    a.pop();
    // After popping the snapshot, the real catalog is unchanged.
    expect(getAllMaterials().length).toBe(12);
  });

  it('getMaterial by ID returns full entry', () => {
    const m = getMaterial('SHG-ARCH');
    expect(m).toBeDefined();
    expect(m!.unitPrice).toBeCloseTo(36.99, 2);
  });

  it('getMaterial on unknown ID returns undefined', () => {
    expect(getMaterial('DOES-NOT-EXIST')).toBeUndefined();
  });

  it('getPrice with fallback', () => {
    expect(getPrice('SHG-ARCH')).toBeCloseTo(36.99, 2);
    expect(getPrice('MISSING', 99.99)).toBeCloseTo(99.99, 2);
    expect(getPrice('MISSING')).toBe(0);
  });

  it('getCoverage with fallback', () => {
    expect(getCoverage('SHG-ARCH')).toBeCloseTo(33.3, 2);
    expect(getCoverage('MISSING', 10)).toBe(10);
  });

  it('getName returns EN by default, ES on request', () => {
    expect(getName('SHG-ARCH')).toBe('Architectural Shingles');
    expect(getName('SHG-ARCH', 'es')).toBe('Tejas Arquitectonicas');
  });

  it('getName falls back to the ID if the entry is missing', () => {
    expect(getName('MISSING')).toBe('MISSING');
  });

  it('setActiveCatalog replaces the active catalog + index', () => {
    setActiveCatalog([{
      materialId: 'CUSTOM-ITEM',
      nameEn: 'Custom',
      nameEs: 'Custom ES',
      unit: 'EA',
      coverage: 1,
      coverageUnit: 'EA',
      description: 'Test',
      unitPrice: 5,
      supplier: 'Test',
      sku: 'T-001',
      notes: '',
    }]);
    expect(getAllMaterials()).toHaveLength(1);
    expect(getMaterial('CUSTOM-ITEM')?.unitPrice).toBe(5);
    expect(getMaterial('SHG-ARCH')).toBeUndefined();
  });

  it('resetToDefaultCatalog restores the baked-in defaults', () => {
    setActiveCatalog([]);
    expect(getAllMaterials()).toHaveLength(0);
    resetToDefaultCatalog();
    expect(getAllMaterials()).toHaveLength(12);
    expect(getMaterial('SHG-ARCH')?.unitPrice).toBeCloseTo(36.99, 2);
  });
});

// ── buildCatalog from raw CSVs ──────────────────────────────────

describe('buildCatalog', () => {
  it('joins materials + pricing by material_id', () => {
    const materials = `material_id,name,name_es,unit,coverage,coverage_unit,description
A,Alpha,Alfa,PCS,1,EA,Test A
B,Beta,Beta,PCS,1,EA,Test B`;
    const pricing = `material_id,unit_price,supplier,sku,notes
A,10.00,Acme,A-001,Notes A`;
    const cat = buildCatalog(materials, pricing);
    expect(cat).toHaveLength(2);
    expect(cat[0]!.unitPrice).toBe(10);
    expect(cat[0]!.supplier).toBe('Acme');
    // B has no pricing row — defaults to 0, empty supplier.
    expect(cat[1]!.unitPrice).toBe(0);
    expect(cat[1]!.supplier).toBe('');
  });

  it('non-numeric coverage / price fall back to 0', () => {
    const materials = `material_id,name,name_es,unit,coverage,coverage_unit,description
X,X,X,PCS,not-a-number,EA,Test`;
    const pricing = `material_id,unit_price,supplier,sku,notes
X,not-a-number,Acme,SKU,Notes`;
    const cat = buildCatalog(materials, pricing);
    expect(cat[0]!.coverage).toBe(0);
    expect(cat[0]!.unitPrice).toBe(0);
  });
});

// ── pricesFromCatalog bridge ────────────────────────────────────

describe('pricesFromCatalog → RoofingPrices bridge', () => {
  it('returns entries for all 8 canonical pricing keys', () => {
    const p = pricesFromCatalog();
    // Shingle_bundle keyed from SHG-ARCH.
    expect(p.shingle_bundle).toBeCloseTo(36.99, 2);
    expect(p.drip_edge_10ft).toBeCloseTo(5.49, 2);
    expect(p.starter_bundle).toBeCloseTo(22.99, 2);
    expect(p.ridge_cap_bundle).toBeCloseTo(34.99, 2);
    expect(p.felt_roll).toBeCloseTo(21.99, 2);
    expect(p.synthetic_roll).toBeCloseTo(89.99, 2);
    expect(p.ice_water_roll).toBeCloseTo(44.99, 2);
    expect(p.roofing_nails_lb).toBeCloseTo(6.49, 2);
  });

  it('returns a Partial — non-catalog keys are OMITTED', () => {
    const p = pricesFromCatalog();
    expect(p.plywood_sheet).toBeUndefined();
    expect(p.fascia_board_lf).toBeUndefined();
    expect(p.drip_edge_metal).toBeUndefined();
  });

  it('zero-priced catalog entries are skipped (fall through to defaults)', () => {
    setActiveCatalog([{
      materialId: 'SHG-ARCH',
      nameEn: 'Free', nameEs: 'Gratis', unit: 'BDL',
      coverage: 33.3, coverageUnit: 'SF/BDL', description: '',
      unitPrice: 0, supplier: '', sku: '', notes: '',
    }]);
    const p = pricesFromCatalog();
    // shingle_bundle skipped → not present in the Partial
    expect(p.shingle_bundle).toBeUndefined();
  });
});

// ── End-to-end: catalog-sourced prices flow into estimatePricing ─

describe('estimatePricing with pricesFromCatalog()', () => {
  const sampleSection: RoofSectionLike = {
    sectionId: 'S1',
    label: 'Sample',
    x: 0, y: 0,
    length: 40, run: 30,
    slope: 6,
    roofType: 'gable',
    overhang: 1,
    areaActual: 1500,
    perimeterPlan: 140,
    ridgeLength: 40,
  };

  it('catalog-sourced prices change the total cost vs defaults', () => {
    const materials = estimateMaterials([sampleSection]);
    const defaultPrice = estimatePricing(materials);
    const catalogPrice = estimatePricing(materials, {
      prices: pricesFromCatalog(),
    });
    // Catalog prices are HIGHER (36.99 vs 35.00 default for shingles,
    // etc.) so the catalog total is greater.
    expect(catalogPrice.materialCost).not.toEqual(defaultPrice.materialCost);
    expect(catalogPrice.total).not.toEqual(defaultPrice.total);
  });

  it('swapping the active catalog changes subsequent price lookups', () => {
    const materials = estimateMaterials([sampleSection]);
    const before = estimatePricing(materials, {
      prices: pricesFromCatalog(),
    });

    // Simulate a user-imported vendor catalog with cheaper shingles.
    setActiveCatalog([
      {
        materialId: 'SHG-ARCH',
        nameEn: 'Arch', nameEs: 'Arch', unit: 'BDL',
        coverage: 33.3, coverageUnit: 'SF/BDL', description: '',
        unitPrice: 20.00, supplier: 'Cheap Co', sku: 'X', notes: '',
      },
    ]);

    const after = estimatePricing(materials, {
      prices: pricesFromCatalog(),
    });
    expect(after.materialCost).toBeLessThan(before.materialCost);
  });
});
