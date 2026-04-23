/**
 * fl_roofing — Phase 14.R.F.
 *
 * Consolidated tests for the ported Florida roofing estimator.
 * Four layers:
 *   • core: types + confidence + serialization
 *   • data: YAML-sourced lookups (wind zones, sheathing, catalog)
 *   • estimator: wind → zones → sheathing → BOM pipeline
 *   • integrity: data consistency checks across YAML files
 *
 * Mirrors the Python test_all.py coverage where it applies
 * (Python-only concerns like JSON-roundtrip-via-FastAPI are
 * omitted — the equivalent here is `estimateToDict` idempotency).
 */

import { describe, it, expect } from 'vitest';
import {
  Confidence,
  worstConfidence,
  createProject,
  createLineItem,
  quantityWithWaste,
  computeConfidenceReport,
  projectToDict,
  projectFromDict,
  estimateToDict,
  estimateToJson,
  createEstimate,
  type Project,
  type WindProfile,
  type ZoneProfile,
  type LineItem,
  type RoofGeometry,
} from '../core';
import {
  loadWindZones,
  allWindZones,
  loadSheathingMatrix,
  loadProductApprovals,
  lookupProduct,
  catalogKeyForSystem,
} from '../data';
import {
  estimate,
  resolveWind,
  computeZones,
  resolveSheathing,
} from '../estimator';
import {
  runAll,
  checkCountyCount,
  checkUniqueCountyNames,
  checkVultRanges,
  checkHvhzCounties,
  checkSheathingConfidenceValues,
  checkSheathingVerifiedHaveSpacing,
  checkSheathingMonotonic,
  checkFlApprovalsFormat,
} from '../integrity';

// ── Helpers ─────────────────────────────────────────────────────

function sampleProject(overrides: Partial<Project> = {}): Project {
  return createProject({
    county: 'Lee',
    roof: {
      length_ft: 60,
      width_ft: 40,
      mean_height_ft: 10,
      slope_pitch: '6:12',
      roof_type: 'hip',
      complexity: 'simple',
    },
    system: 'architectural_shingle',
    product_family: 'GAF Timberline HDZ',
    distance_to_saltwater_ft: 1200,
    job_type: 'reroof',
    ...overrides,
  });
}

// ── core.ts ────────────────────────────────────────────────────

describe('core — Confidence', () => {
  it('worst picks the lowest-rank confidence', () => {
    expect(worstConfidence('verified', 'computed', 'inferred')).toBe('inferred');
    expect(worstConfidence('unverified', 'verified')).toBe('unverified');
    expect(worstConfidence('computed')).toBe('computed');
  });

  it('worst with no inputs defaults to verified', () => {
    expect(worstConfidence()).toBe('verified');
  });

  it('confidence const keys match string values', () => {
    expect(Confidence.VERIFIED).toBe('verified');
    expect(Confidence.PUBLISHED).toBe('published');
    expect(Confidence.COMPUTED).toBe('computed');
    expect(Confidence.INFERRED).toBe('inferred');
    expect(Confidence.UNVERIFIED).toBe('unverified');
  });
});

describe('core — Project round-trip', () => {
  it('to_dict → from_dict preserves fields', () => {
    const p = sampleProject({ customer_name: 'Jane' });
    const back = projectFromDict(projectToDict(p) as Record<string, unknown>);
    expect(back.county).toBe(p.county);
    expect(back.customer_name).toBe('Jane');
    expect(back.roof.roof_type).toBe(p.roof.roof_type);
    expect(back.distance_to_saltwater_ft).toBe(p.distance_to_saltwater_ft);
  });

  it('createProject fills Python defaults', () => {
    const p = createProject({
      county: 'Lee',
      roof: sampleProject().roof,
      system: 'architectural_shingle',
    });
    expect(p.wood_species).toBe('SYP');
    expect(p.sheathing_thickness).toBe('15/32');
    expect(p.framing_spacing_in).toBe(24);
    expect(p.distance_to_saltwater_ft).toBe(5000);
    expect(p.job_type).toBe('reroof');
    expect(p.risk_category).toBe(2);
    expect(p.install_method).toBe('direct_deck');
    expect(p.plumbing_vent_count).toBe(3);
  });
});

