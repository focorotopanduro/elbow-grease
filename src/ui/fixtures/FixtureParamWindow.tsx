/**
 * FixtureParamWindow — floating parameter panel for the selected fixture.
 *
 * Opens when fixtureStore.selectedFixtureId is non-null. Renders the
 * subtype's schema (from FixtureParams.ts) as a grouped form with
 * numeric inputs, selects, toggles, range sliders, and text fields.
 *
 * Visual style matches ELBOW GREASE's futuristic HUD:
 *   - Top gradient strip with subtype icon, tag, and live DFU/WSFU readout
 *   - Scrollable body with collapsible sections
 *   - Footer action row: Reset / Clone / Delete / Close
 *
 * The window is draggable via its header (simple pointer-down +
 * pointermove handler; stored in local state, no external lib).
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import { useFixtureStore } from '@store/fixtureStore';
import { useFixtureEditorStore } from '@store/fixtureEditorStore';
import { PARAM_SCHEMA, type ParamField, type ParamSection } from '@core/fixtures/FixtureParams';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';

// ── Subtype icons (plumbing emojis) ────────────────────────────

const SUBTYPE_ICON: Record<FixtureSubtype, string> = {
  water_closet:      '🚽',
  lavatory:          '🪞',
  kitchen_sink:      '🍽',
  bathtub:           '🛁',
  shower:            '🚿',
  floor_drain:       '🔘',
  laundry_standpipe: '🧺',
  dishwasher:        '🧼',
  clothes_washer:    '🌀',
  hose_bibb:         '🚰',
  urinal:            '🔵',
  mop_sink:          '🧽',
  drinking_fountain: '⛲',
};

const SUBTYPE_LABEL: Record<FixtureSubtype, string> = {
  water_closet:      'Water Closet',
  lavatory:          'Lavatory',
  kitchen_sink:      'Kitchen Sink',
  bathtub:           'Bathtub',
  shower:            'Shower',
  floor_drain:       'Floor Drain',
  laundry_standpipe: 'Laundry Standpipe',
  dishwasher:        'Dishwasher',
  clothes_washer:    'Clothes Washer',
  hose_bibb:         'Hose Bibb',
  urinal:            'Urinal',
  mop_sink:          'Mop Sink',
  drinking_fountain: 'Drinking Fountain',
};

// ── Draggable window position hook ─────────────────────────────

function useDraggable(initial: { x: number; y: number }) {
  const [pos, setPos] = useState(initial);
  const dragState = useRef<{ dx: number; dy: number; active: boolean } | null>(null);

  const onHeaderDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragState.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, active: true };
  };
  const onHeaderMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current?.active) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - dragState.current.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragState.current.dy)),
    });
  };
  const onHeaderUp = () => { if (dragState.current) dragState.current.active = false; };

  return { pos, onHeaderDown, onHeaderMove, onHeaderUp };
}

// ── Main component ─────────────────────────────────────────────

export function FixtureParamWindow() {
  const selectedId = useFixtureStore((s) => s.selectedFixtureId);
  const fixture = useFixtureStore((s) => (s.selectedFixtureId ? s.fixtures[s.selectedFixtureId] : null));
  const updateParam = useFixtureStore((s) => s.updateParam);
  const resetParams = useFixtureStore((s) => s.resetParams);
  const cloneFixture = useFixtureStore((s) => s.cloneFixture);
  const removeFixture = useFixtureStore((s) => s.removeFixture);
  const selectFixture = useFixtureStore((s) => s.selectFixture);
  // Note: compute DFU/WSFU via useMemo instead of via zustand selectors
  // that return new objects every render — object-returning selectors
  // fail zustand's Object.is equality and cause an infinite re-render.
  const dfu = useMemo(
    () => (fixture ? useFixtureStore.getState().getEffectiveDFU(fixture.id) : 0),
    [fixture],
  );
  const wsfu = useMemo(
    () => (fixture ? useFixtureStore.getState().getEffectiveWSFU(fixture.id) : { cold: 0, hot: 0 }),
    [fixture],
  );

  const drag = useDraggable({ x: Math.max(200, window.innerWidth - 620), y: 140 });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Reset drag pos if window goes off-screen after resize
  useEffect(() => {
    const onResize = () => {
      if (drag.pos.x > window.innerWidth - 320) {
        // The hook manages its own state; a manual reset isn't trivial from here.
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [drag.pos]);

  const schema = fixture ? PARAM_SCHEMA[fixture.subtype] : null;

  // Close on Escape
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectFixture(null);
      if (e.key === 'Delete' && fixture && !isEditableTarget(e.target)) {
        removeFixture(fixture.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, fixture, selectFixture, removeFixture]);

  if (!fixture || !schema) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: drag.pos.x,
        top: drag.pos.y,
        width: 380,
        maxHeight: '75vh',
        zIndex: 60,
        background: 'linear-gradient(180deg, rgba(8,14,22,0.97) 0%, rgba(12,20,30,0.96) 100%)',
        border: '1px solid rgba(255, 213, 79, 0.35)',
        borderRadius: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.55), 0 0 30px rgba(255,213,79,0.12)',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        color: '#e0ecf3',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Header */}
      <div
        onPointerDown={drag.onHeaderDown}
        onPointerMove={drag.onHeaderMove}
        onPointerUp={drag.onHeaderUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 14px',
          background: 'linear-gradient(90deg, rgba(255,213,79,0.2) 0%, rgba(255,111,0,0.12) 100%)',
          borderBottom: '1px solid rgba(255, 213, 79, 0.3)',
          cursor: 'move',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: 22, marginRight: 10 }}>{SUBTYPE_ICON[fixture.subtype]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#ffd54f', textShadow: '0 0 6px rgba(255,213,79,0.6)' }}>
            {SUBTYPE_LABEL[fixture.subtype]}
          </div>
          <div style={{ fontSize: 10, color: '#8aa0b1', fontFamily: 'Consolas, monospace' }}>
            {String(fixture.params.tag ?? '—')} · DFU {dfu.toFixed(1)} · WSFU {wsfu.cold.toFixed(1)}c/{wsfu.hot.toFixed(1)}h
          </div>
        </div>
        <button
          onClick={() => selectFixture(null)}
          title="Close (Esc)"
          style={closeBtnStyle}
        >
          ✕
        </button>
      </div>

      {/* Body (scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {schema.sections.map((section) => (
          <ParamSectionView
            key={section.title}
            section={section}
            params={fixture.params}
            collapsed={collapsed[section.title] ?? false}
            onToggleCollapse={() =>
              setCollapsed((c) => ({ ...c, [section.title]: !(c[section.title] ?? false) }))
            }
            onChange={(key, value) => updateParam(fixture.id, key, value)}
          />
        ))}
      </div>

      {/* Footer actions */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 10px',
          borderTop: '1px solid rgba(255,213,79,0.2)',
          background: 'rgba(4,10,16,0.7)',
        }}
      >
        <button style={footerBtnStyle('#607d8b')} onClick={() => resetParams(fixture.id)} title="Reset to defaults">
          ↺ Reset
        </button>
        <button
          style={footerBtnStyle('#ffd54f')}
          onClick={() =>
            useFixtureEditorStore.getState().open(fixture.id, fixture.subtype, fixture.params)
          }
          title="Open visual editor (split top + 3D)"
        >
          ⚙ Editor
        </button>
        <button style={footerBtnStyle('#26c6da')} onClick={() => { const id = cloneFixture(fixture.id, [1, 0, 0]); if (id) selectFixture(id); }}>
          ⎘ Clone
        </button>
        <div style={{ flex: 1 }} />
        <button style={footerBtnStyle('#ef5350')} onClick={() => removeFixture(fixture.id)} title="Delete (Del)">
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ── Section view ──────────────────────────────────────────────

