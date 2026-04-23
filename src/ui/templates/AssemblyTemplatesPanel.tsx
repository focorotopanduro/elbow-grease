/**
 * AssemblyTemplatesPanel — Phase 14.C
 *
 * Modal library browser + save-as-template dialog. Two modes:
 *
 *   1. BROWSE: lists every saved template. Each row has "Drop",
 *      "Rename", "Delete" actions. "Save current scene as template"
 *      button at the bottom flips into mode 2.
 *
 *   2. SAVE: name + description fields. Shows a summary of what's
 *      about to be captured (N pipes + M fixtures). Save commits,
 *      Cancel returns to BROWSE without saving.
 *
 * Triggered by Ctrl+Shift+T. Focus-trapped, Escape closes.
 *
 * Style follows the ContractorProfilePanel + PricingProfilePanel
 * pattern (Phase 14.A/B) for visual consistency.
 */

import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@core/a11y/useFocusTrap';
import { usePlumbingAssemblyTemplateStore } from '@store/plumbingAssemblyTemplateStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
// Phase 14.I — "save selection only" option, driven by multi-select.
import { usePlumbingMultiSelectStore } from '@store/plumbingMultiSelectStore';

type Mode = 'browse' | 'save';

export function AssemblyTemplatesPanel() {
  const order = usePlumbingAssemblyTemplateStore((s) => s.order);
  const templates = usePlumbingAssemblyTemplateStore((s) => s.templates);
  const saveCurrent = usePlumbingAssemblyTemplateStore((s) => s.saveCurrentSceneAsTemplate);
  const deleteTemplate = usePlumbingAssemblyTemplateStore((s) => s.deleteTemplate);
  const renameTemplate = usePlumbingAssemblyTemplateStore((s) => s.renameTemplate);
  const applyTemplate = usePlumbingAssemblyTemplateStore((s) => s.applyTemplateToScene);

  // Scene summary — used by the SAVE mode preview so the user knows
  // what's about to get captured.
  const pipeCount = usePipeStore((s) => s.pipeOrder.length);
  const fixtureCount = useFixtureStore((s) => Object.keys(s.fixtures).length);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('browse');
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Phase 14.I — track multi-select counts for the "save selection only"
  // toggle. Defaults on when multi-select is non-empty at save time.
  const multiPipeIds = usePlumbingMultiSelectStore((s) => s.pipeIds);
  const multiFixtureIds = usePlumbingMultiSelectStore((s) => s.fixtureIds);
  const multiCount = Object.keys(multiPipeIds).length + Object.keys(multiFixtureIds).length;
  const [saveSelectedOnly, setSaveSelectedOnly] = useState(false);

  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        // Escape inside the save form returns to browse; a second Escape closes.
        if (mode === 'save') {
          setMode('browse');
        } else {
          setOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode]);

  // Reset draft + focus name field when switching into save mode.
  useEffect(() => {
    if (mode === 'save') {
      setDraftName('');
      setDraftDescription('');
      // Defer focus until after the input actually mounts.
      const t = setTimeout(() => nameInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mode]);

  if (!open) return null;

  const sceneIsEmpty = pipeCount === 0 && fixtureCount === 0;

  const handleSave = () => {
    if (sceneIsEmpty) {
      alert('The scene is empty — nothing to save as a template.');
      return;
    }
    // Phase 14.I — optional filter to the multi-select subset.
    const opts = saveSelectedOnly && multiCount > 0
      ? {
          pipeIds: Object.keys(multiPipeIds),
          fixtureIds: Object.keys(multiFixtureIds),
        }
      : undefined;
    const id = saveCurrent(draftName, draftDescription, opts);
    if (!id) {
      alert('Template could not be saved. Check that the scene has pipes or fixtures.');
      return;
    }
    setMode('browse');
    setSaveSelectedOnly(false);
  };

  const handleApply = (id: string) => {
    const result = applyTemplate(id, [0, 0, 0]);
    if (result) {
      const summary = `Added ${result.pipesAdded} pipe${result.pipesAdded === 1 ? '' : 's'} ` +
        `+ ${result.fixturesAdded} fixture${result.fixturesAdded === 1 ? '' : 's'} ` +
        `at scene origin. The solver may re-size on next run.`;
      // Use a brief status rather than alert to avoid disrupting the drop flow.
      console.log('[AssemblyTemplates]', summary);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Delete template "${name}"? This cannot be undone.`)) {
      deleteTemplate(id);
    }
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const commitRename = () => {
    if (renamingId) {
      renameTemplate(renamingId, renameValue);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  // ── Render ──────────────────────────────────────────────────

  return (
    <div style={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-title"
        style={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <header style={styles.header}>
          <span id="templates-title" style={styles.title}>
            {mode === 'browse' ? 'Assembly Templates' : 'Save As Template'}
          </span>
          <button
            type="button"
            aria-label="Close templates"
            style={styles.closeBtn}
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </header>

        {mode === 'browse' ? (
          <>
            <div style={styles.body}>
              <div style={styles.hint}>
                Save the current scene as a reusable template, then drop it into
                future jobs. Each template stores pipe routes + fixtures relative
                to their center-of-mass so they can be placed anywhere.
              </div>

              {order.length === 0 ? (
                <div style={styles.emptyState}>
                  No templates saved yet.
                  <br />
                  Draw a layout you'd like to reuse, then click
                  <strong style={{ color: '#00e5ff' }}> Save current scene </strong>
                  below.
                </div>
              ) : (
                <ul style={styles.list}>
                  {order.map((id) => {
                    const t = templates[id];
                    if (!t) return null;
                    const isRenaming = renamingId === id;
                    return (
                      <li key={id} style={styles.listItem}>
                        <div style={styles.listItemMain}>
                          {isRenaming ? (
                            <input
                              autoFocus
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename();
                                else if (e.key === 'Escape') {
                                  setRenamingId(null);
                                  setRenameValue('');
                                }
                              }}
                              style={styles.input}
                            />
                          ) : (
                            <div style={styles.listName}>{t.name}</div>
                          )}
                          {t.description && (
                            <div style={styles.listDescription}>{t.description}</div>
                          )}
                          <div style={styles.listMeta}>
                            {t.counts.pipes} pipe{t.counts.pipes === 1 ? '' : 's'}
                            {' · '}
                            {t.counts.fixtures} fixture{t.counts.fixtures === 1 ? '' : 's'}
                            {' · '}
                            {formatExtents(t.extents)}
                            {' · '}
                            {formatDate(t.createdAt)}
                          </div>
                        </div>
                        <div style={styles.listActions}>
                          <button
                            type="button"
                            style={styles.primaryActionBtn}
                            onClick={() => handleApply(id)}
                            title="Instantiate this template at scene origin"
                          >
                            Drop
                          </button>
                          <button
                            type="button"
                            style={styles.smallBtn}
                            onClick={() => startRename(id, t.name)}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            style={styles.smallBtnDanger}
                            onClick={() => handleDelete(id, t.name)}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer style={styles.footer}>
              <span style={styles.footerHint}>
                {sceneIsEmpty
                  ? 'Draw at least one pipe or fixture to enable saving.'
                  : `Current scene: ${pipeCount} pipes + ${fixtureCount} fixtures`}
              </span>
              <button
                type="button"
                style={sceneIsEmpty ? styles.doneBtnDisabled : styles.doneBtn}
                disabled={sceneIsEmpty}
                onClick={() => setMode('save')}
              >
                Save current scene…
              </button>
            </footer>
          </>
        ) : (
          <>
            <div style={styles.body}>
              <div style={styles.hint}>
                Capturing
                {' '}
                <strong style={{ color: '#00e5ff' }}>
                  {saveSelectedOnly && multiCount > 0
                    ? Object.keys(multiPipeIds).length
                    : pipeCount}
                </strong>
                {' pipe'}
                {(saveSelectedOnly && multiCount > 0
                  ? Object.keys(multiPipeIds).length
                  : pipeCount) === 1 ? '' : 's'}
                {' + '}
                <strong style={{ color: '#00e5ff' }}>
                  {saveSelectedOnly && multiCount > 0
                    ? Object.keys(multiFixtureIds).length
                    : fixtureCount}
                </strong>
                {' fixture'}
                {(saveSelectedOnly && multiCount > 0
                  ? Object.keys(multiFixtureIds).length
                  : fixtureCount) === 1 ? '' : 's'}
                {' '}
                as a template. Positions are normalized around their centroid so
                the template can be dropped anywhere without carrying the
                current scene's origin.
              </div>

              {/* Phase 14.I — "save selection only" toggle. Visible only
                  when there's a multi-select to opt into. */}
              {multiCount > 0 && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#cfd8e3' }}>
                  <input
                    type="checkbox"
                    checked={saveSelectedOnly}
                    onChange={(e) => setSaveSelectedOnly(e.target.checked)}
                  />
                  Save only the {multiCount} multi-selected item{multiCount === 1 ? '' : 's'} (Shift+click adds/removes)
                </label>
              )}

              <div style={styles.field}>
                <label style={styles.fieldLabel}>
                  Template name
                  <span style={styles.requiredMark}> *</span>
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={draftName}
                  placeholder='e.g. "Standard 2-bath rough-in"'
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && draftName.trim().length > 0) handleSave();
                  }}
                  style={styles.input}
                />
              </div>

              <div style={styles.field}>
                <label style={styles.fieldLabel}>Description (optional)</label>
                <textarea
                  value={draftDescription}
                  placeholder="Notes about fixtures, typical lot dimensions, code references…"
                  onChange={(e) => setDraftDescription(e.target.value)}
                  rows={3}
                  style={styles.textarea}
                />
              </div>
            </div>

            <footer style={styles.footer}>
              <button type="button" style={styles.resetBtn} onClick={() => setMode('browse')}>
                ← Back
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                style={draftName.trim().length === 0 ? styles.doneBtnDisabled : styles.doneBtn}
                disabled={draftName.trim().length === 0}
                onClick={handleSave}
              >
                Save template
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

// ── Formatting helpers ───────────────────────────────────────

function formatExtents(e: { width: number; depth: number; height: number }): string {
  const { width, depth, height } = e;
  if (width === 0 && depth === 0 && height === 0) return 'empty bounds';
  return `${width.toFixed(1)}′ × ${depth.toFixed(1)}′ × ${height.toFixed(1)}′`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Styles (matches ContractorProfilePanel palette) ──────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0, 0, 0, 0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  panel: {
    width: 'min(680px, 94vw)',
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
    display: 'flex', flexDirection: 'column', gap: 12,
    minHeight: 120,
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
  list: {
    listStyle: 'none', padding: 0, margin: 0,
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  listItem: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid #1f2a3e',
    borderRadius: 6,
    alignItems: 'center',
  },
  listItemMain: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 },
  listName: { fontSize: 13, fontWeight: 600, color: '#e0e6ef' },
  listDescription: { fontSize: 11, color: '#aebbc9', lineHeight: 1.35 },
  listMeta: { fontSize: 10, color: '#7a8592' },
  listActions: { display: 'flex', gap: 6 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  fieldLabel: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 12, fontWeight: 600, color: '#cfd8e3',
  },
  requiredMark: { color: '#ff6f6f', marginLeft: 2 },
  input: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 12,
    padding: '6px 8px', outline: 'none',
  },
  textarea: {
    background: '#0a1220', border: '1px solid #2a3a54', borderRadius: 4,
    color: '#e0e6ef', fontFamily: 'inherit', fontSize: 11, lineHeight: 1.4,
    padding: 8, resize: 'vertical',
  },
  smallBtn: {
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 4,
    color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 11,
    cursor: 'pointer',
  },
  smallBtnDanger: {
    padding: '4px 10px',
    background: 'transparent',
    border: '1px solid #5c2a2a',
    borderRadius: 4,
    color: '#ff8a8a',
    fontFamily: 'inherit', fontSize: 11,
    cursor: 'pointer',
  },
  primaryActionBtn: {
    padding: '4px 12px',
    background: 'rgba(0, 229, 255, 0.15)',
    border: '1px solid rgba(0, 229, 255, 0.5)',
    borderRadius: 4,
    color: '#00e5ff',
    fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
    cursor: 'pointer',
  },
  footer: {
    display: 'flex', gap: 8, alignItems: 'center',
    padding: '10px 18px',
    borderTop: '1px solid #1a2334',
    background: 'rgba(0, 0, 0, 0.3)',
  },
  footerHint: { flex: 1, fontSize: 11, color: '#7a8592' },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent', border: '1px solid #2a3a54',
    borderRadius: 4, color: '#7a8592',
    fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
  },
  doneBtn: {
    padding: '6px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none', borderRadius: 4, color: '#0a0e18',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', letterSpacing: 0.5,
  },
  doneBtnDisabled: {
    padding: '6px 16px',
    background: '#1a2334',
    border: 'none', borderRadius: 4, color: '#4a5568',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
    cursor: 'not-allowed', letterSpacing: 0.5,
  },
};
