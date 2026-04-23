/**
 * PdfPagePicker — Phase 14.E
 *
 * Modal shown when the user uploads a multi-page PDF. Offers three
 * choices per page set:
 *   • Import a specific page as a single backdrop
 *   • Import every page, assigned to ascending floors (useful for
 *     a multi-story blueprint set where page 1 = basement, page 2 =
 *     1st floor, page 3 = 2nd floor, etc.)
 *   • Cancel
 *
 * The picker is *passive* — it doesn't touch the backdrop store
 * directly. It reports the user's choice back via the `onChoose`
 * callback, which the caller translates into upload actions.
 */

import { useEffect, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import type { PdfMetadata } from '../../engine/pdf/PDFRenderer';
import { useFloorStore } from '@store/floorStore';

export type PdfPickChoice =
  | { kind: 'single'; pageNumber: number; floorId?: string }
  | { kind: 'all-sequential'; startFloorId: string }
  | { kind: 'cancel' };

export interface PdfPagePickerProps {
  filename: string;
  metadata: PdfMetadata;
  onChoose: (choice: PdfPickChoice) => void;
}

export function PdfPagePicker({ filename, metadata, onChoose }: PdfPagePickerProps) {
  const [selectedPage, setSelectedPage] = useState(1);
  const floorsOrdered = useFloorStore((s) =>
    Object.values(s.floors).sort((a, b) => a.order - b.order),
  );
  const activeFloorId = useFloorStore((s) => s.activeFloorId);
  const [targetFloorId, setTargetFloorId] = useState(activeFloorId);
  const [startFloorId, setStartFloorId] = useState(activeFloorId);

  const trapRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onChoose({ kind: 'cancel' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  const isMultiPage = metadata.numPages > 1;

  return (
    <div style={styles.backdrop} onClick={() => onChoose({ kind: 'cancel' })}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-picker-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="pdf-picker-title" style={styles.title}>
            Import PDF Blueprint
          </span>
          <button
            type="button"
            aria-label="Cancel"
            style={styles.closeBtn}
            onClick={() => onChoose({ kind: 'cancel' })}
          >
            ×
          </button>
        </header>

        <div style={styles.body}>
          <div style={styles.hint}>
            <strong>{filename}</strong> — {metadata.numPages} page{metadata.numPages === 1 ? '' : 's'}
            {isMultiPage && ', select which page(s) to import:'}
          </div>

          {/* Single-page path */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>Import a single page</div>
            <div style={styles.row}>
              <label style={styles.inlineLabel}>
                Page
                <input
                  type="number"
                  min={1}
                  max={metadata.numPages}
                  value={selectedPage}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) {
                      setSelectedPage(Math.max(1, Math.min(metadata.numPages, Math.round(n))));
                    }
                  }}
                  style={{ ...styles.input, width: 60 }}
                />
              </label>
              <label style={styles.inlineLabel}>
                onto floor
                <select
                  value={targetFloorId}
                  onChange={(e) => setTargetFloorId(e.target.value)}
                  style={styles.select}
                >
                  {floorsOrdered.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                style={styles.primaryBtn}
                onClick={() => onChoose({
                  kind: 'single',
                  pageNumber: selectedPage,
                  floorId: targetFloorId,
                })}
              >
                Import page {selectedPage} →
              </button>
            </div>
            <div style={styles.pageGrid}>
              {metadata.pages.map((p) => (
                <button
                  key={p.pageNumber}
                  type="button"
                  style={{
                    ...styles.pageChip,
                    ...(p.pageNumber === selectedPage ? styles.pageChipActive : {}),
                  }}
                  onClick={() => setSelectedPage(p.pageNumber)}
                  title={`${p.widthPt.toFixed(0)} × ${p.heightPt.toFixed(0)} pt`}
                >
                  {p.pageNumber}
                </button>
              ))}
            </div>
          </section>

          {/* Multi-page path: one page per floor */}
          {isMultiPage && floorsOrdered.length >= 2 && (
            <section style={styles.section}>
              <div style={styles.sectionTitle}>Import every page (one per floor)</div>
              <div style={styles.row}>
                <label style={styles.inlineLabel}>
                  Starting at floor
                  <select
                    value={startFloorId}
                    onChange={(e) => setStartFloorId(e.target.value)}
                    style={styles.select}
                  >
                    {floorsOrdered.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </label>
                <span style={styles.spacer} />
                <button
                  type="button"
                  style={styles.primaryBtn}
                  onClick={() => onChoose({
                    kind: 'all-sequential',
                    startFloorId,
                  })}
                >
                  Import all {metadata.numPages} pages →
                </button>
              </div>
              <div style={styles.hintLight}>
                Page 1 → {floorsOrdered.find((f) => f.id === startFloorId)?.name ?? '?'},
                page 2 → next floor up, and so on. Any pages that run past the
                top floor are dropped.
              </div>
            </section>
          )}
        </div>

        <footer style={styles.footer}>
          <button type="button" style={styles.resetBtn} onClick={() => onChoose({ kind: 'cancel' })}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(560px, 94vw)',
    maxHeight: '88vh',
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
    display: 'flex', flexDirection: 'column', gap: 14,
  },
  hint: {
    fontSize: 12, color: '#cfd8e3',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
  },
  hintLight: {
    fontSize: 10, color: '#7a8592', lineHeight: 1.5,
    marginTop: 6,
  },
  section: {
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 6,
  },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#e0e6ef' },
  row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  spacer: { flex: 1 },
  inlineLabel: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 11, color: '#aebbc9',
  },
  input: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '4px 8px', outline: 'none',
  },
  select: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 11,
    padding: '4px 6px', outline: 'none',
  },
  pageGrid: {
    display: 'flex', flexWrap: 'wrap', gap: 4,
    paddingTop: 4,
  },
  pageChip: {
    minWidth: 28, height: 28,
    padding: '0 6px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11,
    cursor: 'pointer',
  },
  pageChipActive: {
    background: 'rgba(0, 229, 255, 0.15)',
    borderColor: 'rgba(0, 229, 255, 0.5)',
    color: '#00e5ff',
    fontWeight: 700,
  },
  primaryBtn: {
    padding: '6px 14px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#7a8592',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  footer: {
    display: 'flex', gap: 8,
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
};
