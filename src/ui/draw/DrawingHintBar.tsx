/**
 * DrawingHintBar — bottom-center contextual hint that tells the user
 * what the next click will do.
 *
 * Reads from:
 *   • drawFeedbackStore.nextAction — the semantic intent
 *   • drawFeedbackStore.snapTarget  — the specific target (for label detail)
 *   • interactionStore.drawPoints   — running length + count for in-progress runs
 *   • interactionStore.drawPlane    — horizontal/vertical indicator
 *
 * The bar NEVER modifies state — it's pure feedback. If the user
 * wonders "what should I press / click?", one glance answers.
 *
 * Hides in navigate mode + when nothing is in progress AND there's
 * no cursor action to report, so it doesn't clutter the HUD at rest.
 */

import { useMemo } from 'react';
import { useDrawFeedbackStore, type NextAction } from '@store/drawFeedbackStore';
import { useInteractionStore } from '@store/interactionStore';

// ── Component ──────────────────────────────────────────────────

export function DrawingHintBar() {
  const mode = useInteractionStore((s) => s.mode);
  const drawPoints = useInteractionStore((s) => s.drawPoints);
  const drawPlane = useInteractionStore((s) => s.drawPlane);
  const diameter = useInteractionStore((s) => s.drawDiameter);
  const material = useInteractionStore((s) => s.drawMaterial);

  const nextAction = useDrawFeedbackStore((s) => s.nextAction);
  const snapTarget = useDrawFeedbackStore((s) => s.snapTarget);

  // Compose the hint string.
  const hint = useMemo(
    () => composeHint({
      mode, drawPoints, drawPlane, diameter, material,
      nextAction, snapLabel: snapTarget?.label ?? null,
    }),
    [mode, drawPoints, drawPlane, diameter, material, nextAction, snapTarget?.label],
  );

  // Hide in navigate mode with nothing interesting to report.
  if (mode === 'navigate') return null;
  if (!hint.primary && !hint.secondary) return null;

  return (
    <div style={styles.bar} role="status" aria-live="polite">
      <div style={styles.content}>
        {hint.icon && <span style={styles.icon}>{hint.icon}</span>}
        <span style={styles.primary}>{hint.primary}</span>
        {hint.secondary && <span style={styles.secondary}>{hint.secondary}</span>}
      </div>
      {hint.keyHint && (
        <div style={styles.keyHint}>{hint.keyHint}</div>
      )}
    </div>
  );
}

// ── Compose logic (pure) ──────────────────────────────────────

interface HintPieces {
  primary: string;
  secondary: string;
  icon: string | null;
  keyHint: string;
}

export function composeHint(args: {
  mode: 'navigate' | 'draw' | 'select';
  drawPoints: Array<[number, number, number]>;
  drawPlane: 'horizontal' | 'vertical';
  diameter: number;
  material: string;
  nextAction: NextAction;
  snapLabel: string | null;
}): HintPieces {
  const n = args.drawPoints.length;
  const size = `${args.diameter}"`;
  const mat = args.material.replace(/_/g, ' ');
  const planeTag = args.drawPlane === 'vertical' ? 'V' : 'H';

  // Running length if drawing.
  let runningFt = 0;
  for (let i = 1; i < n; i++) {
    const a = args.drawPoints[i - 1]!;
    const b = args.drawPoints[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    runningFt += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  switch (args.nextAction) {
    case 'place-first-point':
      return {
        icon: '▸',
        primary: `Click to start a ${size} ${mat} pipe`,
        secondary: `Plane: ${planeTag === 'V' ? 'vertical' : 'horizontal'}`,
        keyHint: 'Esc cancel · V/H toggle plane · 1-6 change size · ? all shortcuts',
      };
    case 'start-from-endpoint':
      return {
        icon: '●',
        primary: args.snapLabel
          ? `Click to extend from ${args.snapLabel}`
          : 'Click to extend from pipe endpoint',
        secondary: `New segment: ${size} ${mat}`,
        keyHint: 'Esc cancel · any other click starts a fresh pipe',
      };
    case 'insert-tee':
      return {
        icon: '┬',
        primary: args.snapLabel
          ? `Click to insert a tee on ${args.snapLabel}`
          : 'Click to insert a tee on this pipe',
        secondary: `Branch: ${size} ${mat}`,
        keyHint: 'Drag to extend the branch · Esc cancel',
      };
    case 'place-next-point':
      return {
        icon: '•',
        primary: `Click to place point ${n + 1}`,
        secondary: `Run: ${runningFt.toFixed(2)} ft · ${size} ${mat}`,
        keyHint: 'Enter to finish · dbl-click to finish · Esc to clear',
      };
    case 'finish-at-endpoint':
      return {
        icon: '◉',
        primary: args.snapLabel
          ? `Click to close run at ${args.snapLabel}`
          : 'Click to close the run here',
        secondary: `Run: ${runningFt.toFixed(2)} ft · ${size} ${mat}`,
        keyHint: 'Enter also finishes · Esc clears current run',
      };
    case 'select':
      return {
        icon: '✦',
        primary: 'Click a pipe or fixture to select',
        secondary: 'Drag an endpoint + glyph to extend · Drag a pipe body to tee',
        keyHint: 'Esc to deselect · Ctrl+Z undo',
      };
    case 'pan-only':
      return { icon: null, primary: '', secondary: '', keyHint: '' };
  }
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'fixed',
    bottom: 14,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    background: 'rgba(8, 12, 20, 0.94)',
    border: '1px solid #2a3a54',
    borderRadius: 20,
    color: '#e0e6ef',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 12,
    zIndex: 100,
    pointerEvents: 'none',
    boxShadow: '0 4px 18px rgba(0,0,0,0.5), 0 0 0 1px rgba(0, 229, 255, 0.07)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    maxWidth: '80vw',
  },
  content: { display: 'flex', alignItems: 'baseline', gap: 8 },
  icon: { fontSize: 14, color: '#00e5ff', lineHeight: 1 },
  primary: { color: '#e0e6ef', fontWeight: 600 },
  secondary: { color: '#7a8592', fontSize: 11 },
  keyHint: { color: '#4a5668', fontSize: 10, letterSpacing: 0.5 },
};
