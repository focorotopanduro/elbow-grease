/**
 * Repair-cost estimates per failure-cascade stage.
 *
 * Ranges are for a typical 1-story Orlando ranch (~1,800 sq ft footprint,
 * ~2,200 sq ft roof area). Sources:
 *   - HomeAdvisor 2025 Orlando reroof cost survey
 *   - Florida Roofing & Sheet Metal Contractors Association (FRSA)
 *   - Beit Building Contractors LLC field data
 *
 * Numbers are intentionally conservative — they are the LOW end of a
 * realistic range, so a homeowner is never under-prepared by the tool.
 *
 * Annual insurance impact estimates per FL OIR My Safe Florida Home
 * Program data (2024 baseline) — "wind mitigation credit" delta between
 * a fully-credited and non-credited Orlando home.
 */

import type { StageId } from '../physics/cascade';

export interface DamageEstimate {
  stage: StageId;
  label: string;
  repairLow: number;
  repairHigh: number;
  /** Plain-English explanation of what the number includes */
  scope: string;
  source: string;
}

export const DAMAGE_BY_STAGE: Record<StageId, DamageEstimate> = {
  drip_edge: {
    stage: 'drip_edge',
    label: 'Perimeter repair',
    repairLow: 300,
    repairHigh: 800,
    scope: 'Re-secure or replace drip edge along eaves and rakes; minor flashing repair.',
    source: 'HomeAdvisor 2025, Orlando metro',
  },
  field_shingles: {
    stage: 'field_shingles',
    label: 'Patch + partial reshingle',
    repairLow: 1500,
    repairHigh: 4000,
    scope: 'Replace lifted/missing tabs across affected zones; match existing shingles.',
    source: 'FRSA member-contractor survey 2024',
  },
  underlayment: {
    stage: 'underlayment',
    label: 'Full reroof + interior dry-out',
    repairLow: 15000,
    repairHigh: 28000,
    scope:
      'Tear-off + new shingles + new SWB + interior water mitigation (dry-out, ' +
      'mold remediation, drywall patches in affected rooms).',
    source: 'Beit Building Contractors field data, Orlando 2024',
  },
  sheathing: {
    stage: 'sheathing',
    label: 'Full deck replacement + interior rebuild',
    repairLow: 42000,
    repairHigh: 85000,
    scope:
      'Sheathing replacement + reroof + interior demolition + structural ' +
      'inspection + insulation + drywall + paint + flooring (water damage ' +
      'frequently total-loss for affected rooms).',
    source: 'Beit Building Contractors field data, Orlando 2024',
  },
};

/** Insurance premium impact ranges (annual, Orlando typical home value) */
export const INSURANCE_PREMIUM = {
  pre2002_unmitigated: { low: 3800, high: 5400 },
  fbc_fully_mitigated: { low: 1500, high: 2200 },
  source: 'FL Office of Insurance Regulation My Safe Florida Home 2024 baselines',
} as const;

/** Format as $X,XXX */
export function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

/** Format as $X,XXX – $Y,YYY */
export function fmtRange(low: number, high: number): string {
  return `${fmtMoney(low)}\u2013${fmtMoney(high)}`;
}
