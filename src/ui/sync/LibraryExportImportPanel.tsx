/**
 * LibraryExportImportPanel — Phase 14.J
 *
 * Ctrl+Shift+Y ("sYnc") — move contractor-level settings between
 * machines + between colleagues. Two views in one modal:
 *
 *   EXPORT — pick which sections to include, optional label, Save As
 *            downloads a single .elbowlib.json file.
 *
 *   IMPORT — upload a .elbowlib.json, review the summary (what's in
 *            the file), pick which sections to merge, pick per-section
 *            conflict strategy, Apply writes back to the stores.
 *
 * Each section checkbox is reversible and independent. A contractor
 * can export ONLY templates to share with a colleague (keeps their
 * private rates + customer list private). Import side likewise —
 * pulling only pricing from an old backup without touching current
 * templates is a single checkbox.
 */

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { logger } from '@core/logger/Logger';
import { downloadFile } from '../../engine/export/BOMExporter';
import { useContractorProfileStore } from '@store/contractorProfileStore';
import { usePricingStore } from '@store/pricingStore';
import { useAssemblyTemplateStore } from '@store/assemblyTemplateStore';
import { useProposalRevisionStore } from '@store/proposalRevisionStore';
import {
  buildLibrary,
  serializeLibrary,
  parseLibrary,
  summarizeLibrary,
  mergeLibrary,
  suggestExportFilename,
  type ContractorLibrary,
  type LibrarySummary,
  type MergePlan,
  type MergeReport,
  type MergeStrategy,
} from '@core/sync/contractorLibrary';

const log = logger('LibraryExportImportPanel');

type Mode = 'export' | 'import';

export function LibraryExportImportPanel() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('export');
  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
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

  if (!open) return null;

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="library-title" style={styles.title}>
            Contractor Library — Export / Import
          </span>
          <button
            type="button"
            aria-label="Close library panel"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        <nav style={styles.modeBar}>
          <button
            type="button"
            style={mode === 'export' ? styles.modeBtnActive : styles.modeBtn}
            onClick={() => setMode('export')}
          >
            Export
          </button>
          <button
            type="button"
            style={mode === 'import' ? styles.modeBtnActive : styles.modeBtn}
            onClick={() => setMode('import')}
          >
            Import
          </button>
        </nav>

        {mode === 'export'
          ? <ExportView />
          : <ImportView onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}

// ── Export view ───────────────────────────────────────────────

