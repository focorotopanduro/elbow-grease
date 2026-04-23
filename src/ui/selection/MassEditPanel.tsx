/**
 * MassEditPanel — Phase 14.N
 *
 * Ctrl+Shift+M — bulk-edit the currently multi-selected pipes +
 * fixtures. Supports sparse change-sets: every field is optional,
 * blank fields leave the corresponding property untouched.
 *
 * Workflow:
 *   1. Open (Ctrl+Shift+M or via button on the SelectionCountBadge).
 *   2. The "Currently in selection" strip shows histograms:
 *        Material: 3× PVC Sch 40, 2× Copper Type L
 *        Diameter: 4× 2″, 1× 3″
 *        System:   4× Waste, 1× Vent
 *   3. Set any combination of override fields + Apply.
 *   4. Per-field: only pipes whose current value differs get written
 *      (minimal setState churn).
 *
 * Returns null when multi-select is empty (nothing to edit).
 */

import { useEffect, useMemo, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { useMultiSelectStore } from '@store/multiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  summarizeSelection,
  applyPipeEdit,
  isEmptyChangeSet,
  changeSetAffectsAny,
  humanMaterial,
  humanSystem,
  humanDiameter,
  type MassEditSet,
  type PipeChangeSet,
  type VisibilityOp,
  type EditablePipe,
} from '@core/selection/massEdit';
import { PIPE_MATERIALS, type PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType } from '../../engine/graph/GraphNode';

const ALL_SYSTEMS: SystemType[] = ['waste', 'vent', 'cold_supply', 'hot_supply', 'storm'];
const COMMON_DIAMETERS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6];

