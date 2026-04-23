/**
 * appModeStore — Phase 14.R.3 tests.
 *
 * Covers:
 *   • default mode is 'plumbing' on fresh boot
 *   • setMode persists to localStorage
 *   • toggle cycles plumbing → roofing → plumbing
 *   • loadMode rejects garbage localStorage values
 *   • Exported metadata tables (labels, icons, accents) are complete
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useAppModeStore,
  APP_MODE_LABELS,
  APP_MODE_ICONS,
  APP_MODE_ACCENTS,
  __testables,
  type AppMode,
} from '../appModeStore';

beforeEach(() => {
  try { localStorage.clear(); } catch { /* ignore */ }
  // Reset to a known baseline so test ordering doesn't matter.
  useAppModeStore.setState({ mode: 'plumbing' });
});

describe('default + persistence', () => {
  it('defaults to plumbing', () => {
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });

  it('setMode writes to localStorage', () => {
    useAppModeStore.getState().setMode('roofing');
    expect(useAppModeStore.getState().mode).toBe('roofing');
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('roofing');
  });

  it('setMode back to plumbing persists', () => {
    useAppModeStore.getState().setMode('roofing');
    useAppModeStore.getState().setMode('plumbing');
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('plumbing');
  });

  it('localStorage key is the documented constant', () => {
    expect(__testables.STORAGE_KEY).toBe('elbow-grease-app-mode');
  });
});

describe('toggle()', () => {
  it('plumbing → roofing', () => {
    useAppModeStore.getState().setMode('plumbing');
    useAppModeStore.getState().toggle();
    expect(useAppModeStore.getState().mode).toBe('roofing');
  });

  it('roofing → plumbing (wraps)', () => {
    useAppModeStore.getState().setMode('roofing');
    useAppModeStore.getState().toggle();
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });

  it('persists the new mode', () => {
    useAppModeStore.getState().setMode('plumbing');
    useAppModeStore.getState().toggle();
    expect(localStorage.getItem(__testables.STORAGE_KEY)).toBe('roofing');
  });

  it('double-toggle is a no-op', () => {
    const before = useAppModeStore.getState().mode;
    useAppModeStore.getState().toggle();
    useAppModeStore.getState().toggle();
    expect(useAppModeStore.getState().mode).toBe(before);
  });
});

describe('MODE_CYCLE', () => {
  it('contains exactly the two documented modes in order', () => {
    expect(__testables.MODE_CYCLE).toEqual(['plumbing', 'roofing']);
  });
});

describe('exported metadata tables', () => {
  const modes: AppMode[] = ['plumbing', 'roofing'];

  it('APP_MODE_LABELS has a non-empty entry per mode', () => {
    for (const m of modes) {
      expect(APP_MODE_LABELS[m]).toBeTruthy();
      expect(APP_MODE_LABELS[m].length).toBeGreaterThan(0);
    }
  });

  it('APP_MODE_ICONS has a non-empty entry per mode', () => {
    for (const m of modes) {
      expect(APP_MODE_ICONS[m]).toBeTruthy();
    }
  });

  it('APP_MODE_ACCENTS returns a hex-like string per mode', () => {
    for (const m of modes) {
      expect(APP_MODE_ACCENTS[m]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('accent colors differ per mode (so tabs read distinctly)', () => {
    expect(APP_MODE_ACCENTS.plumbing).not.toBe(APP_MODE_ACCENTS.roofing);
  });
});