function ExportView() {
  // Per-section include toggles. Default: all on.
  const [includeContractor, setIncludeContractor] = useState(true);
  const [includePricing, setIncludePricing] = useState(true);
  const [includeTemplates, setIncludeTemplates] = useState(true);
  const [includeRevisions, setIncludeRevisions] = useState(true);
  const [label, setLabel] = useState('');

  // Live counts of what WOULD be in the export.
  const contractorName = useContractorProfileStore((s) => s.profile.companyName);
  const pricingName = usePricingStore((s) => s.profile.name);
  const templateCount = useAssemblyTemplateStore((s) => s.order.length);
  const revisionStore = useProposalRevisionStore((s) => s.byBase);
  const revisionCount = Object.values(revisionStore).reduce((sum, list) => sum + list.length, 0);
  const revisionBaseCount = Object.keys(revisionStore).length;

  const handleExport = () => {
    const nothingSelected = !includeContractor && !includePricing && !includeTemplates && !includeRevisions;
    if (nothingSelected) {
      alert('Select at least one section to export.');
      return;
    }

    const library = buildLibrary({
      label: label.trim() || undefined,
      contractorProfile: includeContractor ? useContractorProfileStore.getState().profile : undefined,
      pricingProfile: includePricing ? usePricingStore.getState().profile : undefined,
      templates: includeTemplates ? {
        order: [...useAssemblyTemplateStore.getState().order],
        byId: { ...useAssemblyTemplateStore.getState().templates },
      } : undefined,
      revisions: includeRevisions ? {
        byBase: { ...useProposalRevisionStore.getState().byBase },
      } : undefined,
    });

    const filename = suggestExportFilename(label);
    const json = serializeLibrary(library);
    try {
      downloadFile(json, filename, 'application/json');
      log.info('library exported', {
        sections: {
          contractor: includeContractor,
          pricing: includePricing,
          templates: includeTemplates,
          revisions: includeRevisions,
        },
        filename,
      });
    } catch (err) {
      log.error('library export failed', err);
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <>
      <div style={styles.body}>
        <div style={styles.hint}>
          Bundles your contractor setup into a single <code>.elbowlib.json</code> file.
          Perfect for moving to a new machine, keeping a backup, or sharing templates
          with a colleague (uncheck pricing + revisions to keep those private).
        </div>

        <SectionCheckbox
          label="Contractor profile"
          detail={contractorName}
          checked={includeContractor}
          onChange={setIncludeContractor}
        />
        <SectionCheckbox
          label="Pricing profile"
          detail={pricingName}
          checked={includePricing}
          onChange={setIncludePricing}
        />
        <SectionCheckbox
          label="Assembly templates"
          detail={`${templateCount} template${templateCount === 1 ? '' : 's'}`}
          checked={includeTemplates}
          onChange={setIncludeTemplates}
        />
        <SectionCheckbox
          label="Proposal revisions"
          detail={`${revisionCount} revision${revisionCount === 1 ? '' : 's'} across ${revisionBaseCount} proposal${revisionBaseCount === 1 ? '' : 's'}`}
          checked={includeRevisions}
          onChange={setIncludeRevisions}
        />

        <div style={styles.field}>
          <label style={styles.label}>Optional label (included in the file)</label>
          <input
            type="text"
            value={label}
            placeholder='e.g. "pre-rate-bump" or "backup-2026-Q2"'
            onChange={(e) => setLabel(e.target.value)}
            style={styles.input}
          />
        </div>
      </div>

      <footer style={styles.footer}>
        <span style={styles.footerHint}>
          Suggested filename: <code>{suggestExportFilename(label)}</code>
        </span>
        <button type="button" style={styles.primaryBtn} onClick={handleExport}>
          Download →
        </button>
      </footer>
    </>
  );
}

// ── Import view ───────────────────────────────────────────────

interface ImportViewProps {
  onClose: () => void;
}

function ImportView({ onClose }: ImportViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<'awaiting-file' | 'review' | 'applied'>('awaiting-file');
  const [library, setLibrary] = useState<ContractorLibrary | null>(null);
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-section include + strategy.
  const [includeContractor, setIncludeContractor] = useState(false);
  const [includePricing, setIncludePricing] = useState(false);
  const [includeTemplates, setIncludeTemplates] = useState(true);
  const [includeRevisions, setIncludeRevisions] = useState(true);
  const [templateStrategy, setTemplateStrategy] = useState<MergeStrategy>('keep-both');
  const [revisionStrategy, setRevisionStrategy] = useState<MergeStrategy>('skip');
  const [report, setReport] = useState<MergeReport | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const parsed = parseLibrary(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setLibrary(parsed.library);
      setSummary(summarizeLibrary(parsed.library));
      // Default the enable checkboxes to whatever the file has.
      setIncludeContractor(!!parsed.library.contractorProfile);
      setIncludePricing(!!parsed.library.pricingProfile);
      setIncludeTemplates(!!parsed.library.templates);
      setIncludeRevisions(!!parsed.library.revisions);
      setStage('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleApply = () => {
    if (!library) return;
    const plan: MergePlan = {
      sections: {
        contractorProfile: includeContractor,
        pricingProfile: includePricing,
        templates: includeTemplates,
        revisions: includeRevisions,
      },
      strategyByKind: {
        contractorProfile: 'replace',
        pricingProfile: 'replace',
        templates: templateStrategy,
        revisions: revisionStrategy,
      },
    };
    const current = {
      contractorProfile: useContractorProfileStore.getState().profile,
      pricingProfile: usePricingStore.getState().profile,
      templates: {
        order: useAssemblyTemplateStore.getState().order,
        byId: useAssemblyTemplateStore.getState().templates,
      },
      revisions: {
        byBase: useProposalRevisionStore.getState().byBase,
      },
    };
    const { next, report: mergeReport } = mergeLibrary(current, library, plan);

    // Apply back to the stores.
    if (next.contractorProfile && includeContractor) {
      useContractorProfileStore.getState().setProfile(next.contractorProfile);
    }
    if (next.pricingProfile && includePricing) {
      usePricingStore.getState().setProfile(next.pricingProfile);
    }
    if (next.templates && includeTemplates) {
      // The assemblyTemplateStore doesn't expose a setAll, so we call
      // the internal setter directly via setState.
      useAssemblyTemplateStore.setState({
        templates: next.templates.byId,
        order: next.templates.order,
      });
      persistTemplatesToLocalStorage(next.templates.order, next.templates.byId);
    }
    if (next.revisions && includeRevisions) {
      useProposalRevisionStore.setState({ byBase: next.revisions.byBase });
      persistRevisionsToLocalStorage(next.revisions.byBase);
    }

    setReport(mergeReport);
    setStage('applied');
    log.info('library imported', { report: mergeReport });
  };

  if (stage === 'awaiting-file') {
    return (
      <>
        <div style={styles.body}>
          <div style={styles.hint}>
            Import a <code>.elbowlib.json</code> file exported from another
            ELBOW GREASE installation. You'll review what's in it before
            anything is written to your current stores.
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <button
              type="button"
              style={styles.primaryBtn}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose library file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json,.elbowlib.json"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
        </div>
        <footer style={styles.footer}>
          <span style={styles.footerHint}>
            Supported format: ELBOW GREASE library v1
          </span>
        </footer>
      </>
    );
  }

  if (stage === 'applied' && report) {
    return (
      <>
        <div style={styles.body}>
          <div style={styles.successHint}>✓ Library imported successfully.</div>
          <ul style={styles.reportList}>
            {report.contractorProfileReplaced && <li>Contractor profile replaced.</li>}
            {report.pricingProfileReplaced && <li>Pricing profile replaced.</li>}
            {report.templates.added > 0 && <li>Templates added: {report.templates.added}</li>}
            {report.templates.replaced > 0 && <li>Templates replaced: {report.templates.replaced}</li>}
            {report.templates.renamed > 0 && <li>Templates imported as duplicates (keep-both): {report.templates.renamed}</li>}
            {report.templates.skipped > 0 && <li>Templates skipped (conflict, kept yours): {report.templates.skipped}</li>}
            {report.revisions.basesAdded > 0 && <li>Proposal histories added: {report.revisions.basesAdded}</li>}
            {report.revisions.snapshotsAdded > 0 && <li>Revision snapshots added: {report.revisions.snapshotsAdded}</li>}
            {report.revisions.snapshotsReplaced > 0 && <li>Revision snapshots replaced: {report.revisions.snapshotsReplaced}</li>}
            {report.revisions.snapshotsSkipped > 0 && <li>Revision snapshots skipped: {report.revisions.snapshotsSkipped}</li>}
          </ul>
        </div>
        <footer style={styles.footer}>
          <span style={{ flex: 1 }} />
          <button type="button" style={styles.primaryBtn} onClick={onClose}>Done</button>
        </footer>
      </>
    );
  }

  // stage === 'review'
  if (!summary || !library) return null;
  return (
    <>
      <div style={styles.body}>
        <div style={styles.hint}>
          Review what's in the file and pick what to merge. Each section
          is independently toggleable; conflicts within a section obey
          the strategy you pick below.
          <br />
          <small style={{ opacity: 0.7 }}>
            Exported: {summary.exportedAt.slice(0, 10)}
            {summary.label ? ` · "${summary.label}"` : ''}
          </small>
        </div>

        <SectionCheckbox
          label="Contractor profile"
          detail={summary.contractorCompanyName ?? '(not in file)'}
          checked={includeContractor}
          onChange={setIncludeContractor}
          disabled={!summary.hasContractorProfile}
          warning={summary.hasContractorProfile ? 'Imports replace your current contractor profile.' : undefined}
        />
        <SectionCheckbox
          label="Pricing profile"
          detail={summary.pricingProfileName ?? '(not in file)'}
          checked={includePricing}
          onChange={setIncludePricing}
          disabled={!summary.hasPricingProfile}
          warning={summary.hasPricingProfile ? 'Imports replace your current pricing profile (rate, overhead, margin, tax).' : undefined}
        />
        <SectionCheckbox
          label="Assembly templates"
          detail={`${summary.templateCount} template${summary.templateCount === 1 ? '' : 's'}`}
          checked={includeTemplates}
          onChange={setIncludeTemplates}
          disabled={summary.templateCount === 0}
        />
        {includeTemplates && summary.templateCount > 0 && (
          <StrategyPicker
            value={templateStrategy}
            onChange={setTemplateStrategy}
            labels={{
              replace: 'Replace mine on conflict',
              skip: 'Skip on conflict (keep mine)',
              'keep-both': 'Keep both (rename incoming)',
            }}
          />
        )}

        <SectionCheckbox
          label="Proposal revisions"
          detail={`${summary.revisionTotalCount} revision${summary.revisionTotalCount === 1 ? '' : 's'} across ${summary.revisionProposalCount} proposal${summary.revisionProposalCount === 1 ? '' : 's'}`}
          checked={includeRevisions}
          onChange={setIncludeRevisions}
          disabled={summary.revisionTotalCount === 0}
        />
        {includeRevisions && summary.revisionTotalCount > 0 && (
          <StrategyPicker
            value={revisionStrategy}
            onChange={setRevisionStrategy}
            labels={{
              replace: 'Replace matching snapshots',
              skip: 'Skip matching snapshots (keep mine)',
              'keep-both': 'Skip (keep-both not meaningful for revisions)',
            }}
            hide={['keep-both']}
          />
        )}
      </div>

      <footer style={styles.footer}>
        <button
          type="button"
          style={styles.resetBtn}
          onClick={() => { setStage('awaiting-file'); setLibrary(null); setSummary(null); }}
        >
          ← Choose different file
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" style={styles.primaryBtn} onClick={handleApply}>
          Apply merge →
        </button>
      </footer>
    </>
  );
}

// ── Persistence helpers (must mirror each store's localStorage key) ──

function persistTemplatesToLocalStorage(
  order: string[],
  templates: Record<string, import('@core/templates/assemblyTemplate').AssemblyTemplate>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = { version: 1, order, templates };
    localStorage.setItem('elbow-grease-assembly-templates', JSON.stringify(payload));
  } catch {
    // Quota — the in-memory store is updated, next restart picks up what fits.
  }
}

function persistRevisionsToLocalStorage(
  byBase: Record<string, import('@core/print/proposalRevision').SavedRevision[]>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = { version: 1, byBase };
    localStorage.setItem('elbow-grease-proposal-revisions', JSON.stringify(payload));
  } catch {
    // Same as above.
  }
}

