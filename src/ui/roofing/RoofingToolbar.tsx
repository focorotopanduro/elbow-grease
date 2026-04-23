/**
 * RoofingToolbar — Phase 14.R.4.
 *
 * Top-left HUD for the Roofing workspace. Owns the drawing-tool
 * selection + the per-section defaults applied on commit. Mirrors
 * the plumbing `Toolbar` placement so the left side of the screen
 * stays the "what tool am I using?" zone regardless of workspace.
 *
 * Mounted only when `appMode === 'roofing'` (see App.tsx).
 *
 * Layout:
 *   [Draw Rect]  [Select]                         — tool row
 *   Type [hip|gable|shed|flat]                    — roof type
 *   Slope [number]  Overhang [number]  Elev [number] — geometry defaults
 *   [Undo]  [Redo]  [Clear All]                    — graph actions
 */

import {
  useRoofingDrawStore,
} from '@store/roofingDrawStore';
import { useRoofStore } from '@store/roofStore';
import { APP_MODE_ACCENTS } from '@store/appModeStore';
import type { RoofType, SectionType, PenetrationKind } from '@engine/roofing/RoofGraph';

const ROOF_TYPES: { value: RoofType; label: string; icon: string }[] = [
  { value: 'hip',   label: 'Hip',   icon: '🏠' },
  { value: 'gable', label: 'Gable', icon: '🏡' },
  { value: 'shed',  label: 'Shed',  icon: '📐' },
  { value: 'flat',  label: 'Flat',  icon: '▬'  },
];

const SECTION_TYPES: { value: SectionType; label: string }[] = [
  { value: 'main_roof', label: 'Main' },
  { value: 'wing',      label: 'Wing' },
  { value: 'garage',    label: 'Garage' },
  { value: 'porch',     label: 'Porch' },
  { value: 'dormer',    label: 'Dormer' },
  { value: 'other',     label: 'Other' },
];

/** Phase 14.R.27 — penetration kinds surfaced as place-click buttons.
 *  Icon-only to keep the toolbar compact; `title` carries the full
 *  name + tip. */
const PENETRATION_KINDS: { value: PenetrationKind; icon: string; label: string }[] = [
  { value: 'plumbing_vent', icon: '⎰', label: 'Plumbing vent' },
  { value: 'skylight',      icon: '☼', label: 'Skylight' },
  { value: 'chimney',       icon: '🏭', label: 'Chimney' },
];

// ── Styles ──────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  position: 'fixed',
  top: 56,
  left: 12,
  zIndex: 22,
  width: 244,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 10,
  background: '#0a0a0f',
  border: '1px solid #222',
  // Workspace-accent on the canvas-facing edge. Roofing toolbar
  // sits left-of-canvas so the accent goes on the right edge,
  // mirroring the plumbing Toolbar on the other side of the mode.
  borderRight: `3px solid ${APP_MODE_ACCENTS.roofing}`,
  borderRadius: 10,
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  boxShadow: '0 2px 14px rgba(0,0,0,0.5)',
  userSelect: 'none',
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

