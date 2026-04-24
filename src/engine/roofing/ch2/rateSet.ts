/**
 * RateSet loader + validator + staleness check.
 *
 * Source: spec §9 (RateSet & Configuration).
 *
 * ─── Philosophy ────────────────────────────────────────────────
 *
 * Per Ground Rule #8: "Never hardcode rates or prices. All $ values
 * and labor rates come from a RateSet object. The book's historical
 * values are test fixtures, not defaults."
 *
 * Every `BidOutput` records its `RateSet.version`. Re-pricing a bid
 * under a different RateSet is an EXPLICIT migration action, never
 * silent — spec §9.2.
 *
 * ─── Loader strategy ──────────────────────────────────────────
 *
 * Two consumers:
 *
 *   Tests → use the exported `TEST_RATE_SET_FL_2026_Q2_V1` constant
 *           directly. Book historical values, clearly marked TEST
 *           in `source`, not safe for production bids.
 *
 *   Production → load a JSON payload from a versioned config source
 *           (file in repo / SQLite / HTTP) and pass to `load_rate_set()`.
 *           The function parses + validates and returns a typed
 *           `RateSet` or throws `RateSetMissing`.
 *
 * Starting simple: JSON-in-repo. Future migration to SQLite or
 * HTTP is straightforward — the loader function's public surface
 * is a JSON string, so the data source can change without touching
 * consumers.
 *
 * ─── Staleness ────────────────────────────────────────────────
 *
 * Spec §9.2: "Stale RateSet detection: warn if last_verified_date
 * > 1 year old." `check_rate_set_staleness` returns a WarningFlag
 * when the date crosses the threshold; callers push it onto the
 * bid's `flags` array.
 */

import type { RateSet, WarningFlag } from './types';
import { RateSetMissing } from './errors';

/** Staleness threshold — a RateSet older than this fires the
 *  `rate_set_stale` warning per §9.2 ("> 1 year old"). */
export const RATE_SET_STALENESS_DAYS = 365;

// ─── Validator ────────────────────────────────────────────────

/**
 * Structural validator for a RateSet. Throws `RateSetMissing` on
 * any issue; on success, narrows the input to `RateSet` via TS's
 * `asserts` keyword so callers can pass an `unknown`-typed value
 * and get a typed result.
 *
 * This is strict by design — per §9.2, silent fallback would
 * violate the "every bid records its RateSet version" invariant.
 * Malformed = throw = caller must fix.
 */
export function validate_rate_set(rs: unknown): asserts rs is RateSet {
  if (rs === null || rs === undefined || typeof rs !== 'object') {
    throw new RateSetMissing('RateSet is null/undefined or not an object');
  }
  const r = rs as Record<string, unknown>;

  // version — non-empty string
  if (typeof r.version !== 'string' || r.version.length === 0) {
    throw new RateSetMissing(
      'RateSet.version must be a non-empty string (e.g. "FL-2026-Q2-v1")',
    );
  }

  // source — string (may be descriptive, audit-trail only)
  if (typeof r.source !== 'string') {
    throw new RateSetMissing('RateSet.source must be a string');
  }

  // crew_manhour_rate_usd — strictly positive, finite
  if (
    typeof r.crew_manhour_rate_usd !== 'number' ||
    !Number.isFinite(r.crew_manhour_rate_usd) ||
    r.crew_manhour_rate_usd <= 0
  ) {
    throw new RateSetMissing(
      `RateSet.crew_manhour_rate_usd must be a finite number > 0, ` +
        `got ${r.crew_manhour_rate_usd}`,
    );
  }

  // labor_rates_mh_per_sf — object of positive-finite numbers
  if (
    r.labor_rates_mh_per_sf === null ||
    typeof r.labor_rates_mh_per_sf !== 'object'
  ) {
    throw new RateSetMissing('RateSet.labor_rates_mh_per_sf must be an object');
  }
  for (const [key, value] of Object.entries(
    r.labor_rates_mh_per_sf as Record<string, unknown>,
  )) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new RateSetMissing(
        `RateSet.labor_rates_mh_per_sf['${key}'] must be a finite number > 0, ` +
          `got ${value}`,
      );
    }
  }

  // material_skus_usd_per_sf — object of non-negative finite numbers.
  // Zero is allowed (bundled / complimentary line items).
  if (
    r.material_skus_usd_per_sf === null ||
    typeof r.material_skus_usd_per_sf !== 'object'
  ) {
    throw new RateSetMissing(
      'RateSet.material_skus_usd_per_sf must be an object',
    );
  }
  for (const [key, value] of Object.entries(
    r.material_skus_usd_per_sf as Record<string, unknown>,
  )) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new RateSetMissing(
        `RateSet.material_skus_usd_per_sf['${key}'] must be a finite number ≥ 0, ` +
          `got ${value}`,
      );
    }
  }

  // tax_rate — finite, [0, 1]
  if (
    typeof r.tax_rate !== 'number' ||
    !Number.isFinite(r.tax_rate) ||
    r.tax_rate < 0 ||
    r.tax_rate > 1
  ) {
    throw new RateSetMissing(
      `RateSet.tax_rate must be a finite number in [0, 1], got ${r.tax_rate}`,
    );
  }

  // last_verified_date — parseable ISO-8601 date string
  if (typeof r.last_verified_date !== 'string') {
    throw new RateSetMissing(
      'RateSet.last_verified_date must be an ISO-8601 date string',
    );
  }
  const parsed = Date.parse(r.last_verified_date);
  if (Number.isNaN(parsed)) {
    throw new RateSetMissing(
      `RateSet.last_verified_date is not a parseable date: ` +
        `'${r.last_verified_date}'`,
    );
  }
}

