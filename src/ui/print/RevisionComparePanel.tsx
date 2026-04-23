/**
 * RevisionComparePanel — Phase 14.G
 *
 * Ctrl+Shift+V ("Versions") — proposal revision browser + change-order
 * generator. The workflow:
 *
 *   1. Pick a base proposal (the P-YYMMDD-XXXX). Dropdown shows every
 *      proposal that has at least one saved revision.
 *   2. Pick two revisions (from / to) within that base.
 *   3. See the diff summary (added / removed / changed items + totals).
 *   4. Click "Print Change Order" → fires printChangeOrder() and the
 *      browser's print dialog opens with the CO layout.
 *
 * No destructive actions other than "Delete revision" (with confirm).
 * Snapshots are read-only once saved — revisions are an audit trail.
 */

import { useEffect, useMemo, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { useProposalRevisionStore } from '@store/proposalRevisionStore';
import {
  diffProposals,
  summarizeChangeOrder,
  type SavedRevision,
} from '@core/print/proposalRevision';
import { printChangeOrder } from '@core/print/printChangeOrder';
import { logger } from '@core/logger/Logger';

const log = logger('RevisionComparePanel');

export function RevisionComparePanel() {
  const byBase = useProposalRevisionStore((s) => s.byBase);
  const deleteRevision = useProposalRevisionStore((s) => s.deleteRevision);
  const getBaseNumbers = useProposalRevisionStore((s) => s.getBaseNumbers);

  const [open, setOpen] = useState(false);
  const [selectedBase, setSelectedBase] = useState<string | null>(null);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Auto-pick the most-recent base on open if none is selected.
  useEffect(() => {
    if (!open) return;
    const bases = getBaseNumbers();
    if (bases.length === 0) {
      setSelectedBase(null);
      return;
    }
    if (!selectedBase || !byBase[selectedBase]) {
      setSelectedBase(bases[0]!);
    }
  }, [open, byBase, getBaseNumbers, selectedBase]);

  // When the base changes, auto-pick from/to: oldest → newest if there
  // are ≥ 2 revisions; otherwise from=only revision, to=null.
  useEffect(() => {
    if (!selectedBase) { setFromId(null); setToId(null); return; }
    const list = byBase[selectedBase] ?? [];
    if (list.length === 0) { setFromId(null); setToId(null); return; }
    const sorted = [...list].sort((a, b) => a.revisionIndex - b.revisionIndex);
    setFromId(sorted[0]!.id);
    setToId(sorted[sorted.length - 1]!.id);
  }, [selectedBase, byBase]);

  if (!open) return null;

  const baseNumbers = getBaseNumbers();
  const list = selectedBase ? (byBase[selectedBase] ?? []) : [];
  const sortedList = [...list].sort((a, b) => a.revisionIndex - b.revisionIndex);
  const fromRevision = sortedList.find((r) => r.id === fromId) ?? null;
  const toRevision = sortedList.find((r) => r.id === toId) ?? null;

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revisions-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="revisions-title" style={styles.title}>
            Proposal Revisions &amp; Change Orders
          </span>
          <button
            type="button"
            aria-label="Close revisions panel"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.hint}>
            Every print of a proposal auto-saves here as a revision (R1, R2 …).
            Pick two revisions of the same proposal to see the diff + generate
            a signable change-order PDF.
          </div>

          {baseNumbers.length === 0 ? (
            <div style={styles.emptyState}>
              No saved revisions yet.<br />
              Print a proposal from the export panel — it's auto-saved as R1.
            </div>
          ) : (
            <>
              {/* Base selector */}
              <div style={styles.field}>
                <label style={styles.label}>Proposal</label>
                <select
                  value={selectedBase ?? ''}
                  onChange={(e) => setSelectedBase(e.target.value || null)}
                  style={styles.select}
                >
                  {baseNumbers.map((base) => {
                    const count = byBase[base]?.length ?? 0;
                    return (
                      <option key={base} value={base}>
                        {base} — {count} revision{count === 1 ? '' : 's'}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Revision list */}
              <div style={styles.field}>
                <label style={styles.label}>History</label>
                <ul style={styles.list}>
                  {sortedList.map((rev) => (
                    <li key={rev.id} style={styles.listItem}>
                      <div style={styles.listItemMain}>
                        <div style={styles.listItemHead}>
                          <span style={styles.listItemLabel}>{rev.revisionNumber}</span>
                          <span style={styles.listItemMeta}>
                            {fmtDate(rev.savedAtIso)} · ${rev.data.totals.customerTotal.toFixed(0)}
                          </span>
                        </div>
                        {rev.note && <div style={styles.listItemNote}>{rev.note}</div>}
                      </div>
                      <div style={styles.listItemActions}>
                        <button
                          type="button"
                          style={fromId === rev.id ? styles.pickBtnActive : styles.pickBtn}
                          onClick={() => setFromId(rev.id)}
                        >
                          From
                        </button>
                        <button
                          type="button"
                          style={toId === rev.id ? styles.pickBtnActive : styles.pickBtn}
                          onClick={() => setToId(rev.id)}
                        >
                          To
                        </button>
                        <button
                          type="button"
                          style={styles.smallBtnDanger}
                          onClick={() => {
                            if (confirm(`Delete revision ${rev.revisionNumber}? This cannot be undone.`)) {
                              deleteRevision(rev.baseNumber, rev.revisionNumber);
                              if (fromId === rev.id) setFromId(null);
                              if (toId === rev.id) setToId(null);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Diff preview */}
              {fromRevision && toRevision && fromRevision.id !== toRevision.id && (
                <DiffPreview from={fromRevision} to={toRevision} />
              )}
            </>
          )}
        </div>

        <footer style={styles.footer}>
          <span style={styles.footerHint}>
            {fromRevision && toRevision && fromRevision.id !== toRevision.id
              ? `Printing ${fromRevision.revisionNumber} → ${toRevision.revisionNumber}`
              : 'Pick a "From" and a "To" revision to enable printing.'}
          </span>
          <button
            type="button"
            style={
              fromRevision && toRevision && fromRevision.id !== toRevision.id && !printing
                ? styles.primaryBtn
                : styles.primaryBtnDisabled
            }
            disabled={!fromRevision || !toRevision || fromRevision.id === toRevision.id || printing}
            onClick={async () => {
              if (!fromRevision || !toRevision) return;
              // Ensure from < to chronologically; swap if user picked
              // in the other order.
              const [earlier, later] = fromRevision.revisionIndex < toRevision.revisionIndex
                ? [fromRevision, toRevision]
                : [toRevision, fromRevision];
              setPrinting(true);
              try {
                await printChangeOrder({ from: earlier, to: later });
              } catch (err) {
                log.error('printChangeOrder failed', err);
                alert(`Print failed: ${err instanceof Error ? err.message : String(err)}`);
              } finally {
                setPrinting(false);
              }
            }}
          >
            {printing ? 'Printing…' : 'Print Change Order →'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Diff preview ──────────────────────────────────────────────

function DiffPreview({ from, to }: { from: SavedRevision; to: SavedRevision }) {
  const [earlier, later] = from.revisionIndex < to.revisionIndex ? [from, to] : [to, from];
  const diff = useMemo(() => diffProposals(earlier.data, later.data), [earlier, later]);
  const summary = useMemo(() => summarizeChangeOrder(diff), [diff]);
  const net = diff.summary.netBidDelta;
  const netColor = net > 0 ? '#66bb6a' : net < 0 ? '#ff8a8a' : '#7a8592';

  return (
    <div style={styles.diffBlock}>
      <div style={styles.diffHeader}>
        <span style={styles.diffLabel}>
          {earlier.revisionNumber} → {later.revisionNumber}
        </span>
        <span style={{ ...styles.diffNet, color: netColor }}>
          {net > 0 ? '+' : net < 0 ? '−' : ''}${Math.abs(net).toFixed(2)} net bid
        </span>
      </div>
      <div style={styles.diffCounts}>
        {diff.summary.lineItemsAdded > 0 && (
          <span style={styles.diffCountAdd}>+{diff.summary.lineItemsAdded} added</span>
        )}
        {diff.summary.lineItemsRemoved > 0 && (
          <span style={styles.diffCountRemove}>−{diff.summary.lineItemsRemoved} removed</span>
        )}
        {diff.summary.lineItemsChanged > 0 && (
          <span style={styles.diffCountChange}>±{diff.summary.lineItemsChanged} changed</span>
        )}
      </div>
      <ul style={styles.summaryList}>
        {summary.map((line, i) => (
          <li key={i} style={styles.summaryItem}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Formatting helpers ───────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

// ── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(720px, 96vw)',
    maxHeight: '90vh',
    background: 'rgba(10, 14, 22, 0.98)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 229, 255, 0.06)',
    color: '#e0e6ef',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#00e5ff', letterSpacing: 1, flex: 1 },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 12,
    minHeight: 140,
  },
  hint: {
    fontSize: 11, color: '#7a8592',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
    lineHeight: 1.45,
  },
  emptyState: {
    padding: '32px 16px',
    textAlign: 'center',
    color: '#7a8592',
    fontSize: 12,
    lineHeight: 1.6,
    border: '1px dashed #2a3a54',
    borderRadius: 6,
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: '#cfd8e3', letterSpacing: 0.5 },
  select: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '6px 8px', outline: 'none',
  },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  listItem: {
    display: 'grid', gridTemplateColumns: '1fr auto',
    gap: 10, padding: '8px 10px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 6,
    alignItems: 'center',
  },
  listItemMain: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  listItemHead: { display: 'flex', alignItems: 'baseline', gap: 10 },
  listItemLabel: { fontSize: 13, fontWeight: 700, color: '#ffd54f' },
  listItemMeta: { fontSize: 10, color: '#7a8592' },
  listItemNote: { fontSize: 11, color: '#aebbc9', fontStyle: 'italic' },
  listItemActions: { display: 'flex', gap: 4 },
  pickBtn: {
    padding: '3px 10px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 3, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 10, cursor: 'pointer',
  },
  pickBtnActive: {
    padding: '3px 10px',
    background: 'rgba(0, 229, 255, 0.18)',
    border: '1px solid rgba(0, 229, 255, 0.55)',
    borderRadius: 3, color: '#00e5ff',
    fontFamily: 'inherit', fontSize: 10, fontWeight: 700,
    cursor: 'pointer',
  },
  smallBtnDanger: {
    padding: '3px 8px',
    background: 'transparent',
    border: '1px solid #5c2a2a',
    borderRadius: 3, color: '#ff8a8a',
    fontFamily: 'inherit', fontSize: 10, cursor: 'pointer',
  },
  diffBlock: {
    padding: '10px 12px',
    background: 'rgba(255, 213, 79, 0.05)',
    border: '1px solid rgba(255, 213, 79, 0.3)',
    borderRadius: 6,
  },
  diffHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    paddingBottom: 4, borderBottom: '1px solid #2a3a54', marginBottom: 6,
  },
  diffLabel: { fontSize: 13, fontWeight: 700, color: '#ffd54f' },
  diffNet: { fontSize: 13, fontWeight: 700, fontFamily: 'ui-monospace, Consolas, monospace' },
  diffCounts: { display: 'flex', gap: 10, marginBottom: 6, fontSize: 10 },
  diffCountAdd: { color: '#66bb6a', fontWeight: 600 },
  diffCountRemove: { color: '#ff8a8a', fontWeight: 600 },
  diffCountChange: { color: '#ffd54f', fontWeight: 600 },
  summaryList: { margin: 0, paddingLeft: 18, fontSize: 11, color: '#cfd8e3', lineHeight: 1.45 },
  summaryItem: { marginBottom: 2 },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  footerHint: { flex: 1, fontSize: 11, color: '#7a8592' },
  primaryBtn: {
    padding: '7px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
  primaryBtnDisabled: {
    padding: '7px 16px',
    background: '#1a2334',
    border: 'none', borderRadius: 4, color: '#4a5568',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'not-allowed', letterSpacing: 0.5,
  },
};