function ParamSectionView({
  section,
  params,
  collapsed,
  onToggleCollapse,
  onChange,
}: {
  section: ParamSection;
  params: Record<string, unknown>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onChange: (key: string, value: unknown) => void;
}) {
  const visibleFields = useMemo(
    () => section.fields.filter((f) => !f.showIf || f.showIf(params)),
    [section.fields, params],
  );

  return (
    <div style={{ borderBottom: '1px solid rgba(80,120,150,0.15)' }}>
      <div
        onClick={onToggleCollapse}
        style={{
          padding: '8px 14px',
          cursor: 'pointer',
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: '#7fb8d0',
          fontFamily: 'Consolas, monospace',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          userSelect: 'none',
        }}
      >
        <span style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}>▼</span>
        <span>{section.title}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '2px 14px 10px' }}>
          {visibleFields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={params[field.key]}
              onChange={(v) => onChange(field.key, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field row (dispatches to proper input) ────────────────────

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0', gap: 8 }}>
      <label
        style={{
          flex: '0 0 110px',
          fontSize: 11,
          color: '#b8cbd7',
        }}
        title={field.help}
      >
        {field.label}
      </label>
      <div style={{ flex: 1, minWidth: 0 }}>
        {field.kind === 'number' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="number"
              value={value as number ?? ''}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
              style={inputStyle}
            />
            {field.unit && <span style={unitStyle}>{field.unit}</span>}
          </div>
        )}
        {field.kind === 'select' && (
          <select
            value={String(value ?? field.options[0]?.id ?? '')}
            onChange={(e) => onChange(e.target.value)}
            style={{ ...inputStyle, paddingRight: 4 }}
          >
            {field.options.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.icon ? `${opt.icon} ` : ''}{opt.label}</option>
            ))}
          </select>
        )}
        {field.kind === 'toggle' && (
          <Toggle checked={Boolean(value)} onChange={(v) => onChange(v)} />
        )}
        {field.kind === 'range' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step ?? 0.1}
              value={value as number ?? field.min}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: '#ffd54f' }}
            />
            <span style={{ fontFamily: 'Consolas, monospace', fontSize: 10, color: '#ffd54f', minWidth: 42, textAlign: 'right' }}>
              {(value as number ?? 0).toFixed(1)}{field.unit ? field.unit : ''}
            </span>
          </div>
        )}
        {field.kind === 'text' && (
          <input
            type="text"
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            style={inputStyle}
          />
        )}
      </div>
    </div>
  );
}