// ─── Loader ───────────────────────────────────────────────────

/**
 * Parse + validate a RateSet from a JSON source.
 *
 * @param source  Either a JSON string (file contents, HTTP body)
 *                or an already-parsed plain object. Object input
 *                skips the parse step; strings get `JSON.parse`'d
 *                with typed failure on malformed syntax.
 *
 * @returns  Validated, typed `RateSet`.
 *
 * @throws {RateSetMissing} on parse failure OR validation failure.
 */
export function load_rate_set(source: string | object): RateSet {
  let parsed: unknown;
  if (typeof source === 'string') {
    try {
      parsed = JSON.parse(source);
    } catch (e) {
      throw new RateSetMissing(
        `RateSet JSON parse failed: ${(e as Error).message}`,
      );
    }
  } else {
    parsed = source;
  }
  validate_rate_set(parsed);
  return parsed;
}

// ─── Staleness check ──────────────────────────────────────────

/**
 * Return a `rate_set_stale` warning flag iff the RateSet's
 * `last_verified_date` is more than `RATE_SET_STALENESS_DAYS`
 * before the `reference_date` (default: now).
 *
 * Future-dated RateSets return null (weird but not stale — the
 * operator may have post-dated a verification in advance).
 *
 * @param rs              Validated RateSet.
 * @param reference_date  Comparison point. Default: `new Date()`.
 *                        Tests override for determinism.
 */
export function check_rate_set_staleness(
  rs: RateSet,
  reference_date: Date = new Date(),
): WarningFlag | null {
  const verified = new Date(rs.last_verified_date);
  const ageMs = reference_date.getTime() - verified.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > RATE_SET_STALENESS_DAYS) {
    return {
      code: 'rate_set_stale',
      severity: 'warning',
      message:
        `RateSet '${rs.version}' was last verified ${Math.floor(ageDays)} ` +
        `days ago — exceeds the ${RATE_SET_STALENESS_DAYS}-day staleness ` +
        `window per §9.2. Prices and labor rates may be outdated.`,
      remediation:
        'Load a fresher RateSet or re-verify rates against current ' +
        'market data and bump last_verified_date.',
    };
  }
  return null;
}

// ─── Test seed ────────────────────────────────────────────────

/**
 * Book-historical RateSet seeded with values from §2N.
 *
 * **TEST ONLY — DO NOT USE IN PRODUCTION BIDS.**
 *
 * Per spec Ground Rule #8 + §9.3, the book's historical values
 * are fixtures, not defaults. This constant exists so tests +
 * migration fixtures have a known-good RateSet to exercise
 * algorithms against. Production RateSets come from a versioned
 * config source.
 *
 * `last_verified_date` is set to a recent date on purpose so the
 * staleness check returns null for the most common test paths.
 * Tests that want the stale-warning path construct their own
 * RateSet with an old date.
 */
export const TEST_RATE_SET_FL_2026_Q2_V1: RateSet = Object.freeze({
  version: 'FL-TEST-2026-Q2-v1',
  source:
    'book-historical-seed, TEST ONLY — NOT for production pricing ' +
    '(spec Ground Rule #8)',
  crew_manhour_rate_usd: 33.85,  // §2N historical
  labor_rates_mh_per_sf: Object.freeze({
    board_sheathing: 0.026,      // §2N
    plywood_sheathing: 0.013,    // §2N
    // OSB treated as plywood-equivalent for labor until field-verified;
    // flagged in migration report.
    osb_sheathing: 0.013,
  }),
  material_skus_usd_per_sf: Object.freeze({
    // Plausible FL Q2 2026 prices — test-only, not authoritative.
    plywood_32_16_15_32: 1.25,
    plywood_24_16_7_16:  1.05,
    plywood_40_20_19_32: 1.55,
    plywood_48_24_23_32: 1.80,
    plywood_60_32_7_8:   2.20,
    osb_1_2:             0.95,
    osb_15_32:           0.90,
    board_1x6:           2.10,
    board_1x8:           2.45,
  }),
  tax_rate: 0.07,  // FL state 6% + typical local ~1%
  last_verified_date: '2026-04-01',
}) as RateSet;
