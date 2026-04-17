/**
 * PhaseTypes — construction-phase taxonomy for plumbing work.
 *
 * Every residential/commercial plumbing job happens in three distinct
 * phases, each billed separately and often by different crews:
 *
 *   1. UNDERGROUND  — Before the slab pour. Main sewer line, below-slab
 *                     DWV branches, fixture drain stubs poking up through
 *                     where the slab will be.
 *                     Typical materials: cast iron, SDR-35, schedule-40
 *                     PVC. Inspected by "rough-in underground" before
 *                     concrete is poured.
 *
 *   2. ROUGH-IN     — After framing, before drywall. All supply (copper/
 *                     PEX) and above-slab DWV inside walls and joists.
 *                     Water heater rough, shower valves, tub fillers,
 *                     hose bibbs, air chambers. Inspected when walls are
 *                     still open.
 *
 *   3. TRIM         — After tile and drywall. Fixtures set, faucets
 *                     installed, trim rings, escutcheons, supply stops
 *                     from rough stub to fixture tail. Final inspection.
 *
 * The phase an object belongs to determines:
 *   - When it appears on the jobsite
 *   - Which invoice line item covers its labor + materials
 *   - Which inspection it's tied to
 *   - What visibility filter the plumber wants while drafting
 *
 * Auto-classification rules (see PhaseClassifier.ts):
 *   - Pipes below Y=0 (slab) → UNDERGROUND
 *   - Fixtures themselves    → TRIM
 *   - Everything else        → ROUGH-IN
 */

export type ConstructionPhase = 'underground' | 'rough_in' | 'trim';

export const PHASE_ORDER: ConstructionPhase[] = ['underground', 'rough_in', 'trim'];

export interface PhaseMeta {
  id: ConstructionPhase;
  label: string;
  shortLabel: string;
  icon: string;
  /** Accent color used in UI and optional pipe tinting. */
  color: string;
  /** Hotkey digit (1/2/3). */
  hotkey: '1' | '2' | '3';
  /** Brief one-liner shown in tooltips. */
  description: string;
}

export const PHASE_META: Record<ConstructionPhase, PhaseMeta> = {
  underground: {
    id: 'underground',
    label: 'Underground',
    shortLabel: 'UG',
    icon: '⛏',
    color: '#8d6e63',
    hotkey: '1',
    description: 'Below-slab DWV and sewer — before concrete',
  },
  rough_in: {
    id: 'rough_in',
    label: 'Rough-in',
    shortLabel: 'RI',
    icon: '🔧',
    color: '#26c6da',
    hotkey: '2',
    description: 'Supply and above-slab DWV inside walls',
  },
  trim: {
    id: 'trim',
    label: 'Trim',
    shortLabel: 'TR',
    icon: '✨',
    color: '#ffd54f',
    hotkey: '3',
    description: 'Fixtures, faucets, stops — finish phase',
  },
};

/**
 * Phase visibility mode — controls what the user sees on-screen:
 *
 *   single     Only the active phase is rendered
 *   cumulative Active phase + all earlier phases (field-walk view —
 *              what exists on site at this point in time)
 *   all        All phases rendered regardless of active
 */
export type PhaseVisibilityMode = 'single' | 'cumulative' | 'all';

/**
 * For a given active phase and visibility mode, should this object's
 * phase be rendered?
 */
export function shouldPhaseRender(
  objectPhase: ConstructionPhase,
  activePhase: ConstructionPhase,
  mode: PhaseVisibilityMode,
): boolean {
  if (mode === 'all') return true;
  if (mode === 'single') return objectPhase === activePhase;
  // cumulative: object phase must be <= active phase in construction order
  const objIdx = PHASE_ORDER.indexOf(objectPhase);
  const actIdx = PHASE_ORDER.indexOf(activePhase);
  return objIdx <= actIdx;
}

/**
 * Cost-estimate markers per phase (used by BOM panel). These are
 * approximate labor-hour multipliers applied to material cost — the
 * plumber's take-off tool can override later.
 */
export const PHASE_LABOR_MULT: Record<ConstructionPhase, number> = {
  underground: 1.8,  // heavy, dirty, hard to re-do
  rough_in:    1.0,
  trim:        1.4,  // meticulous, customer-facing
};
