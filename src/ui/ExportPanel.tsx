/**
 * Export Panel — HUD with IFC, BOM, and CSV export buttons.
 *
 * Shows export options when pipes exist. Each button triggers the
 * corresponding exporter and initiates a file download.
 */

import { useState, useCallback, useMemo } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
// Phase 10.B — IFCSerializer is lazy-loaded. `type`-only import keeps
// the API surface available for type-checking without dragging the
// runtime module into the main bundle.
import type { exportToIFC as ExportToIFCFn } from '../engine/export/IFCSerializer';
import type { exportToDXF as ExportToDXFFn } from '../engine/export/DXFExporter';
import { loadDxfExporter } from '@core/lazy/loaders';
import { loadIfcSerializer } from '@core/lazy/loaders';
import { hoverPrewarm } from '@core/lazy/lazyImport';
import { generateBOM, bomToCSV, bomToJSON, downloadFile } from '../engine/export/BOMExporter';
import { generateAllFittings } from '@ui/pipe/FittingGenerator';
import { logger } from '@core/logger/Logger';
// Phase 14.A — bid math. Pulled from the active pricing profile at
// export time so CSV/JSON includes the contractor-ready bid total,
// not just raw material + hours.
import { getActivePricingProfile } from '@store/pricingStore';
// Phase 14.B — PDF proposal export via browser print-to-PDF.
import { printProposal } from '@core/print/printProposal';
import { printBidPackage } from '@core/print/printBidPackage';
import { useContractorProfileStore } from '@store/contractorProfileStore';
// Phase 14.D — auto-planner for p-traps + cleanouts. Produces
// FittingInstance[] that BOMExporter aggregates alongside the
// mechanically-generated bends/tees, so material + labor reflect
// real install cost.
import { planPTrapsAndCleanouts, planToFittings } from '@core/compliance/pTrapCleanoutPlanner';
// Phase 14.H — per-material hanger/support planner. Emits BOMItem[]
// that override BOMExporter's flat 4-ft-spacing rollup.
import { planHangers, planToBOMItems as hangerItems } from '@core/compliance/hangerPlanner';
// Phase 14.G — proposal revisions. Prior base-number lookup drives
// the "Print R{n+1}" option; every print auto-saves as a revision.
import { useProposalRevisionStore } from '@store/proposalRevisionStore';

const log = logger('ExportPanel');

