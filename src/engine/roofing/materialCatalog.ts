/**
 * Material Catalog — Phase 14.R.2.
 *
 * Port of AROYH's `data/materials.csv` + `data/pricing.csv` into a
 * runtime-queryable catalog. The default catalog is BAKED IN at
 * build time (CSV strings inlined below) so there's zero I/O at
 * module load + tests get deterministic data. A runtime override
 * API (`loadCatalog(csvText)`) lets users swap in vendor-specific
 * prices from a CSV file pick later.
 *
 * Source reference:
 *   C:\LOVEDECIDES\WiLeads\elbow_grease\roofing\data\materials.csv
 *   C:\LOVEDECIDES\WiLeads\elbow_grease\roofing\data\pricing.csv
 *
 * The **same schema** is preserved — material IDs (SHG-3TAB, etc.)
 * round-trip cleanly so user-supplied CSVs from the Python AROYH
 * can be imported unchanged.
 *
 * Schema:
 *   materials: material_id, name, name_es, unit, coverage,
 *              coverage_unit, description
 *   pricing:   material_id, unit_price, supplier, sku, notes
 *
 * Joined view (exposed to callers): `MaterialEntry` has all the
 * material fields + pricing fields, with price defaulting to 0
 * when a material is present in materials but absent in pricing.
 */

// ── Types ────────────────────────────────────────────────────────

/** Unit-of-measure — maps to the material's sale unit. */
export type MaterialUnit = 'BDL' | 'PCS' | 'RLL' | 'LB' | 'EA';

export interface MaterialEntry {
  /** Stable key (SHG-3TAB, DRP-10, …). */
  materialId: string;
  nameEn: string;
  nameEs: string;
  /** How this material is sold (bundle, piece, roll, pound, each). */
  unit: MaterialUnit;
  /** Numeric coverage — e.g. 33.3 for "33.3 SF per bundle". */
  coverage: number;
  /** Units of the coverage value (SF/BDL, LF/PCS, EA, …). */
  coverageUnit: string;
  /** Human-readable blurb. */
  description: string;
  /** Vendor-quoted unit price (USD). 0 if no pricing entry exists. */
  unitPrice: number;
  /** Vendor name (Home Depot, Lowes, Beacon, …). */
  supplier: string;
  /** Vendor SKU. */
  sku: string;
  /** Pricing notes (per bundle, per foot, …). */
  notes: string;
}

// ── Inlined defaults (baked at build time) ───────────────────────

const DEFAULT_MATERIALS_CSV = `material_id,name,name_es,unit,coverage,coverage_unit,description
SHG-3TAB,3-Tab Shingles,Tejas 3-Tab,BDL,33.3,SF/BDL,Standard 3-tab asphalt shingles
SHG-ARCH,Architectural Shingles,Tejas Arquitectonicas,BDL,33.3,SF/BDL,Dimensional laminated shingles
DRP-10,Drip Edge 10ft,Gotero 10 pies,PCS,10,LF/PCS,Aluminum drip edge 10-foot length
STR-105,Starter Strip,Tira Inicial,BDL,105,LF/BDL,Universal starter strip shingles
RDG-33,Ridge/Hip Cap,Cumbrera/Hip,BDL,33,LF/BDL,Hip and ridge cap shingles
FLT-15,Felt 15# Roll,Fieltro 15# Rollo,RLL,400,SF/RLL,15-pound asphalt felt underlayment
SYN-1000,Synthetic Underlayment,Subcapa Sintetica,RLL,1000,SF/RLL,Synthetic roof underlayment
ICE-200,Ice & Water Shield,Membrana Hielo/Agua,RLL,200,SF/RLL,Self-adhesive waterproofing membrane
NLS-RF,Roofing Nails,Clavos para Techo,LB,66.7,SF/LB,1.25-inch galvanized roofing nails
VNT-RIDGE,Ridge Vent,Ventila de Cumbrera,PCS,4,LF/PCS,Aluminum ridge vent 4-foot sections
FLS-STEP,Step Flashing,Tapajuntas Escalonado,PCS,1,EA,5x7 aluminum step flashing
FLS-PIPE,Pipe Boot,Bota de Tubo,PCS,1,EA,Neoprene pipe boot flashing`;

