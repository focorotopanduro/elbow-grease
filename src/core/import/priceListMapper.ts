/**
 * priceListMapper — Phase 14.AB.2
 *
 * Transforms a vendor price-list CSV (Ferguson, HD Supply, Winsupply,
 * Wolseley, etc.) into the `fittingPriceOverrides` shape consumed by
 * `PricingProfile` + `BOMExporter`.
 *
 * The contractor's workflow:
 *
 *   1. Drop a CSV from their vendor portal.
 *   2. Point us at the columns: "Which column is the fitting type?
 *      Which is the diameter? Which is the unit price?"
 *   3. Optional fuzzy mapping helpers — if the vendor calls their
 *      fittings `ELBOW_90_DEG`, we map that to our canonical
 *      `elbow_90` type.
 *   4. Import — a `fittingPriceOverrides: Record<type,
 *      Record<diameter, number>>` payload the pricing profile stores
 *      verbatim.
 *
 * Pure module. No filesystem, no UI, no HTTP. Takes parsed rows +
 * a mapping config, returns the override record + a diagnostic
 * report the UI can surface.
 */

import { parseCurrencyNumber } from '@core/formula/formulaEngine';
import type { FittingType } from '../../engine/graph/GraphEdge';

// ── Mapping config ────────────────────────────────────────────

export interface PriceListMapping {
  /** CSV column name that carries the fitting type identifier. */
  typeColumn: string;
  /** CSV column name that carries the diameter (inches). */
  diameterColumn: string;
  /** CSV column name that carries the unit price (USD). */
  priceColumn: string;
  /**
   * Optional: vendor-specific alias map. The key is the vendor's
   * raw type string (normalized to lowercase, underscores); the
   * value is our canonical `FittingType`.
   *
   * Example:
   *   { 'elbow_90_deg': 'elbow_90', 'tee_ss': 'sanitary_tee' }
   */
  typeAliases?: Record<string, FittingType>;
  /**
   * Optional: diameter alias map for vendors that list sizes like
   * "3/4" or "0.75" or "19mm". Normalized-lowercase key →
   * numeric inches.
   */
  diameterAliases?: Record<string, number>;
}

// ── Output ────────────────────────────────────────────────────

export interface PriceListImportRow {
  /** 1-indexed source row (matches the CSV's visual line count
   *  when `row 1` is the header). */
  sourceRow: number;
  type: FittingType;
  diameter: number;
  price: number;
}

export interface PriceListImportWarning {
  sourceRow: number;
  reason:
    | 'unknown_type'
    | 'unknown_diameter'
    | 'invalid_price'
    | 'missing_type_column'
    | 'missing_diameter_column'
    | 'missing_price_column';
  rawValue: string;
}

export interface PriceListImportResult {
  /** Normalized rows that mapped cleanly. */
  rows: PriceListImportRow[];
  /** Rows that didn't parse + why. */
  warnings: PriceListImportWarning[];
  /** Summary counts. */
  summary: {
    total: number;
    accepted: number;
    rejected: number;
  };
}

// ── Canonical type lookup ─────────────────────────────────────

/**
 * Our universe of fitting types — must match
 * `FITTING_TYPES` in `GraphEdge.ts`. Local copy so this module
 * doesn't drag the whole graph layer into the import path.
 */
const CANONICAL_TYPES: ReadonlySet<FittingType> = new Set<FittingType>([
  'bend_22_5', 'bend_45', 'bend_90', 'bend_90_ls',
  'elbow_90', 'elbow_45', 'pex_elbow_90',
  'tee', 'sanitary_tee', 'wye', 'combo_wye_eighth',
  'cross', 'coupling', 'reducer', 'cap',
  'cleanout_adapter', 'p_trap', 'closet_flange',
  'manifold_2', 'manifold_4', 'manifold_6', 'manifold_8',
]);

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')   // spaces / hyphens → underscore
    .replace(/[^a-z0-9_]/g, ''); // strip anything else
}

/**
 * Resolve a vendor's type-string to a canonical `FittingType`.
 *   1. Try `typeAliases` first (exact match on normalized key)
 *   2. Then try the canonical set directly (normalized key)
 *   3. Return null if neither matches.
 */
export function resolveCanonicalType(
  raw: string,
  aliases?: Record<string, FittingType>,
): FittingType | null {
  const key = normalizeKey(raw);
  if (aliases) {
    const aliasedKey = Object.keys(aliases).find((k) => normalizeKey(k) === key);
    if (aliasedKey) return aliases[aliasedKey]!;
  }
  if ((CANONICAL_TYPES as ReadonlySet<string>).has(key)) {
    return key as FittingType;
  }
  return null;
}

// ── Diameter parsing ──────────────────────────────────────────

/**
 * Parse a vendor's diameter string — accepts:
 *   "0.75" / "3/4" / "3/4\"" / "0.75 in" / "19mm" (via alias)
 *   "1-1/2" / "1 1/2" (mixed fraction)
 *
 * Returns inches or null if it can't decide.
 */