// ── Sub-components ────────────────────────────────────────────

function SectionCheckbox({
  label, detail, checked, onChange, disabled, warning,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  warning?: string;
}) {
  return (
    <label style={{ ...styles.checkboxRow, ...(disabled ? { opacity: 0.5 } : {}) }}>
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div style={{ flex: 1 }}>
        <div style={styles.checkboxLabel}>{label}</div>
        <div style={styles.checkboxDetail}>{detail}</div>
        {warning && <div style={styles.checkboxWarning}>{warning}</div>}
      </div>
    </label>
  );
}

function StrategyPicker({
  value, onChange, labels, hide,
}: {
  value: MergeStrategy;
  onChange: (next: MergeStrategy) => void;
  labels: Record<MergeStrategy, string>;
  hide?: MergeStrategy[];
}) {
  const strategies: MergeStrategy[] = (['replace', 'skip', 'keep-both'] as MergeStrategy[])
    .filter((s) => !hide?.includes(s));
  return (
    <div style={styles.strategyPicker}>
      <div style={styles.strategyLabel}>Conflict strategy</div>
      {strategies.map((s) => (
        <label key={s} style={styles.strategyOption}>
          <input
            type="radio"
            checked={value === s}
            onChange={() => onChange(s)}
          />
          {labels[s]}
        </label>
      ))}
    </div>
  );
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
    width: 'min(600px, 94vw)',
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
  modeBar: {
    display: 'flex', gap: 4,
    padding: '8px 18px',
    borderBottom: '1px solid #1a2334',
  },
  modeBtn: {
    padding: '6px 14px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  modeBtnActive: {
    padding: '6px 14px',
    background: 'rgba(0, 229, 255, 0.15)',
    border: '1px solid rgba(0, 229, 255, 0.55)',
    borderRadius: 4, color: '#00e5ff',
    fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
    cursor: 'pointer',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
    minHeight: 200,
  },
  hint: {
    fontSize: 11, color: '#cfd8e3',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
    lineHeight: 1.5,
  },
  successHint: {
    fontSize: 13, color: '#66bb6a', fontWeight: 700,
    padding: '10px 12px',
    background: 'rgba(102, 187, 106, 0.08)',
    border: '1px solid rgba(102, 187, 106, 0.35)',
    borderRadius: 4,
  },
  error: {
    fontSize: 11, color: '#ff8a8a',
    padding: '8px 10px',
    background: 'rgba(239, 83, 80, 0.08)',
    border: '1px solid rgba(239, 83, 80, 0.4)',
    borderRadius: 4,
  },
  checkboxRow: {
    display: 'flex', gap: 10, alignItems: 'flex-start',
    padding: '8px 10px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 4,
    cursor: 'pointer',
  },
  checkboxLabel: { fontSize: 12, fontWeight: 600, color: '#e0e6ef' },
  checkboxDetail: { fontSize: 11, color: '#7a8592', marginTop: 1 },
  checkboxWarning: {
    fontSize: 10, color: '#ffd54f',
    marginTop: 2, fontStyle: 'italic',
  },
  strategyPicker: {
    display: 'flex', flexDirection: 'column', gap: 4,
    marginLeft: 32, marginTop: -4, marginBottom: 4,
    padding: '6px 10px',
    background: 'rgba(0, 0, 0, 0.15)',
    borderLeft: '2px solid #2a3a54',
    borderRadius: 0,
  },
  strategyLabel: { fontSize: 10, color: '#7a8592', letterSpacing: 0.5, textTransform: 'uppercase' },
  strategyOption: {
    display: 'flex', gap: 6, alignItems: 'center',
    fontSize: 11, color: '#cfd8e3',
    cursor: 'pointer',
  },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 11, fontWeight: 600, color: '#cfd8e3' },
  input: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '6px 8px', outline: 'none',
  },
  reportList: {
    listStyle: 'disc', paddingLeft: 24, margin: 0,
    fontSize: 12, color: '#cfd8e3', lineHeight: 1.6,
  },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  footerHint: { flex: 1, fontSize: 11, color: '#7a8592', overflow: 'hidden', textOverflow: 'ellipsis' },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#7a8592',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  primaryBtn: {
    padding: '7px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
};
