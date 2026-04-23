/**
 * Toolbar — polished left-side panel with:
 *   Mode switcher (Navigate / Draw / Select)
 *   Draw plane toggle (H horizontal / V vertical)
 *   Pipe diameter selector
 *   Pipe quality toggle (3D / Fast)
 *   Status hints
 *
 * ─── Interaction state: useInteractiveButton hook ──────────────
 *
 * Each toolbar button composes press-scale (0.96 on mousedown) +
 * focus ring via `useInteractiveButton`. The pattern matches what
 * ModeTabs worked out — mouseleave mid-press releases the press
 * (drag-off-to-abort gesture). The hook handles the state; the
 * `<InteractiveButton>` wrapper below handles the visual composition.
 *
 * Hover halos are intentionally absent on mode / utility buttons
 * because each has its own saturated accent color (green, cyan,
 * amber, purple, orange) — painting a same-colored halo on hover
 * would double up and noise rather than clarify. The existing
 * background / border shifts already flag hover. We just add the
 * tactile press beat and a visible focus ring.
 *
 * The button wrapper comes from `@ui/shared/InteractiveButton`
 * which layers the hook's state onto a native <button>. Same
 * wrapper is used in LayerPanel + RoofingToolbar for consistency.
 */

import { usePlumbingDrawStore, type InteractionMode } from '@store/plumbingDrawStore';
import { usePipeStore } from '@store/pipeStore';
import { APP_MODE_ACCENTS } from '@store/appModeStore';
import { InteractiveButton } from '@ui/shared/InteractiveButton';

// ── Mode buttons ────────────────────────────────────────────────

const MODES: { key: InteractionMode; label: string; icon: string; shortcut: string; color: string }[] = [
  { key: 'navigate', label: 'Navigate', icon: '🧭', shortcut: 'N', color: '#66bb6a' },
  { key: 'draw',     label: 'Draw Pipe', icon: '✏️', shortcut: 'D', color: '#00e5ff' },
  { key: 'select',   label: 'Select',    icon: '👆', shortcut: 'S', color: '#ffc107' },
];

const DIAMETERS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

// ── Component ───────────────────────────────────────────────────