export function RoofingToolbar() {
  const mode = useRoofingDrawStore((s) => s.mode);
  const beginDrawRect = useRoofingDrawStore((s) => s.beginDrawRect);
  const beginDrawPolygon = useRoofingDrawStore((s) => s.beginDrawPolygon);
  const beginPlacePenetration = useRoofingDrawStore((s) => s.beginPlacePenetration);
  const penetrationKind = useRoofingDrawStore((s) => s.penetrationKind);
  const cancelDraft = useRoofingDrawStore((s) => s.cancelDraft);
  const roofType = useRoofingDrawStore((s) => s.defaultRoofType);
  const sectionType = useRoofingDrawStore((s) => s.defaultSectionType);
  const slope = useRoofingDrawStore((s) => s.defaultSlope);
  const overhang = useRoofingDrawStore((s) => s.defaultOverhang);
  const elevation = useRoofingDrawStore((s) => s.defaultElevation);
  const setDefaultRoofType = useRoofingDrawStore((s) => s.setDefaultRoofType);
  const setDefaultSectionType = useRoofingDrawStore((s) => s.setDefaultSectionType);
  const setDefaultSlope = useRoofingDrawStore((s) => s.setDefaultSlope);
  const setDefaultOverhang = useRoofingDrawStore((s) => s.setDefaultOverhang);
  const setDefaultElevation = useRoofingDrawStore((s) => s.setDefaultElevation);

  const undo = useRoofStore((s) => s.undo);
  const redo = useRoofStore((s) => s.redo);
  const clear = useRoofStore((s) => s.clear);
  const sectionCount = useRoofStore((s) => s.sectionOrder.length);
  const penetrationCount = useRoofStore((s) => s.penetrationOrder.length);

  const drawingRect = mode === 'draw-rect';
  const drawingPoly = mode === 'draw-polygon';
  const placingPenetration = mode === 'place-penetration';
  const drawing = drawingRect || drawingPoly || placingPenetration;

  return (
    <div style={PANEL}>
      {/* Tool row */}
      <div style={ROW}>
        <button
          style={drawingRect ? BTN_ACTIVE : BTN}
          onClick={() => drawingRect ? cancelDraft() : beginDrawRect()}
          title="Click-click to draw a roof section rectangle"
        >
          {drawingRect ? '⏹ Cancel' : '▭ Draw Rect'}
        </button>
        <button
          style={drawingPoly ? BTN_ACTIVE : BTN}
          onClick={() => drawingPoly ? cancelDraft() : beginDrawPolygon()}
          title="Click each vertex; Enter or click vertex 1 to close. Creates a FLAT roof over any polygon."
        >
          {drawingPoly ? '⏹ Cancel' : '⬠ Polygon'}
        </button>
        <button
          style={BTN}
          onClick={() => cancelDraft()}
          title="Return to selection mode"
          disabled={!drawing}
        >
          ✧
        </button>
      </div>

      <div style={DIVIDER} />

      {/* Roof type picker */}
      <div>
        <div style={LABEL}>Roof type</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {ROOF_TYPES.map((rt) => (
            <button
              key={rt.value}
              style={roofType === rt.value ? BTN_ACTIVE : BTN}
              onClick={() => setDefaultRoofType(rt.value)}
              title={`Set default roof type to ${rt.label.toLowerCase()}`}
            >
              <span style={{ marginRight: 4 }}>{rt.icon}</span>{rt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section type picker */}
      <div>
        <div style={LABEL}>Section type</div>
        <select
          value={sectionType}
          onChange={(e) => setDefaultSectionType(e.target.value as SectionType)}
          style={INPUT}
        >
          {SECTION_TYPES.map((st) => (
            <option key={st.value} value={st.value}>{st.label}</option>
          ))}
        </select>
      </div>

      {/* Numeric inputs */}
      <div>
        <div style={LABEL}>Slope (X in 12)</div>
        <input
          type="number"
          value={slope}
          min={0}
          max={24}
          step={0.5}
          onChange={(e) => setDefaultSlope(Number(e.target.value) || 0)}
          style={INPUT}
        />
      </div>
      <div>
        <div style={LABEL}>Overhang (ft)</div>
        <input
          type="number"
          value={overhang}
          min={0}
          max={6}
          step={0.25}
          onChange={(e) => setDefaultOverhang(Number(e.target.value) || 0)}
          style={INPUT}
        />
      </div>
      <div>
        <div style={LABEL}>Elevation (ft)</div>
        <input
          type="number"
          value={elevation}
          min={-10}
          max={60}
          step={0.5}
          onChange={(e) => setDefaultElevation(Number(e.target.value) || 0)}
          style={INPUT}
        />
      </div>

      <div style={DIVIDER} />

      {/* Phase 14.R.27 — Penetrations */}
      <div>
        <div style={LABEL}>Penetrations ({penetrationCount})</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
          {PENETRATION_KINDS.map((pk) => {
            const active = placingPenetration && penetrationKind === pk.value;
            return (
              <button
                key={pk.value}
                style={active ? BTN_ACTIVE : BTN}
                onClick={() => active ? cancelDraft() : beginPlacePenetration(pk.value)}
                title={`Click on the roof to place a ${pk.label.toLowerCase()}`}
              >
                <span style={{ marginRight: 3 }}>{pk.icon}</span>
                {pk.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>

      <div style={DIVIDER} />

      {/* Graph actions */}
      <div style={ROW}>
        <button style={BTN} onClick={() => undo()} title="Undo last change">
          ↶ Undo
        </button>
        <button style={BTN} onClick={() => redo()} title="Redo">
          ↷ Redo
        </button>
      </div>
      <button
        style={BTN_DANGER}
        onClick={() => {
          if (sectionCount === 0) return;
          if (window.confirm(`Delete all ${sectionCount} section${sectionCount === 1 ? '' : 's'}?`)) {
            clear();
          }
        }}
        disabled={sectionCount === 0}
        title="Remove every roof section from the scene"
      >
        🗑 Clear All ({sectionCount})
      </button>

      {/* Hint text */}
      <div style={{ color: '#666', fontSize: 10, lineHeight: 1.4, marginTop: 4 }}>
        {drawingRect && 'Click two corners on the ground. ESC cancels.'}
        {drawingPoly && (
          <>
            Click each vertex (3+). Enter or click vertex 1 to close · Backspace undoes · ESC cancels.
            <br />
            <span style={{ color: '#8aa' }}>
              Hip + convex polygon → pyramid. Gable / shed / concave → flat.
            </span>
          </>
        )}
        {placingPenetration && (
          <>
            Click on the roof to drop the {
              PENETRATION_KINDS.find((p) => p.value === penetrationKind)?.label.toLowerCase() ?? 'marker'
            } · ESC cancels.
            <br />
            <span style={{ color: '#8aa' }}>
              Placed markers drive the estimator's {penetrationKind.replace('_', ' ')} count.
            </span>
          </>
        )}
        {!drawing && 'Pick a tool above to start drawing roof sections.'}
      </div>
    </div>
  );
}
