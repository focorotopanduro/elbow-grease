/**
 * RecentFilesPanel — modal listing recently-saved project bundles,
 * grouped by customer where one is known.
 *
 * Toggle: `Ctrl+Shift+R`. Escape / backdrop click closes.
 *
 * Keyboard navigation:
 *   ↑ / ↓    move selection up / down
 *   Enter    open the selected recent
 *   Delete   remove the selected entry from the list (not the file)
 *
 * The panel reads from `useCurrentFileStore.recents`. That store only
 * collects entries in Tauri (see `supportsRecentFiles` in fsAdapter) —
 * in the browser this panel shows an explanatory empty state.
 *
 * Opening flow delegates to `openRecentFile` which handles read,
 * parse, apply, and stale-file cleanup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentFileStore, type RecentFile } from '@core/bundle/currentFileStore';
import { supportsRecentFiles } from '@core/bundle/fsAdapter';
import { openRecentFile } from '@core/bundle/openRecentFile';
import { eventBus } from '@core/EventBus';
import { EV, type CuePayload } from '@core/events';
import { useFocusTrap } from '@core/a11y/useFocusTrap';

// ── Component ──────────────────────────────────────────────────

export function RecentFilesPanel() {
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const recents = useCurrentFileStore((s) => s.recents);
  const removeRecent = useCurrentFileStore((s) => s.removeRecent);
  const clearRecents = useCurrentFileStore((s) => s.clearRecents);

  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const listRef = useRef<HTMLDivElement>(null);
  const recentsAvailable = supportsRecentFiles();

  // Grouped for display — customer groups first, ungrouped at the bottom.
  const grouped = useMemo(() => groupByCustomer(recents), [recents]);

  // Flat list matches the display order, so arrow-key nav maps cleanly.
  const flat = useMemo(() => grouped.flatMap((g) => g.entries), [grouped]);

  // Keep selection in range whenever the list shrinks or grows.
  useEffect(() => {
    if (selectedIdx >= flat.length) setSelectedIdx(Math.max(0, flat.length - 1));
  }, [flat.length, selectedIdx]);

  // Ctrl+Shift+R to toggle, Esc to close, arrows + Enter + Delete while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Toggle
      if (e.ctrlKey && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen((o) => !o);
        setSelectedIdx(0);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
      if (flat.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(flat.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = flat[selectedIdx];
        if (entry) void handleOpen(entry);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const entry = flat[selectedIdx];
        if (entry) removeRecent(entry.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Intentional: handleOpen is stable via useCallback below, flat + selectedIdx
    // capture by ref-like semantics through closures at install time — we
    // re-bind on every change to pick up the latest list + selection.
  }, [open, flat, selectedIdx, removeRecent]);

  const handleOpen = useCallback(async (entry: RecentFile) => {
    setBusy(true);
    try {
      const result = await openRecentFile(entry.path);
      if (result.ok) {
        cue(`Opened ${entry.name}${result.applyResult.project?.customerName
          ? ` for ${result.applyResult.project.customerName}` : ''}`);
        setOpen(false);
      } else {
        cue(result.error);
      }
    } finally {
      setBusy(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recent-files-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="recent-files-title" style={styles.title}>Recent Projects</span>
          {recents.length > 0 && (
            <button
              type="button"
              style={styles.clearBtn}
              onClick={() => {
                if (confirm('Clear the entire recents list?')) clearRecents();
              }}
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            style={styles.closeBtn}
            aria-label="Close recent projects"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div ref={listRef} style={styles.body}>
          {!recentsAvailable && (
            <EmptyState
              title="Recent files unavailable"
              body="This panel tracks files that were saved with a stable path. The desktop build (Tauri) opens a native Save dialog and remembers the path; the browser version cannot."
            />
          )}
          {recentsAvailable && recents.length === 0 && (
            <EmptyState
              title="No recent projects yet"
              body="Press Ctrl+S to save a project. The first save opens a native Save dialog; subsequent saves go to the same file silently, and the entry appears here."
            />
          )}
          {recentsAvailable && grouped.length > 0 && grouped.map((g, gIdx) => (
            <section key={g.customerName ?? '(no customer)'} style={styles.section}>
              <h3 style={styles.sectionHeader}>
                {g.customerName ?? 'No customer linked'}
              </h3>
              {g.entries.map((entry) => {
                const flatIdx = flatIndexOf(grouped, gIdx, entry);
                const isSelected = flatIdx === selectedIdx;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    disabled={busy}
                    onMouseEnter={() => setSelectedIdx(flatIdx)}
                    onClick={() => void handleOpen(entry)}
                    style={{ ...styles.row, ...(isSelected ? styles.rowSelected : null) }}
                  >
                    <div style={styles.rowName}>{entry.name}</div>
                    <div style={styles.rowMeta}>
                      <span style={styles.rowTime}>{formatAge(entry.savedAt)}</span>
                      <span style={styles.rowPath} title={entry.path}>
                        {elideLeft(entry.path, 50)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.name} from recents`}
                      style={styles.rowRemove}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(entry.path);
                      }}
                    >
                      ×
                    </button>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <footer style={styles.footer}>
          <span>
            <kbd style={styles.kbd}>↑</kbd>
            <kbd style={styles.kbd}>↓</kbd> navigate ·{' '}
            <kbd style={styles.kbd}>Enter</kbd> open ·{' '}
            <kbd style={styles.kbd}>Del</kbd> remove ·{' '}
            <kbd style={styles.kbd}>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

interface Group {
  customerName: string | null;
  entries: RecentFile[];
}

function groupByCustomer(recents: RecentFile[]): Group[] {
  const byCustomer = new Map<string, RecentFile[]>();
  const ungrouped: RecentFile[] = [];
  for (const r of recents) {
    if (r.customerName) {
      const list = byCustomer.get(r.customerName) ?? [];
      list.push(r);
      byCustomer.set(r.customerName, list);
    } else {
      ungrouped.push(r);
    }
  }
  const groups: Group[] = [];
  // Customer groups sorted alphabetically for stable ordering.
  for (const name of [...byCustomer.keys()].sort()) {
    groups.push({ customerName: name, entries: byCustomer.get(name)! });
  }
  if (ungrouped.length > 0) groups.push({ customerName: null, entries: ungrouped });
  return groups;
}

function flatIndexOf(groups: Group[], groupIdx: number, entry: RecentFile): number {
  let count = 0;
  for (let g = 0; g < groupIdx; g++) count += groups[g]!.entries.length;
  const group = groups[groupIdx]!;
  return count + group.entries.indexOf(entry);
}

function formatAge(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

function elideLeft(s: string, max: number): string {
  if (s.length <= max) return s;
  return '…' + s.slice(s.length - (max - 1));
}

function cue(message: string): void {
  eventBus.emit<CuePayload>(EV.CUE, { type: 'highlight', message });
}

// ── Sub-component ─────────────────────────────────────────────

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={styles.empty}>
      <div style={styles.emptyTitle}>{title}</div>
      <div style={styles.emptyBody}>{body}</div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(720px, 92vw)',
    maxHeight: '80vh',
    background: 'rgba(10, 14, 22, 0.98)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 229, 255, 0.06)',
    color: '#e0e6ef',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: '#00e5ff',
    letterSpacing: 1,
    flex: 1,
  },
  clearBtn: {
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 4,
    color: '#7a8592',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8592',
    fontSize: 22,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 8px',
  },
  body: {
    padding: '8px 6px 14px',
    overflowY: 'auto',
  },
  section: { marginTop: 8 },
  sectionHeader: {
    margin: '6px 12px 4px',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#ffc107',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gridTemplateRows: 'auto auto',
    columnGap: 8,
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 4,
  },
  rowSelected: {
    background: 'rgba(0, 229, 255, 0.08)',
    outline: '1px solid #00e5ff',
  },
  rowName: {
    gridColumn: 1,
    gridRow: 1,
    fontWeight: 600,
    color: '#e0e6ef',
  },
  rowMeta: {
    gridColumn: 1,
    gridRow: 2,
    display: 'flex',
    gap: 8,
    fontSize: 10,
    color: '#7a8592',
  },
  rowTime: { flex: '0 0 auto' },
  rowPath: {
    fontFamily: 'Consolas, monospace',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  rowRemove: {
    gridColumn: 2,
    gridRow: '1 / 3',
    alignSelf: 'center',
    background: 'none',
    border: '1px solid transparent',
    color: '#7a8592',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 3,
  },
  empty: {
    padding: '36px 24px',
    textAlign: 'center' as const,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: '#aebbc9',
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 12,
    color: '#7a8592',
    lineHeight: 1.5,
    maxWidth: 480,
    margin: '0 auto',
  },
  footer: {
    display: 'flex',
    gap: 8,
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    fontSize: 10,
    color: '#7a8592',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  kbd: {
    display: 'inline-block',
    fontFamily: 'Consolas, monospace',
    fontSize: 10,
    color: '#e0e6ef',
    background: '#1a2334',
    border: '1px solid #2a3a54',
    borderRadius: 3,
    padding: '0 5px',
    marginInline: 1,
  },
};
