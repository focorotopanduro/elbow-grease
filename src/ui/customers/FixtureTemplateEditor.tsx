/**
 * FixtureTemplateEditor — per-customer fixture template editor.
 *
 * Opens when customerStore.editingFixture is set (triggered by the
 * CUSTOMER EDIT wheel, Ctrl+E+F). Lets the plumber configure exactly
 * which pipes, fittings, and fixture components get dropped under the
 * active customer when they place a given fixture variant.
 *
 *   ┌────────────────────────────────────────────────────────┐
 *   │  ⚙ EDIT  TOILET · FLOOR-MOUNT WC                        │
 *   │  for customer: Lennar Homes                             │
 *   │                                                         │
 *   │  Model name: [Kohler Cimarron 12" rough-in          ]  │
 *   │                                                         │
 *   │  ◢ UNDERGROUND                               + Add item│
 *   │    [Closet flange 3" PVC]  [fitting] [3"] [PVC]  $12   │
 *   │    [Trap adapter]          [fitting] [3"] [PVC]  $8    │
 *   │                                                         │
 *   │  ◢ ROUGH-IN                                   + Add    │
 *   │    [Cold supply stub]      [pipe]  [1/2"] [PEX] $2     │
 *   │    [Angle stop]            [fitting][1/2"][brass] $8   │
 *   │                                                         │
 *   │  ◢ TRIM                                       + Add    │
 *   │    ...                                                  │
 *   │                                                         │
 *   │  [Cancel]                           [Save Template]    │
 *   └────────────────────────────────────────────────────────┘
 *
 * The UX is deliberately gritty — each item row shows all the fields
 * the plumber actually cares about (label, kind, diameter, material,
 * cost, part number). No burying fields behind a sub-dialog.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  useCustomerStore,
  type FixtureTemplate,
  type PhasedAssemblyItem,
  PHASE_LABELS,
  PHASE_COLORS,
  PHASE_ORDER,
  type ConstructionPhase,
} from '@store/customerStore';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';

const ITEM_KINDS = ['pipe', 'fitting', 'fixture_component', 'support'] as const;
const MATERIALS: PipeMaterial[] = [
  'pvc_sch40', 'pvc_sch80', 'abs', 'cast_iron',
  'pex', 'cpvc', 'copper_type_l', 'copper_type_m',
];
const DIAMETERS = [0.375, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 6];

// ── Helpers ────────────────────────────────────────────────────

function blankItem(): PhasedAssemblyItem {
  return {
    id: `itm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'pipe',
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    diameter: 0.5,
    material: 'pex',
    length: 1,
    label: 'New item',
    cost: 0,
  };
}

function blankTemplate(subtype: FixtureSubtype, variant: string): FixtureTemplate {
  return {
    subtype,
    variant,
    category: subtype,
    modelName: `${subtype.replace(/_/g, ' ')} — ${variant}`,
    footprint: { width: 2, depth: 2, height: 3 },
    connections: {},
    phases: {
      underground: [],
      rough_in: [],
      trim: [],
    },
  };
}

// ── Main component ─────────────────────────────────────────────

export function FixtureTemplateEditor() {
  const editing = useCustomerStore((s) => s.editingFixture);
  const endEditFixture = useCustomerStore((s) => s.endEditFixture);
  const activeCustomerId = useCustomerStore((s) => s.activeCustomerId);
  const activeCustomer = useCustomerStore((s) =>
    s.activeCustomerId ? s.profiles[s.activeCustomerId] : null,
  );
  const setTemplate = useCustomerStore((s) => s.setTemplate);
  const getActiveTemplate = useCustomerStore((s) => s.getActiveTemplate);

  // Staged (uncommitted) edits
  const [draft, setDraft] = useState<FixtureTemplate | null>(null);
  const [dirty, setDirty] = useState(false);

  // Reset draft when editing target changes
  useEffect(() => {
    if (!editing) {
      setDraft(null);
      setDirty(false);
      return;
    }
    const existing = getActiveTemplate(editing.subtype, editing.variant);
    setDraft(existing ? JSON.parse(JSON.stringify(existing)) : blankTemplate(editing.subtype, editing.variant));
    setDirty(false);
  }, [editing, getActiveTemplate]);

  // Close on Escape
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEditable(e.target)) {
        endEditFixture();
      }
      if ((e.key === 'Enter' || e.key === 'Return') && e.ctrlKey) {
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, dirty]);

  const save = () => {
    if (!draft || !activeCustomerId || !dirty) return;
    setTemplate(activeCustomerId, draft);
    endEditFixture();
  };

  if (!editing || !draft) return null;

  const update = (patch: Partial<FixtureTemplate>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };

  const updatePhase = (phase: ConstructionPhase, items: PhasedAssemblyItem[]) => {
    setDraft((d) => (d ? { ...d, phases: { ...d.phases, [phase]: items } } : d));
    setDirty(true);
  };

  const totalCost = PHASE_ORDER.reduce(
    (sum, p) => sum + draft.phases[p].reduce((s, it) => s + (it.cost || 0), 0),
    0,
  );
  const markup = activeCustomer?.markupPercent ?? 0;
  const markedUp = totalCost * (1 + markup / 100);

  return (
    <div style={modalStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle}>
            ⚙ EDIT FIXTURE — {editing.subtype.replace(/_/g, ' ').toUpperCase()} · {editing.variant.toUpperCase()}
          </div>
          <div style={subtitleStyle}>
            for customer: <span style={{ color: '#ffd54f' }}>{activeCustomer?.name ?? '—'}</span>
            &nbsp;·&nbsp; markup {markup}% &nbsp;·&nbsp;
            base ${totalCost.toFixed(2)} → final <span style={{ color: '#66bb6a' }}>${markedUp.toFixed(2)}</span>
            &nbsp;·&nbsp; Esc=cancel · Ctrl+Enter=save
          </div>
        </div>
        <button onClick={endEditFixture} style={cancelBtnStyle}>✕ Cancel</button>
        <button onClick={save} style={applyBtnStyle(dirty)} disabled={!dirty}>
          {dirty ? '✓ Save Template' : '• No changes'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {/* Model name + notes */}
        <SectionHdr>Identity</SectionHdr>
        <Row label="Model name">
          <input
            value={draft.modelName}
            onChange={(e) => update({ modelName: e.target.value })}
            style={textInput}
            placeholder='e.g. "Kohler Cimarron 12" rough-in"'
          />
        </Row>
        <Row label="Variant">
          <input value={draft.variant} onChange={(e) => update({ variant: e.target.value })} style={textInput} />
        </Row>
        <Row label="Footprint (w×d×h ft)">
          <div style={{ display: 'flex', gap: 4 }}>
            {(['width', 'depth', 'height'] as const).map((axis) => (
              <input
                key={axis}
                type="number"
                value={draft.footprint[axis]}
                step={0.1}
                min={0.1}
                onChange={(e) => update({ footprint: { ...draft.footprint, [axis]: parseFloat(e.target.value) || 0 } })}
                style={{ ...textInput, flex: 1 }}
              />
            ))}
          </div>
        </Row>

        {/* Per-phase item tables */}
        {PHASE_ORDER.map((phase) => (
          <PhaseSection
            key={phase}
            phase={phase}
            items={draft.phases[phase]}
            onChange={(items) => updatePhase(phase, items)}
          />
        ))}

        {/* Connection CLs (read-only for now) */}
        <SectionHdr>Connection Rough-Ins (preview)</SectionHdr>
        <div style={{ fontSize: 10, color: '#7fb8d0', fontFamily: 'Consolas, monospace', padding: '4px 0' }}>
          Drain: {draft.connections.waste ? `${draft.connections.waste.diameter}"` : '—'}
          &nbsp;&nbsp;Vent: {draft.connections.vent ? `${draft.connections.vent.diameter}"` : '—'}
          &nbsp;&nbsp;Cold: {draft.connections.cold ? `${draft.connections.cold.diameter}"` : '—'}
          &nbsp;&nbsp;Hot: {draft.connections.hot ? `${draft.connections.hot.diameter}"` : '—'}
        </div>
      </div>
    </div>
  );
}

