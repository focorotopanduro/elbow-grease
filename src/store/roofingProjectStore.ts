/**
 * roofingProjectStore — Phase 14.R.3.
 *
 * Zustand store holding the CURRENT Florida roofing estimate's
 * input parameters — i.e. everything the user types into the
 * Roofing Inspector form. A derived selector `computeEstimate()`
 * runs the full fl_roofing pipeline on demand.
 *
 * Kept DELIBERATELY flat + primitive-typed so the Inspector form
 * is a straightforward `value ↔ setter` binding per field — no
 * nested `project.roof.length_ft` paths that break React change
 * detection.
 *
 * Persists to localStorage so the user's last inputs come back
 * on next launch — matches the `appModeStore` + `renderModeStore`
 * pattern.
 */

import { create } from 'zustand';
import {
  type Project,
  type RoofTypeFL,
  type SystemFL,
  type RoofComplexity,
  type JobType,
  type InstallMethod,
  type Estimate,
  createProject,
} from '@engine/roofing/fl/core';
import { estimate } from '@engine/roofing/fl/estimator';

const STORAGE_KEY = 'elbow-grease-roofing-project';

/** Flat, form-friendly shape of the FL Project. */
export interface RoofingProjectInput {
  county: string;
  length_ft: number;
  width_ft: number;
  mean_height_ft: number;
  slope_pitch: string;
  roof_type: RoofTypeFL;
  complexity: RoofComplexity;
  system: SystemFL;
  product_family: string;
  address: string;
  wood_species: string;
  sheathing_thickness: string;
  framing_spacing_in: number;
  distance_to_saltwater_ft: number;
  job_type: JobType;
  risk_category: number;
  install_method: InstallMethod;
  plumbing_vent_count: number;
  skylight_count: number;
  chimney_count: number;
  customer_name: string;
  project_id: string;
  notes: string;
}

const DEFAULTS: RoofingProjectInput = {
  county: 'Lee',
  length_ft: 60,
  width_ft: 40,
  mean_height_ft: 10,
  slope_pitch: '6:12',
  roof_type: 'hip',
  complexity: 'simple',
  system: 'architectural_shingle',
  product_family: '',
  address: '',
  wood_species: 'SYP',
  sheathing_thickness: '15/32',
  framing_spacing_in: 24,
  distance_to_saltwater_ft: 5000,
  job_type: 'reroof',
  risk_category: 2,
  install_method: 'direct_deck',
  plumbing_vent_count: 3,
  skylight_count: 0,
  chimney_count: 0,
  customer_name: '',
  project_id: '',
  notes: '',
};

export interface RoofingProjectState {
  input: RoofingProjectInput;
  /** Update one or more fields atomically. */
  update: (patch: Partial<RoofingProjectInput>) => void;
  /** Replace the whole input (used by "Load Example" buttons). */
  set: (input: RoofingProjectInput) => void;
  reset: () => void;
}

function loadFromStorage(): RoofingProjectInput {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<RoofingProjectInput>;
    // Merge with defaults so older snapshots missing newer fields
    // still load cleanly.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function persistToStorage(input: RoofingProjectInput): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(input)); }
  catch { /* quota / disabled; ignore */ }
}

export const useRoofingProjectStore = create<RoofingProjectState>((set) => ({
  input: loadFromStorage(),

  update: (patch) => set((s) => {
    const next = { ...s.input, ...patch };
    persistToStorage(next);
    return { input: next };
  }),

  set: (input) => set(() => {
    persistToStorage(input);
    return { input };
  }),

  reset: () => set(() => {
    const next = { ...DEFAULTS };
    persistToStorage(next);
    return { input: next };
  }),
}));

// ── Derived selectors ───────────────────────────────────────────

/** Build a full FL `Project` from the flat input fields. */
export function selectProject(state: RoofingProjectState): Project {
  const i = state.input;
  return createProject({
    county: i.county,
    roof: {
      length_ft: i.length_ft,
      width_ft: i.width_ft,
      mean_height_ft: i.mean_height_ft,
      slope_pitch: i.slope_pitch,
      roof_type: i.roof_type,
      complexity: i.complexity,
    },
    system: i.system,
    address: i.address || null,
    wood_species: i.wood_species,
    sheathing_thickness: i.sheathing_thickness,
    framing_spacing_in: i.framing_spacing_in,
    distance_to_saltwater_ft: i.distance_to_saltwater_ft,
    job_type: i.job_type,
    risk_category: i.risk_category,
    product_family: i.product_family || null,
    customer_name: i.customer_name || null,
    project_id: i.project_id || null,
    notes: i.notes || null,
    install_method: i.install_method,
    plumbing_vent_count: i.plumbing_vent_count,
    skylight_count: i.skylight_count,
    chimney_count: i.chimney_count,
  });
}

/**
 * Compute the full estimate from the current input. Catches the
 * "unknown county" error that `estimate()` throws so the UI can
 * render an error state instead of crashing.
 */
export function computeEstimate(state: RoofingProjectState): {
  estimate: Estimate | null;
  error: string | null;
} {
  try {
    const project = selectProject(state);
    return { estimate: estimate(project), error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { estimate: null, error: msg };
  }
}

export const __testables = { STORAGE_KEY, DEFAULTS };
