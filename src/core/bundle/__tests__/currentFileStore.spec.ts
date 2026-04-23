/**
 * currentFileStore — Phase 11.D tests.
 *
 * Covers:
 *   • setCurrent records path + display name derived from filename
 *   • setCurrent pushes to recents ONLY when supportsRecentFiles (Tauri)
 *   • recents cap at MAX_RECENTS
 *   • duplicate path moves to the head (MRU semantics)
 *   • clearCurrent nulls the active path but preserves recents
 *   • removeRecent drops the targeted entry
 *   • clearRecents wipes the list
 *   • deriveName strips Windows + Unix path prefixes + extension
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCurrentFileStore, __testables } from '../currentFileStore';
import { __setTauriProbeForTest } from '../fsAdapter';

beforeEach(() => {
  // Reset store + localStorage + Tauri probe.
  try { localStorage.clear(); } catch { /* ignore */ }
  useCurrentFileStore.setState({ currentPath: null, recents: [] });
  __setTauriProbeForTest(true); // Tauri on by default — tests that want
                                // the browser shape flip it explicitly.
});

// ── deriveName ─────────────────────────────────────────────────

describe('deriveName', () => {
  it('handles Unix paths', () => {
    expect(__testables.deriveName('/home/alice/projects/foo.elbow')).toBe('foo');
  });

  it('handles Windows paths', () => {
    expect(__testables.deriveName('C:\\Users\\alice\\projects\\foo.elbow')).toBe('foo');
  });

  it('keeps a leading dot file name intact', () => {
    expect(__testables.deriveName('/etc/.config')).toBe('.config');
  });

  it('strips the last extension only', () => {
    expect(__testables.deriveName('/a/b/file.backup.elbow')).toBe('file.backup');
  });
});

// ── setCurrent ─────────────────────────────────────────────────

describe('setCurrent', () => {
  it('sets currentPath and appends to recents in Tauri', () => {
    useCurrentFileStore.getState().setCurrent('/p/jones.elbow');
    const s = useCurrentFileStore.getState();
    expect(s.currentPath).toBe('/p/jones.elbow');
    expect(s.recents).toHaveLength(1);
    expect(s.recents[0]!.name).toBe('jones');
    expect(s.recents[0]!.path).toBe('/p/jones.elbow');
  });

  it('explicit displayName overrides derivation', () => {
    useCurrentFileStore.getState().setCurrent('/p/abc.elbow', 'Jones Residence');
    expect(useCurrentFileStore.getState().recents[0]!.name).toBe('Jones Residence');
  });

  it('browser runtime sets currentPath but skips recents', () => {
    __setTauriProbeForTest(false);
    useCurrentFileStore.getState().setCurrent('/p/jones.elbow');
    const s = useCurrentFileStore.getState();
    expect(s.currentPath).toBe('/p/jones.elbow');
    expect(s.recents).toHaveLength(0);
  });

  it('duplicate path moves to front (MRU ordering)', () => {
    useCurrentFileStore.getState().setCurrent('/p/a.elbow');
    useCurrentFileStore.getState().setCurrent('/p/b.elbow');
    useCurrentFileStore.getState().setCurrent('/p/a.elbow');
    const recents = useCurrentFileStore.getState().recents;
    expect(recents).toHaveLength(2);
    expect(recents[0]!.path).toBe('/p/a.elbow');
    expect(recents[1]!.path).toBe('/p/b.elbow');
  });

  it('caps at MAX_RECENTS', () => {
    for (let i = 0; i < __testables.MAX_RECENTS + 3; i++) {
      useCurrentFileStore.getState().setCurrent(`/p/file-${i}.elbow`);
    }
    expect(useCurrentFileStore.getState().recents).toHaveLength(__testables.MAX_RECENTS);
    // Newest first.
    expect(useCurrentFileStore.getState().recents[0]!.path)
      .toBe(`/p/file-${__testables.MAX_RECENTS + 2}.elbow`);
  });

  it('persists recents to localStorage', () => {
    useCurrentFileStore.getState().setCurrent('/p/persisted.elbow');
    const raw = localStorage.getItem(__testables.STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[0].path).toBe('/p/persisted.elbow');
  });
});

// ── clearCurrent ───────────────────────────────────────────────

describe('clearCurrent', () => {
  it('nulls currentPath but preserves recents', () => {
    useCurrentFileStore.getState().setCurrent('/p/x.elbow');
    useCurrentFileStore.getState().clearCurrent();
    expect(useCurrentFileStore.getState().currentPath).toBeNull();
    expect(useCurrentFileStore.getState().recents).toHaveLength(1);
  });
});

// ── removeRecent / clearRecents ────────────────────────────────

describe('removeRecent / clearRecents', () => {
  it('removeRecent drops one entry, persists the rest', () => {
    useCurrentFileStore.getState().setCurrent('/p/a.elbow');
    useCurrentFileStore.getState().setCurrent('/p/b.elbow');
    useCurrentFileStore.getState().removeRecent('/p/a.elbow');
    const recents = useCurrentFileStore.getState().recents;
    expect(recents).toHaveLength(1);
    expect(recents[0]!.path).toBe('/p/b.elbow');
    const stored = JSON.parse(localStorage.getItem(__testables.STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
  });

  it('clearRecents wipes all entries + localStorage', () => {
    useCurrentFileStore.getState().setCurrent('/p/x.elbow');
    useCurrentFileStore.getState().clearRecents();
    expect(useCurrentFileStore.getState().recents).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem(__testables.STORAGE_KEY)!);
    expect(stored).toHaveLength(0);
  });
});