// ── Phase section with item table ──────────────────────────────

function PhaseSection({
  phase, items, onChange,
}: {
  phase: ConstructionPhase;
  items: PhasedAssemblyItem[];
  onChange: (items: PhasedAssemblyItem[]) => void;
}) {
  const color = PHASE_COLORS[phase];
  const label = PHASE_LABELS[phase];
  const phaseSum = items.reduce((s, it) => s + (it.cost || 0), 0);
  const [collapsed, setCollapsed] = useState(false);

  const addItem = () => onChange([...items, blankItem()]);
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const updateItem = (idx: number, patch: Partial<PhasedAssemblyItem>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const duplicateItem = (idx: number) => {
    const src = items[idx];
    if (!src) return;
    const copy = { ...src, id: blankItem().id, label: `${src.label} (copy)` };
    onChange([...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)]);
  };

  return (
    <div style={{ marginTop: 16, border: `1px solid ${color}55`, borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: `${color}22`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          transform: collapsed ? 'rotate(-90deg)' : 'none',
          transition: 'transform 120ms',
          color,
        }}>▼</span>
        <span style={{ fontSize: 11, fontWeight: 600, color, letterSpacing: 1, flex: 1 }}>
          ◢ {label.toUpperCase()}
        </span>
        <span style={{ fontSize: 10, color: '#b8cbd7', fontFamily: 'Consolas, monospace' }}>
          {items.length} item{items.length === 1 ? '' : 's'} · ${phaseSum.toFixed(2)}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); addItem(); }}
          style={{
            padding: '3px 10px',
            fontSize: 10,
            background: `${color}33`,
            border: `1px solid ${color}aa`,
            borderRadius: 4,
            color,
            cursor: 'pointer',
            fontFamily: 'Consolas, monospace',
            fontWeight: 600,
          }}
        >＋ Add</button>
      </div>
      {!collapsed && (
        <div style={{ padding: '4px 10px 10px' }}>
          {items.length === 0 && (
            <div style={{ padding: '10px 4px', fontSize: 11, color: '#7fb8d0', opacity: 0.6, textAlign: 'center' }}>
              No items in this phase. Click <span style={{ color }}>＋ Add</span> to add one.
            </div>
          )}
          {items.map((it, idx) => (
            <ItemRow
              key={it.id}
              item={it}
              color={color}
              onChange={(patch) => updateItem(idx, patch)}
              onRemove={() => removeItem(idx)}
              onDuplicate={() => duplicateItem(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single item row ────────────────────────────────────────────

function ItemRow({
  item, color, onChange, onRemove, onDuplicate,
}: {
  item: PhasedAssemblyItem;
  color: string;
  onChange: (patch: Partial<PhasedAssemblyItem>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      padding: '6px 0',
      borderBottom: '1px solid rgba(120,180,220,0.08)',
    }}>
      {/* Compact row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 100px 60px 110px 60px 40px', gap: 4, alignItems: 'center' }}>
        <input
          value={item.label}
          onChange={(e) => onChange({ label: e.target.value })}
          style={textInput}
          placeholder="label"
        />
        <select
          value={item.kind}
          onChange={(e) => onChange({ kind: e.target.value as PhasedAssemblyItem['kind'] })}
          style={selectInput}
        >
          {ITEM_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <select
          value={item.diameter ?? ''}
          onChange={(e) => onChange({ diameter: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
          style={selectInput}
          title="Diameter (in)"
        >
          <option value="">—</option>
          {DIAMETERS.map((d) => (
            <option key={d} value={d}>{formatDiameter(d)}"</option>
          ))}
        </select>
        <select
          value={item.material ?? ''}
          onChange={(e) => onChange({ material: (e.target.value || undefined) as PipeMaterial | undefined })}
          style={selectInput}
        >
          <option value="">—</option>
          {MATERIALS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          type="number"
          value={item.cost}
          step={0.5}
          min={0}
          onChange={(e) => onChange({ cost: parseFloat(e.target.value) || 0 })}
          style={textInput}
          placeholder="$"
          title="Cost ($)"
        />
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            title="More fields"
            style={iconBtn('#7fb8d0')}
          >{expanded ? '▲' : '▼'}</button>
        </div>
      </div>

      {/* Expanded row — offset, rotation, part number, length, fitting type */}
      {expanded && (
        <div style={{ padding: '6px 0 6px 8px', marginTop: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 3 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px 1fr', gap: 6, padding: '4px 8px', alignItems: 'center', fontSize: 10 }}>
            <span style={lbl}>Offset (x,y,z ft)</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  value={item.offset[axis] ?? 0}
                  step={0.1}
                  onChange={(e) => {
                    const next: [number, number, number] = [...item.offset];
                    next[axis] = parseFloat(e.target.value) || 0;
                    onChange({ offset: next });
                  }}
                  style={{ ...textInput, flex: 1 }}
                />
              ))}
            </div>
            <span style={lbl}>Rotation (x,y,z rad)</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {[0, 1, 2].map((axis) => (
                <input
                  key={axis}
                  type="number"
                  value={item.rotation[axis] ?? 0}
                  step={0.1}
                  onChange={(e) => {
                    const next: [number, number, number] = [...item.rotation];
                    next[axis] = parseFloat(e.target.value) || 0;
                    onChange({ rotation: next });
                  }}
                  style={{ ...textInput, flex: 1 }}
                />
              ))}
            </div>

            {item.kind === 'pipe' && (
              <>
                <span style={lbl}>Length (ft)</span>
                <input
                  type="number"
                  value={item.length ?? 0}
                  step={0.1}
                  onChange={(e) => onChange({ length: parseFloat(e.target.value) || 0 })}
                  style={textInput}
                />
              </>
            )}

            {item.kind === 'fitting' && (
              <>
                <span style={lbl}>Fitting type</span>
                <input
                  value={item.fittingType ?? ''}
                  onChange={(e) => onChange({ fittingType: e.target.value })}
                  style={textInput}
                  placeholder="e.g. elbow_90, p_trap, closet_flange"
                />
              </>
            )}

            <span style={lbl}>Part number</span>
            <input
              value={item.partNumber ?? ''}
              onChange={(e) => onChange({ partNumber: e.target.value })}
              style={textInput}
              placeholder="supplier SKU"
            />
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 4, padding: '0 8px' }}>
            <button onClick={onDuplicate} style={iconBtn(color)} title="Duplicate row">⎘ Duplicate</button>
            <div style={{ flex: 1 }} />
            <button onClick={onRemove} style={iconBtn('#ef5350')} title="Remove row">🗑 Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Atoms ──────────────────────────────────────────────────────

function SectionHdr({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: '#ff1744',
      padding: '14px 0 6px',
      borderBottom: '1px solid rgba(255,23,68,0.25)',
      marginBottom: 8,
      fontFamily: 'Consolas, monospace',
    }}>{children}</div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <label style={{ fontSize: 11, color: '#b8cbd7' }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 110,
  background: 'rgba(4, 8, 14, 0.92)',
  backdropFilter: 'blur(6px)',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  color: '#e0ecf3',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '1px solid rgba(255,23,68,0.45)',
  background: 'linear-gradient(90deg, rgba(255,23,68,0.15) 0%, rgba(255,111,0,0.08) 100%)',
};

const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#ff5252', letterSpacing: 1 };
const subtitleStyle: React.CSSProperties = { fontSize: 10, color: '#b8cbd7', fontFamily: 'Consolas, monospace' };

const textInput: React.CSSProperties = {
  width: '100%',
  padding: '3px 6px',
  background: 'rgba(8,14,22,0.85)',
  border: '1px solid rgba(120,180,220,0.25)',
  color: '#e0ecf3',
  borderRadius: 3,
  fontSize: 11,
  fontFamily: 'Consolas, monospace',
  boxSizing: 'border-box',
  outline: 'none',
};

const selectInput: React.CSSProperties = { ...textInput, padding: '3px 4px' };

const lbl: React.CSSProperties = { fontSize: 10, color: '#8aa0b1', fontFamily: 'Consolas, monospace' };

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

function applyBtnStyle(dirty: boolean): React.CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 11,
    background: dirty ? 'linear-gradient(135deg, #66bb6a, #43a047)' : 'rgba(60,75,90,0.4)',
    border: `1px solid ${dirty ? '#81c784' : 'rgba(120,180,220,0.3)'}`,
    borderRadius: 4,
    color: dirty ? '#fff' : '#8aa0b1',
    cursor: dirty ? 'pointer' : 'not-allowed',
    fontWeight: 600,
    boxShadow: dirty ? '0 0 10px rgba(102,187,106,0.4)' : 'none',
  };
}

function iconBtn(color: string): React.CSSProperties {
  return {
    padding: '3px 8px',
    fontSize: 10,
    background: `${color}22`,
    border: `1px solid ${color}66`,
    borderRadius: 3,
    color,
    fontFamily: 'Consolas, monospace',
    cursor: 'pointer',
  };
}

function formatDiameter(d: number): string {
  if (d === 0.375) return '3/8';
  if (d === 0.5) return '1/2';
  if (d === 0.75) return '3/4';
  if (d === 1.25) return '1-1/4';
  if (d === 1.5) return '1-1/2';
  if (d === 2.5) return '2-1/2';
  return String(d);
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t.isContentEditable) return true;
  return false;
}