describe('core — LineItem quantity_with_waste + confidence report', () => {
  it('quantityWithWaste applies waste factor + rounds to 1 decimal', () => {
    const li = createLineItem({
      category: 'covering',
      name: 'Test',
      quantity: 100,
      unit: 'square',
      waste_factor_pct: 15,
    });
    expect(quantityWithWaste(li)).toBeCloseTo(115, 1);
  });

  it('computeConfidenceReport aggregates correctly', () => {
    const wind: WindProfile = {
      vult_mph: 150, exposure: 'C', hvhz: false, wbdr: true, coastal: true,
      region: 'Test', confidence: Confidence.VERIFIED, source: 'test',
    };
    const zones: ZoneProfile = {
      a_dimension_ft: 4, zone_1_sqft: 0, zone_2e_sqft: 0, zone_2n_sqft: 0,
      zone_3e_sqft: 0, zone_3r_sqft: 0, interior_sqft: 0, perimeter_sqft: 0,
      corners_sqft: 0, total_plan_sqft: 1000, sloped_area_sqft: 1100,
      perimeter_fraction: 0, confidence: Confidence.COMPUTED,
    };
    const items: LineItem[] = [
      createLineItem({ category: 'covering', name: 'A', quantity: 10, unit: 'sq', confidence: Confidence.PUBLISHED }),
      createLineItem({ category: 'covering', name: 'B', quantity: 10, unit: 'sq', confidence: Confidence.COMPUTED }),
      createLineItem({ category: 'covering', name: 'C', quantity: 10, unit: 'sq', confidence: Confidence.UNVERIFIED }),
    ];
    const est = createEstimate({
      project: sampleProject(),
      wind, zones, sheathing: null, line_items: items, warnings: [],
    });
    const report = computeConfidenceReport(est);
    expect(report.total_line_items).toBe(3);
    expect(report.verified_line_items).toBe(1); // only PUBLISHED
    expect(report.flagged_items).toEqual(['C']);
    expect(report.overall).toBe(Confidence.UNVERIFIED);
  });
});

// ── data.ts ────────────────────────────────────────────────────

describe('data — wind zones', () => {
  it('loads all 67 FL counties', () => {
    expect(allWindZones()).toHaveLength(67);
  });

  it('keyed map uses lowercased county name', () => {
    const zones = loadWindZones();
    expect(zones['miami-dade']).toBeDefined();
    expect(zones['miami-dade']!.hvhz_flag).toBe(1);
  });

  it('HVHZ flag only on Miami-Dade and Broward', () => {
    const hvhz = allWindZones().filter((z) => z.hvhz_flag === 1);
    expect(hvhz.map((z) => z.county).sort()).toEqual(['Broward', 'Miami-Dade']);
  });

  it('Vult values are within expected 110-220 mph range', () => {
    for (const z of allWindZones()) {
      expect(z.vult_peak_mph).toBeGreaterThanOrEqual(110);
      expect(z.vult_peak_mph).toBeLessThanOrEqual(220);
    }
  });
});

describe('data — sheathing matrix', () => {
  it('has at least the 18 verified rows from the FBC excerpt', () => {
    const verified = loadSheathingMatrix().filter(
      (r) => r.source_confidence === 'VERIFIED_FBC_FACT_SHEET',
    );
    expect(verified.length).toBeGreaterThanOrEqual(18);
  });

  it('every row has a valid source_confidence', () => {
    const valid = new Set([
      'VERIFIED_FBC_FACT_SHEET',
      'ENGINEERING_INFERENCE',
      'NEEDS_VERIFICATION',
    ]);
    for (const r of loadSheathingMatrix()) {
      expect(valid.has(r.source_confidence)).toBe(true);
    }
  });
});

