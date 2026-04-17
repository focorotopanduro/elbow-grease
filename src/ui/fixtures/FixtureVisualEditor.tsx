/**
 * FixtureVisualEditor — full-screen workbench for a fixture's geometry
 * and parameters. See individual view components for how each pane
 * interacts with the shared editor store.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  Editor header: title, view mode, preset, mirror/flip,    │
 *   │  undo/redo, cancel/apply                                  │
 *   ├──────────────┬──────────────┬───────────────┬────────────┤
 *   │   TOP        │  ELEVATION   │      3D       │ DIAG +     │
 *   │   (plan)     │  (side)      │ (perspective) │ PRESETS    │
 *   ├──────────────┴──────────────┴───────────────┴────────────┤
 *   │  Footer: rotation / snap / dimensions / walls / reset     │
 *   └───────────────────────────────────────────────────────────┘
 *
 * View-mode toggles:
 *   • TOP      single pane plan
 *   • ELEV     single pane elevation
 *   • 3D       single pane 3D
 *   • TRI      triple pane (top + elev + 3d)  ← default
 *
 * Keyboard:
 *   Esc              cancel
 *   Enter            apply
 *   Ctrl+Z / Ctrl+Y  undo / redo
 *   M                mirror horizontal
 *   F                flip drain side
 *   Arrows           nudge active handle ½″
 *   1/2/3/4          switch view mode
 */

import { useEffect, useMemo } from 'react';
import { useFixtureEditorStore } from '@store/fixtureEditorStore';
import { useFixtureStore } from '@store/fixtureStore';
import { getFixtureGeometry } from '@core/fixtures/ConnectionPoints';
import { getPresetsFor } from '@core/fixtures/FixturePresets';
import { diagnoseFixture, highestSeverity, type Diagnostic } from '@core/fixtures/FixtureDiagnostics';
import { EditorTopView } from './EditorTopView';
import { Editor3DView } from './Editor3DView';
import { EditorElevationView } from './EditorElevationView';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';

const ROLE_TO_PARAM: Record<string, string> = {
  drain: 'drainRoughIn',
  cold:  'coldRoughIn',
  hot:   'hotRoughIn',
};