export function ExportPanel() {
  const pipes = usePipeStore((s) => s.pipes);
  const pipeList = Object.values(pipes);
  const fixtures = useFixtureStore((s) => s.fixtures);
  const fixtureList = useMemo(() => Object.values(fixtures), [fixtures]);
  const [exporting, setExporting] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Phase 10.B — hover handlers for the IFC button. Sustained 500ms
  // hover pre-warms the chunk so the eventual click feels instant.
  const ifcHover = useMemo(() => hoverPrewarm(loadIfcSerializer, 500), []);

  const handleExportIFC = useCallback(async () => {
    setExporting('ifc');
    try {
      const mod = await loadIfcSerializer.get();
      const fittings = generateAllFittings(pipeList);

      const result = (mod.exportToIFC as typeof ExportToIFCFn)(pipeList, fittings, [], {
        projectName: 'ELBOW GREASE Design',
        includeProperties: true,
        includeFittings: true,
        groupBySystems: true,
      });

      downloadFile(result.content, 'plumbing-design.ifc', 'application/x-step');
      setLastResult(`IFC exported: ${result.entityCount} entities, ${result.pipeCount} pipes, ${(result.sizeBytes / 1024).toFixed(1)}KB`);
    } catch (err) {
      log.error('IFC export failed', err);
      setLastResult(`IFC export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  }, [pipeList]);

  // Phase 14.AA.1 — DXF export. AutoCAD plan-view hand-off for
  // contractors who need to share the design with a GC/architect
  // whose shop runs Revit, BricsCAD, or Draftsight.
  const dxfHover = useMemo(() => hoverPrewarm(loadDxfExporter, 500), []);
  const handleExportDXF = useCallback(async () => {
    setExporting('dxf');
    try {
      const mod = await loadDxfExporter.get();
      const fittings = generateAllFittings(pipeList);
      const result = (mod.exportToDXF as typeof ExportToDXFFn)(
        { pipes: pipeList, fixtures: fixtureList, fittings },
        {
          projection: 'plan',
          projectName: 'ELBOW GREASE Plumbing Plan',
          includeFittings: true,
          includeLabels: true,
        },
      );
      downloadFile(result.content, 'plumbing-plan.dxf', 'application/dxf');
      setLastResult(
        `DXF exported: ${result.entityCount} entities, `
        + `${result.layersUsed.length} layers, `
        + `${(result.sizeBytes / 1024).toFixed(1)}KB`,
      );
    } catch (err) {
      log.error('DXF export failed', err);
      setLastResult(`DXF export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(null);
    }
  }, [pipeList, fixtureList]);

  const handleExportBOM_CSV = useCallback(() => {
    setExporting('csv');
    // Phase 14.D — plan p-traps + cleanouts and fold them into the
    // fitting list before aggregation. BOMExporter already knows how
    // to price `p_trap` + `cleanout_adapter` types.
    const mechanicalFittings = generateAllFittings(pipeList);
    const plan = planPTrapsAndCleanouts(pipeList, fixtureList);
    const complianceFittings = planToFittings(plan);
    const fittings = [...mechanicalFittings, ...complianceFittings];
    // Phase 14.H — per-material hanger plan drives the support rows
    // instead of BOMExporter's flat 4-ft rollup.
    const hangerPlan = planHangers(pipeList);
    const supportItemsOverride = hangerItems(hangerPlan);
    // Phase 14.A — pass the active pricing profile so the CSV carries
    // a BID SUMMARY section (labor $ at the contractor's rate,
    // overhead, tax, margin, grand total).
    const report = generateBOM(pipeList, fittings, getActivePricingProfile(), { supportItemsOverride }, fixtureList);
    const csv = bomToCSV(report);

    downloadFile(csv, 'plumbing-bom.csv', 'text/csv');
    const bidTotal = report.bid ? ` · BID $${report.bid.grandTotal.toFixed(0)}` : '';
    const complianceSuffix = plan.summary.pTrapCount + plan.summary.cleanoutCount + hangerPlan.summary.hangerCount > 0
      ? ` · +${plan.summary.pTrapCount} traps +${plan.summary.cleanoutCount} COs +${hangerPlan.summary.hangerCount} hangers`
      : '';
    setLastResult(
      `BOM CSV: ${report.items.length} items, $${report.grandTotal.toFixed(0)} mat, ` +
      `${report.cutList.wastePercent.toFixed(1)}% waste${bidTotal}${complianceSuffix}`,
    );
    setExporting(null);
  }, [pipeList, fixtureList]);

  const handleExportBOM_JSON = useCallback(() => {
    setExporting('json');
    const mechanicalFittings = generateAllFittings(pipeList);
    const plan = planPTrapsAndCleanouts(pipeList, fixtureList);
    const complianceFittings = planToFittings(plan);
    const fittings = [...mechanicalFittings, ...complianceFittings];
    const hangerPlan = planHangers(pipeList);
    const supportItemsOverride = hangerItems(hangerPlan);
    const report = generateBOM(pipeList, fittings, getActivePricingProfile(), { supportItemsOverride }, fixtureList);
    const json = bomToJSON(report);

    downloadFile(json, 'plumbing-bom.json', 'application/json');
    const bidTotal = report.bid ? ` · BID $${report.bid.grandTotal.toFixed(0)}` : '';
    setLastResult(`BOM JSON: ${report.items.length} items, $${report.grandTotal.toFixed(0)} mat${bidTotal}`);
    setExporting(null);
  }, [pipeList, fixtureList]);

  const contractorUnset = useContractorProfileStore((s) => s.isUnset());

  // Phase 14.G — pick the most-recently-saved base proposal as the
  // "active" revision target. When set, the proposal buttons offer
  // "Print R{n+1}" instead of "Print new". User can opt out via
  // the "Start new" checkbox that appears when a base is active.
  //
  // Bug-fix: previously called `useProposalRevisionStore((s) => s.getBaseNumbers())`
  // which invoked a method that ALLOCATES A NEW SORTED ARRAY every call.
  // Zustand's Object.is equality check saw a different reference every
  // render → forced another render → infinite "Maximum update depth
  // exceeded" loop on boot. Subscribe to the stable `byBase` map
  // instead and derive via useMemo so the sort only runs when the
  // map actually changes.
  const byBase = useProposalRevisionStore((s) => s.byBase);
  const baseNumbers = useMemo(() => {
    const keys = Object.keys(byBase);
    return keys.sort((a, b) => {
      const aLast = byBase[a]?.reduce((acc, r) => (r.savedAtIso > acc ? r.savedAtIso : acc), '') ?? '';
      const bLast = byBase[b]?.reduce((acc, r) => (r.savedAtIso > acc ? r.savedAtIso : acc), '') ?? '';
      return bLast.localeCompare(aLast);
    });
  }, [byBase]);
  const activeBase = baseNumbers[0] ?? null;
  const activeBaseRevCount = activeBase ? (byBase[activeBase]?.length ?? 0) : 0;
  const [startNew, setStartNew] = useState(false);
  const willRevise = activeBase !== null && !startNew;

  // Phase 14.AA.2 — multi-page branded bid package (cover + scope +
  // BOM + compliance + terms). Single PDF the customer or AHJ can
  // sign and file. Uses the same print-to-PDF flow as the proposal;
  // the orchestrator stages the data + toggles the body class.
  const handleExportBidPackage = useCallback(() => {
    setExporting('bid');
    try {
      printBidPackage({});
      setLastResult('Bid package print dialog opened — save as PDF.');
    } catch (err) {
      log.error('Bid package export failed', err);
      setLastResult(`Bid package failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // Release the disabled state immediately — the print flow is
      // out of our hands once window.print() returns; the browser
      // manages its own dialog lifecycle.
      setTimeout(() => setExporting(null), 400);
    }
  }, []);

  const handleExportProposal = useCallback(async (variant: 'customer-facing' | 'internal') => {
    if (contractorUnset) {
      const go = confirm(
        'Your contractor profile isn\'t set up yet. The proposal will print ' +
        'with a placeholder. Continue anyway?\n\nTip: Ctrl+Shift+I opens the editor.',
      );
      if (!go) return;
    }
    setExporting(variant === 'customer-facing' ? 'pdf' : 'pdf-internal');
    try {
      let note: string | undefined;
      if (willRevise) {
        const raw = prompt(
          `Print revision R${activeBaseRevCount + 1} of ${activeBase}.\n\n` +
          'Optional note for this revision (e.g. "Added tub, removed shower"):',
          '',
        );
        if (raw === null) {
          // User hit Cancel on the prompt.
          setExporting(null);
          return;
        }
        note = raw.trim() || undefined;
      }
      await printProposal({
        variant,
        ...(willRevise && activeBase ? { revisionOfBaseNumber: activeBase } : {}),
        ...(note ? { revisionNote: note } : {}),
      });
      // After first fresh print, the `startNew` checkbox is no longer
      // relevant — reset it so the next print naturally continues as R2.
      setStartNew(false);
      setLastResult(
        willRevise
          ? `Revision R${activeBaseRevCount + 1} printed (${variant})`
          : `Proposal R1 printed (${variant})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastResult(`PDF failed: ${msg.slice(0, 80)}`);
    } finally {
      setExporting(null);
    }
  }, [contractorUnset, willRevise, activeBase, activeBaseRevCount]);

  if (pipeList.length === 0) return null;

  return (
    <div style={styles.panel}>
      <div style={styles.header}>EXPORT</div>

      <button
        style={styles.btn}
        onClick={handleExportIFC}
        onMouseEnter={ifcHover.onEnter}
        onMouseLeave={ifcHover.onLeave}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>BIM</span>
        <span style={styles.btnLabel}>IFC File</span>
        <span style={styles.btnSub}>
          Revit / BIM viewers{exporting === 'ifc' ? ' · loading…' : ''}
        </span>
      </button>

      {/* Phase 14.AA.1 — DXF export for AutoCAD / Revit / BricsCAD
          plan-view hand-off. Writes AC1027 ASCII with AIA-guideline
          layers per system (P-DOMC / P-DOMH / P-DRAN-WAST / etc.). */}
      <button
        style={styles.btn}
        onClick={handleExportDXF}
        onMouseEnter={dxfHover.onEnter}
        onMouseLeave={dxfHover.onLeave}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>DXF</span>
        <span style={styles.btnLabel}>AutoCAD DXF</span>
        <span style={styles.btnSub}>
          Plan view · AIA layers{exporting === 'dxf' ? ' · loading…' : ''}
        </span>
      </button>

      {/* Phase 14.AA.2 — multi-page branded bid package with cover,
          scope, itemized BOM, compliance summary, and sign-off. */}
      <button
        style={styles.btn}
        onClick={handleExportBidPackage}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>BID</span>
        <span style={styles.btnLabel}>Bid Package</span>
        <span style={styles.btnSub}>
          Branded multi-page PDF{exporting === 'bid' ? ' · printing…' : ''}
        </span>
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

      {/* Phase 14.B — customer-facing PDF proposal (print-to-PDF).
          Phase 14.G — label shows which revision is about to print. */}
      <button
        style={styles.btn}
        onClick={() => handleExportProposal('customer-facing')}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>PDF</span>
        <span style={styles.btnLabel}>
          Proposal{willRevise ? ` R${activeBaseRevCount + 1}` : ' R1'}
        </span>
        <span style={styles.btnSub}>Customer-facing</span>
      </button>

      {/* Phase 14.B — internal breakdown (shows overhead + margin). */}
      <button
        style={styles.btn}
        onClick={() => handleExportProposal('internal')}
        disabled={exporting !== null}
      >
        <span style={styles.btnIcon}>PDF</span>
        <span style={styles.btnLabel}>
          Proposal{willRevise ? ` R${activeBaseRevCount + 1}` : ' R1'}
        </span>
        <span style={styles.btnSub}>Internal breakdown</span>
      </button>

      {/* Phase 14.G — revision controls. Shown only when there's an
          active base. "Start new" flips the next print to a fresh
          proposal number; "Revisions…" opens the compare panel. */}
      {activeBase && (
        <div style={styles.revisionStrip}>
          <label style={styles.revisionLabel}>
            <input
              type="checkbox"
              checked={startNew}
              onChange={(e) => setStartNew(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Start new
          </label>
          <span style={styles.revisionActiveLabel}>
            {activeBase} · {activeBaseRevCount} rev
          </span>
        </div>
      )}

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
  // Phase 14.G — small revision status strip on the export HUD.
  revisionStrip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: '4px 8px',
    marginLeft: 4,
    borderLeft: '1px solid #333',
    gap: 2,
  },
  revisionLabel: {
    fontSize: 9,
    color: '#aebbc9',
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  revisionActiveLabel: {
    fontSize: 8,
    color: '#7a8592',
    fontFamily: 'ui-monospace, Consolas, monospace',
    letterSpacing: 0.5,
  },
};
