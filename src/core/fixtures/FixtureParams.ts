/**
 * FixtureParams — per-fixture parameter schemas, defaults, and validation.
 *
 * Each fixture subtype has a rich set of configurable parameters that
 * determine:
 *   - Visual geometry (e.g., kitchen_sink bowlCount → 1/2/3 basins)
 *   - Hydraulic load (DFU/WSFU overrides for oversized units)
 *   - Drain/supply topology (tub drain left/right, WC 10"/12"/14" rough-in)
 *   - Selectable variants (brand-style prep faucets, shower valve types)
 *
 * The PARAM_SCHEMA is the single source of truth; the
 * FixtureParamWindow UI is rendered generically from the schema so that
 * new fixtures/fields appear automatically when added here.
 *
 * Field types:
 *   - number:   numeric input with min/max/step
 *   - select:   dropdown of named options (value is the option id)
 *   - toggle:   bool on/off
 *   - range:    slider (linear)
 *   - text:     freeform string (e.g. tag, model name)
 *
 * Conditional visibility via `showIf(params) => boolean`.
 */

import type { FixtureSubtype } from '../../engine/graph/GraphNode';

// ── Primitive field definitions ────────────────────────────────

export interface NumberField {
  kind: 'number';
  key: string;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  help?: string;
  showIf?: (params: Record<string, unknown>) => boolean;
}

export interface SelectField<T extends string = string> {
  kind: 'select';
  key: string;
  label: string;
  options: { id: T; label: string; icon?: string }[];
  help?: string;
  showIf?: (params: Record<string, unknown>) => boolean;
}

export interface ToggleField {
  kind: 'toggle';
  key: string;
  label: string;
  help?: string;
  showIf?: (params: Record<string, unknown>) => boolean;
}

export interface RangeField {
  kind: 'range';
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  help?: string;
  showIf?: (params: Record<string, unknown>) => boolean;
}

export interface TextField {
  kind: 'text';
  key: string;
  label: string;
  help?: string;
  showIf?: (params: Record<string, unknown>) => boolean;
}

export type ParamField = NumberField | SelectField | ToggleField | RangeField | TextField;

export interface ParamSection {
  title: string;
  fields: ParamField[];
}

export interface SubtypeSchema {
  /** Default parameter values when placing this fixture. */
  defaults: Record<string, unknown>;
  /** Grouped parameter sections displayed in the panel. */
  sections: ParamSection[];
  /** Compute effective DFU given the current params (may override GraphNode DFU_TABLE). */
  dfuOverride?: (p: Record<string, unknown>) => number | null;
  /** Compute WSFU override for supply branch sizing. */
  wsfuOverride?: (p: Record<string, unknown>) => { cold: number; hot: number } | null;
}

// ── Shared field building blocks ───────────────────────────────

const COMMON_PLACEMENT: ParamSection = {
  title: 'Placement',
  fields: [
    { kind: 'text',   key: 'tag',       label: 'Tag' },
    { kind: 'number', key: 'rotationDeg', label: 'Rotation', unit: '°', min: 0, max: 360, step: 5 },
    { kind: 'toggle', key: 'wallMounted', label: 'Wall mounted' },
  ],
};

const ROUGH_IN: ParamSection = {
  title: 'Rough-in heights',
  fields: [
    { kind: 'number', key: 'drainRoughIn',  label: 'Drain CL',  unit: 'in', min: 0,  max: 48, step: 0.5 },
    { kind: 'number', key: 'coldRoughIn',   label: 'Cold supply', unit: 'in', min: 0, max: 60, step: 0.5 },
    { kind: 'number', key: 'hotRoughIn',    label: 'Hot supply',  unit: 'in', min: 0, max: 60, step: 0.5 },
  ],
};

// ── Per-subtype schemas ────────────────────────────────────────

