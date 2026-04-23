/**
 * FixtureMiniCard — Phase 14.F
 *
 * Compact bottom-right inspector for the currently selected fixture.
 * Default inspector surface — designed to stay out of the user's
 * pipe-drawing pipeline:
 *   • 260 px wide (vs. 380 for the full editor)
 *   • no backdrop, no blur
 *   • z-index below modals (25) so hotkeys open modals on top
 *   • `pointerEvents: auto` on the card itself; areas outside the
 *     card pass pointer events through to the scene
 *
 * Shows:
 *   • Fixture subtype name + selected ID
 *   • Rotation readout + ±15° / ±90° step buttons + expand shortcut hint
 *   • DFU / WSFU / trap size (computed in real time via fixtureStore)
 *   • Expand → full detail editor
 *   • Deselect × button
 *
 * Styled to match PipeInspector (Phase 3.D) + ContractorProfilePanel
 * palette for consistency across the HUD.
 */

import { useFixtureStore } from '@store/fixtureStore';
import { useFixtureInspectorStore } from '@store/fixtureInspectorStore';
import { normalizeDeg } from '@core/fixtures/rotationGizmoMath';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';

export function FixtureMiniCard() {
  const selectedId = useFixtureStore((s) => s.selectedFixtureId);
  const fixtures = useFixtureStore((s) => s.fixtures);
  const selectFixture = useFixtureStore((s) => s.selectFixture);
  const updateParam = useFixtureStore((s) => s.updateParam);
  const getEffectiveDFU = useFixtureStore((s) => s.getEffectiveDFU);
  const getEffectiveWSFU = useFixtureStore((s) => s.getEffectiveWSFU);

  const mode = useFixtureInspectorStore((s) => s.mode);
  const setMode = useFixtureInspectorStore((s) => s.setMode);

  // Render only when: (a) a fixture is selected, and (b) mode is 'mini'.
  // Detail mode yields the screen to FixtureParamWindow.
  if (!selectedId || mode !== 'mini') return null;
  const fixture = fixtures[selectedId];
  if (!fixture) return null;

  const rotDeg = Number(fixture.params['rotationDeg'] ?? 0);
  const dfu = getEffectiveDFU(selectedId);
  const wsfu = getEffectiveWSFU(selectedId);
  const trapSize = trapDiameterFor(fixture.subtype);

  const bumpRotation = (delta: number) => {
    updateParam(selectedId, 'rotationDeg', normalizeDeg(rotDeg + delta));
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>FIXTURE</span>
        <span style={styles.subtype}>{humanSubtype(fixture.subtype)}</span>
        <span style={styles.idBadge}>{fixture.id.slice(-4)}</span>
        <button
          type="button"
          aria-label="Deselect fixture"
          style={styles.closeBtn}
          onClick={() => selectFixture(null)}
        >
          ×
        </button>
      </div>

      {/* Rotation row — inline ±15° / ±90° bump + readout */}
      <div style={styles.rotRow}>
        <button type="button" style={styles.stepBtn} onClick={() => bumpRotation(-90)} title="Ctrl+[">⟲ 90°</button>
        <button type="button" style={styles.stepBtn} onClick={() => bumpRotation(-15)} title="[">–15°</button>
        <span style={styles.rotValue}>{rotDeg.toFixed(0)}°</span>
        <button type="button" style={styles.stepBtn} onClick={() => bumpRotation(15)} title="]">+15°</button>
        <button type="button" style={styles.stepBtn} onClick={() => bumpRotation(90)} title="Ctrl+]">⟳ 90°</button>
      </div>

      {/* Specs — essential only */}
      <div style={styles.grid}>
        <Row label="DFU" value={dfu.toFixed(1)} />
        <Row
          label="WSFU"
          value={`${wsfu.cold.toFixed(1)} · ${wsfu.hot.toFixed(1)}`}
          hint="cold · hot"
        />
        <Row label="Trap" value={`${trapSize}″`} />
      </div>

      {/* Footer: expand to detail view */}
      <button
        type="button"
        style={styles.expandBtn}
        onClick={() => setMode('detail')}
      >
        Open full editor →
      </button>
    </div>
  );
}

// ── Row component ─────────────────────────────────────────────

function Row({
  label, value, hint,
}: { label: string; value: string; hint?: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
      {hint && <span style={styles.rowHint}>{hint}</span>}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function humanSubtype(s: FixtureSubtype): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Mirrors the trap-size rule from pTrapCleanoutPlanner. */
function trapDiameterFor(subtype: FixtureSubtype): number {
  if (subtype === 'water_closet') return 3;
  if (subtype === 'floor_drain') return 2;
  return 1.5;
}

// ── Styles ────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    bottom: 16,
    right: 16,
    width: 260,
    padding: '10px 12px',
    background: 'rgba(10, 14, 22, 0.94)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    color: '#e0e6ef',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 11,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    zIndex: 25,
    pointerEvents: 'auto',
    display: 'flex', flexDirection: 'column', gap: 8,
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 6,
    paddingBottom: 6,
    borderBottom: '1px solid #1a2334',
  },
  title: {
    fontSize: 9, fontWeight: 800, color: '#00e5ff',
    letterSpacing: 2,
  },
  subtype: { flex: 1, fontSize: 12, color: '#e0e6ef', fontWeight: 600 },
  idBadge: {
    fontSize: 9, color: '#7a8592',
    fontFamily: 'ui-monospace, Consolas, monospace',
    padding: '1px 4px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 3,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 18, lineHeight: 1, cursor: 'pointer',
    padding: '0 4px',
  },
  rotRow: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '4px 0',
  },
  stepBtn: {
    padding: '3px 6px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 3,
    color: '#aebbc9',
    fontFamily: 'inherit', fontSize: 10,
    cursor: 'pointer',
  },
  rotValue: {
    flex: 1,
    fontSize: 13, fontWeight: 700,
    color: '#ffd54f',
    fontFamily: 'ui-monospace, Consolas, monospace',
    textAlign: 'center',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 2,
  },
  row: {
    display: 'flex', alignItems: 'baseline', gap: 6,
    padding: '2px 0',
  },
  rowLabel: {
    width: 44,
    fontSize: 10,
    color: '#7a8592',
    letterSpacing: 0.5,
  },
  rowValue: {
    flex: 1,
    fontSize: 11,
    color: '#e0e6ef',
    fontFamily: 'ui-monospace, Consolas, monospace',
  },
  rowHint: {
    fontSize: 9,
    color: '#5a6472',
    fontStyle: 'italic',
  },
  expandBtn: {
    marginTop: 2,
    padding: '5px 8px',
    background: 'rgba(0, 229, 255, 0.08)',
    border: '1px solid rgba(0, 229, 255, 0.35)',
    borderRadius: 4,
    color: '#00e5ff',
    fontFamily: 'inherit', fontSize: 10, fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
};
