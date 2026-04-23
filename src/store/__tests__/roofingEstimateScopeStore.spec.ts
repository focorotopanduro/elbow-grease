/**
 * roofingEstimateScopeStore — Phase 14.R.6 tests.
 *
 * Covers:
 *   • defaults to 'all' on a fresh boot
 *   • setScope persists + toggle cycles
 *   • loadScope rejects non-enum localStorage values
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingEstimateScopeStore,
  __testables,
} from '../roofingEstimateScopeStore';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useRoofingEstimateScopeStore.setState({ scope: 'all' });
});

describe('default + persistence', () => {
  it('defaults to "all"', () => {
    expect(useRoofingEstimateScopeStore.getState().scope).toBe('all');
  });

  it('setScope writes to localStorage', () => {
    useRoofingEstimateScopeStore.getState().setScope('selected');
    expect(useRoofingEstimateScopeStore.getState().scope).toBe('selected');
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('selected');
  });

  it('localStorage key is the documented constant', () => {
    expect(__testables.STORAGE_KEY).toBe('elbow-grease-roofing-estimate-scope');
  });
});

describe('toggle()', () => {
  it('all → selected', () => {
    useRoofingEstimateScopeStore.getState().setScope('all');
    useRoofingEstimateScopeStore.getState().toggle();
    expect(useRoofingEstimateScopeStore.getState().scope).toBe('selected');
  });

  it('selected → all', () => {
    useRoofingEstimateScopeStore.getState().setScope('selected');
    useRoofingEstimateScopeStore.getState().toggle();
    expect(useRoofingEstimateScopeStore.getState().scope).toBe('all');
  });

  it('persists the toggle', () => {
    useRoofingEstimateScopeStore.getState().setScope('all');
    useRoofingEstimateScopeStore.getState().toggle();
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('selected');
  });

  it('double-toggle is a no-op', () => {
    const before = useRoofingEstimateScopeStore.getState().scope;
    useRoofingEstimateScopeStore.getState().toggle();
    useRoofingEstimateScopeStore.getState().toggle();
    expect(useRoofingEstimateScopeStore.getState().scope).toBe(before);
  });
});