const WATER_CLOSET: SubtypeSchema = {
  defaults: {
    tag: 'WC',
    rotationDeg: 0,
    wallMounted: false,
    roughInDistance: 12,   // back-wall to drain CL
    flushType: '1.28gpf',
    bowlShape: 'elongated',
    seatHeight: 16.5,
    drainRoughIn: 3,
    coldRoughIn: 8,
    hotRoughIn: 0,
    commercial: false,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Toilet',
      fields: [
        {
          kind: 'select', key: 'roughInDistance', label: 'Rough-in',
          options: [
            { id: '10', label: '10" (compact)' },
            { id: '12', label: '12" (standard)' },
            { id: '14', label: '14" (deep)' },
          ],
        },
        {
          kind: 'select', key: 'flushType', label: 'Flush',
          options: [
            { id: '0.8gpf',  label: '0.8 gpf (low-flush)' },
            { id: '1.28gpf', label: '1.28 gpf (WaterSense)' },
            { id: '1.6gpf',  label: '1.6 gpf (legacy)' },
            { id: 'dual',    label: 'Dual flush' },
          ],
        },
        {
          kind: 'select', key: 'bowlShape', label: 'Bowl',
          options: [
            { id: 'round',     label: 'Round front' },
            { id: 'elongated', label: 'Elongated' },
          ],
        },
        { kind: 'number', key: 'seatHeight', label: 'Seat height', unit: 'in', min: 14, max: 21, step: 0.5 },
        { kind: 'toggle', key: 'commercial', label: 'Commercial (heavy-use)' },
      ],
    },
    ROUGH_IN,
  ],
  dfuOverride: (p) => (p.commercial ? 6 : 4),
};

const LAVATORY: SubtypeSchema = {
  defaults: {
    tag: 'LAV',
    rotationDeg: 0,
    wallMounted: false,
    faucetCenters: 4,
    basinShape: 'oval',
    drainRoughIn: 18,
    coldRoughIn: 21,
    hotRoughIn: 21,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Lavatory',
      fields: [
        {
          kind: 'select', key: 'faucetCenters', label: 'Faucet centers',
          options: [
            { id: '4',  label: '4" centerset' },
            { id: '8',  label: '8" widespread' },
            { id: 'single', label: 'Single hole' },
          ],
        },
        {
          kind: 'select', key: 'basinShape', label: 'Basin',
          options: [
            { id: 'oval',      label: 'Oval' },
            { id: 'rectangle', label: 'Rectangle' },
            { id: 'round',     label: 'Round' },
            { id: 'vessel',    label: 'Vessel' },
          ],
        },
      ],
    },
    ROUGH_IN,
  ],
};

const KITCHEN_SINK: SubtypeSchema = {
  defaults: {
    tag: 'KS',
    rotationDeg: 0,
    wallMounted: false,
    bowlCount: 2,
    bowlDepth: 9,
    garbageDisposal: true,
    disposalHP: 0.5,
    dishwasherConnected: true,
    airGap: true,
    instantHotWater: false,
    potFiller: false,
    drainRoughIn: 18,
    coldRoughIn: 22,
    hotRoughIn: 22,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Sink bowls',
      fields: [
        {
          kind: 'select', key: 'bowlCount', label: 'Bowl count',
          options: [
            { id: '1', label: 'Single' },
            { id: '2', label: 'Double' },
            { id: '3', label: 'Triple / prep' },
          ],
        },
        { kind: 'range',  key: 'bowlDepth', label: 'Bowl depth', unit: 'in', min: 6, max: 12, step: 0.5 },
      ],
    },
    {
      title: 'Under-sink equipment',
      fields: [
        { kind: 'toggle', key: 'garbageDisposal', label: 'Garbage disposal' },
        {
          kind: 'select', key: 'disposalHP', label: 'Disposal HP',
          options: [
            { id: '0.33', label: '1/3 HP' },
            { id: '0.5',  label: '1/2 HP' },
            { id: '0.75', label: '3/4 HP' },
            { id: '1.0',  label: '1 HP' },
          ],
          showIf: (p) => p.garbageDisposal === true,
        },
        { kind: 'toggle', key: 'dishwasherConnected', label: 'Dishwasher tie-in' },
        { kind: 'toggle', key: 'airGap',              label: 'Air gap required',
          showIf: (p) => p.dishwasherConnected === true },
        { kind: 'toggle', key: 'instantHotWater',     label: 'Instant hot tap' },
        { kind: 'toggle', key: 'potFiller',           label: 'Pot filler' },
      ],
    },
    ROUGH_IN,
  ],
  dfuOverride: (p) => (p.bowlCount === 3 ? 3 : p.bowlCount === 2 ? 2 : 2),
  wsfuOverride: (p) => {
    const base = 0.7;
    const mult = p.bowlCount === 3 ? 1.4 : p.bowlCount === 2 ? 1.0 : 0.8;
    return { cold: base * mult, hot: base * mult };
  },
};

