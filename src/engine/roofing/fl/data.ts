/**
 * fl_roofing.data — Phase 14.R.F.2.
 *
 * Typed loaders for the Florida roofing YAML data. The raw YAML
 * files were converted to JSON once (see `data/*.json`) and are
 * imported here via TS's `resolveJsonModule`. Module-local caches
 * match the Python `_WIND_ZONES_CACHE` etc. so each lookup table
 * builds exactly once per session.
 *
 * If a user imports their own refreshed product catalog (e.g. a
 * monthly FL# scraper), call `setProductApprovals(json)` to swap
 * the active catalog at runtime.
 *
 * Source refs:
 *   C:\Users\Owner\Downloads\roofs\extracted\fl_roofing\data\wind_zones.yaml
 *   C:\Users\Owner\Downloads\roofs\extracted\fl_roofing\data\sheathing_matrix.yaml
 *   C:\Users\Owner\Downloads\roofs\extracted\fl_roofing\data\product_approvals.yaml
 */

import windZonesRaw from './data/wind_zones.json';
import sheathingMatrixRaw from './data/sheathing_matrix.json';
import productApprovalsRaw from './data/product_approvals.json';

// ── Wind zones ──────────────────────────────────────────────────

export interface WindZoneRow {
  id: number;
  county: string;
  region: string;
  vult_peak_mph: number;
  wbdr_flag: number;
  hvhz_flag: number;
  coastal_flag: number;
  exposure_default: string;
  notes?: string;
}

interface WindZonesFile {
  wind_zones: WindZoneRow[];
}

let _windZonesCache: Record<string, WindZoneRow> | null = null;

/** Load all wind zones as a county-keyed map (county name lowercased). */
export function loadWindZones(): Record<string, WindZoneRow> {
  if (_windZonesCache) return _windZonesCache;
  const rows = (windZonesRaw as WindZonesFile).wind_zones;
  const map: Record<string, WindZoneRow> = {};
  for (const row of rows) {
    map[row.county.toLowerCase()] = row;
  }
  _windZonesCache = map;
  return map;
}

/** All wind-zone rows as an array (in source order). Useful for
 *  integrity checks + the /counties endpoint in the Python API. */
export function allWindZones(): WindZoneRow[] {
  return [...(windZonesRaw as WindZonesFile).wind_zones];
}

// ── Sheathing attachment matrix (R803.2.3.1) ────────────────────

export type SheathingSourceConfidence =
  | 'VERIFIED_FBC_FACT_SHEET'
  | 'ENGINEERING_INFERENCE'
  | 'NEEDS_VERIFICATION';

export interface SheathingRow {
  id: number;
  vult_mph: number;
  exposure: string;
  wood_sg: number;
  framing_spacing_in: number;
  sheathing_thickness: string;
  fastener_ref: string;
  panel_edge_spacing_in: number | null;
  panel_field_spacing_in: number | null;
  interior_zone_override_in: number;
  source_confidence: SheathingSourceConfidence;
}

interface SheathingMatrixFile {
  sheathing_attachment_matrix_v2: SheathingRow[];
}

let _sheathingCache: SheathingRow[] | null = null;

/** Load all sheathing rows (in source order). */
export function loadSheathingMatrix(): SheathingRow[] {
  if (_sheathingCache) return _sheathingCache;
  const data = sheathingMatrixRaw as SheathingMatrixFile;
  _sheathingCache = [...data.sheathing_attachment_matrix_v2];
  return _sheathingCache;
}

// ── Product approvals catalog ───────────────────────────────────

export interface ProductLine {
  name: string;
  profile?: string | null;
  material?: string | null;
  warranty_years?: number | null;
  wind_rating?: string | null;
  fl_approval_prefix?: string | null;
  noa_number?: string | null;
  /** Arbitrary extra fields carried through verbatim. */
  [key: string]: unknown;
}

export interface ProductManufacturer {
  id: number;
  manufacturer: string;
  parent?: string;
  headquarters?: string;
  product_lines: ProductLine[];
  master_fl_approval?: string;
  master_noa?: string;
  typical_refresh_cycle_years?: number;
}

