/**
 * CursorBadge — DOM overlay near the cursor showing the current
 * drawing loadout: diameter (color-coded), material, plane.
 *
 * The user's question "what am I about to draw?" gets a one-glance
 * answer without looking away from the scene. Reads nothing but
 * feedback + interaction state; fully passive.
 *
 * Positioning:
 *   Follows `drawFeedbackStore.cursorClient` in CSS `left/top`.
 *   ~20px below and to the right of the cursor so it doesn't occlude
 *   the actual hit point. Stays within viewport via CSS `max`.
 *
 * Visibility:
 *   Draw mode → always visible.
 *   Select mode → visible when a snap is active (the user is about
 *     to extend/tee — shows them what material will be used).
 *   Navigate mode → hidden.
 */

import { useMemo } from 'react';
import { useDrawFeedbackStore } from '@store/drawFeedbackStore';
import { useInteractionStore } from '@store/interactionStore';

// ── System / diameter colors (mirrors DIAMETER_COLORS in pipeStore) ──

const DIAMETER_COLORS: Record<string, string> = {
  '0.375': '#4fc3f7', '0.5': '#4fc3f7',
  '0.75':  '#29b6f6', '1':   '#29b6f6',
  '1.25':  '#66bb6a', '1.5': '#66bb6a',
  '2':     '#ffa726', '2.5': '#ffa726',
  '3':     '#ef5350',
  '4':     '#ab47bc',
  '5':     '#8d6e63', '6':   '#8d6e63',
  '8':     '#78909c', '10':  '#78909c', '12': '#78909c',
};

function colorForDiameter(d: number): string {
  return DIAMETER_COLORS[String(d)] ?? '#ffa726';
}

// ── Component ──────────────────────────────────────────────────

export function CursorBadge() {
  const mode = useInteractionStore((s) => s.mode);
  const diameter = useInteractionStore((s) => s.drawDiameter);
  const material = useInteractionStore((s) => s.drawMaterial);
  const plane = useInteractionStore((s) => s.drawPlane);

  const cursorClient = useDrawFeedbackStore((s) => s.cursorClient);
  const snapTarget = useDrawFeedbackStore((s) => s.snapTarget);

  // Visibility gate.
  const shouldShow = useMemo(() => {
    if (mode === 'navigate') return false;
    if (mode === 'draw') return !!cursorClient;
    // Select mode: show only when a snap is active.
    return !!snapTarget && !!cursorClient;
  }, [mode, cursorClient, snapTarget]);

  if (!shouldShow || !cursorClient) return null;

  const color = colorForDiameter(diameter);
  const shortMat = material.replace('_sch40', '').replace(/_/g, ' ');

  return (
    <div
      style={{
        ...styles.badge,
        // Slight offset so the badge doesn't sit under the cursor tip.
        left: cursorClient.x + 16,
        top: cursorClient.y + 20,
      }}
      aria-hidden
    >
      <span
        style={{
          ...styles.dot,
          background: color,
          boxShadow: `0 0 6px ${color}80`,
        }}
      />
      <span style={styles.diameter}>{diameter}"</span>
      <span style={styles.mat}>{shortMat}</span>
      <span style={styles.plane}>{plane === 'vertical' ? 'V' : 'H'}</span>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  badge: {
    position: 'fixed',
    padding: '3px 8px',
    background: 'rgba(10, 14, 22, 0.92)',
    border: '1px solid #2a3a54',
    borderRadius: 14,
    color: '#e0e6ef',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 11,
    lineHeight: 1.2,
    pointerEvents: 'none',
    zIndex: 90,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    userSelect: 'none',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
    transition: 'none',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flex: '0 0 10px',
  },
  diameter: { color: '#e0e6ef', fontWeight: 700 },
  mat: { color: '#a0aec0', textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 },
  plane: {
    color: '#7a8592',
    fontSize: 10,
    border: '1px solid #2a3a54',
    borderRadius: 3,
    padding: '0 4px',
    fontFamily: 'monospace',
  },
};
