/**
 * RoofingPdfPagePicker — Phase 14.R.24.
 *
 * Compact single-page-pick modal for roofing multi-page PDFs.
 * Plumbing's `PdfPagePicker` is tightly coupled to the floor store
 * (pages-per-floor flow, returns floorId); the roofing workspace
 * has a single underlay slot, so this picker just asks "which page?"
 * and calls back with a page number (or `cancel`).
 *
 * Passive — doesn't touch the store; the caller (RoofingPDFPanel)
 * handles the actual render + store update based on the reported
 * choice.
 */

import { useEffect, useState } from 'react';
import type { PdfMetadata } from '@engine/pdf/PDFRenderer';

export type RoofingPdfPickChoice =
  | { kind: 'page'; pageNumber: number }
  | { kind: 'cancel' };

export interface RoofingPdfPagePickerProps {
  filename: string;
  metadata: PdfMetadata;
  onChoose: (choice: RoofingPdfPickChoice) => void;
}

export function RoofingPdfPagePicker({
  filename,
  metadata,
  onChoose,
}: RoofingPdfPagePickerProps) {
  const [selectedPage, setSelectedPage] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onChoose({ kind: 'cancel' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onChoose({ kind: 'page', pageNumber: selectedPage });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose, selectedPage]);

  return (
    <div
      style={styles.backdrop}
      onClick={() => onChoose({ kind: 'cancel' })}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roofing-pdf-picker-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="roofing-pdf-picker-title" style={styles.title}>
            📄 Pick Blueprint Page
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
            <strong>{filename}</strong> — {metadata.numPages} page{metadata.numPages === 1 ? '' : 's'}.
            Pick the one to trace the roof over.
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
                onDoubleClick={() =>
                  onChoose({ kind: 'page', pageNumber: p.pageNumber })
                }
                title={`Page ${p.pageNumber} · ${p.widthPt.toFixed(0)} × ${p.heightPt.toFixed(0)} pt (double-click to import)`}
              >
                {p.pageNumber}
              </button>
            ))}
          </div>

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
                style={{ ...styles.input, width: 70 }}
                autoFocus
              />
            </label>
            <span style={styles.spacer} />
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={() =>
                onChoose({ kind: 'page', pageNumber: selectedPage })
              }
            >
              Import page {selectedPage} →
            </button>
          </div>
          <div style={styles.hintLight}>
            Enter commits the selected page. Esc or clicking outside cancels.
          </div>
        </div>
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
    width: 'min(480px, 94vw)',
    maxHeight: '88vh',
    background: 'rgba(10, 10, 15, 0.98)',
    border: '1px solid #2a2a36',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 152, 0, 0.08)',
    color: '#e0e6ef',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: {
    fontSize: 14, fontWeight: 700, color: '#ff9800',
    letterSpacing: 0.8, flex: 1,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 12,
  },
  hint: {
    fontSize: 12, color: '#cfd8e3',
    padding: '8px 10px',
    background: 'rgba(255, 152, 0, 0.05)',
    border: '1px solid rgba(255, 152, 0, 0.2)',
    borderRadius: 4,
  },
  hintLight: {
    fontSize: 10, color: '#7a8592', lineHeight: 1.5,
  },
  pageGrid: {
    display: 'flex', flexWrap: 'wrap', gap: 4,
  },
  pageChip: {
    minWidth: 30, height: 30, padding: '0 8px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 12,
    cursor: 'pointer',
  },
  pageChipActive: {
    background: 'rgba(255, 152, 0, 0.15)',
    borderColor: 'rgba(255, 152, 0, 0.5)',
    color: '#ff9800',
    fontWeight: 700,
  },
  row: { display: 'flex', gap: 10, alignItems: 'center' },
  spacer: { flex: 1 },
  inlineLabel: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 11, color: '#aebbc9',
  },
  input: {
    background: '#0e0e16', border: '1px solid #2a2a36', borderRadius: 4,
    color: '#e5e5e5', fontFamily: 'inherit', fontSize: 12,
    padding: '4px 8px', outline: 'none',
  },
  primaryBtn: {
    padding: '6px 14px',
    background: 'linear-gradient(180deg, #ff9800 0%, #e65100 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.3,
  },
};
