/**
 * Toolbar — polished left-side panel with:
 *   Mode switcher (Navigate / Draw / Select)
 *   Draw plane toggle (H horizontal / V vertical)
 *   Pipe diameter selector
 *   Pipe quality toggle (3D / Fast)
 *   Status hints
 */

import { useInteractionStore, type InteractionMode } from '@store/interactionStore';
import { usePipeStore } from '@store/pipeStore';

// ── Mode buttons ────────────────────────────────────────────────

const MODES: { key: InteractionMode; label: string; icon: string; shortcut: string; color: string }[] = [
  { key: 'navigate', label: 'Navigate', icon: '🧭', shortcut: 'N', color: '#66bb6a' },
  { key: 'draw',     label: 'Draw Pipe', icon: '✏️', shortcut: 'D', color: '#00e5ff' },
  { key: 'select',   label: 'Select',    icon: '👆', shortcut: 'S', color: '#ffc107' },
];

const DIAMETERS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6];

export function Toolbar() {
  const mode = useInteractionStore((s) => s.mode);
  const isDrawing = useInteractionStore((s) => s.isDrawing);
  const pointCount = useInteractionStore((s) => s.drawPoints.length);
  const setMode = useInteractionStore((s) => s.setMode);
  const drawPlane = useInteractionStore((s) => s.drawPlane);
  const togglePlane = useInteractionStore((s) => s.toggleDrawPlane);
  const quality = useInteractionStore((s) => s.pipeQuality);
  const toggleQuality = useInteractionStore((s) => s.togglePipeQuality);
  const diameter = useInteractionStore((s) => s.drawDiameter);
  const setDiameter = useInteractionStore((s) => s.setDrawDiameter);
  const orthoClickDrag = useInteractionStore((s) => s.orthoClickDragMode);
  const toggleOrthoClickDrag = useInteractionStore((s) => s.toggleOrthoClickDragMode);
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
          <button key={m.key}
            style={{ ...styles.btn, borderColor: active ? m.color : '#333', background: active ? 'rgba(255,255,255,0.06)' : 'transparent' }}
            onClick={() => setMode(m.key)} title={`${m.label} (${m.shortcut})`}>
            <span style={styles.icon}>{m.icon}</span>
            <span style={{ ...styles.label, color: active ? m.color : '#666' }}>{m.label}</span>
            <kbd style={styles.kbd}>{m.shortcut}</kbd>
          </button>
        );
      })}

      {/* Draw mode controls */}
      {mode === 'draw' && (
        <>
          <div style={styles.divider} />

          {/* H/V plane toggle */}
          <button style={{ ...styles.btn, borderColor: drawPlane === 'vertical' ? '#ff7043' : '#333',
            background: drawPlane === 'vertical' ? 'rgba(255,112,67,0.1)' : 'transparent' }}
            onClick={togglePlane} title="Toggle draw plane (V/H)">
            <span style={styles.icon}>{drawPlane === 'horizontal' ? '➡️' : '⬆️'}</span>
            <span style={{ ...styles.label, color: drawPlane === 'vertical' ? '#ff7043' : '#666' }}>
              {drawPlane === 'horizontal' ? 'Horizontal' : 'Vertical'}
            </span>
            <kbd style={styles.kbd}>{drawPlane === 'horizontal' ? 'H' : 'V'}</kbd>
          </button>

          {/* Diameter selector */}
          <div style={styles.sectionLabel}>Diameter</div>
          <div style={styles.diamRow}>
            {DIAMETERS.map((d) => (
              <button key={d}
                style={{ ...styles.diamBtn, borderColor: diameter === d ? '#00e5ff' : '#333',
                  color: diameter === d ? '#00e5ff' : '#666',
                  background: diameter === d ? 'rgba(0,229,255,0.1)' : 'transparent' }}
                onClick={() => setDiameter(d)}>
                {d}"
              </button>
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
      <button style={{ ...styles.btn, borderColor: quality === '3d' ? '#7c4dff' : '#333',
        background: quality === '3d' ? 'rgba(124,77,255,0.1)' : 'transparent' }}
        onClick={toggleQuality} title="Toggle pipe quality (Q)">
        <span style={styles.icon}>{quality === '3d' ? '🔵' : '⚡'}</span>
        <span style={{ ...styles.label, color: quality === '3d' ? '#7c4dff' : '#666' }}>
          {quality === '3d' ? '3D Pipes' : 'Fast Mode'}
        </span>
        <kbd style={styles.kbd}>Q</kbd>
      </button>

      {/* Phase 14.AD.23 — ortho click-drag draw mode toggle. Active
          by default; disable for users who prefer the classic
          click-to-place-points flow. Only has an effect in top /
          front / side / bottom views; perspective + isometric
          still use the classic tool. */}
      <button
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
      </button>

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
    cursor: 'pointer', transition: 'all 0.15s', width: '100%',
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
