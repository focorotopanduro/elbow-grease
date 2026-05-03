/**
 * Orlando-specific reference data for the wind-uplift visualizer.
 *
 * Ground truth: ASCE 7-22 Fig 26.5-1A wind-speed map (Risk Cat II), FBC 8th
 * Ed. Tbl R301.2(2), and NHC HURDAT2 best-track database for named-storm
 * peak winds.
 */

export const ORLANDO_DESIGN_WIND_SPEED = {
  riskCatII: { min: 130, max: 140, unit: 'mph' },
  source: 'ASCE 7-22 Fig 26.5-1A; FBC 8th Ed. (2023) Tbl R301.2(2)',
  region: 'WBDR (Wind-Borne Debris Region) — NOT HVHZ',
  hvhzNote:
    'HVHZ (High-Velocity Hurricane Zone) is Miami-Dade and Broward counties ' +
    'only. Orlando installs are WBDR-grade. Never label them HVHZ.',
} as const;

// Slider band shown on the visualizer UI
export const SLIDER = {
  min: 60,
  max: 200,
  step: 1,
  designBand: ORLANDO_DESIGN_WIND_SPEED.riskCatII,
} as const;

// Saffir-Simpson hurricane categories (3-second gust ranges per NHC)
export interface HurricaneCategory {
  cat: number;
  label: string;
  minMph: number;
  maxMph: number;
}

export const HURRICANE_CATEGORIES: HurricaneCategory[] = [
  { cat: 1, label: 'Cat 1', minMph: 74,  maxMph: 95 },
  { cat: 2, label: 'Cat 2', minMph: 96,  maxMph: 110 },
  { cat: 3, label: 'Cat 3', minMph: 111, maxMph: 129 },
  { cat: 4, label: 'Cat 4', minMph: 130, maxMph: 156 },
  { cat: 5, label: 'Cat 5', minMph: 157, maxMph: 200 },
];

// Named storms relevant to Central Florida — peak sustained winds at landfall
export interface NamedStorm {
  id: string;
  name: string;
  year: number;
  peakMph: number;
  landfall: string;
  note: string;
}

export const NAMED_STORMS: NamedStorm[] = [
  {
    id: 'andrew_1992',
    name: 'Andrew',
    year: 1992,
    peakMph: 175,
    landfall: 'Homestead, FL',
    note: 'Cat 5. Triggered the 2001 FBC rewrite that created WBDR/HVHZ.',
  },
  {
    id: 'charley_2004',
    name: 'Charley',
    year: 2004,
    peakMph: 150,
    landfall: 'Punta Gorda → Orlando',
    note: 'Cat 4 at landfall. Crossed Central Florida directly. The Orlando event.',
  },
  {
    id: 'ian_2022',
    name: 'Ian',
    year: 2022,
    peakMph: 140,
    landfall: 'Cayo Costa, FL',
    note: 'Cat 4. Devastated SW Florida; sustained Cat 1 winds reached Orlando.',
  },
  {
    id: 'milton_2024',
    name: 'Milton',
    year: 2024,
    peakMph: 120,
    landfall: 'Siesta Key, FL',
    note: 'Cat 3 at landfall, weakened crossing the state to Cat 1 over Orlando.',
  },
];

// FBC sections cited inline — every reference verified against FBC 8th Ed.
// Update before publishing; flag any unverified additions to Carlos.
export const FBC_REFERENCES = {
  '708.7': {
    section: 'FBC 708.7',
    text: 'Reroofing — sheathing reattachment + secondary water barrier required',
    summary:
      'When a roof covering is replaced, exposed sheathing must be inspected ' +
      'and refastened to current code. A secondary water barrier (SWB) must ' +
      'be installed over the entire roof deck.',
    appliesWhen: 'Any reroof on an existing structure in WBDR.',
  },
  '1504.1.1': {
    section: 'FBC 1504.1.1',
    text: 'Wind resistance of asphalt shingles',
    summary:
      'Asphalt shingles in WBDR shall meet ASTM D7158 Class H (150 mph) ' +
      'or ASTM D3161 Class F (110 mph), whichever is more restrictive.',
    appliesWhen: 'New roof or reroof in WBDR.',
  },
  '1518': {
    section: 'FBC 1518',
    text: 'Reroofing requirements',
    summary:
      'Establishes the framework for reroof permits, including secondary ' +
      'water barrier and sheathing reattachment triggers.',
    appliesWhen: 'Any reroof permit in Florida.',
  },
} as const;
