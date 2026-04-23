/**
 * pricingStore — active pricing profile for bid generation.
 *
 * Phase 14.A ships a single-active-profile model:
 *   • One `profile` lives in the store.
 *   • Seeded from `FL_RESIDENTIAL_DEFAULT` on first boot.
 *   • Persisted to localStorage so edits survive reloads.
 *   • Editable via the PricingProfilePanel UI (Ctrl+Shift+$).
 *
 * The store is intentionally simple. Per-customer profile overrides +
 * multi-profile library are v2 concerns. The current shape lets a solo
 * contractor run the app with their actual rates without hitting any
 * multi-profile management surface.
 *
 * See ADR 032 for the math + FL rule rationale.
 */

import { create } from 'zustand';
import {
  FL_RESIDENTIAL_DEFAULT,
  type PricingProfile,
} from '../engine/export/computeBid';

const STORAGE_KEY = 'elbow-grease-pricing-profile';

interface PricingState {
  profile: PricingProfile;

  /** Merge partial edits into the active profile (UI editor uses this). */
  update: (patch: Partial<PricingProfile>) => void;
  /** Replace the entire profile (e.g. "load FL default", "import from file"). */
  setProfile: (next: PricingProfile) => void;
  /** Reset to the seeded default. Confirmation is the UI's responsibility. */
  resetToDefault: () => void;
}

function loadProfile(): PricingProfile {
  if (typeof window === 'undefined') return { ...FL_RESIDENTIAL_DEFAULT };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...FL_RESIDENTIAL_DEFAULT };
    const parsed = JSON.parse(raw) as Partial<PricingProfile>;
    // Merge on top of default so new fields added in future releases
    // pick up a sensible value without forcing the user to reset.
    return { ...FL_RESIDENTIAL_DEFAULT, ...parsed };
  } catch {
    return { ...FL_RESIDENTIAL_DEFAULT };
  }
}

function saveProfile(p: PricingProfile): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

export const usePricingStore = create<PricingState>((set, get) => ({
  profile: loadProfile(),

  update: (patch) => {
    const next: PricingProfile = {
      ...get().profile,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    set({ profile: next });
    saveProfile(next);
  },

  setProfile: (next) => {
    const stamped: PricingProfile = { ...next, updatedAt: new Date().toISOString() };
    set({ profile: stamped });
    saveProfile(stamped);
  },

  resetToDefault: () => {
    const fresh = { ...FL_RESIDENTIAL_DEFAULT, updatedAt: new Date().toISOString() };
    set({ profile: fresh });
    saveProfile(fresh);
  },
}));

/** Non-React getter. Used by BOMExporter when computing bids from export flow. */
export function getActivePricingProfile(): PricingProfile {
  return usePricingStore.getState().profile;
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = { STORAGE_KEY };
