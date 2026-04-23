/**
 * fsAdapter — Phase 11.D tests.
 *
 * Covers:
 *   • isTauri() reads global Tauri marker (both v2 __TAURI_INTERNALS__
 *     and legacy __TAURI__), falls back to false otherwise.
 *   • __setTauriProbeForTest overrides the probe.
 *   • requestSavePath in non-Tauri returns the BROWSER_SAVE_TOKEN.
 *   • writeToPath with BROWSER_SAVE_TOKEN triggers a DOM blob download
 *     (we verify via createElement + click side effects).
 *   • isRealPath correctly distinguishes tokens from real paths.
 *   • supportsRecentFiles follows isTauri().
 *   • readFromPath throws a helpful message in the browser runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isTauri,
  requestSavePath,
  writeToPath,
  readFromPath,
  isRealPath,
  supportsRecentFiles,
  __setTauriProbeForTest,
  __testables,
} from '../fsAdapter';

beforeEach(() => {
  __setTauriProbeForTest(null);
  // Clean any lingering Tauri markers from prior tests.
  const w = window as unknown as Record<string, unknown>;
  delete w.__TAURI_INTERNALS__;
  delete w.__TAURI__;
});

afterEach(() => {
  __setTauriProbeForTest(null);
});

// ── isTauri ────────────────────────────────────────────────────

describe('isTauri', () => {
  it('returns false in plain jsdom', () => {
    expect(isTauri()).toBe(false);
  });

  it('returns true when window.__TAURI_INTERNALS__ is set (v2)', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    __setTauriProbeForTest(null); // force re-probe
    expect(isTauri()).toBe(true);
  });

  it('returns true when the legacy window.__TAURI__ marker is set', () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    __setTauriProbeForTest(null);
    expect(isTauri()).toBe(true);
  });

  it('caches after first probe within a session', () => {
    expect(isTauri()).toBe(false);
    // Set the marker AFTER the first probe — should still be cached false.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(isTauri()).toBe(false);
  });
});

// ── requestSavePath ────────────────────────────────────────────

describe('requestSavePath (browser)', () => {
  it('returns BROWSER_SAVE_TOKEN in non-Tauri environments', async () => {
    __setTauriProbeForTest(false);
    const result = await requestSavePath({ defaultName: 'x.elbow', extension: 'elbow' });
    expect(result).toBe(__testables.BROWSER_SAVE_TOKEN);
  });
});

// ── writeToPath (browser) ──────────────────────────────────────

describe('writeToPath (browser)', () => {
  it('triggers a download via createObjectURL + anchor click', async () => {
    __setTauriProbeForTest(false);

    // jsdom doesn't ship URL.createObjectURL by default — install stubs
    // before spying, then restore them on teardown.
    const urlWithFns = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    const hadCreate = 'createObjectURL' in urlWithFns;
    const hadRevoke = 'revokeObjectURL' in urlWithFns;
    if (!hadCreate) urlWithFns.createObjectURL = () => 'blob:fake';
    if (!hadRevoke) urlWithFns.revokeObjectURL = () => undefined;

    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    // Only intercept anchor creation; let Blob/input still work.
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');

    await writeToPath(__testables.BROWSER_SAVE_TOKEN, '{"ok":true}', {
      browserFilename: 'x.elbow',
      browserMime: 'application/octet-stream',
    });

    expect(urlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    // Teardown.
    createSpy.mockRestore();
    urlSpy.mockRestore();
    if (!hadCreate) delete urlWithFns.createObjectURL;
    if (!hadRevoke) delete urlWithFns.revokeObjectURL;
  });
});

// ── isRealPath ─────────────────────────────────────────────────

describe('isRealPath', () => {
  it('null / undefined / empty → false', () => {
    expect(isRealPath(null)).toBe(false);
    expect(isRealPath('')).toBe(false);
  });

  it('BROWSER_SAVE_TOKEN → false', () => {
    expect(isRealPath(__testables.BROWSER_SAVE_TOKEN)).toBe(false);
  });

  it('browser-upload synthetic path → false', () => {
    expect(isRealPath('browser-upload:foo.elbow')).toBe(false);
  });

  it('real path → only true in Tauri', () => {
    __setTauriProbeForTest(false);
    expect(isRealPath('/real/path/project.elbow')).toBe(false);
    __setTauriProbeForTest(true);
    expect(isRealPath('/real/path/project.elbow')).toBe(true);
    __setTauriProbeForTest(false);
  });
});

// ── supportsRecentFiles ────────────────────────────────────────

describe('supportsRecentFiles', () => {
  it('mirrors isTauri', () => {
    __setTauriProbeForTest(false);
    expect(supportsRecentFiles()).toBe(false);
    __setTauriProbeForTest(true);
    expect(supportsRecentFiles()).toBe(true);
  });
});

// ── readFromPath ───────────────────────────────────────────────

describe('readFromPath (browser rejection)', () => {
  it('throws a helpful message in the browser runtime', async () => {
    __setTauriProbeForTest(false);
    await expect(readFromPath('browser-upload:x.elbow')).rejects.toThrow(/browser/);
  });
});