export function FixtureVisualEditor() {
  const isOpen = useFixtureEditorStore((s) => s.isOpen);
  const subtype = useFixtureEditorStore((s) => s.subtype);
  const fixtureId = useFixtureEditorStore((s) => s.fixtureId);
  const stagedParams = useFixtureEditorStore((s) => s.stagedParams);
  const dirty = useFixtureEditorStore((s) => s.dirty);
  const view = useFixtureEditorStore((s) => s.view);
  const activeHandle = useFixtureEditorStore((s) => s.activeHandle);
  const showRotationHandle = useFixtureEditorStore((s) => s.showRotationHandle);
  const snapHalfInch = useFixtureEditorStore((s) => s.snapHalfInch);
  const showDimensions = useFixtureEditorStore((s) => s.showDimensions);
  const showWalls = useFixtureEditorStore((s) => s.showWalls);
  const undoLen = useFixtureEditorStore((s) => s.undoStack.length);
  const redoLen = useFixtureEditorStore((s) => s.redoStack.length);

  const close = useFixtureEditorStore((s) => s.close);
  const setView = useFixtureEditorStore((s) => s.setView);
  const toggleRot = useFixtureEditorStore((s) => s.toggleRotationHandle);
  const toggleSnap = useFixtureEditorStore((s) => s.toggleSnapHalfInch);
  const toggleDims = useFixtureEditorStore((s) => s.toggleDimensions);
  const toggleWalls = useFixtureEditorStore((s) => s.toggleWalls);
  const resetDefaults = useFixtureEditorStore((s) => s.resetToDefaults);
  const applyPreset = useFixtureEditorStore((s) => s.applyPreset);
  const undo = useFixtureEditorStore((s) => s.undo);
  const redo = useFixtureEditorStore((s) => s.redo);
  const mirrorH = useFixtureEditorStore((s) => s.mirrorHorizontal);
  const flipDrain = useFixtureEditorStore((s) => s.flipDrainSide);
  const updateParam = useFixtureEditorStore((s) => s.updateParam);
  const bulkUpdateFixture = useFixtureStore((s) => s.bulkUpdateParams);

  const geometry = useMemo(
    () => (subtype ? getFixtureGeometry(subtype, stagedParams) : null),
    [subtype, stagedParams],
  );

  const diagnostics = useMemo(
    () => (subtype ? diagnoseFixture(subtype, stagedParams) : []),
    [subtype, stagedParams],
  );

  const presets = useMemo(
    () => (subtype ? getPresetsFor(subtype) : []),
    [subtype],
  );

  const hasErrors = diagnostics.some((d) => d.severity === 'error');

  // Global keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Apply / cancel
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Enter') {
        if (dirty && fixtureId && !hasErrors) {
          bulkUpdateFixture(fixtureId, stagedParams);
          close();
        }
        e.preventDefault();
        return;
      }

      // Undo / redo
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z') || (e.ctrlKey && e.key.toLowerCase() === 'y')) {
        e.preventDefault(); redo(); return;
      }

      // Mirror / Flip
      if (!e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === 'm') { e.preventDefault(); mirrorH(); return; }
        if (e.key.toLowerCase() === 'f') { e.preventDefault(); flipDrain(); return; }
      }

      // View mode
      if (!e.ctrlKey && !e.altKey) {
        if (e.key === '1') { e.preventDefault(); setView('top');  return; }
        if (e.key === '2') { e.preventDefault(); setView('elev'); return; }
        if (e.key === '3') { e.preventDefault(); setView('3d');   return; }
        if (e.key === '4') { e.preventDefault(); setView('tri');  return; }
      }

      // Arrow-key nudge on active handle
      if (activeHandle && subtype && geometry) {
        const pt = geometry.points.find((p) => p.id === activeHandle);
        if (pt) {
          const paramKey = ROLE_TO_PARAM[pt.role];
          if (paramKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const current = Number(stagedParams[paramKey] ?? 0);
            const step = e.shiftKey ? 0.25 : 0.5; // ¼″ with shift, else ½″
            const next = current + (e.key === 'ArrowUp' ? step : -step);
            updateParam(paramKey, Math.max(0, next));
          }
          if (pt.role === 'drain' && subtype === 'bathtub' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            const sides = ['left', 'center', 'right'];
            const cur = String(stagedParams.drainSide ?? 'left');
            const idx = sides.indexOf(cur);
            const nextIdx = e.key === 'ArrowRight' ? Math.min(2, idx + 1) : Math.max(0, idx - 1);
            updateParam('drainSide', sides[nextIdx]!);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, dirty, fixtureId, stagedParams, bulkUpdateFixture, close, undo, redo, mirrorH, flipDrain, setView, updateParam, activeHandle, subtype, geometry, hasErrors]);

  if (!isOpen || !subtype || !geometry) return null;

  const apply = () => {
    if (fixtureId && !hasErrors) {
      bulkUpdateFixture(fixtureId, stagedParams);
      close();
    }
  };

  return (
    <div style={modalStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>
            ⚙ VISUAL EDITOR — {subtype.replace(/_/g, ' ').toUpperCase()}
          </div>
          <div style={subtitleStyle}>
            {String(stagedParams.tag ?? '—')} · drag handles · Esc=cancel · Enter=apply · M=mirror · F=flip · ↑↓=nudge
          </div>
        </div>

        <PresetDropdown subtype={subtype} presets={presets} applyPreset={applyPreset} />

        <ToolbarBtn onClick={mirrorH}       title="Mirror horizontal (swap cold/hot) [M]" icon="⇄" />
        <ToolbarBtn onClick={flipDrain}     title="Flip drain side [F]"                   icon="⇵" disabled={!('drainSide' in stagedParams)} />
        <ToolbarBtn onClick={undo}          title="Undo [Ctrl+Z]"   icon="↶" disabled={undoLen === 0} />
        <ToolbarBtn onClick={redo}          title="Redo [Ctrl+Y]"   icon="↷" disabled={redoLen === 0} />

        <ViewModeToggle view={view} setView={setView} />

        <button onClick={close} style={cancelBtnStyle}>✕ Cancel</button>
        <button onClick={apply} style={applyBtnStyle(dirty, hasErrors)} disabled={hasErrors}>
          {hasErrors ? '✕ Fix errors' : dirty ? '✓ Apply' : '• No changes'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Main panes */}
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          {(view === 'top' || view === 'tri') && (
            <Pane label="TOP VIEW · plan">
              <EditorTopView geometry={geometry} />
            </Pane>
          )}
          {(view === 'elev' || view === 'tri') && (
            <Pane label="ELEVATION · side">
              <EditorElevationView geometry={geometry} />
            </Pane>
          )}
          {(view === '3d' || view === 'tri') && (
            <Pane label="3D VIEW · perspective">
              <Editor3DView geometry={geometry} />
            </Pane>
          )}
        </div>

        {/* Right sidebar: diagnostics */}
        <DiagnosticsPanel diagnostics={diagnostics} />
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <FooterToggle label="Rotation ring" checked={showRotationHandle} onClick={toggleRot} />
        <FooterToggle label="Snap ½″"       checked={snapHalfInch}       onClick={toggleSnap} />
        <FooterToggle label="Dimensions"    checked={showDimensions}     onClick={toggleDims} />
        <FooterToggle label="Walls"         checked={showWalls}          onClick={toggleWalls} />
        <div style={{ flex: 1 }} />
        <button onClick={resetDefaults} style={footerBtnStyle('#607d8b')}>↺ Reset to defaults</button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Pane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, borderRight: '1px solid rgba(255,213,79,0.15)', position: 'relative', minWidth: 0 }}>
      <div style={paneLabelStyle}>{label}</div>
      {children}
    </div>
  );
}