const DEFAULT_PRICING_CSV = `material_id,unit_price,supplier,sku,notes
SHG-3TAB,29.99,Home Depot,1001001,Per bundle
SHG-ARCH,36.99,Home Depot,1001002,Per bundle
DRP-10,5.49,Home Depot,1002001,10-foot piece
STR-105,22.99,Home Depot,1003001,Per bundle (105 LF)
RDG-33,34.99,Home Depot,1004001,Per bundle (33 LF)
FLT-15,21.99,Home Depot,1005001,Per roll (400 SF)
SYN-1000,89.99,Home Depot,1006001,Per roll (1000 SF)
ICE-200,44.99,Home Depot,1007001,Per roll (200 SF)
NLS-RF,6.49,Home Depot,1008001,Per pound
VNT-RIDGE,12.99,Home Depot,1009001,4-foot section
FLS-STEP,0.89,Home Depot,1010001,Each piece
FLS-PIPE,8.99,Home Depot,1011001,Each boot`;

// ── CSV parser (minimal, dependency-free) ────────────────────────

/**
 * Parse a CSV string (header row + N data rows). Handles the
 * AROYH data format: plain comma-separated values, no embedded
 * quotes / commas, LF or CRLF line endings, trailing blank lines
 * ignored. Numbers remain as string — type coercion is the
 * caller's responsibility.
 *
 * Throws if the header doesn't contain the required columns.
 */
export function parseCsv(
  text: string,
  requiredColumns: readonly string[],
): Array<Record<string, string>> {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0]!.split(',').map((h) => h.trim());
  for (const col of requiredColumns) {
    if (!headers.includes(col)) {
      throw new Error(
        `materialCatalog: CSV missing required column '${col}'. Got: ${headers.join(', ')}`,
      );
    }
  }
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split(',');
    if (parts.length < headers.length) continue; // skip malformed
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = (parts[j] ?? '').trim();
    }
    out.push(row);
  }
  return out;
}

// ── Catalog assembly ─────────────────────────────────────────────

/**
 * Join materials + pricing into unified `MaterialEntry` records.
 * Materials without a matching pricing row get `unitPrice: 0` +
 * empty supplier/sku/notes, matching the AROYH behavior (missing
 * prices show as $0 in the BOM panel rather than breaking the
 * calc pipeline).
 */
export function buildCatalog(
  materialsCsv: string,
  pricingCsv: string,
): MaterialEntry[] {
  const materials = parseCsv(materialsCsv, [
    'material_id', 'name', 'name_es', 'unit', 'coverage', 'coverage_unit', 'description',
  ]);
  const pricing = parseCsv(pricingCsv, [
    'material_id', 'unit_price', 'supplier', 'sku', 'notes',
  ]);
  const priceByMaterial: Record<string, typeof pricing[number]> = {};
  for (const row of pricing) {
    priceByMaterial[row.material_id!] = row;
  }

  const out: MaterialEntry[] = [];
  for (const row of materials) {
    const p = priceByMaterial[row.material_id!];
    out.push({
      materialId: row.material_id!,
      nameEn: row.name!,
      nameEs: row.name_es!,
      unit: row.unit as MaterialUnit,
      coverage: parseFloat(row.coverage!) || 0,
      coverageUnit: row.coverage_unit!,
      description: row.description!,
      unitPrice: p ? parseFloat(p.unit_price!) || 0 : 0,
      supplier: p?.supplier ?? '',
      sku: p?.sku ?? '',
      notes: p?.notes ?? '',
    });
  }
  return out;
}

/** Freshly-built default catalog from the baked-in CSVs. */
export function defaultCatalog(): MaterialEntry[] {
  return buildCatalog(DEFAULT_MATERIALS_CSV, DEFAULT_PRICING_CSV);
}

// ── Singleton active catalog (swappable at runtime) ─────────────

let activeCatalog: MaterialEntry[] = defaultCatalog();
let activeById: Map<string, MaterialEntry> = buildIndex(activeCatalog);

function buildIndex(entries: MaterialEntry[]): Map<string, MaterialEntry> {
  const m = new Map<string, MaterialEntry>();
  for (const e of entries) m.set(e.materialId, e);
  return m;
}

/**
 * Replace the active catalog. Pass a freshly-built array from
 * `buildCatalog(userMaterialsCsv, userPricingCsv)` when the user
 * imports vendor-specific pricing from a file picker.
 */
export function setActiveCatalog(entries: MaterialEntry[]): void {
  activeCatalog = entries;
  activeById = buildIndex(entries);
}