export interface ProductApprovalsFile {
  catalog_refresh_metadata?: {
    generated_date?: string;
    next_refresh_due?: string;
    state_search_url?: string;
    miami_dade_search_url?: string;
    notes?: string;
  };
  shingle_manufacturers?: ProductManufacturer[];
  tile_manufacturers?: ProductManufacturer[];
  metal_manufacturers?: ProductManufacturer[];
  underlayment_manufacturers?: ProductManufacturer[];
}

let _productApprovalsCache: ProductApprovalsFile | null = null;

/** Load the product approvals catalog (all manufacturer families). */
export function loadProductApprovals(): ProductApprovalsFile {
  if (_productApprovalsCache) return _productApprovalsCache;
  _productApprovalsCache = productApprovalsRaw as ProductApprovalsFile;
  return _productApprovalsCache;
}

/** Replace the active product approvals catalog — e.g. when a user
 *  imports a fresh scrape. Subsequent lookups see the new data. */
export function setProductApprovals(data: ProductApprovalsFile): void {
  _productApprovalsCache = data;
}

/** Reset to the baked-in catalog. */
export function resetProductApprovals(): void {
  _productApprovalsCache = productApprovalsRaw as ProductApprovalsFile;
}

/** Clear all caches — useful for tests. */
export function _resetDataCaches(): void {
  _windZonesCache = null;
  _sheathingCache = null;
  _productApprovalsCache = null;
}

// ── System → catalog-key map (from estimator.py) ────────────────

import type { SystemFL } from './core';

const SYSTEM_CATALOG_KEY: Record<SystemFL, keyof ProductApprovalsFile | null> = {
  architectural_shingle: 'shingle_manufacturers',
  '3tab_shingle': 'shingle_manufacturers',
  concrete_tile: 'tile_manufacturers',
  clay_tile: 'tile_manufacturers',
  standing_seam_metal: 'metal_manufacturers',
  '5v_crimp_metal': 'metal_manufacturers',
};

/** Resolve the catalog sub-list key for a given roofing system. */
export function catalogKeyForSystem(
  system: SystemFL,
): keyof ProductApprovalsFile | null {
  return SYSTEM_CATALOG_KEY[system] ?? null;
}

// ── Product fuzzy-match lookup (from estimator.py) ──────────────

export interface ProductMatch {
  manufacturer: string;
  product_name: string;
  fl_approval: string | null;
  noa_number: string | null;
  profile: string | null;
  material: string | null;
  warranty_years: number | null;
  wind_rating: string | null;
}

/**
 * Fuzzy-match a product family string against the catalog for the
 * given system. Matches on any of:
 *   - product-line name is a substring of the query
 *   - query is a substring of the product-line name
 *   - manufacturer name appears in the query AND any word from the
 *     product-line name appears in the query
 *
 * Returns the first match or null. Mirrors `_lookup_product()` in
 * the Python estimator.
 */
export function lookupProduct(
  system: SystemFL,
  productFamily: string | null | undefined,
): ProductMatch | null {
  if (!productFamily) return null;
  const key = catalogKeyForSystem(system);
  if (!key) return null;

  const catalog = loadProductApprovals();
  const manufacturers = (catalog[key] as ProductManufacturer[] | undefined) ?? [];
  const pfLower = productFamily.toLowerCase();

  for (const m of manufacturers) {
    const manuLower = m.manufacturer.toLowerCase();
    for (const line of m.product_lines ?? []) {
      const lineLower = line.name.toLowerCase();
      const match =
        lineLower.includes(pfLower)
        || pfLower.includes(lineLower)
        || (pfLower.includes(manuLower)
            && lineLower.split(/\s+/).some((w) => pfLower.includes(w)));
      if (match) {
        return {
          manufacturer: m.manufacturer,
          product_name: line.name,
          fl_approval:
            line.fl_approval_prefix ?? m.master_fl_approval ?? null,
          noa_number: line.noa_number ?? m.master_noa ?? null,
          profile: line.profile ?? null,
          material: line.material ?? null,
          warranty_years: line.warranty_years ?? null,
          wind_rating: line.wind_rating ?? null,
        };
      }
    }
  }
  return null;
}