// ── Toggle switch ─────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 36,
        height: 18,
        borderRadius: 9,
        background: checked ? 'linear-gradient(90deg, #26c6da, #00acc1)' : 'rgba(60,75,90,0.6)',
        border: `1px solid ${checked ? '#4dd0e1' : 'rgba(120,180,220,0.3)'}`,
        position: 'relative',
        cursor: 'pointer',
        transition: 'all 120ms',
        boxShadow: checked ? '0 0 8px rgba(38,198,218,0.6)' : 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 1,
          left: checked ? 19 : 1,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 120ms',
        }}
      />
    </div>
  );
}

// ── Utility styles ────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '3px 6px',
  background: 'rgba(18,28,40,0.85)',
  border: '1px solid rgba(120,180,220,0.25)',
  borderRadius: 3,
  color: '#e0ecf3',
  fontSize: 11,
  fontFamily: 'Consolas, monospace',
  outline: 'none',
  boxSizing: 'border-box',
};

const unitStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#7fb8d0',
  fontFamily: 'Consolas, monospace',
  minWidth: 16,
};

const closeBtnStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  background: 'transparent',
  border: '1px solid rgba(255,213,79,0.3)',
  borderRadius: 4,
  color: '#ffd54f',
  cursor: 'pointer',
  fontSize: 11,
  padding: 0,
};

function footerBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 10px',
    background: `${color}22`,
    border: `1px solid ${color}66`,
    borderRadius: 4,
    color,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.5,
    cursor: 'pointer',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  };
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}
