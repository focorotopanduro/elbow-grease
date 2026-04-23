/**
 * HelpOverlay — keyboard shortcut reference.
 *
 * Toggle: `?` key (also `Shift + /`). Full-screen dark modal that
 * lists every entry from `ShortcutRegistry` grouped by category.
 * Filterable by a simple text-match search box.
 *
 * The overlay reads the registry, it does NOT install handlers —
 * keeping this component passive means the registry is the single
 * source of truth for "what can the user press", and the overlay
 * can never fall out of sync with the live bindings.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  groupedShortcuts,
  type Shortcut,
} from '@core/input/ShortcutRegistry';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
// Phase 10.F — replay the first-run coach-mark walkthrough on demand.
import { useOnboardingStore } from '@store/onboardingStore';

// ── Component ──────────────────────────────────────────────────

export function HelpOverlay() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  // Phase 10.C — Tab/Shift+Tab cycles inside the dialog; focus
  // restores to the element that was focused before open on close.
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  // ? toggle — accept both `?` (US keyboards) and `Shift + /`.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore if typing in an input.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setOpen((o) => !o);
        setFilter('');
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const groups = useMemo(() => {
    const g = groupedShortcuts();
    const needle = filter.trim().toLowerCase();
    if (!needle) return g;
    return g
      .map((grp) => ({
        ...grp,
        entries: grp.entries.filter((e) => matches(e, needle)),
      }))
      .filter((grp) => grp.entries.length > 0);
  }, [filter]);

  if (!open) return null;

  return (
    <div style={styles.backdrop} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span style={styles.title}>Keyboard Shortcuts</span>
          <input
            autoFocus
            type="text"
            placeholder="filter — try 'undo', 'draw', 'manifold'…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={styles.filter}
          />
          <button style={styles.closeBtn} aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </header>

        <div style={styles.body}>
          {groups.length === 0 && (
            <div style={styles.emptyHint}>No shortcuts match “{filter}”.</div>
          )}
          {groups.map((grp) => (
            <section key={grp.category} style={styles.section}>
              <h3 style={styles.sectionHeader}>{grp.label}</h3>
              <div style={styles.rows}>
                {grp.entries.map((s) => (
                  <Row key={s.id} shortcut={s} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <footer style={styles.footer}>
          <span>Press <kbd style={styles.kbdSm}>Esc</kbd> or click the backdrop to close</span>
          <span>· <kbd style={styles.kbdSm}>?</kbd> toggles this panel at any time</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            style={styles.replayBtn}
            onClick={() => {
              // Reset persistence + start, then close the help overlay
              // so the coach marks have the screen to themselves.
              const s = useOnboardingStore.getState();
              s.resetPersisted();
              s.start();
              setOpen(false);
            }}
          >
            Replay tutorial
          </button>
        </footer>
      </div>
    </div>
  );
}

function matches(s: Shortcut, q: string): boolean {
  return (
    s.keys.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    (s.hint?.toLowerCase().includes(q) ?? false) ||
    s.category.includes(q)
  );
}

// ── Row ────────────────────────────────────────────────────────

function Row({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div style={styles.row}>
      <div style={styles.keys}>
        {shortcut.keys.split(/\s*\|\s*/).map((alt, i) => (
          <span key={i} style={styles.keyGroup}>
            {i > 0 && <span style={styles.orSep}> or </span>}
            {alt.split(' + ').map((k, j) => (
              <span key={j}>
                {j > 0 && <span style={styles.plusSep}>+</span>}
                <kbd style={styles.kbd}>{k}</kbd>
              </span>
            ))}
          </span>
        ))}
      </div>
      <div style={styles.desc}>
        <div>{shortcut.description}</div>
        {shortcut.hint && <div style={styles.hint}>{shortcut.hint}</div>}
      </div>
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
    width: 'min(780px, 92vw)',
    maxHeight: '85vh',
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
    flex: 0,
  },
  filter: {
    flex: 1,
    padding: '6px 10px',
    background: '#0a1220',
    border: '1px solid #2a3a54',
    borderRadius: 5,
    color: '#e0e6ef',
    fontFamily: 'inherit',
    fontSize: 13,
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
    padding: '4px 18px 14px',
    overflowY: 'auto',
  },
  emptyHint: {
    padding: '32px 8px',
    textAlign: 'center',
    color: '#7a8592',
    fontSize: 13,
  },
  section: { marginTop: 16 },
  sectionHeader: {
    margin: '0 0 6px',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: '#ffc107',
  },
  rows: { display: 'flex', flexDirection: 'column', gap: 2 },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, auto) 1fr',
    gap: 16,
    padding: '6px 6px',
    borderRadius: 4,
    borderBottom: '1px solid #111a2a',
  },
  keys: { display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap' },
  keyGroup: { display: 'inline-flex', alignItems: 'baseline', gap: 2 },
  orSep: { color: '#7a8592', fontSize: 11, padding: '0 2px' },
  plusSep: { color: '#7a8592', fontSize: 11, padding: '0 2px' },
  kbd: {
    display: 'inline-block',
    fontFamily: 'Consolas, monospace',
    fontSize: 11,
    color: '#e0e6ef',
    background: '#1a2334',
    border: '1px solid #2a3a54',
    borderBottom: '2px solid #2a3a54',
    borderRadius: 3,
    padding: '1px 6px',
    minWidth: 18,
    textAlign: 'center',
  },
  kbdSm: {
    fontFamily: 'Consolas, monospace',
    fontSize: 10,
    color: '#a0aec0',
    border: '1px solid #2a3a54',
    borderRadius: 3,
    padding: '1px 4px',
    background: '#1a2334',
  },
  desc: { display: 'flex', flexDirection: 'column', gap: 2 },
  hint: { fontSize: 11, color: '#7a8592', lineHeight: 1.4 },
  footer: {
    display: 'flex',
    gap: 8,
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    fontSize: 11,
    color: '#7a8592',
    background: 'rgba(0, 0, 0, 0.3)',
    alignItems: 'center',
  },
  replayBtn: {
    padding: '4px 10px',
    background: 'rgba(0, 229, 255, 0.08)',
    border: '1px solid #00e5ff',
    borderRadius: 4,
    color: '#00e5ff',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
};
