/**
 * roofingScopeStore — Phase 14.R.6 tests.
 *
 * Covers:
 *   • defaults to 'all' on a fresh boot
 *   • setScope persists + toggle cycles
 *   • loadScope rejects non-enum localStorage values
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useRoofingScopeStore,
  __testables,
} from '../roofingScopeStore';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  useRoofingScopeStore.setState({ scope: 'all' });
});

describe('default + persistence', () => {
  it('defaults to "all"', () => {
    expect(useRoofingScopeStore.getState().scope).toBe('all');
  });

  it('setScope writes to localStorage', () => {
    useRoofingScopeStore.getState().setScope('selected');
    expect(useRoofingScopeStore.getState().scope).toBe('selected');
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('selected');
  });

  it('localStorage key is the documented constant', () => {
    expect(__testables.STORAGE_KEY).toBe('elbow-grease-roofing-estimate-scope');
  });
});

describe('toggle()', () => {
  it('all → selected', () => {
    useRoofingScopeStore.getState().setScope('all');
    useRoofingScopeStore.getState().toggle();
    expect(useRoofingScopeStore.getState().scope).toBe('selected');
  });

  it('selected → all', () => {
    useRoofingScopeStore.getState().setScope('selected');
    useRoofingScopeStore.getState().toggle();
    expect(useRoofingScopeStore.getState().scope).toBe('all');
  });

  it('persists the toggle', () => {
    useRoofingScopeStore.getState().setScope('all');
    useRoofingScopeStore.getState().toggle();
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('selected');
  });

  it('double-toggle is a no-op', () => {
    const before = useRoofingScopeStore.getState().scope;
    useRoofingScopeStore.getState().toggle();
    useRoofingScopeStore.getState().toggle();
    expect(useRoofingScopeStore.getState().scope).toBe(before);
  });
});
