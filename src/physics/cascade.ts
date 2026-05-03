/**
 * Failure-cascade engine.
 *
 * Given wind speed + install profile + house config, returns the ordered
 * list of roof-assembly failures. Four stages, in physical order:
 *
 *   Stage 1 — Drip edge lifts
 *   Stage 2 — Field shingles lift (corners → edges → field)
 *   Stage 3 — Underlayment / SWB exposes
 *   Stage 4 — Sheathing nail withdrawal
 */

import {
  configurableUpliftProfile,
  DEFAULT_HOUSE_CONFIG,
  type HouseConfig,
  type UpliftProfile,
} from './pressure';
import {
  profileResistance,
  type InstallProfile,
  type ResistanceProfile,
} from './resistance';

export type StageId = 'drip_edge' | 'field_shingles' | 'underlayment' | 'sheathing';

export interface FailureStage {
  id: StageId;
  label: string;
  triggered: boolean;
  zone?: 'field' | 'edge' | 'corner';
  severity: 'minor' | 'moderate' | 'major' | 'catastrophic';
  homeownerImpact: string;
}

export interface CascadeResult {
  windSpeed: number;
  config: HouseConfig;
  uplift: UpliftProfile;
  resistance: ResistanceProfile;
  stages: FailureStage[];
  highestStageReached: StageId | null;
  marginPsf: { field: number; edge: number; corner: number };
}

const DRIP_EDGE_TRIGGER_PSF = 30;

export function buildFailureCascade(
  windSpeed: number,
  profile: InstallProfile,
  config: HouseConfig = DEFAULT_HOUSE_CONFIG,
): CascadeResult {
  const uplift = configurableUpliftProfile(windSpeed, config);
  const resistance = profileResistance(profile);

  const dripEdgeTriggered = uplift.corner > DRIP_EDGE_TRIGGER_PSF;
  const fieldShinglesTriggered = uplift.field > resistance.shingleCapPsf;
  const edgeShinglesTriggered = uplift.edge > resistance.shingleCapPsf;
  const cornerShinglesTriggered = uplift.corner > resistance.shingleCapPsf;
  const anyShinglesTriggered =
    fieldShinglesTriggered || edgeShinglesTriggered || cornerShinglesTriggered;

  const underlaymentTriggered = anyShinglesTriggered;

  const sheathingTriggered =
    uplift.field > resistance.sheathing.field ||
    uplift.edge > resistance.sheathing.edge ||
    uplift.corner > resistance.sheathing.corner;

  const stages: FailureStage[] = [
    {
      id: 'drip_edge',
      label: 'Drip edge lifts',
      triggered: dripEdgeTriggered,
      zone: 'corner',
      severity: 'minor',
      homeownerImpact:
        'Visible flapping at the eaves and rakes. Wind-driven rain begins ' +
        'entering the perimeter. Cosmetic at first, but the gateway failure.',
    },
    {
      id: 'field_shingles',
      label: cornerShinglesTriggered
        ? 'Shingles lifting (corners → edges → field)'
        : edgeShinglesTriggered
        ? 'Shingles lifting (corners and edges)'
        : 'Field shingles lifting',
      triggered: anyShinglesTriggered,
      zone: cornerShinglesTriggered ? 'corner' : edgeShinglesTriggered ? 'edge' : 'field',
      severity: cornerShinglesTriggered ? 'major' : 'moderate',
      homeownerImpact:
        'Tabs detach starting at the corners (highest suction). ' +
        'Granule loss visible on the ground. Once the seal-strip bond is ' +
        'broken, neighboring tabs unzip in series.',
    },
    {
      id: 'underlayment',
      label: profile.hasSWB
        ? 'SWB exposed (still water-tight)'
        : 'Underlayment exposed (water intrusion begins)',
      triggered: underlaymentTriggered,
      severity: profile.hasSWB ? 'moderate' : 'major',
      homeownerImpact: profile.hasSWB
        ? 'Self-adhered secondary water barrier holds back rain even with ' +
          'shingles missing. The interior stays dry — this is the value of ' +
          'the WBDR upgrade.'
        : 'Standard #15 felt tears within minutes once shingles are gone. ' +
          'Wind-driven rain enters the attic. Ceiling staining and drywall ' +
          'failure begin within hours.',
    },
    {
      id: 'sheathing',
      label: 'Sheathing panels blow off',
      triggered: sheathingTriggered,
      zone: uplift.corner > resistance.sheathing.corner
        ? 'corner'
        : uplift.edge > resistance.sheathing.edge
        ? 'edge'
        : 'field',
      severity: 'catastrophic',
      homeownerImpact:
        'Whole 4×8 panels of OSB or plywood tear free of the rafters. ' +
        'The roof opens to sky. Rain pours into the living space, attic ' +
        'insulation flies, and the ceiling collapses.',
    },
  ];

  const highestStageReached = stages.reduce<StageId | null>(
    (acc, s) => (s.triggered ? s.id : acc),
    null,
  );

  return {
    windSpeed,
    config,
    uplift,
    resistance,
    stages,
    highestStageReached,
    marginPsf: {
      field: resistance.field - uplift.field,
      edge: resistance.edge - uplift.edge,
      corner: resistance.corner - uplift.corner,
    },
  };
}

export function failureWindSpeed(
  stage: StageId,
  profile: InstallProfile,
  config: HouseConfig = DEFAULT_HOUSE_CONFIG,
  range: [number, number] = [50, 220],
  tol = 0.5,
): number | null {
  const [min, max] = range;
  const triggered = (V: number) =>
    buildFailureCascade(V, profile, config).stages.find((s) => s.id === stage)?.triggered ?? false;

  if (!triggered(max)) return null;
  if (triggered(min)) return min;

  let lo = min;
  let hi = max;
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (triggered(mid)) hi = mid; else lo = mid;
  }
  return Math.round(hi * 2) / 2;
}