export function MassEditPanel() {
  const pipeIdsMap = useMultiSelectStore((s) => s.pipeIds);
  const fixtureIdsMap = useMultiSelectStore((s) => s.fixtureIds);
  const pipesState = usePipeStore((s) => s.pipes);
  const fixturesState = useFixtureStore((s) => s.fixtures);

  const selectedPipeIds = Object.keys(pipeIdsMap);
  const selectedFixtureIds = Object.keys(fixtureIdsMap);
  const selectionCount = selectedPipeIds.length + selectedFixtureIds.length;

  const [open, setOpen] = useState(false);

  // Change-set form state.
  const [material, setMaterial] = useState<PipeMaterial | ''>('');
  const [diameter, setDiameter] = useState<string>('');
  const [system, setSystem] = useState<SystemType | ''>('');
  const [visibility, setVisibility] = useState<VisibilityOp>('unchanged');

  const trapRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
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

  // Reset form on open so prior values don't carry into a new session.
  useEffect(() => {
    if (!open) return;
    setMaterial('');
    setDiameter('');
    setSystem('');
    setVisibility('unchanged');
  }, [open]);

  // Snapshot the selected entities + build histograms. Memoed so
  // histogram computation only runs when the selection changes.
  const { selectedPipes, summary } = useMemo(() => {
    const selPipes: EditablePipe[] = selectedPipeIds
      .map((id) => pipesState[id])
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        id: p.id,
        material: p.material,
        diameter: p.diameter,
        system: p.system,
        visible: p.visible,
      }));
    return {
      selectedPipes: selPipes,
      summary: summarizeSelection(selPipes, selectedFixtureIds.length),
    };
  }, [selectedPipeIds.join(','), selectedFixtureIds.length, pipesState]);

  if (!open) return null;
  if (selectionCount === 0) {
    // User opened the panel with nothing selected — show an empty state.
    return (
      <div style={styles.backdrop} onClick={() => setOpen(false)}>
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="massedit-title"
          style={styles.panel}
          onClick={(e) => e.stopPropagation()}
        >
          <header style={styles.header}>
            <span id="massedit-title" style={styles.title}>Mass Edit</span>
            <button type="button" aria-label="Close" style={styles.closeBtn} onClick={() => setOpen(false)}>×</button>
          </header>
          <div style={styles.body}>
            <div style={styles.emptyState}>
              Nothing selected. Shift+click pipes or fixtures, or press S for lasso mode.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Build the live change-set so we can show "will affect N pipes."
  const changeSet: MassEditSet = {
    pipes: {
      ...(material !== '' ? { material } : {}),
      ...(diameter !== '' ? { diameter: Number(diameter) } : {}),
      ...(system !== '' ? { system } : {}),
      ...(visibility !== 'unchanged' ? { visibility } : {}),
    },
  };
  const empty = isEmptyChangeSet(changeSet);
  const affectedCount = empty
    ? 0
    : selectedPipes.filter((p) => applyPipeEdit(p, changeSet.pipes!).changed).length;
  const willApply = !empty && changeSetAffectsAny(selectedPipes, changeSet);

  const handleApply = () => {
    if (!willApply || !changeSet.pipes) return;
    const pipeStoreState = usePipeStore.getState();
    for (const p of selectedPipes) {
      const diff = applyPipeEdit(p, changeSet.pipes);
      if (!diff.changed) continue;
      if (diff.material !== undefined) pipeStoreState.setMaterial(p.id, diff.material);
      if (diff.diameter !== undefined) pipeStoreState.updateDiameter(p.id, diff.diameter);
      if (diff.system !== undefined) pipeStoreState.setSystem(p.id, diff.system);
      if (diff.visible !== undefined) pipeStoreState.setVisibility(p.id, diff.visible);
    }
    setOpen(false);
  };

  const anyPipes = summary.pipeCount > 0;

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="massedit-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="massedit-title" style={styles.title}>Mass Edit</span>
          <span style={styles.countBadge}>
            {summary.pipeCount} pipe{summary.pipeCount === 1 ? '' : 's'}
            {' · '}
            {summary.fixtureCount} fixture{summary.fixtureCount === 1 ? '' : 's'}
          </span>
          <button type="button" aria-label="Close" style={styles.closeBtn} onClick={() => setOpen(false)}>×</button>
        </header>

        <div style={styles.body}>
          <div style={styles.hint}>
            Blank fields leave the property untouched. Set any combination
            of overrides and click Apply — only pipes whose current value
            differs get written.
          </div>

          {anyPipes && (
            <>
              {/* "Currently in selection" histogram */}
              <div style={styles.summaryBox}>
                <div style={styles.summaryLabel}>Currently in selection</div>
                <HistogramRow label="Material" items={summary.pipes.materials.map((m) => ({
                  label: humanMaterial(m.value), count: m.count,
                }))} />
                <HistogramRow label="Diameter" items={summary.pipes.diameters.map((d) => ({
                  label: humanDiameter(d.value), count: d.count,
                }))} />
                <HistogramRow label="System" items={summary.pipes.systems.map((s) => ({
                  label: humanSystem(s.value), count: s.count,
                }))} />
                {summary.pipes.hiddenCount > 0 && (
                  <HistogramRow label="Visible" items={[
                    { label: 'visible', count: summary.pipes.visibleCount },
                    { label: 'hidden', count: summary.pipes.hiddenCount },
                  ]} />
                )}
              </div>

              {/* Override fields */}
              <div style={styles.formBox}>
                <div style={styles.formLabel}>Apply to all selected pipes</div>

                <div style={styles.field}>
                  <label style={styles.fieldLabel}>Material</label>
                  <select
                    value={material}
                    onChange={(e) => setMaterial(e.target.value as PipeMaterial | '')}
                    style={styles.select}
                  >
                    <option value="">— leave unchanged —</option>
                    {PIPE_MATERIALS.map((m) => (
                      <option key={m} value={m}>{humanMaterial(m)}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.fieldLabel}>Diameter</label>
                  <select
                    value={diameter}
                    onChange={(e) => setDiameter(e.target.value)}
                    style={styles.select}
                  >
                    <option value="">— leave unchanged —</option>
                    {COMMON_DIAMETERS.map((d) => (
                      <option key={d} value={d}>{humanDiameter(d)}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.fieldLabel}>System</label>
                  <select
                    value={system}
                    onChange={(e) => setSystem(e.target.value as SystemType | '')}
                    style={styles.select}
                  >
                    <option value="">— leave unchanged —</option>
                    {ALL_SYSTEMS.map((s) => (
                      <option key={s} value={s}>{humanSystem(s)}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.fieldLabel}>Visibility</label>
                  <div style={styles.buttonRow}>
                    <button
                      type="button"
                      style={visibility === 'unchanged' ? styles.radioBtnActive : styles.radioBtn}
                      onClick={() => setVisibility('unchanged')}
                    >
                      Leave
                    </button>
                    <button
                      type="button"
                      style={visibility === 'show' ? styles.radioBtnActive : styles.radioBtn}
                      onClick={() => setVisibility('show')}
                    >
                      Show all
                    </button>
                    <button
                      type="button"
                      style={visibility === 'hide' ? styles.radioBtnActive : styles.radioBtn}
                      onClick={() => setVisibility('hide')}
                    >
                      Hide all
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {!anyPipes && (
            <div style={styles.emptyState}>
              No pipes in the selection — mass edits here apply to pipe properties
              only. Select pipes (Shift+click or lasso) to enable the form.
            </div>
          )}
        </div>

        <footer style={styles.footer}>
          <span style={styles.footerHint}>
            {empty
              ? 'No overrides set yet — set at least one field.'
              : affectedCount > 0
                ? `Will change ${affectedCount} pipe${affectedCount === 1 ? '' : 's'} · ${selectedPipes.length - affectedCount} already match${selectedPipes.length - affectedCount === 1 ? 'es' : ''}`
                : 'Every selected pipe already matches — no changes would apply.'}
          </span>
          <button type="button" style={styles.cancelBtn} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            style={willApply ? styles.primaryBtn : styles.primaryBtnDisabled}
            disabled={!willApply}
            onClick={handleApply}
          >
            Apply →
          </button>
        </footer>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function HistogramRow({ label, items }: {
  label: string;
  items: Array<{ label: string; count: number }>;
}) {
  if (items.length === 0) return null;
  return (
    <div style={styles.histoRow}>
      <span style={styles.histoLabel}>{label}</span>
      <span style={styles.histoItems}>
        {items.map((it, i) => (
          <span key={i} style={styles.histoItem}>
            <strong style={styles.histoCount}>{it.count}×</strong> {it.label}
          </span>
        ))}
      </span>
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
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 18px',
    borderBottom: '1px solid #1a2334',
  },
  title: { fontSize: 16, fontWeight: 700, color: '#00e5ff', letterSpacing: 1, flex: 1 },
  countBadge: {
    fontSize: 10,
    color: '#ffd54f',
    fontFamily: 'ui-monospace, Consolas, monospace',
    padding: '3px 8px',
    background: 'rgba(255, 213, 79, 0.12)',
    border: '1px solid rgba(255, 213, 79, 0.45)',
    borderRadius: 4,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 8px',
  },
  body: {
    padding: '14px 18px',
    overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 12,
    minHeight: 180,
  },
  hint: {
    fontSize: 11, color: '#cfd8e3',
    padding: '8px 10px',
    background: 'rgba(0, 229, 255, 0.04)',
    border: '1px solid rgba(0, 229, 255, 0.15)',
    borderRadius: 4,
    lineHeight: 1.5,
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
  summaryBox: {
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 6,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  summaryLabel: {
    fontSize: 10, color: '#7a8592', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 2,
  },
  histoRow: { display: 'flex', gap: 8, alignItems: 'baseline' },
  histoLabel: {
    width: 68, fontSize: 11, color: '#aebbc9', fontWeight: 600,
  },
  histoItems: {
    flex: 1, fontSize: 11, color: '#cfd8e3',
    display: 'flex', flexWrap: 'wrap', gap: '4px 10px',
  },
  histoItem: { whiteSpace: 'nowrap' },
  histoCount: { color: '#ffd54f', fontFamily: 'ui-monospace, Consolas, monospace' },
  formBox: {
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 6,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  formLabel: {
    fontSize: 11, fontWeight: 700, color: '#00e5ff', letterSpacing: 0.5,
    marginBottom: 2,
  },
  field: { display: 'flex', alignItems: 'center', gap: 10 },
  fieldLabel: { width: 70, fontSize: 11, color: '#cfd8e3', fontWeight: 500 },
  select: {
    flex: 1,
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '5px 8px', outline: 'none',
  },
  buttonRow: { display: 'flex', gap: 4, flex: 1 },
  radioBtn: {
    padding: '4px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  radioBtnActive: {
    padding: '4px 12px',
    background: 'rgba(0, 229, 255, 0.15)',
    border: '1px solid rgba(0, 229, 255, 0.55)',
    borderRadius: 4, color: '#00e5ff',
    fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
    cursor: 'pointer',
  },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  footerHint: { flex: 1, fontSize: 11, color: '#7a8592' },
  cancelBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
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
