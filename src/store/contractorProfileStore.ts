/**
 * contractorProfileStore — the contractor's own identity info for
 * proposal title blocks.
 *
 * One-time setup. Persisted to localStorage so the user doesn't re-key
 * their license number on every project. The first-launch default is
 * a sentinel placeholder that the proposal-printer recognizes as
 * "unset" and prompts the user to fill in before their first print.
 */

import { create } from 'zustand';
import type { ContractorProfile } from '@core/print/proposalData';

const STORAGE_KEY = 'elbow-grease-contractor-profile';

export const PLACEHOLDER_COMPANY = '(Set company name in Ctrl+Shift+I)';

export const DEFAULT_CONTRACTOR_PROFILE: ContractorProfile = {
  companyName: PLACEHOLDER_COMPANY,
  contactName: '',
  licenseNumber: '',
  phone: '',
  email: '',
  addressLine1: '',
  cityStateZip: '',
  proposalTerms:
    'Proposal valid for 30 days. Payment terms: 50% on contract, 50% on ' +
    'completion. All work performed in accordance with applicable local, ' +
    'state, and federal plumbing codes. Any alterations or deviations from ' +
    'the above specifications involving extra cost will be executed only ' +
    'upon written change orders and will become an extra charge.',
};

interface ContractorState {
  profile: ContractorProfile;

  /** Merge partial edits into the active profile. */
  update: (patch: Partial<ContractorProfile>) => void;
  /** Replace the entire profile (e.g. "reset to default"). */
  setProfile: (next: ContractorProfile) => void;
  /** True when the company name is still the sentinel placeholder. */
  isUnset: () => boolean;
}

function loadProfile(): ContractorProfile {
  if (typeof window === 'undefined') return { ...DEFAULT_CONTRACTOR_PROFILE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONTRACTOR_PROFILE };
    const parsed = JSON.parse(raw) as Partial<ContractorProfile>;
    return { ...DEFAULT_CONTRACTOR_PROFILE, ...parsed };
  } catch {
    return { ...DEFAULT_CONTRACTOR_PROFILE };
  }
}

function saveProfile(p: ContractorProfile): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

export const useContractorProfileStore = create<ContractorState>((set, get) => ({
  profile: loadProfile(),

  update: (patch) => {
    const next: ContractorProfile = { ...get().profile, ...patch };
    set({ profile: next });
    saveProfile(next);
  },

  setProfile: (next) => {
    set({ profile: next });
    saveProfile(next);
  },

  isUnset: () => get().profile.companyName === PLACEHOLDER_COMPANY
    || get().profile.companyName.trim().length === 0,
}));

export function getActiveContractorProfile(): ContractorProfile {
  return useContractorProfileStore.getState().profile;
}
