/**
 * StatusBar — bottom-of-screen bar showing current mode, shortcuts, and draw state.
 */

import { useInteractionStore } from '@store/interactionStore';
import { usePipeStore } from '@store/pipeStore';

const MODE_LABELS = {
  navigate: { text: 'NAVIGATE', color: '#888', hint: 'Left-drag = orbit | Scroll = zoom | D = draw mode' },
  draw: { text: 'DRAW', color: '#00e5ff', hint: '' },
  select: { text: 'SELECT', color: '#ffc107', hint: 'Click a pipe to inspect | Del = delete | N = navigate' },
};

export function StatusBar() {
  const mode = useInteractionStore((s) => s.mode);
  const drawPlane = useInteractionStore((s) => s.drawPlane);
  const isDrawing = useInteractionStore((s) => s.isDrawing);
  const pointCount = useInteractionStore((s) => s.drawPoints.length);
  const diameter = useInteractionStore((s) => s.drawDiameter);
  const pipeCount = usePipeStore((s) => Object.keys(s.pipes).length);

  const modeInfo = MODE_LABELS[mode];
  const isVert = drawPlane === 'vertical';

  let hint = modeInfo.hint;
  if (mode === 'draw') {
    if (isDrawing) {
      hint = `${pointCount} point${pointCount !== 1 ? 's' : ''} | Enter = finish | Esc = cancel | ${isVert ? 'H' : 'V'} = switch to ${isVert ? 'horizontal' : 'vertical'}`;
    } else {
      hint = `Click to place points | ${isVert ? '⬆ VERTICAL' : '➡ HORIZONTAL'} plane | ${diameter}" diameter | 1-6 = quick size`;
    }
  }

  return (
    <div style={styles.bar}>
      {/* Mode badge */}
      <div style={{ ...styles.badge, borderColor: modeInfo.color, color: modeInfo.color }}>
        {modeInfo.text}
      </div>

      {/* Draw plane indicator */}
      {mode === 'draw' && (
        <div style={{ ...styles.badge, borderColor: isVert ? '#ff7043' : '#00e5ff',
          color: isVert ? '#ff7043' : '#00e5ff' }}>
          {isVert ? '⬆ VERT' : '➡ HORIZ'}
        </div>
      )}

      {/* Diameter indicator */}
      {mode === 'draw' && (
        <div style={{ ...styles.badge, borderColor: '#7c4dff', color: '#7c4dff' }}>
          ⌀ {diameter}"
        </div>
      )}

      {/* Hint text */}
      <span style={styles.hint}>{hint}</span>

      {/* Pipe count */}
      <span style={styles.meta}>
        {pipeCount > 0 ? `${pipeCount} pipe${pipeCount !== 1 ? 's' : ''}` : ''}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 16px 0 180px', // left padding clears the toolbar
    background: 'rgba(10,10,15,0.95)',
    borderTop: '1px solid #222',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'none',
    zIndex: 25,
  },
  badge: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '2px 8px',
    borderRadius: 4,
    border: '1px solid',
  },
  hint: {
    fontSize: 11,
    color: '#666',
    flex: 1,
  },
  meta: {
    fontSize: 10,
    color: '#444',
  },
};