export function parseDiameter(
  raw: string,
  aliases?: Record<string, number>,
): number | null {
  const normalized = raw.trim().toLowerCase();

  // Alias match (exact or normalized)
  if (aliases) {
    if (typeof aliases[raw] === 'number') return aliases[raw]!;
    const key = Object.keys(aliases).find((k) => k.toLowerCase().trim() === normalized);
    if (key) return aliases[key]!;
  }

  // Strip units
  const stripped = normalized
    .replace(/inches?$/i, '')
    .replace(/\bin\b\.?$/i, '')
    .replace(/["″]/g, '')
    .trim();

  // Mixed fraction: "1-1/2" or "1 1/2"
  const mixed = stripped.match(/^(\d+)\s*[-\s]\s*(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const num = Number(mixed[2]);
    const den = Number(mixed[3]);
    if (den > 0) return whole + num / den;
  }

  // Simple fraction: "3/4"
  const frac = stripped.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const num = Number(frac[1]);
    const den = Number(frac[2]);
    if (den > 0) return num / den;
  }

  // Decimal / integer
  const n = Number(stripped);
  if (Number.isFinite(n) && n > 0) return n;

  return null;
}

// ── Merge strategies ─────────────────────────────────────────

export type MergeStrategy =
  /** Replace any existing prices for types in the import. */
  | 'replace'
  /** Keep existing prices; add only entries that weren't there. */
  | 'skip_existing'
  /** Replace every single type+diameter regardless of prior state. */
  | 'overwrite_all';

// ── Main entry points ────────────────────────────────────────

/**
 * Convert parsed CSV object rows into `PriceListImportRow[]`, with
 * warnings for rows that didn't map cleanly.
 */
export function mapPriceListRows(
  rows: readonly Record<string, string>[],
  mapping: PriceListMapping,
): PriceListImportResult {
  const outRows: PriceListImportRow[] = [];
  const warnings: PriceListImportWarning[] = [];

  for (let i = 0; i < rows.length; i++) {
    const src = rows[i]!;
    const sourceRow = i + 2; // +1 for 1-indexing, +1 for header row

    const rawType = src[mapping.typeColumn];
    if (rawType === undefined) {
      warnings.push({ sourceRow, reason: 'missing_type_column', rawValue: '' });
      continue;
    }
    const rawDiameter = src[mapping.diameterColumn];
    if (rawDiameter === undefined) {
      warnings.push({ sourceRow, reason: 'missing_diameter_column', rawValue: '' });
      continue;
    }
    const rawPrice = src[mapping.priceColumn];
    if (rawPrice === undefined) {
      warnings.push({ sourceRow, reason: 'missing_price_column', rawValue: '' });
      continue;
    }

    const type = resolveCanonicalType(rawType, mapping.typeAliases);
    if (type === null) {
      warnings.push({ sourceRow, reason: 'unknown_type', rawValue: rawType });
      continue;
    }

    const diameter = parseDiameter(rawDiameter, mapping.diameterAliases);
    if (diameter === null) {
      warnings.push({ sourceRow, reason: 'unknown_diameter', rawValue: rawDiameter });
      continue;
    }

    const price = parseCurrencyNumber(rawPrice);
    if (price <= 0) {
      warnings.push({ sourceRow, reason: 'invalid_price', rawValue: rawPrice });
      continue;
    }

    outRows.push({ sourceRow, type, diameter, price });
  }

  return {
    rows: outRows,
    warnings,
    summary: {
      total: rows.length,
      accepted: outRows.length,
      rejected: warnings.length,
    },
  };
}

// ── Merge into profile ───────────────────────────────────────

export type FittingPriceOverrides = Record<string, Record<number, number>>;

/**
 * Fold the imported rows into an existing price-override record.
 * Pure — returns a new record; does not mutate `existing`.
 */
export function mergePriceOverrides(
  existing: FittingPriceOverrides,
  imported: readonly PriceListImportRow[],
  strategy: MergeStrategy,
): FittingPriceOverrides {
  if (strategy === 'overwrite_all') {
    // Deterministic: rebuild from scratch using ONLY the imported set.
    const fresh: FittingPriceOverrides = {};
    for (const r of imported) {
      if (!fresh[r.type]) fresh[r.type] = {};
      fresh[r.type]![r.diameter] = r.price;
    }
    return fresh;
  }

  // Deep-clone existing
  const next: FittingPriceOverrides = {};
  for (const [t, byD] of Object.entries(existing)) {
    next[t] = { ...byD };
  }

  for (const r of imported) {
    if (!next[r.type]) next[r.type] = {};
    const bucket = next[r.type]!;
    const have = bucket[r.diameter];
    if (strategy === 'skip_existing' && typeof have === 'number') {
      continue;
    }
    bucket[r.diameter] = r.price;
  }
  return next;
}
