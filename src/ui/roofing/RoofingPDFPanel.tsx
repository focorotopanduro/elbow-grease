/**
 * RoofingPDFPanel — Phase 14.R.5 / R.24.
 *
 * Left-side DOM panel (below the drawing toolbar) for managing the
 * blueprint underlay. Owns:
 *
 *   • Load / Unload   — file picker → routes by type:
 *                         PDF (single-page)  → render page 1 directly
 *                         PDF (multi-page)   → open RoofingPdfPagePicker
 *                         PNG / JPG / WebP   → imageLoader
 *                       …then `roofStore.loadPdfImage()`.
 *   • Opacity slider  — 0..1.
 *   • Visibility      — show/hide the plane without unloading.
 *   • Calibrate       — starts the two-click flow. When both clicks
 *                       land, a numeric-input overlay asks for the
 *                       real-world distance; submitting recomputes
 *                       `scale` (px/ft) via `calibratePdfFromWorld`.
 *   • Scale override  — manual `px/ft` input for users who know it.
 *   • Offset X / Z    — ground-plane position (ft).
 *   • Rotation        — plane rotation (degrees around world Y).
 *   • Lock            — if true, ignore drag/offset edits.
 *   • Reset transform — recenter + unrotate + scale=10 px/ft.
 *
 * Only mounted when `appMode === 'roofing'` AND a PDF is loaded OR
 * the user just requested a load. In other words the panel is
 * ALWAYS visible in roofing mode — even when empty — so "Load…"
 * is one click away. Matches the contractor workflow.
 */

import { useRef, useState } from 'react';
import { useRoofStore } from '@store/roofStore';
import { useRoofingPdfCalibStore } from '@store/roofingPdfCalibStore';
import { loadPdfRenderer } from '@core/lazy/loaders';
import { pdfPhysicalSize } from '@engine/roofing/RoofGraph';
// Phase 14.R.24 — multi-page PDF picker + raster image loader.
import { isPdfFile, type PdfMetadata } from '@engine/pdf/PDFRenderer';
import { isImageFile, loadImageFile } from '@engine/underlay/imageLoader';
// Phase 14.R.25 — ASCII DXF underlay support.
import { isDxfFile, loadDxfFile } from '@engine/underlay/dxfLoader';
import {
  RoofingPdfPagePicker,
  type RoofingPdfPickChoice,
} from './RoofingPdfPagePicker';

// ── Styles ──────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  position: 'fixed',
  left: 12,
  bottom: 52,
  zIndex: 22,
  width: 244,
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  background: '#0a0a0f',
  border: '1px solid #222',
  borderRadius: 10,
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  boxShadow: '0 2px 14px rgba(0,0,0,0.5)',
};

