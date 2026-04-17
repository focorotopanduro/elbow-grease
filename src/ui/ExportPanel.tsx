/**
 * Export Panel — HUD with IFC, BOM, and CSV export buttons.
 *
 * Shows export options when pipes exist. Each button triggers the
 * corresponding exporter and initiates a file download.
 */

import { useState, useCallback } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { exportToIFC } from '../engine/export/IFCSerializer';
import { generateBOM, bomToCSV, bomToJSON, downloadFile } from '../engine/export/BOMExporter';
import { generateAllFittings } from '@ui/pipe/FittingGenerator';

export function ExportPanel() {
  const pipes = usePipeStore((s) => s.pipes);
  const pipeList = Object.values(pipes);
  const [exporting, setExporting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleExportIFC = useCallback(() => {
    setExporting('ifc');
    const fittings = generateAllFittings(pipeList);

    const result = exportToIFC(pipeList, fittings, [], {
      projectName: 'ELBOW GREASE Design',
      includeProperties: true,
      includeFittings: true,
      groupBySystems: true,
    });

    downloadFile(result.content, 'plumbing-design.ifc', 'application/x-step');
    setLastResult(`IFC exported: ${result.entityCount} entities, ${result.pipeCount} pipes, ${(result.sizeBytes / 1024).toFixed(1)}KB`);
    setExporting(null);
  }, [pipeList]);

  const handleExportBOM_CSV = useCallback(() => {
    setExporting('csv');
    const fittings = generateAllFittings(pipeList);
    const report = generateBOM(pipeList, fittings);
    const csv = bomToCSV(report);

    downloadFile(csv, 'plumbing-bom.csv', 'text/csv');
    setLastResult(`BOM CSV: ${report.items.length} items, $${report.grandTotal.toFixed(0)} total, ${report.cutList.wastePercent.toFixed(1)}% waste`);
    setExporting(null);
  }, [pipeList]);

  const handleExportBOM_JSON = useCallback(() => {
    setExporting('json');
    const fittings = generateAllFittings(pipeList);
    const report = generateBOM(pipeList, fittings);
    const json = bomToJSON(report);

    downloadFile(json, 'plumbing-bom.json', 'application/json');
    setLastResult(`BOM JSON: ${report.items.length} items, $${report.grandTotal.toFixed(0)} total`);
    setExporting(null);
  }, [pipeList]);

  if (pipeList.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>EXPORT</div>

      <button
        style={styles.btn}
        onClick={handleExportIFC}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>BIM</span>
        <span style={styles.btnLabel}>IFC File</span>
        <span style={styles.btnSub}>Revit / BIM viewers</span>
      </button>

      <button
        style={styles.btn}
        onClick={handleExportBOM_CSV}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>CSV</span>
        <span style={styles.btnLabel}>Bill of Materials</span>
        <span style={styles.btnSub}>Excel / QuickBooks</span>
      </button>

      <button
        style={styles.btn}
        onClick={handleExportBOM_JSON}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>API</span>
        <span style={styles.btnLabel}>BOM JSON</span>
        <span style={styles.btnSub}>Procurement API</span>
      </button>

      {exporting && (
        <div style={styles.status}>Exporting {exporting}...</div>
      )}
      {lastResult && !exporting && (
        <div style={styles.result}>{lastResult}</div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    bottom: 16,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 20,
  },
  header: {
    fontSize: 9,
    fontWeight: 700,
    color: '#888',
    letterSpacing: 2,
    marginRight: 4,
  },
  btn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '8px 14px',
    borderRadius: 8,
    border: '1px solid #333',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    minWidth: 90,
  },
  btnIcon: {
    fontSize: 11,
    fontWeight: 800,
    color: '#00e5ff',
    letterSpacing: 1,
  },
  btnLabel: {
    fontSize: 11,
    color: '#ccc',
    fontWeight: 500,
  },
  btnSub: {
    fontSize: 8,
    color: '#666',
  },
  status: {
    fontSize: 10,
    color: '#ffc107',
    marginLeft: 8,
  },
  result: {
    fontSize: 9,
    color: '#00e676',
    marginLeft: 8,
    maxWidth: 200,
  },
};
