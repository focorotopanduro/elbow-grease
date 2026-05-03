import type { CascadeResult } from '../physics/cascade';

/**
 * Element label registry — every `data-label="..."` in the scene SVG maps
 * to one entry here. The Labels toggle (in the View popover) lights up
 * the entire scene with hover-driven tooltips that cite the relevant
 * building code AND describe the live cascade state.
 *
 * Educational copy is pitched at homeowners (not engineers) but cites the
 * actual code section so contractors + skeptical visitors trust it.
 */

export interface ElementLabel {
  id: string;
  /** Display name in the tooltip header */
  name: string;
  /** Code reference (FBC / ASCE / ASTM section) */
  codeRef?: string;
  /** 1–2 sentence plain-English explanation */
  description: string;
  /**
   * Optional dynamic-state function. Returns a short live status like
   * "fluttering loose" or "intact". Reads from the live cascade + V
   * so tooltips reflect what's happening right now.
   */
  dynamicState?: (cascade: CascadeResult, V: number) => string | null;
}

const stageTriggered = (cascade: CascadeResult, id: string): boolean =>
  cascade.stages.find((s) => s.id === id)?.triggered ?? false;

export const ELEMENT_LABELS: Record<string, ElementLabel> = {
  // ─── ROOF ──────────────────────────────────────────────────────────────
  'roof-ridge': {
    id: 'roof-ridge',
    name: 'Ridge cap',
    codeRef: 'FBC §1518',
    description:
      'Hip + ridge shingles capping the roof apex. Sealed at the highest pressure point. First place water gets in if shingles fail.',
  },
  'shingle-field': {
    id: 'shingle-field',
    name: 'Field shingles · Zone 1',
    codeRef: 'ASCE 7-22 §30 · ASTM D7158',
    description:
      'The interior of the roof slope, where uplift pressure is lowest. Class H shingles are rated for 150 mph here.',
    dynamicState: (cascade) =>
      stageTriggered(cascade, 'sheathing')
        ? 'GONE'
        : stageTriggered(cascade, 'field_shingles')
          ? 'lifting'
          : 'intact',
  },
  'shingle-corner': {
    id: 'shingle-corner',
    name: 'Corner zone · Zone 3',
    codeRef: 'ASCE 7-22 §30',
    description:
      'Roof corners experience ~3× the field uplift. This is where most hurricane failures begin — corner shingles peel first.',
    dynamicState: (cascade) => {
      const ratio = cascade.uplift.corner / cascade.resistance.shingleCapPsf;
      if (ratio > 1.5) return 'CRITICAL';
      if (ratio > 1.0) return 'overloaded';
      return `${(ratio * 100).toFixed(0)}% of capacity`;
    },
  },
  'gable-end': {
    id: 'gable-end',
    name: 'Gable end',
    codeRef: 'FBC §1518.5',
    description:
      'The triangular wall under the roof slope. Vulnerable to wind suction; modern code requires bracing back to the trusses.',
  },
  'sheathing': {
    id: 'sheathing',
    name: 'Roof sheathing',
    codeRef: 'FBC §708.7 · NDS 2018 Tbl 12.2C',
    description:
      'OSB or plywood deck under the shingles. Re-roofs after 2007 require 8d ring-shank nails 4" o.c. — old code used 6d smooth.',
    dynamicState: (cascade) => {
      if (stageTriggered(cascade, 'sheathing')) return 'TORN OFF';
      if (stageTriggered(cascade, 'underlayment')) return 'exposed';
      return 'covered';
    },
  },

  // ─── HOUSE ─────────────────────────────────────────────────────────────
  'drip-edge': {
    id: 'drip-edge',
    name: 'Drip edge',
    codeRef: 'FBC §1518.7',
    description:
      'Aluminum L-flashing along every eave + rake. Keeps wind-driven rain from getting under the shingles.',
    dynamicState: (cascade) =>
      stageTriggered(cascade, 'drip_edge') ? 'fluttering loose' : 'intact',
  },
  'wall-stucco': {
    id: 'wall-stucco',
    name: 'Stucco wall',
    codeRef: 'FBC §1405',
    description:
      'Cement-based finish over wood-frame studs. Designed for the same 30 psf cladding pressure as windows.',
  },
  'front-window': {
    id: 'front-window',
    name: 'Window · Hurricane shutters',
    codeRef: 'FBC §1709 · ASTM E1996',
    description:
      'Impact-rated glass + accordion or roll-down shutters. Florida WBDR requires Large Missile Impact Class D rating.',
    dynamicState: (_, V) => (V > 140 ? 'shutters CLOSED' : 'shutters open'),
  },
  'garage-door': {
    id: 'garage-door',
    name: 'Garage door',
    codeRef: 'FBC §1714',
    description:
      "Largest opening on most homes. If it fails, internal pressure ramps up + can blow the roof off from the inside. Requires bracing or impact rating in WBDR.",
    dynamicState: (_, V) => {
      if (V >= 175) return 'CATASTROPHIC';
      if (V >= 160) return 'BUCKLING';
      if (V >= 140) return 'flexing';
      return 'intact';
    },
  },
  'chimney': {
    id: 'chimney',
    name: 'Chimney',
    codeRef: 'FBC §2113',
    description:
      'Masonry stack penetrating the roof. Step-flashed at the base. A common leak point post-storm if flashing tears.',
  },

  // ─── LANDSCAPE / SITE ──────────────────────────────────────────────────
  'palm-tree': {
    id: 'palm-tree',
    name: 'Palm tree',
    description:
      'Sabal palms (Florida state tree) flex with hurricane winds — rarely fall, but their fronds become projectiles at >100 mph.',
  },
  'power-pole': {
    id: 'power-pole',
    name: 'Utility pole + service drop',
    description:
      'The most common Florida storm casualty. Pole sway begins ~100 mph; lines snap around 140 mph. Average outage after Cat 3+ landfall: 4–7 days.',
    dynamicState: (_, V) => {
      if (V >= 175) return 'POLE DOWN';
      if (V >= 140) return 'LINE SNAPPED';
      if (V >= 100) return 'swaying';
      return 'normal';
    },
  },
  'storm-flag': {
    id: 'storm-flag',
    name: 'American flag',
    description:
      'Universal wind cue. Snapping horizontal at 80 mph; tattered at 140; shredded by 185. If your neighbor\'s flag is gone, the storm was bad.',
  },
};

export const LABEL_IDS = Object.keys(ELEMENT_LABELS);
