/**
 * fl_roofing.integrity — Phase 14.R.F.4.
 *
 * Port of `fl_roofing/integrity.py`. Validates data files against
 * each other so drift gets caught at build / test time, not at a
 * permit-critical moment. Same check names as the Python so
 * reports are cross-recognizable.
 *
 * Run via vitest — each check returns an array of error strings;
 * `runAll()` aggregates them into a single report.
 */

import {
  allWindZones,
  loadSheathingMatrix,
  loadProductApprovals,
} from './data';

export interface CheckResult {
  name: string;
  passed: boolean;
  errors: string[];
}

export interface IntegrityReport {
  checks: CheckResult[];
  total_errors: number;
}

// ── Individual checks ──────────────────────────────────────────

/** Must have exactly 67 FL counties. */
export function checkCountyCount(): string[] {
  const rows = allWindZones();
  return rows.length === 67
    ? []
    : [`Expected 67 counties in wind_zones.yaml, got ${rows.length}`];
}

/** County names must be unique. */
export function checkUniqueCountyNames(): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const z of allWindZones()) {
    if (seen.has(z.county)) dupes.add(z.county);
    seen.add(z.county);
  }
  return dupes.size === 0
    ? []
    : [`Duplicate county names: ${[...dupes].join(', ')}`];
}

/** Vult values should be physically plausible (110–220 mph). */
export function checkVultRanges(): string[] {
  const errors: string[] = [];
  for (const z of allWindZones()) {
    if (z.vult_peak_mph < 110 || z.vult_peak_mph > 220) {
      errors.push(
        `${z.county}: Vult=${z.vult_peak_mph} is outside expected 110-220 mph range`,
      );
    }
  }
  return errors;
}

/** Only Miami-Dade and Broward should have hvhz_flag=1. */
export function checkHvhzCounties(): string[] {
  const errors: string[] = [];
  for (const z of allWindZones()) {
    if (z.hvhz_flag === 1 && z.county !== 'Miami-Dade' && z.county !== 'Broward') {
      errors.push(
        `${z.county}: hvhz_flag=1 but only Miami-Dade and Broward should be HVHZ`,
      );
    }
  }
  return errors;
}

/** All sheathing rows must have a valid source_confidence. */
export function checkSheathingConfidenceValues(): string[] {
  const errors: string[] = [];
  const valid = new Set([
    'VERIFIED_FBC_FACT_SHEET',
    'ENGINEERING_INFERENCE',
    'NEEDS_VERIFICATION',
  ]);
  for (const r of loadSheathingMatrix()) {
    if (!valid.has(r.source_confidence)) {
      errors.push(
        `Sheathing row id=${r.id}: invalid source_confidence '${r.source_confidence}'`,
      );
    }
  }
  return errors;
}

/** Verified rows must have non-null edge and field spacing. */
export function checkSheathingVerifiedHaveSpacing(): string[] {
  const errors: string[] = [];
  for (const r of loadSheathingMatrix()) {
    if (r.source_confidence === 'VERIFIED_FBC_FACT_SHEET') {
      if (r.panel_edge_spacing_in === null) {
        errors.push(
          `Sheathing row id=${r.id} (verified): NULL panel_edge_spacing_in`,
        );
      }
      if (r.panel_field_spacing_in === null) {
        errors.push(
          `Sheathing row id=${r.id} (verified): NULL panel_field_spacing_in`,
        );
      }
    }
  }
  return errors;
}

/** Higher Vult should never yield looser spacing (within a group). */
export function checkSheathingMonotonic(): string[] {
  const errors: string[] = [];
  const groups = new Map<string, typeof rows>();
  const rows = loadSheathingMatrix().filter(
    (r) => r.panel_edge_spacing_in !== null,
  );
  for (const r of rows) {
    const key = `${r.exposure}|${r.wood_sg}|${r.framing_spacing_in}|${r.sheathing_thickness}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  for (const [key, items] of groups) {
    items.sort((a, b) => a.vult_mph - b.vult_mph);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      const curr = items[i]!;
      if (
        (curr.panel_edge_spacing_in ?? 0) > (prev.panel_edge_spacing_in ?? 0)
      ) {
        errors.push(
          `Non-monotonic: ${key} Vult ${prev.vult_mph}->${curr.vult_mph} mph`
          + ` edge spacing ${prev.panel_edge_spacing_in}->${curr.panel_edge_spacing_in}`,
        );
      }
    }
  }
  return errors;
}

/** All FL approval prefixes must match FL##### pattern. */
export function checkFlApprovalsFormat(): string[] {
  const errors: string[] = [];
  const catalog = loadProductApprovals();
  const sections = [
    'shingle_manufacturers',
    'tile_manufacturers',
    'metal_manufacturers',
    'underlayment_manufacturers',
  ] as const;
  const flPattern = /^FL\d+$/;
  for (const section of sections) {
    const list = (catalog as Record<string, unknown>)[section];
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      const prefix = (m as { master_fl_approval?: string }).master_fl_approval;
      if (prefix && !flPattern.test(prefix)) {
        errors.push(
          `${(m as { manufacturer: string }).manufacturer}: `
          + `master_fl_approval '${prefix}' does not match FL##### pattern`,
        );
      }
    }
  }
  return errors;
}

// ── Aggregate runner ───────────────────────────────────────────

export const ALL_CHECKS: Array<[string, () => string[]]> = [
  ['checkCountyCount', checkCountyCount],
  ['checkUniqueCountyNames', checkUniqueCountyNames],
  ['checkVultRanges', checkVultRanges],
  ['checkHvhzCounties', checkHvhzCounties],
  ['checkSheathingConfidenceValues', checkSheathingConfidenceValues],
  ['checkSheathingVerifiedHaveSpacing', checkSheathingVerifiedHaveSpacing],
  ['checkSheathingMonotonic', checkSheathingMonotonic],
  ['checkFlApprovalsFormat', checkFlApprovalsFormat],
];

/** Run all integrity checks, aggregate results into a single report. */
export function runAll(): IntegrityReport {
  const results: CheckResult[] = [];
  let total = 0;
  for (const [name, fn] of ALL_CHECKS) {
    const errors = fn();
    results.push({ name, passed: errors.length === 0, errors });
    total += errors.length;
  }
  return { checks: results, total_errors: total };
}