const BATHTUB: SubtypeSchema = {
  defaults: {
    tag: 'TUB',
    rotationDeg: 0,
    wallMounted: false,
    tubStyle: 'alcove',
    length: 60,
    width: 32,
    drainSide: 'left',
    overflow: true,
    whirlpool: false,
    jetCount: 0,
    drainRoughIn: 2,
    coldRoughIn: 20,
    hotRoughIn: 20,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Tub',
      fields: [
        {
          kind: 'select', key: 'tubStyle', label: 'Style',
          options: [
            { id: 'alcove',    label: 'Alcove (3-wall)' },
            { id: 'drop_in',   label: 'Drop-in' },
            { id: 'freestand', label: 'Free-standing' },
            { id: 'corner',    label: 'Corner' },
          ],
        },
        { kind: 'number', key: 'length', label: 'Length', unit: 'in', min: 48, max: 84, step: 1 },
        { kind: 'number', key: 'width',  label: 'Width',  unit: 'in', min: 28, max: 42, step: 1 },
        {
          kind: 'select', key: 'drainSide', label: 'Drain side',
          options: [
            { id: 'left',   label: 'Left' },
            { id: 'right',  label: 'Right' },
            { id: 'center', label: 'Center' },
          ],
        },
        { kind: 'toggle', key: 'overflow', label: 'Overflow drain' },
        { kind: 'toggle', key: 'whirlpool', label: 'Whirlpool / jetted' },
        { kind: 'number', key: 'jetCount', label: 'Jets', min: 0, max: 20, step: 1,
          showIf: (p) => p.whirlpool === true },
      ],
    },
    ROUGH_IN,
  ],
  dfuOverride: (p) => (p.whirlpool ? 3 : 2),
};

const SHOWER: SubtypeSchema = {
  defaults: {
    tag: 'SH',
    rotationDeg: 0,
    wallMounted: false,
    panSize: '36x36',
    valveType: 'pressure_balance',
    bodySprays: false,
    rainHead: false,
    handheld: false,
    steamUnit: false,
    drainType: 'point',
    drainRoughIn: 2,
    coldRoughIn: 48,
    hotRoughIn: 48,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Shower',
      fields: [
        {
          kind: 'select', key: 'panSize', label: 'Pan size',
          options: [
            { id: '32x32', label: '32×32"' },
            { id: '36x36', label: '36×36"' },
            { id: '42x36', label: '42×36"' },
            { id: '48x36', label: '48×36"' },
            { id: '60x32', label: '60×32" (walk-in)' },
            { id: 'custom', label: 'Custom (curbless)' },
          ],
        },
        {
          kind: 'select', key: 'valveType', label: 'Valve',
          options: [
            { id: 'pressure_balance', label: 'Pressure balance' },
            { id: 'thermostatic',     label: 'Thermostatic' },
            { id: 'diverter',         label: 'Diverter (multi-head)' },
          ],
        },
        {
          kind: 'select', key: 'drainType', label: 'Drain type',
          options: [
            { id: 'point',  label: 'Point drain' },
            { id: 'linear', label: 'Linear drain' },
          ],
        },
        { kind: 'toggle', key: 'bodySprays', label: 'Body sprays' },
        { kind: 'toggle', key: 'rainHead',   label: 'Rain head' },
        { kind: 'toggle', key: 'handheld',   label: 'Handheld' },
        { kind: 'toggle', key: 'steamUnit',  label: 'Steam unit' },
      ],
    },
    ROUGH_IN,
  ],
  wsfuOverride: (p) => {
    let mult = 1;
    if (p.bodySprays) mult += 0.4;
    if (p.rainHead) mult += 0.3;
    if (p.handheld) mult += 0.2;
    return { cold: 1 * mult, hot: 1 * mult };
  },
};

const FLOOR_DRAIN: SubtypeSchema = {
  defaults: {
    tag: 'FD',
    rotationDeg: 0,
    wallMounted: false,
    size: 2,
    trapPrimer: true,
    gradeToDrain: 0.125,
    drainRoughIn: 0,
    coldRoughIn: 0,
    hotRoughIn: 0,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Floor drain',
      fields: [
        {
          kind: 'select', key: 'size', label: 'Outlet size',
          options: [
            { id: '2', label: '2"' },
            { id: '3', label: '3"' },
            { id: '4', label: '4"' },
          ],
        },
        { kind: 'toggle', key: 'trapPrimer', label: 'Trap primer' },
        { kind: 'number', key: 'gradeToDrain', label: 'Floor slope', unit: '/ft', min: 0, max: 0.5, step: 0.025 },
      ],
    },
  ],
};

const LAUNDRY: SubtypeSchema = {
  defaults: {
    tag: 'LS',
    rotationDeg: 0,
    wallMounted: false,
    standpipeHeight: 30,
    pan: true,
    panDrainSize: 2,
    drainRoughIn: 30,
    coldRoughIn: 36,
    hotRoughIn: 36,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Laundry standpipe',
      fields: [
        { kind: 'number', key: 'standpipeHeight', label: 'Standpipe height', unit: 'in', min: 18, max: 42, step: 1 },
        { kind: 'toggle', key: 'pan', label: 'Catch pan' },
        {
          kind: 'select', key: 'panDrainSize', label: 'Pan drain',
          options: [{ id: '1', label: '1"' }, { id: '1.5', label: '1-1/2"' }, { id: '2', label: '2"' }],
          showIf: (p) => p.pan === true,
        },
      ],
    },
    ROUGH_IN,
  ],
};