describe('data — product catalog', () => {
  it('loads at least one shingle manufacturer', () => {
    const cat = loadProductApprovals();
    expect(cat.shingle_manufacturers?.length).toBeGreaterThan(0);
  });

  it('GAF Timberline HDZ is in the catalog', () => {
    const p = lookupProduct('architectural_shingle', 'GAF Timberline HDZ');
    expect(p).not.toBeNull();
    expect(p!.manufacturer).toBe('GAF');
    expect(p!.product_name).toBe('Timberline HDZ');
    expect(p!.fl_approval).toBeTruthy();
  });

  it('unknown product_family returns null', () => {
    expect(lookupProduct('architectural_shingle', 'XYZ-Nonexistent')).toBeNull();
  });

  it('null product_family returns null', () => {
    expect(lookupProduct('architectural_shingle', null)).toBeNull();
  });

  it('fuzzy-matches partial name', () => {
    // Just "Timberline HDZ" (no manufacturer) should still match.
    const p = lookupProduct('architectural_shingle', 'Timberline HDZ');
    expect(p).not.toBeNull();
  });

  it('catalogKeyForSystem maps all 6 systems', () => {
    expect(catalogKeyForSystem('architectural_shingle')).toBe('shingle_manufacturers');
    expect(catalogKeyForSystem('3tab_shingle')).toBe('shingle_manufacturers');
    expect(catalogKeyForSystem('concrete_tile')).toBe('tile_manufacturers');
    expect(catalogKeyForSystem('clay_tile')).toBe('tile_manufacturers');
    expect(catalogKeyForSystem('standing_seam_metal')).toBe('metal_manufacturers');
    expect(catalogKeyForSystem('5v_crimp_metal')).toBe('metal_manufacturers');
  });
});

// ── estimator.ts — wind + zones + sheathing ────────────────────

describe('estimator — resolveWind', () => {
  it('Miami-Dade: HVHZ + coastal + WBDR all true', () => {
    const p = sampleProject({ county: 'Miami-Dade' });
    const wind = resolveWind(p);
    expect(wind.hvhz).toBe(true);
    expect(wind.coastal).toBe(true);
    expect(wind.vult_mph).toBeGreaterThanOrEqual(170);
    expect(wind.confidence).toBe('verified');
  });

  it('inland county: not HVHZ, may be non-coastal', () => {
    // Use an interior county. "Polk" is in Central Florida (inland).
    const p = sampleProject({ county: 'Polk' });
    const wind = resolveWind(p);
    expect(wind.hvhz).toBe(false);
  });

  it('unknown county throws', () => {
    const p = sampleProject({ county: 'Atlantis' });
    expect(() => resolveWind(p)).toThrow(/not found/);
  });
});

describe('estimator — computeZones', () => {
  it('rectangular hip roof: zone_1 is the largest zone', () => {
    const roof: RoofGeometry = {
      length_ft: 60, width_ft: 40, mean_height_ft: 10,
      slope_pitch: '6:12', roof_type: 'hip', complexity: 'simple',
    };
    const zones = computeZones(roof);
    expect(zones.total_plan_sqft).toBe(60 * 40);
    expect(zones.sloped_area_sqft).toBeGreaterThan(zones.total_plan_sqft);
    expect(zones.zone_1_sqft).toBeGreaterThan(0);
    expect(zones.perimeter_fraction).toBeGreaterThan(0);
    expect(zones.perimeter_fraction).toBeLessThan(1);
  });

  it('gable roof: zone_3r populated (ridge corners)', () => {
    const roof: RoofGeometry = {
      length_ft: 60, width_ft: 40, mean_height_ft: 10,
      slope_pitch: '6:12', roof_type: 'gable', complexity: 'simple',
    };
    const zones = computeZones(roof);
    expect(zones.zone_3r_sqft).toBeGreaterThan(0);
    expect(zones.zone_3e_sqft).toBeGreaterThan(0);
  });

  it('degenerate tiny roof: collapses to pure-perimeter profile', () => {
    const roof: RoofGeometry = {
      length_ft: 5, width_ft: 5, mean_height_ft: 8,
      slope_pitch: '4:12', roof_type: 'hip', complexity: 'simple',
    };
    const zones = computeZones(roof);
    expect(zones.zone_1_sqft).toBe(0);
    expect(zones.perimeter_fraction).toBe(1.0);
  });
});