export function Toolbar() {
  const mode = usePlumbingDrawStore((s) => s.mode);
  const isDrawing = usePlumbingDrawStore((s) => s.isDrawing);
  const pointCount = usePlumbingDrawStore((s) => s.drawPoints.length);
  const setMode = usePlumbingDrawStore((s) => s.setMode);
  const drawPlane = usePlumbingDrawStore((s) => s.drawPlane);
  const togglePlane = usePlumbingDrawStore((s) => s.toggleDrawPlane);
  const quality = usePlumbingDrawStore((s) => s.pipeQuality);
  const toggleQuality = usePlumbingDrawStore((s) => s.togglePipeQuality);
  const diameter = usePlumbingDrawStore((s) => s.drawDiameter);
  const setDiameter = usePlumbingDrawStore((s) => s.setDrawDiameter);
  const orthoClickDrag = usePlumbingDrawStore((s) => s.orthoClickDragMode);
  const toggleOrthoClickDrag = usePlumbingDrawStore((s) => s.toggleOrthoClickDragMode);
  const pipeCount = usePipeStore((s) => Object.keys(s.pipes).length);

  return (
    <div style={styles.toolbar}>
      {/* Title */}
      <div style={styles.title}>ELBOW GREASE</div>
      <div style={styles.subtitle}>Plumbing CAD</div>

      <div style={styles.divider} />

      {/* Mode buttons */}
      {MODES.map((m) => {
        const active = mode === m.key;
        return (
          <InteractiveButton key={m.key}
            style={{ ...styles.btn, borderColor: active ? m.color : '#333', background: active ? 'rgba(255,255,255,0.06)' : 'transparent' }}
            onClick={() => setMode(m.key)} title={`${m.label} (${m.shortcut})`}>
            <span style={styles.icon}>{m.icon}</span>
            <span style={{ ...styles.label, color: active ? m.color : '#666' }}>{m.label}</span>
            <kbd style={styles.kbd}>{m.shortcut}</kbd>
          </InteractiveButton>
        );
      })}

      {/* Draw mode controls */}
      {mode === 'draw' && (
        <>
          <div style={styles.divider} />

          {/* H/V plane toggle */}
          <InteractiveButton style={{ ...styles.btn, borderColor: drawPlane === 'vertical' ? '#ff7043' : '#333',
            background: drawPlane === 'vertical' ? 'rgba(255,112,67,0.1)' : 'transparent' }}
            onClick={togglePlane} title="Toggle draw plane (V/H)">
            <span style={styles.icon}>{drawPlane === 'horizontal' ? '➡️' : '⬆️'}</span>
            <span style={{ ...styles.label, color: drawPlane === 'vertical' ? '#ff7043' : '#666' }}>
              {drawPlane === 'horizontal' ? 'Horizontal' : 'Vertical'}
            </span>
            <kbd style={styles.kbd}>{drawPlane === 'horizontal' ? 'H' : 'V'}</kbd>
          </InteractiveButton>

          {/* Diameter selector */}
          <div style={styles.sectionLabel}>Diameter</div>
          <div style={styles.diamRow}>
            {DIAMETERS.map((d) => (
              <InteractiveButton key={d}
                style={{ ...styles.diamBtn, borderColor: diameter === d ? '#00e5ff' : '#333',
                  color: diameter === d ? '#00e5ff' : '#666',
                  background: diameter === d ? 'rgba(0,229,255,0.1)' : 'transparent' }}
                onClick={() => setDiameter(d)}>
                {d}"
              </InteractiveButton>
            ))}
          </div>

          {/* Draw hints */}
          <div style={styles.hint}>
            {isDrawing
              ? `${pointCount} point${pointCount !== 1 ? 's' : ''} placed`
              : 'Click to place points'}
          </div>
          <div style={styles.hintSub}>
            {isDrawing ? 'Enter = finish | Esc = cancel' : 'Double-click = finish'}
          </div>
        </>
      )}

      <div style={styles.divider} />

      {/* Quality toggle */}
      <InteractiveButton style={{ ...styles.btn, borderColor: quality === '3d' ? '#7c4dff' : '#333',
        background: quality === '3d' ? 'rgba(124,77,255,0.1)' : 'transparent' }}
        onClick={toggleQuality} title="Toggle pipe quality (Q)">
        <span style={styles.icon}>{quality === '3d' ? '🔵' : '⚡'}</span>
        <span style={{ ...styles.label, color: quality === '3d' ? '#7c4dff' : '#666' }}>
          {quality === '3d' ? '3D Pipes' : 'Fast Mode'}
        </span>
        <kbd style={styles.kbd}>Q</kbd>
      </InteractiveButton>

      {/* Phase 14.AD.23 — ortho click-drag draw mode toggle. Active
          by default; disable for users who prefer the classic
          click-to-place-points flow. Only has an effect in top /
          front / side / bottom views; perspective + isometric
          still use the classic tool. */}
      <InteractiveButton
        style={{ ...styles.btn,
          borderColor: orthoClickDrag ? '#ff9800' : '#333',
          background: orthoClickDrag ? 'rgba(255,152,0,0.1)' : 'transparent' }}
        onClick={toggleOrthoClickDrag}
        title="Toggle CAD-style click-drag drawing in ortho views (Shift+O)">
        <span style={styles.icon}>{orthoClickDrag ? '✋' : '✏️'}</span>
        <span style={{ ...styles.label, color: orthoClickDrag ? '#ff9800' : '#666' }}>
          {orthoClickDrag ? 'Ortho Drag: ON' : 'Ortho Drag: off'}
        </span>
        <kbd style={styles.kbd}>⇧O</kbd>
      </InteractiveButton>

      {/* Pipe count */}
      {pipeCount > 0 && (
        <div style={styles.pipeCount}>{pipeCount} pipe{pipeCount !== 1 ? 's' : ''}</div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    position: 'absolute', left: 16, top: 16, bottom: 16,
    display: 'flex', flexDirection: 'column', gap: 3,
    padding: 8, borderRadius: 12, border: '1px solid #333',
    // Workspace-accent on the canvas-facing edge (right, since the
    // toolbar sits left-of-canvas). Plumbing-only mount via App.tsx
    // gate — hardcoded cyan is correct.
    borderRight: `3px solid ${APP_MODE_ACCENTS.plumbing}`,
    background: 'rgba(10,10,15,0.95)', fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto', zIndex: 30, width: 160, overflowY: 'auto',
  },
  title: {
    fontSize: 13, fontWeight: 800, color: '#00e5ff', letterSpacing: 1,
    textAlign: 'center' as const, padding: '4px 0 0',
  },
  subtitle: {
    fontSize: 9, color: '#555', textAlign: 'center' as const,
    letterSpacing: 2, textTransform: 'uppercase' as const,
  },
  divider: { height: 1, background: '#222', margin: '4px 0' },
  btn: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '7px 10px', borderRadius: 8, border: '1px solid',
    cursor: 'pointer',
    // Bumped the transition list to include transform (press-scale)
    // + box-shadow (focus ring). `all 0.15s` used to cover everything,
    // but we want transform on a faster 100ms curve so the press
    // beat feels immediate.
    transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease, box-shadow 150ms ease',
    width: '100%',
    background: 'transparent',
  },
  icon: { fontSize: 14, width: 20, textAlign: 'center' as const },
  label: { fontSize: 11, fontWeight: 600, flex: 1, textAlign: 'left' as const },
  kbd: {
    fontSize: 8, color: '#555', border: '1px solid #333', borderRadius: 3,
    padding: '1px 4px', fontFamily: 'monospace',
  },
  sectionLabel: {
    fontSize: 9, color: '#555', letterSpacing: 1, textTransform: 'uppercase' as const,
    padding: '4px 4px 2px',
  },
  diamRow: {
    display: 'flex', flexWrap: 'wrap' as const, gap: 3,
  },
  diamBtn: {
    fontSize: 10, fontWeight: 600, padding: '3px 7px', borderRadius: 4,
    border: '1px solid', cursor: 'pointer', background: 'transparent',
    transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease, transform 100ms ease, box-shadow 150ms ease',
  },
  hint: {
    fontSize: 11, color: '#00e5ff', padding: '4px 4px 0', textAlign: 'center' as const,
  },
  hintSub: {
    fontSize: 9, color: '#555', textAlign: 'center' as const, padding: '0 4px 2px',
  },
  pipeCount: {
    fontSize: 10, color: '#444', textAlign: 'center' as const, padding: '4px 0',
  },
};
