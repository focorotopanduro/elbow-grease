/**
 * roofingProjectStore — Phase 14.R.3 tests.
 *
 * Covers:
 *   • defaults match the documented baseline (Lee County 60×40 reroof)
 *   • update() merges partial patches and persists
 *   • set() replaces the whole input and persists
 *   • reset() restores defaults + persists
 *   • selectProject() builds a valid FL Project from the flat input
 *   • computeEstimate() returns a non-null estimate for Lee County
 *   • computeEstimate() returns an error (not a crash) for unknown counties
 *   • localStorage round-trip (persist → loadFromStorage)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingProjectStore,
  selectProject,
  computeEstimate,
  __testables,
  type RoofingProjectInput,
  type RoofingProjectState,
} from '../roofingProjectStore';

function snapshotState(): RoofingProjectState {
  return useRoofingProjectStore.getState();
}

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  // Reset the store to the documented defaults so test ordering is
  // irrelevant. We avoid calling the public reset() action here
  // because that also persists — we want a clean slate.
  useRoofingProjectStore.setState({ input: { ...__testables.DEFAULTS } });
});

describe('defaults', () => {
  it('matches the documented baseline', () => {
    const d = __testables.DEFAULTS;
    expect(d.county).toBe('Lee');
    expect(d.length_ft).toBe(60);
    expect(d.width_ft).toBe(40);
    expect(d.slope_pitch).toBe('6:12');
    expect(d.roof_type).toBe('hip');
    expect(d.system).toBe('architectural_shingle');
    expect(d.install_method).toBe('direct_deck');
    expect(d.job_type).toBe('reroof');
    expect(d.plumbing_vent_count).toBe(3);
  });

  it('fresh store has defaults', () => {
    expect(snapshotState().input).toEqual(__testables.DEFAULTS);
  });
});

describe('update()', () => {
  it('merges a partial patch', () => {
    useRoofingProjectStore.getState().update({ length_ft: 80 });
    const s = snapshotState();
    expect(s.input.length_ft).toBe(80);
    // other fields left alone
    expect(s.input.width_ft).toBe(__testables.DEFAULTS.width_ft);
    expect(s.input.county).toBe(__testables.DEFAULTS.county);
  });

  it('persists to localStorage', () => {
    useRoofingProjectStore.getState().update({ county: 'Miami-Dade' });
    const raw = localStorage.getItem(__testables.STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as RoofingProjectInput;
    expect(parsed.county).toBe('Miami-Dade');
  });

  it('multiple updates compose', () => {
    useRoofingProjectStore.getState().update({ length_ft: 100 });
    useRoofingProjectStore.getState().update({ width_ft: 50 });
    const s = snapshotState();
    expect(s.input.length_ft).toBe(100);
    expect(s.input.width_ft).toBe(50);
  });
});

describe('set()', () => {
  it('replaces the whole input', () => {
    const override: RoofingProjectInput = {
      ...__testables.DEFAULTS,
      county: 'Broward',
      length_ft: 120,
      system: 'standing_seam_metal',
    };
    useRoofingProjectStore.getState().set(override);
    expect(snapshotState().input).toEqual(override);
  });

  it('persists', () => {
    const override: RoofingProjectInput = { ...__testables.DEFAULTS, county: 'Lee' };
    useRoofingProjectStore.getState().set(override);
    const raw = localStorage.getItem(__testables.STORAGE_KEY);
    expect(raw).toBeTruthy();
  });
});

describe('reset()', () => {
  it('restores defaults after mutation', () => {
    useRoofingProjectStore.getState().update({ length_ft: 999 });
    useRoofingProjectStore.getState().reset();
    expect(snapshotState().input).toEqual(__testables.DEFAULTS);
  });

  it('persists the reset', () => {
    useRoofingProjectStore.getState().update({ length_ft: 999 });
    useRoofingProjectStore.getState().reset();
    const raw = localStorage.getItem(__testables.STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as RoofingProjectInput;
    expect(parsed.length_ft).toBe(__testables.DEFAULTS.length_ft);
  });
});

describe('selectProject()', () => {
  it('builds a non-null project from defaults', () => {
    const p = selectProject(snapshotState());
    expect(p).toBeTruthy();
    expect(p.county).toBe('Lee');
    expect(p.roof.length_ft).toBe(60);
    expect(p.roof.width_ft).toBe(40);
    expect(p.system).toBe('architectural_shingle');
  });

  it('passes penetration counts through', () => {
    useRoofingProjectStore.getState().update({
      plumbing_vent_count: 7,
      skylight_count: 2,
      chimney_count: 1,
    });
    const p = selectProject(snapshotState());
    expect(p.plumbing_vent_count).toBe(7);
    expect(p.skylight_count).toBe(2);
    expect(p.chimney_count).toBe(1);
  });

  it('empty strings become null on the Project', () => {
    useRoofingProjectStore.getState().update({
      address: '',
      product_family: '',
      customer_name: '',
    });
    const p = selectProject(snapshotState());
    expect(p.address).toBeNull();
    expect(p.product_family).toBeNull();
    expect(p.customer_name).toBeNull();
  });
});

describe('computeEstimate()', () => {
  it('returns an estimate for the default Lee-County project', () => {
    const { estimate, error } = computeEstimate(snapshotState());
    expect(error).toBeNull();
    expect(estimate).not.toBeNull();
    expect(estimate!.line_items.length).toBeGreaterThan(0);
  });

  it('returns an error (not a throw) for an unknown county', () => {
    useRoofingProjectStore.getState().update({ county: 'NotARealCounty' });
    const { estimate, error } = computeEstimate(snapshotState());
    expect(estimate).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.length).toBeGreaterThan(0);
  });

  it('re-computes after a mutation', () => {
    const { estimate: before } = computeEstimate(snapshotState());
    useRoofingProjectStore.getState().update({ length_ft: 120, width_ft: 80 });
    const { estimate: after } = computeEstimate(snapshotState());
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Bigger roof → different totals somewhere. We don't pin an exact
    // number (the estimator internals evolve) but some quantity must
    // have grown.
    const beforeQty = before!.line_items.reduce((s, i) => s + i.quantity, 0);
    const afterQty = after!.line_items.reduce((s, i) => s + i.quantity, 0);
    expect(afterQty).toBeGreaterThan(beforeQty);
  });
});

describe('localStorage round-trip', () => {
  it('persist → parse matches what we wrote', () => {
    useRoofingProjectStore.getState().update({
      county: 'Orange',
      length_ft: 72,
      customer_name: 'Test Customer',
    });
    const raw = localStorage.getItem(__testables.STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as RoofingProjectInput;
    expect(parsed.county).toBe('Orange');
    expect(parsed.length_ft).toBe(72);
    expect(parsed.customer_name).toBe('Test Customer');
  });
});