function ViewModeToggle({ view, setView }: { view: string; setView: (v: 'top' | '3d' | 'elev' | 'tri') => void }) {
  const options: { id: 'top' | 'elev' | '3d' | 'tri'; label: string; icon: string }[] = [
    { id: 'top',  label: 'TOP',  icon: '▦' },
    { id: 'elev', label: 'ELEV', icon: '▤' },
    { id: '3d',   label: '3D',   icon: '◈' },
    { id: 'tri',  label: 'TRI',  icon: '▦▤◈' },
  ];
  return (
    <div style={viewToggleWrap}>
      {options.map((o) => (
        <button key={o.id} onClick={() => setView(o.id)} style={viewToggleBtn(view === o.id)}>
          <div style={{ fontSize: 11 }}>{o.icon}</div>
          <div style={{ fontSize: 9 }}>{o.label}</div>
        </button>
      ))}
    </div>
  );
}

function PresetDropdown({
  subtype, presets, applyPreset,
}: {
  subtype: FixtureSubtype;
  presets: { id: string; label: string; description: string; params: Record<string, unknown> }[];
  applyPreset: (p: Record<string, unknown>) => void;
}) {
  if (presets.length === 0) return null;
  return (
    <select
      onChange={(e) => {
        const id = e.target.value;
        if (!id) return;
        const preset = presets.find((p) => p.id === id);
        if (preset) applyPreset(preset.params);
        e.currentTarget.value = '';
      }}
      defaultValue=""
      title="Apply preset configuration"
      style={{
        padding: '4px 8px',
        background: 'rgba(30,45,60,0.8)',
        color: '#ffd54f',
        border: '1px solid rgba(255,213,79,0.4)',
        borderRadius: 4,
        fontSize: 10,
        fontFamily: 'Consolas, monospace',
        cursor: 'pointer',
      }}
    >
      <option value="" disabled>★ Preset…</option>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  );
}

function ToolbarBtn({ onClick, title, icon, disabled }: { onClick: () => void; title: string; icon: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: 32,
        height: 30,
        background: disabled ? 'rgba(30,45,60,0.4)' : 'rgba(30,45,60,0.8)',
        border: `1px solid ${disabled ? 'rgba(120,180,220,0.15)' : 'rgba(120,180,220,0.35)'}`,
        borderRadius: 4,
        color: disabled ? '#4a5a6a' : '#7fb8d0',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 13,
        padding: 0,
      }}
    >
      {icon}
    </button>
  );
}

function DiagnosticsPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const top = highestSeverity(diagnostics);
  return (
    <div style={{
      width: 240,
      borderLeft: '1px solid rgba(255,213,79,0.2)',
      background: 'rgba(4,10,16,0.85)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        fontSize: 10,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color: top === 'error' ? '#ff5252' : top === 'warn' ? '#ffa726' : '#7fb8d0',
        fontFamily: 'Consolas, monospace',
        borderBottom: '1px solid rgba(120,180,220,0.15)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>◢ DIAGNOSTICS</span>
        <span style={{ fontSize: 10 }}>{diagnostics.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 10px' }}>
        {diagnostics.length === 0 && (
          <div style={{ padding: '20px 10px', fontSize: 11, color: '#7fb8d0', textAlign: 'center', opacity: 0.7 }}>
            ✓ All checks pass
          </div>
        )}
        {diagnostics.map((d) => (
          <div key={d.id} style={diagRowStyle(d.severity)}>
            <div style={{ fontSize: 10, color: sevColor(d.severity), fontWeight: 600, marginBottom: 2 }}>
              {sevIcon(d.severity)} {d.severity.toUpperCase()}
            </div>
            <div style={{ fontSize: 11, color: '#d6e8f0', lineHeight: 1.3 }}>{d.message}</div>
            {d.hint && (
              <div style={{ fontSize: 10, color: '#7fb8d0', marginTop: 4, fontStyle: 'italic', opacity: 0.85 }}>
                {d.hint}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FooterToggle({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 10px',
        fontSize: 10,
        letterSpacing: 0.5,
        background: checked ? 'rgba(38,198,218,0.2)' : 'rgba(30,45,60,0.6)',
        border: `1px solid ${checked ? '#4dd0e1' : 'rgba(120,180,220,0.25)'}`,
        borderRadius: 4,
        color: checked ? '#4dd0e1' : '#8aa0b1',
        cursor: 'pointer',
        fontFamily: 'Consolas, monospace',
      }}
    >
      {checked ? '◉' : '○'} {label}
    </button>
  );
}

// ── Styles / helpers ──────────────────────────────────────────

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(4, 8, 14, 0.88)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  color: '#e0ecf3',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderBottom: '1px solid rgba(255,213,79,0.3)',
  background: 'linear-gradient(90deg, rgba(255,213,79,0.15) 0%, rgba(255,111,0,0.08) 100%)',
};

const titleStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: '#ffd54f', letterSpacing: 1,
};

const subtitleStyle: React.CSSProperties = {
  fontSize: 10, color: '#7fb8d0', fontFamily: 'Consolas, monospace',
};

const paneLabelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 10,
  fontSize: 10,
  letterSpacing: 2,
  textTransform: 'uppercase',
  color: '#7fb8d0',
  fontFamily: 'Consolas, monospace',
  background: 'rgba(8,14,22,0.8)',
  padding: '3px 8px',
  borderRadius: 4,
  zIndex: 1,
};

const viewToggleWrap: React.CSSProperties = {
  display: 'flex', gap: 2, padding: 2,
  background: 'rgba(4,10,16,0.7)',
  border: '1px solid rgba(120,180,220,0.2)',
  borderRadius: 6,
};

function viewToggleBtn(active: boolean): React.CSSProperties {
  return {
    padding: '4px 8px',
    minWidth: 38,
    background: active ? 'linear-gradient(135deg, #1e88e5, #00bcd4)' : 'transparent',
    border: 'none',
    borderRadius: 4,
    color: active ? '#fff' : '#7fb8d0',
    cursor: 'pointer',
    fontFamily: 'Consolas, monospace',
    boxShadow: active ? '0 0 6px rgba(79,195,247,0.5)' : 'none',
    textAlign: 'center',
  };
}

const cancelBtnStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 11,
  background: 'transparent',
  border: '1px solid rgba(255,100,100,0.4)',
  borderRadius: 4,
  color: '#ff8080',
  cursor: 'pointer',
  fontWeight: 600,
};

function applyBtnStyle(dirty: boolean, hasErrors: boolean): React.CSSProperties {
  const live = dirty && !hasErrors;
  return {
    padding: '6px 14px',
    fontSize: 11,
    background: hasErrors
      ? 'rgba(255, 82, 82, 0.2)'
      : live ? 'linear-gradient(135deg, #26c6da, #00acc1)' : 'rgba(60,75,90,0.4)',
    border: `1px solid ${hasErrors ? '#ff5252' : live ? '#4dd0e1' : 'rgba(120,180,220,0.3)'}`,
    borderRadius: 4,
    color: hasErrors ? '#ff8080' : live ? '#fff' : '#8aa0b1',
    cursor: live ? 'pointer' : 'not-allowed',
    fontWeight: 600,
    boxShadow: live ? '0 0 10px rgba(38,198,218,0.45)' : 'none',
  };
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 14px',
  borderTop: '1px solid rgba(255,213,79,0.2)',
  background: 'rgba(4,10,16,0.8)',
};

function footerBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 12px',
    fontSize: 10,
    background: `${color}22`,
    border: `1px solid ${color}66`,
    borderRadius: 4,
    color,
    fontFamily: 'Consolas, monospace',
    cursor: 'pointer',
  };
}

function diagRowStyle(sev: 'error' | 'warn' | 'info'): React.CSSProperties {
  return {
    padding: '6px 8px',
    margin: '4px 0',
    background: sev === 'error' ? 'rgba(239,83,80,0.08)' : sev === 'warn' ? 'rgba(255,167,38,0.08)' : 'rgba(127,184,208,0.05)',
    borderLeft: `3px solid ${sevColor(sev)}`,
    borderRadius: 3,
  };
}

function sevColor(sev: 'error' | 'warn' | 'info'): string {
  return sev === 'error' ? '#ff5252' : sev === 'warn' ? '#ffa726' : '#7fb8d0';
}

function sevIcon(sev: 'error' | 'warn' | 'info'): string {
  return sev === 'error' ? '⛔' : sev === 'warn' ? '⚠' : 'ℹ';
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}