/** Reset to the baked-in AROYH defaults. */
export function resetToDefaultCatalog(): void {
  activeCatalog = defaultCatalog();
  activeById = buildIndex(activeCatalog);
}

/** Full active catalog (snapshot). */
export function getAllMaterials(): MaterialEntry[] {
  return [...activeCatalog];
}

/** Single-material lookup by stable ID. Returns undefined if
 *  the ID isn't in the catalog. */
export function getMaterial(id: string): MaterialEntry | undefined {
  return activeById.get(id);
}

/**
 * Unit price for a material ID, or `fallback` if missing.
 * Convenience for the calc engine — avoids the `getMaterial()?.
 * unitPrice ?? fallback` pattern at every call site.
 */
export function getPrice(id: string, fallback: number = 0): number {
  const m = activeById.get(id);
  return m ? m.unitPrice : fallback;
}

/**
 * Coverage for a material, or `fallback` if missing. Example:
 * `getCoverage('SHG-3TAB')` → 33.3 (SF per bundle).
 */
export function getCoverage(id: string, fallback: number = 0): number {
  const m = activeById.get(id);
  return m ? m.coverage : fallback;
}

/** Localized name lookup — 'en' or 'es'. */
export function getName(id: string, locale: 'en' | 'es' = 'en'): string {
  const m = activeById.get(id);
  if (!m) return id; // stable fallback = the ID itself
  return locale === 'es' ? m.nameEs : m.nameEn;
}

/**
 * Default catalog IDs used by the roofing calc engine. Exported
 * so callers can iterate the canonical set when they don't want
 * to depend on the full active catalog (e.g. a BOM panel that
 * always shows these 12 rows).
 */
export const CANONICAL_MATERIAL_IDS: readonly string[] = [
  'SHG-3TAB',
  'SHG-ARCH',
  'DRP-10',
  'STR-105',
  'RDG-33',
  'FLT-15',
  'SYN-1000',
  'ICE-200',
  'NLS-RF',
  'VNT-RIDGE',
  'FLS-STEP',
  'FLS-PIPE',
] as const;

// ── Bridge to calcEngine's RoofingPrices shape ──────────────────

import type { RoofingPrices } from './calcEngine';

/**
 * Map from `calcEngine.RoofingPrices` keys to catalog IDs. The
 * calc engine's pricing record uses mnemonic keys (shingle_bundle,
 * drip_edge_10ft, …); the catalog uses stable product IDs. This
 * map bridges the two so `estimatePricing(mat, {prices: pricesFromCatalog()})`
 * automatically picks up vendor-specific pricing when the user
 * imports an updated pricing CSV.
 *
 * The SHG-ARCH (architectural shingles) entry is used by default
 * for the shingle_bundle price — most residential jobs use arch.
 * Swap to 'SHG-3TAB' for budget jobs via `opts.prices.shingle_bundle`.
 *
 * `plywood_sheet`, `fascia_board_lf`, `drip_edge_metal` are NOT in
 * the canonical AROYH catalog (12 materials) — they fall through to
 * the calcEngine defaults.
 */
const CATALOG_PRICE_KEYS: Partial<Record<keyof RoofingPrices, string>> = {
  shingle_bundle: 'SHG-ARCH',
  drip_edge_10ft: 'DRP-10',
  starter_bundle: 'STR-105',
  ridge_cap_bundle: 'RDG-33',
  felt_roll: 'FLT-15',
  synthetic_roll: 'SYN-1000',
  ice_water_roll: 'ICE-200',
  roofing_nails_lb: 'NLS-RF',
};

/**
 * Build a `Partial<RoofingPrices>` populated from the active
 * catalog. Pass the result into `estimatePricing(mat, {prices:
 * pricesFromCatalog()})` to use catalog-sourced pricing.
 * Missing catalog entries are simply omitted from the partial —
 * `estimatePricing` merges with defaults so those rows stay at
 * their hard-coded amounts.
 */
export function pricesFromCatalog(): Partial<RoofingPrices> {
  const out: Partial<RoofingPrices> = {};
  for (const [key, matId] of Object.entries(CATALOG_PRICE_KEYS)) {
    if (!matId) continue;
    const entry = activeById.get(matId);
    if (entry && entry.unitPrice > 0) {
      (out as Record<string, number>)[key] = entry.unitPrice;
    }
  }
  return out;
}