const DISHWASHER: SubtypeSchema = {
  defaults: {
    tag: 'DW',
    rotationDeg: 0,
    wallMounted: false,
    airGap: true,
    powerMode: '120V',
    tieIn: 'disposal',
    drainRoughIn: 8,
    coldRoughIn: 0,
    hotRoughIn: 8,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Dishwasher',
      fields: [
        {
          kind: 'select', key: 'tieIn', label: 'Drain tie-in',
          options: [
            { id: 'disposal', label: 'To disposal' },
            { id: 'tailpiece', label: 'Sink tailpiece' },
            { id: 'direct', label: 'Direct DWV' },
          ],
        },
        { kind: 'toggle', key: 'airGap', label: 'Air gap required' },
        {
          kind: 'select', key: 'powerMode', label: 'Power',
          options: [{ id: '120V', label: '120V cord' }, { id: 'hardwired', label: 'Hardwired' }],
        },
      ],
    },
    ROUGH_IN,
  ],
};

const CLOTHES_WASHER: SubtypeSchema = {
  defaults: {
    tag: 'CW',
    rotationDeg: 0,
    wallMounted: false,
    boxed: true,
    hammerArrestor: true,
    drainRoughIn: 34,
    coldRoughIn: 42,
    hotRoughIn: 42,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Clothes washer',
      fields: [
        { kind: 'toggle', key: 'boxed', label: 'Supply/drain box' },
        { kind: 'toggle', key: 'hammerArrestor', label: 'Water hammer arrestor' },
      ],
    },
    ROUGH_IN,
  ],
};

const HOSE_BIBB: SubtypeSchema = {
  defaults: {
    tag: 'HB',
    rotationDeg: 0,
    wallMounted: true,
    frostFree: true,
    vacuumBreaker: true,
    length: 8,
    drainRoughIn: 0,
    coldRoughIn: 24,
    hotRoughIn: 0,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Hose bibb',
      fields: [
        { kind: 'toggle', key: 'frostFree', label: 'Frost-free' },
        { kind: 'number', key: 'length', label: 'Stem length', unit: 'in', min: 4, max: 18, step: 1,
          showIf: (p) => p.frostFree === true },
        { kind: 'toggle', key: 'vacuumBreaker', label: 'Vacuum breaker' },
      ],
    },
    ROUGH_IN,
  ],
};

const URINAL: SubtypeSchema = {
  defaults: {
    tag: 'UR',
    rotationDeg: 0,
    wallMounted: true,
    flushType: '0.125gpf',
    waterless: false,
    ada: false,
    drainRoughIn: 22,
    coldRoughIn: 45,
    hotRoughIn: 0,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Urinal',
      fields: [
        {
          kind: 'select', key: 'flushType', label: 'Flush',
          options: [
            { id: '0.125gpf', label: '0.125 gpf (pint)' },
            { id: '0.5gpf',   label: '0.5 gpf' },
            { id: '1.0gpf',   label: '1.0 gpf' },
          ],
          showIf: (p) => p.waterless === false,
        },
        { kind: 'toggle', key: 'waterless', label: 'Waterless' },
        { kind: 'toggle', key: 'ada', label: 'ADA' },
      ],
    },
    ROUGH_IN,
  ],
  dfuOverride: (p) => (p.waterless ? 0.5 : 2),
};

const MOP_SINK: SubtypeSchema = {
  defaults: {
    tag: 'MS',
    rotationDeg: 0,
    wallMounted: false,
    size: '24x24',
    faucetHeight: 42,
    hoseReel: false,
    drainRoughIn: 2,
    coldRoughIn: 45,
    hotRoughIn: 45,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Mop sink',
      fields: [
        {
          kind: 'select', key: 'size', label: 'Size',
          options: [
            { id: '24x24', label: '24×24"' },
            { id: '28x28', label: '28×28"' },
            { id: '36x24', label: '36×24"' },
          ],
        },
        { kind: 'number', key: 'faucetHeight', label: 'Faucet CL', unit: 'in', min: 36, max: 60, step: 1 },
        { kind: 'toggle', key: 'hoseReel', label: 'Hose reel' },
      ],
    },
    ROUGH_IN,
  ],
};

