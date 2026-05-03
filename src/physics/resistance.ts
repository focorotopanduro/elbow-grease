/**
 * Roof-assembly uplift resistance.
 *
 * Two layers govern:
 *   1. The shingle field (top layer, fails first)
 *   2. The sheathing-to-rafter nail withdrawal (deck blow-off)
 *
 * The intermediate layers (drip edge, underlayment / SWB) are ordinal failure
 * markers, not load-bearing members; they are scored in cascade.ts.
 */

import {
  FASTENERS,
  NAIL_PATTERNS,
  PENETRATION_IN,
  SHINGLE_CLASSES,
  type Fastener,
  type NailPatternId,
} from './constants';

type FastenerId = keyof typeof FASTENERS;

/**
 * Per-fastener withdrawal capacity (lb).
 *   P = W · L_penetration
 * Per NDS 12.2C the result is an allowable design value (LRFD/ASD already
 * baked into NDS published W). We treat it as ultimate-equivalent for the
 * education tool.
 */
export function fastenerWithdrawalLb(fastener: Fastener, penetrationIn: number): number {
  return fastener.withdrawalLbPerIn * penetrationIn;
}

/**
 * Per-square-foot sheathing uplift resistance (psf), keyed to:
 *   - which fastener
 *   - which nail pattern (6/12 vs 6/6)
 *   - which roof zone (corner has more nails, smaller tributary)
 *
 * For the simplified pedagogy: in the field the tributary area per nail is
 * NAIL_PATTERNS[pattern].field; in edge/corner zones the perimeter spacing
 * applies (.edge tributary).
 */
export function sheathingResistancePsf(
  fastenerId: FastenerId,
  patternId: NailPatternId,
  zone: 'field' | 'edge' | 'corner',
): number {
  const fastener = FASTENERS[fastenerId];
  const pattern = NAIL_PATTERNS[patternId];
  const penetration = PENETRATION_IN[fastenerId as keyof typeof PENETRATION_IN];
  const perNail = fastenerWithdrawalLb(fastener, penetration);
  const tributary = zone === 'field' ? pattern.field : pattern.edge;
  return perNail / tributary;
}

/**
 * Shingle field resistance (psf) — depends on shingle class + condition.
 * Aged shingles lose seal-strip bond; we do not model age in v1.
 */
export function shingleResistancePsf(shingleClassId: keyof typeof SHINGLE_CLASSES): number {
  return SHINGLE_CLASSES[shingleClassId].netUpliftCapPsf;
}

// ============================================================================
// INSTALL PROFILES — the two prebuilt scenarios from the visualizer brief.
// ============================================================================

export type InstallProfileId = 'code_min' | 'fbc_wbdr';

export interface InstallProfile {
  id: InstallProfileId;
  label: string;
  era: string;
  shingleClassId: keyof typeof SHINGLE_CLASSES;
  fastenerId: FastenerId;
  patternId: NailPatternId;
  hasSWB: boolean;
  notes: string;
  fbcReferences: string[];
}

export const INSTALL_PROFILES: Record<InstallProfileId, InstallProfile> = {
  code_min: {
    id: 'code_min',
    label: 'Pre-2002 Code Minimum',
    era: 'Pre-2002',
    shingleClassId: 'D',
    fastenerId: '6d_smooth',
    patternId: '6_12',
    hasSWB: false,
    notes:
      'Original construction typical of Orlando homes built before the 2001 ' +
      'Florida Building Code rewrite. 6d smooth box nails, no secondary ' +
      'water barrier, Class D shingles meet the 90 mph ASCE 7-95 minimum.',
    fbcReferences: ['ASCE 7-95'],
  },
  fbc_wbdr: {
    id: 'fbc_wbdr',
    label: 'Current FBC + WBDR',
    era: '2023+',
    shingleClassId: 'H',
    fastenerId: '8d_ring',
    patternId: '6_6',
    hasSWB: true,
    notes:
      '2023 Florida Building Code (8th Ed.) for the Wind-Borne Debris Region. ' +
      '8d ring-shank nails at 6"/6", Class H shingles, peel-and-stick or ' +
      'self-adhered secondary water barrier over the entire deck.',
    fbcReferences: ['FBC 1504.1.1', 'FBC 1518', 'FBC 708.7'],
  },
};

/**
 * Aggregate per-zone uplift resistance for a given install profile.
 * Returns the GOVERNING (lower) of shingle-field-resistance and
 * sheathing-resistance, since whichever fails first ends the assembly.
 */
export interface ResistanceProfile {
  field: number;
  edge: number;
  corner: number;
  shingleCapPsf: number;
  sheathing: { field: number; edge: number; corner: number };
}

export function profileResistance(profile: InstallProfile): ResistanceProfile {
  const shingleCap = shingleResistancePsf(profile.shingleClassId);
  const sheathing = {
    field: sheathingResistancePsf(profile.fastenerId, profile.patternId, 'field'),
    edge: sheathingResistancePsf(profile.fastenerId, profile.patternId, 'edge'),
    corner: sheathingResistancePsf(profile.fastenerId, profile.patternId, 'corner'),
  };
  return {
    shingleCapPsf: shingleCap,
    sheathing,
    // governing capacity is the lower of shingle-field and sheathing — but
    // the shingle is the topmost layer, so once it lifts the deck is exposed.
    // For UI purposes we report shingle-cap as the "first thing to go" in
    // each zone, with sheathing as the "deck failure" floor.
    field: Math.min(shingleCap, sheathing.field),
    edge: Math.min(shingleCap, sheathing.edge),
    corner: Math.min(shingleCap, sheathing.corner),
  };
}