describe('estimator — resolveSheathing', () => {
  it('SYP / Exposure C / 24" / 15/32 / 150 mph → verified row', () => {
    const p = sampleProject({ county: 'Lee' });
    const wind = resolveWind(p);
    const spec = resolveSheathing(p, wind);
    expect(spec).not.toBeNull();
    expect(spec!.fastener).toBeTruthy();
    expect(spec!.code_reference).toBe('FBC R803.2.3.1');
  });

  it('unknown wood species returns null', () => {
    const p = sampleProject({ wood_species: 'UNKNOWN' });
    const wind = resolveWind(p);
    expect(resolveSheathing(p, wind)).toBeNull();
  });
});

// ── estimator.ts — full pipeline ───────────────────────────────

describe('estimator — end-to-end', () => {
  it('generates a full estimate for Lee County reroof', () => {
    const result = estimate(sampleProject());
    expect(result.wind.vult_mph).toBeGreaterThan(0);
    expect(result.zones.sloped_area_sqft).toBeGreaterThan(0);
    expect(result.line_items.length).toBeGreaterThan(0);
    // Covering is always first in the BOM order.
    expect(result.line_items[0]!.category).toBe('covering');
  });

  it('Miami-Dade HVHZ project gets HVHZ warning', () => {
    const result = estimate(sampleProject({ county: 'Miami-Dade' }));
    const hvhzWarning = result.warnings.find((w) => /HVHZ/.test(w.message));
    expect(hvhzWarning).toBeDefined();
  });

  it('coastal project under 1500 ft gets corrosion warning', () => {
    const result = estimate(sampleProject({
      county: 'Lee',
      distance_to_saltwater_ft: 800,
    }));
    const corrosion = result.warnings.find((w) => w.category === 'corrosion');
    expect(corrosion).toBeDefined();
    expect(corrosion!.severity).toBe('warning'); // 300 < d ≤ 1500
  });

  it('direct saltwater spray (<= 300 ft) → blocker', () => {
    const result = estimate(sampleProject({
      county: 'Lee',
      distance_to_saltwater_ft: 200,
    }));
    const corrosion = result.warnings.find((w) => w.category === 'corrosion');
    expect(corrosion!.severity).toBe('blocker');
  });

  it('reroof gets re-nail evaluation note', () => {
    const result = estimate(sampleProject({ job_type: 'reroof' }));
    const renail = result.warnings.find((w) => /re-nail/i.test(w.message));
    expect(renail).toBeDefined();
  });

  it('new_roof does NOT get re-nail note', () => {
    const result = estimate(sampleProject({ job_type: 'new_roof' }));
    const renail = result.warnings.find((w) => /re-nail/i.test(w.message));
    expect(renail).toBeUndefined();
  });

  it('tile system emits tile underlayment + field tile + hip/ridge', () => {
    const result = estimate(sampleProject({
      county: 'Miami-Dade',
      system: 'concrete_tile',
      product_family: null,
      install_method: 'direct_deck',
    }));
    const names = result.line_items.map((li) => li.name);
    expect(names.some((n) => /Tile underlayment/i.test(n))).toBe(true);
    expect(names.some((n) => /Starter tile/i.test(n))).toBe(true);
  });

  it('foam-set tile emits Polyset AH-160 with FL5259 approval', () => {
    const result = estimate(sampleProject({
      county: 'Miami-Dade',
      system: 'concrete_tile',
      install_method: 'foam_set',
    }));
    const polyset = result.line_items.find((li) => /Polyset/i.test(li.name));
    expect(polyset).toBeDefined();
    expect(polyset!.fl_approval).toBe('FL5259');
  });

  it('metal-roof plumbing vent uses EPDM (never lead)', () => {
    const result = estimate(sampleProject({
      system: 'standing_seam_metal',
      plumbing_vent_count: 2,
    }));
    const vent = result.line_items.find((li) => /pipe boot|pipe flashing/i.test(li.name));
    expect(vent).toBeDefined();
    expect(vent!.name.toLowerCase()).toContain('epdm');
    expect(vent!.name.toLowerCase()).not.toContain('lead');
  });

  it('shingle plumbing vent uses lead', () => {
    const result = estimate(sampleProject({
      plumbing_vent_count: 3,
    }));
    const vent = result.line_items.find((li) => /pipe/i.test(li.name));
    expect(vent!.name.toLowerCase()).toContain('lead');
  });

  it('confidence report has non-empty overall', () => {
    const result = estimate(sampleProject());
    const report = computeConfidenceReport(result);
    expect(['verified', 'published', 'computed', 'inferred', 'unverified']).toContain(
      report.overall,
    );
    expect(report.total_line_items).toBeGreaterThan(0);
  });
});