const DRINKING_FOUNTAIN: SubtypeSchema = {
  defaults: {
    tag: 'DF',
    rotationDeg: 0,
    wallMounted: true,
    bottleFiller: true,
    chilled: false,
    ada: true,
    drainRoughIn: 17,
    coldRoughIn: 30,
    hotRoughIn: 0,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Drinking fountain',
      fields: [
        { kind: 'toggle', key: 'bottleFiller', label: 'Bottle filler' },
        { kind: 'toggle', key: 'chilled', label: 'Chilled' },
        { kind: 'toggle', key: 'ada', label: 'ADA (bi-level)' },
      ],
    },
    ROUGH_IN,
  ],
};

// ── Master registry ────────────────────────────────────────────

// Phase 14.Y — minimal schemas for equipment + specialty fixtures.
// These don't expose user-editable fields yet (beyond placement)
// because their parametric behavior lands in 14.Y.2; for now we
// just need the schema to exist so PARAM_SCHEMA is exhaustive over
// the FixtureSubtype union.
const MINIMAL_PLACEMENT_ONLY: SubtypeSchema = {
  defaults: { rotationDeg: 0, wallMounted: false },
  sections: [COMMON_PLACEMENT],
};

const WATER_HEATER: SubtypeSchema = {
  defaults: {
    rotationDeg: 0, wallMounted: false,
    capacityGal: 50,
    energy: 'gas',   // 'gas' | 'electric'
    expansionTank: true,
  },
  sections: [
    COMMON_PLACEMENT,
    {
      title: 'Heater',
      fields: [
        { kind: 'number', key: 'capacityGal', label: 'Capacity', unit: 'gal', min: 20, max: 100, step: 10 },
        { kind: 'select', key: 'energy', label: 'Energy',
          options: [{ id: 'gas', label: 'Gas' }, { id: 'electric', label: 'Electric' }] },
        { kind: 'toggle', key: 'expansionTank', label: 'Expansion tank' },
      ],
    },
  ],
};

export const PARAM_SCHEMA: Record<FixtureSubtype, SubtypeSchema> = {
  water_closet:      WATER_CLOSET,
  lavatory:          LAVATORY,
  kitchen_sink:      KITCHEN_SINK,
  bathtub:           BATHTUB,
  shower:            SHOWER,
  floor_drain:       FLOOR_DRAIN,
  laundry_standpipe: LAUNDRY,
  dishwasher:        DISHWASHER,
  clothes_washer:    CLOTHES_WASHER,
  hose_bibb:         HOSE_BIBB,
  urinal:            URINAL,
  mop_sink:          MOP_SINK,
  drinking_fountain: DRINKING_FOUNTAIN,
  // Phase 14.Y equipment + specialty
  water_heater:            WATER_HEATER,
  tankless_water_heater:   MINIMAL_PLACEMENT_ONLY,
  bidet:                   MINIMAL_PLACEMENT_ONLY,
  laundry_tub:             MINIMAL_PLACEMENT_ONLY,
  utility_sink:            MINIMAL_PLACEMENT_ONLY,
  expansion_tank:          MINIMAL_PLACEMENT_ONLY,
  backflow_preventer:      MINIMAL_PLACEMENT_ONLY,
  pressure_reducing_valve: MINIMAL_PLACEMENT_ONLY,
  cleanout_access:         MINIMAL_PLACEMENT_ONLY,
};

// ── Helpers ────────────────────────────────────────────────────

/** Deep-clone the defaults for a subtype (so fixtures don't share the same object). */
export function defaultParamsFor(subtype: FixtureSubtype): Record<string, unknown> {
  return JSON.parse(JSON.stringify(PARAM_SCHEMA[subtype].defaults));
}

/** Merge partial user overrides onto the subtype's defaults. */
export function mergeParams(
  subtype: FixtureSubtype,
  overrides: Partial<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...defaultParamsFor(subtype), ...overrides };
}

/** DFU after schema override (falls back to the static DFU_TABLE value). */
export function effectiveDFU(
  subtype: FixtureSubtype,
  params: Record<string, unknown>,
  fallback: number,
): number {
  const override = PARAM_SCHEMA[subtype].dfuOverride;
  if (override) {
    const v = override(params);
    if (v !== null) return v;
  }
  return fallback;
}

/** WSFU after schema override. */
export function effectiveWSFU(
  subtype: FixtureSubtype,
  params: Record<string, unknown>,
  fallback: { cold: number; hot: number },
): { cold: number; hot: number } {
  const override = PARAM_SCHEMA[subtype].wsfuOverride;
  if (override) {
    const v = override(params);
    if (v !== null) return v;
  }
  return fallback;
}