const HEADER: React.CSSProperties = {
  color: '#ff9800',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const LABEL: React.CSSProperties = {
  color: '#888',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 3,
};

const BTN: React.CSSProperties = {
  background: '#181823',
  border: '1px solid #333',
  color: '#ccc',
  padding: '6px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 12,
  transition: 'background 120ms, border-color 120ms, color 120ms',
};

const BTN_ACTIVE: React.CSSProperties = {
  ...BTN,
  background: '#ff980022',
  borderColor: '#ff9800',
  color: '#ff9800',
  fontWeight: 600,
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  borderColor: '#441818',
  color: '#ef5350',
};

const INPUT: React.CSSProperties = {
  background: '#0e0e16',
  border: '1px solid #2a2a36',
  borderRadius: 5,
  color: '#e5e5e5',
  padding: '4px 6px',
  fontSize: 12,
  width: '100%',
  boxSizing: 'border-box',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const DIVIDER: React.CSSProperties = {
  height: 1,
  background: '#1a1a24',
  margin: '2px 0',
};

// ── Component ───────────────────────────────────────────────────

export function RoofingPDFPanel() {
  const pdf = useRoofStore((s) => s.pdf);
  const loadPdfImage = useRoofStore((s) => s.loadPdfImage);
  const clearPdf = useRoofStore((s) => s.clearPdf);
  const setPdfOpacity = useRoofStore((s) => s.setPdfOpacity);
  const setPdfVisible = useRoofStore((s) => s.setPdfVisible);
  const setPdfOffset = useRoofStore((s) => s.setPdfOffset);
  const setPdfRotation = useRoofStore((s) => s.setPdfRotation);
  const setPdfScale = useRoofStore((s) => s.setPdfScale);
  const setPdfLocked = useRoofStore((s) => s.setPdfLocked);
  const calibratePdfFromWorld = useRoofStore((s) => s.calibratePdfFromWorld);

  const calibMode = useRoofingPdfCalibStore((s) => s.mode);
  const beginCalibrate = useRoofingPdfCalibStore((s) => s.beginCalibrate);
  const resetCalib = useRoofingPdfCalibStore((s) => s.reset);
  const firstPt = useRoofingPdfCalibStore((s) => s.firstPoint);
  const secondPt = useRoofingPdfCalibStore((s) => s.secondPoint);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [distanceInput, setDistanceInput] = useState<string>('');
  // Phase 14.R.24 — staged state for the multi-page picker. `pending`
  // holds the File + its pdfjs metadata while the picker modal is
  // open. Closed when the user picks a page (→ renderPage) or cancels.
  const [pendingPdf, setPendingPdf] = useState<
    { file: File; metadata: PdfMetadata } | null
  >(null);

  const hasPdf = Boolean(pdf.imageDataUrl);
  const size = pdfPhysicalSize(pdf);

  // ── Load handler (R.24: PDF single/multi-page + raster image) ─
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0]!;
    setLoading(true);
    setLoadError(null);
    try {
      if (isPdfFile(file)) {
        const mod = await loadPdfRenderer.get();
        const metadata = await mod.readPdfMetadata(file);
        if (metadata.numPages <= 1) {
          // Fast path: single-page PDF renders immediately.
          const img = await mod.renderPdfPage(file, 1, 200);
          loadPdfImage({
            imageDataUrl: img.dataUrl,
            widthPx: img.widthPx,
            heightPx: img.heightPx,
            fileName: file.name,
            page: 1,
          });
        } else {
          // Multi-page: show the picker modal. Actual page render
          // happens in `handlePdfPickerChoice` once the user picks.
          setPendingPdf({ file, metadata });
        }
      } else if (isImageFile(file)) {
        // Raster underlay (PNG / JPG / WebP / GIF / BMP) — decoded
        // in-browser via the FileReader + Image elements inside
        // loadImageFile. Page-less; always treated as "page 1".
        const loaded = await loadImageFile(file);
        loadPdfImage({
          imageDataUrl: loaded.dataUrl,
          widthPx: loaded.widthPx,
          heightPx: loaded.heightPx,
          fileName: loaded.fileName,
          page: 1,
        });
      } else if (isDxfFile(file)) {
        // Phase 14.R.25 — vector DXF rasterized to PNG at load time.
        // Parser handles ASCII DXF with LINE / LWPOLYLINE / CIRCLE /
        // ARC entities (covers nearly every real-world architectural
        // blueprint). Binary DXF + unsupported entities are rejected
        // with a clear error message from the loader.
        const loaded = await loadDxfFile(file);
        loadPdfImage({
          imageDataUrl: loaded.dataUrl,
          widthPx: loaded.widthPx,
          heightPx: loaded.heightPx,
          fileName: loaded.fileName,
          page: 1,
        });
      } else {
        setLoadError(
          `Unsupported file type: ${file.name}. Load a PDF, DXF, or PNG/JPG/WebP image.`,
        );
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Page-picker choice handler (R.24) ────────────────────────
  const handlePdfPickerChoice = async (choice: RoofingPdfPickChoice) => {
    const pending = pendingPdf;
    setPendingPdf(null);
    if (!pending || choice.kind === 'cancel') return;
    setLoading(true);
    setLoadError(null);
    try {
      const mod = await loadPdfRenderer.get();
      const img = await mod.renderPdfPage(pending.file, choice.pageNumber, 200);
      loadPdfImage({
        imageDataUrl: img.dataUrl,
        widthPx: img.widthPx,
        heightPx: img.heightPx,
        fileName: pending.file.name,
        page: choice.pageNumber,
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // ── Calibration commit ───────────────────────────────────────
  const commitCalibration = () => {
    if (!firstPt || !secondPt) return;
    const ft = parseFloat(distanceInput);
    if (!Number.isFinite(ft) || ft <= 0) {
      setLoadError('Enter a positive distance in feet');
      return;
    }
    calibratePdfFromWorld(firstPt, secondPt, ft);
    setDistanceInput('');
    resetCalib();
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <>
    {/* Phase 14.R.24 — multi-page PDF picker overlay. Rendered in a
        sibling fragment so it portals above the panel + canvas.
        `pendingPdf` is non-null only while the picker is open. */}
    {pendingPdf && (
      <RoofingPdfPagePicker
        filename={pendingPdf.file.name}
        metadata={pendingPdf.metadata}
        onChoose={handlePdfPickerChoice}
      />
    )}
    <div style={PANEL}>
      <div style={ROW}>
        <div style={{ ...HEADER, flex: 1 }}>📄 Blueprint Underlay</div>
        {hasPdf && (
          <span style={{
            fontSize: 10,
            color: '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 120,
          }} title={
            pdf.fileName
              ? (pdf.page && pdf.page > 1
                ? `${pdf.fileName} (page ${pdf.page})`
                : pdf.fileName)
              : '(no name)'
          }>
            {pdf.fileName || '(no name)'}
            {pdf.page && pdf.page > 1 ? ` · p${pdf.page}` : ''}
          </span>
        )}
      </div>

      {/* Load / unload row */}
      <div style={ROW}>
        <input
          ref={fileInputRef}
          type="file"
          // Phase 14.R.24 / R.25 — accept PDFs + raster images + DXF.
          accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.bmp,.dxf,application/dxf,image/vnd.dxf"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
        <button
          style={BTN}
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          title="Load a PDF blueprint, DXF drawing, or raster image (PNG / JPG / WebP) as an underlay"
        >
          {loading ? '⌛ Loading…' : hasPdf ? '↻ Replace' : '📁 Load PDF / DXF / Image'}
        </button>
        {hasPdf && (
          <button
            style={BTN_DANGER}
            onClick={() => {
              resetCalib();
              clearPdf();
            }}
            title="Remove the underlay"
          >
            🗑
          </button>
        )}
      </div>
      {loadError && (
        <div style={{ color: '#ef5350', fontSize: 11, lineHeight: 1.4 }}>
          {loadError}
        </div>
      )}

      {hasPdf && (
        <>
          <div style={DIVIDER} />

          {/* Visibility + opacity */}
          <div style={ROW}>
            <button
              style={pdf.visible ? BTN_ACTIVE : BTN}
              onClick={() => setPdfVisible(!pdf.visible)}
              title={pdf.visible ? 'Hide underlay' : 'Show underlay'}
            >
              {pdf.visible ? '👁 Visible' : '◎ Hidden'}
            </button>
            <button
              style={pdf.locked ? BTN_ACTIVE : BTN}
              onClick={() => setPdfLocked(!pdf.locked)}
              title={pdf.locked ? 'Unlock transforms' : 'Lock transforms'}
            >
              {pdf.locked ? '🔒' : '🔓'}
            </button>
          </div>

          <div>
            <div style={LABEL}>Opacity ({Math.round(pdf.opacity * 100)}%)</div>
            <input
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={pdf.opacity}
              onChange={(e) => setPdfOpacity(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>

          <div style={DIVIDER} />

          {/* Calibration */}
          <div>
            <div style={LABEL}>Calibration</div>
            {calibMode === 'idle' && (
              <button
                style={BTN}
                onClick={beginCalibrate}
                disabled={pdf.locked}
                title="Click two points on the blueprint that you know the real distance between"
              >
                📏 Calibrate (2-click)
              </button>
            )}
            {calibMode === 'calibrate-1' && (
              <div style={{ color: '#00e5ff', fontSize: 11, lineHeight: 1.5 }}>
                Click the <strong>first</strong> anchor on the PDF. ESC cancels.
              </div>
            )}
            {calibMode === 'calibrate-2' && (
              <div style={{ color: '#ff9800', fontSize: 11, lineHeight: 1.5 }}>
                Click the <strong>second</strong> anchor on the PDF. ESC cancels.
              </div>
            )}
            {calibMode === 'enter-distance' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 11, color: '#ccc' }}>
                  Real-world distance between anchors (ft):
                </div>
                <div style={ROW}>
                  <input
                    autoFocus
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={distanceInput}
                    onChange={(e) => setDistanceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitCalibration();
                      if (e.key === 'Escape') {
                        setDistanceInput('');
                        resetCalib();
                      }
                    }}
                    style={INPUT}
                    placeholder="e.g. 40"
                  />
                  <button style={BTN_ACTIVE} onClick={commitCalibration}>
                    ✓
                  </button>
                  <button style={BTN} onClick={() => {
                    setDistanceInput('');
                    resetCalib();
                  }}>
                    ✕
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Scale + size readout */}
          <div>
            <div style={LABEL}>Scale (px / ft)</div>
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={Number.isFinite(pdf.scale) ? pdf.scale.toFixed(2) : '10'}
              onChange={(e) => setPdfScale(Number(e.target.value) || 0.1)}
              disabled={pdf.locked}
              style={INPUT}
            />
            {size && (
              <div style={{ color: '#777', fontSize: 10, marginTop: 3 }}>
                Physical: {size.widthFt.toFixed(1)} × {size.depthFt.toFixed(1)} ft
              </div>
            )}
          </div>

          <div style={DIVIDER} />

          {/* Transforms */}
          <div>
            <div style={LABEL}>Offset X / Z (ft)</div>
            <div style={ROW}>
              <input
                type="number"
                step={0.5}
                value={pdf.offsetX}
                onChange={(e) => setPdfOffset(Number(e.target.value) || 0, pdf.offsetY)}
                disabled={pdf.locked}
                style={INPUT}
              />
              <input
                type="number"
                step={0.5}
                value={pdf.offsetY}
                onChange={(e) => setPdfOffset(pdf.offsetX, Number(e.target.value) || 0)}
                disabled={pdf.locked}
                style={INPUT}
              />
            </div>
          </div>

          <div>
            <div style={LABEL}>Rotation (°)</div>
            <input
              type="number"
              step={1}
              value={pdf.rotationDeg ?? 0}
              onChange={(e) => setPdfRotation(Number(e.target.value) || 0)}
              disabled={pdf.locked}
              style={INPUT}
            />
          </div>

          <button
            style={BTN}
            onClick={() => {
              setPdfOffset(0, 0);
              setPdfRotation(0);
            }}
            disabled={pdf.locked}
            title="Recenter on origin + zero rotation"
          >
            ⊕ Reset transform
          </button>
        </>
      )}

      {!hasPdf && !loading && (
        <div style={{ color: '#666', fontSize: 10, lineHeight: 1.5 }}>
          Load a blueprint PDF, DXF drawing, or raster image (PNG /
          JPG / WebP) to trace your roof over it. Multi-page PDFs
          show a page picker; single-page PDFs render at 200 DPI;
          DXF files are rasterized from LINE / LWPOLYLINE / CIRCLE /
          ARC entities.
        </div>
      )}
    </div>
    </>
  );
}