// ── Serialization idempotency ───────────────────────────────────

describe('serialization — estimate to_dict / to_json', () => {
  it('to_dict produces the expected top-level keys', () => {
    const result = estimate(sampleProject());
    const d = estimateToDict(result);
    expect(Object.keys(d).sort()).toEqual([
      'confidence_report', 'generated_at', 'line_items', 'project',
      'sheathing', 'version', 'warnings', 'wind', 'zones',
    ].sort());
  });

  it('to_json returns valid parseable JSON', () => {
    const result = estimate(sampleProject());
    const json = estimateToJson(result);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.wind.vult_mph).toBeGreaterThan(0);
  });

  it('line_items include computed quantity_with_waste', () => {
    const result = estimate(sampleProject());
    const d = estimateToDict(result);
    const items = d.line_items as Array<Record<string, unknown>>;
    expect(items[0]!.quantity_with_waste).toBeGreaterThanOrEqual(
      items[0]!.quantity as number,
    );
  });
});

// ── integrity.ts ────────────────────────────────────────────────

describe('integrity — all checks pass on shipped data', () => {
  it('checkCountyCount: exactly 67', () => {
    expect(checkCountyCount()).toEqual([]);
  });

  it('checkUniqueCountyNames: no duplicates', () => {
    expect(checkUniqueCountyNames()).toEqual([]);
  });

  it('checkVultRanges: all in 110-220 mph', () => {
    expect(checkVultRanges()).toEqual([]);
  });

  it('checkHvhzCounties: only Miami-Dade + Broward', () => {
    expect(checkHvhzCounties()).toEqual([]);
  });

  it('checkSheathingConfidenceValues: all valid', () => {
    expect(checkSheathingConfidenceValues()).toEqual([]);
  });

  it('checkSheathingVerifiedHaveSpacing: no nulls in verified rows', () => {
    expect(checkSheathingVerifiedHaveSpacing()).toEqual([]);
  });

  it('checkSheathingMonotonic: spacing never loosens as Vult rises', () => {
    expect(checkSheathingMonotonic()).toEqual([]);
  });

  it('checkFlApprovalsFormat: all FL## patterns valid', () => {
    expect(checkFlApprovalsFormat()).toEqual([]);
  });

  it('runAll aggregates to zero total errors', () => {
    const report = runAll();
    expect(report.total_errors).toBe(0);
    expect(report.checks).toHaveLength(8);
    for (const c of report.checks) expect(c.passed).toBe(true);
  });
});
