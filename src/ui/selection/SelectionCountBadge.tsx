/**
 * SelectionCountBadge — Phase 14.M
 *
 * Small fixed-position HUD near top-right that shows "N selected"
 * when multi-select has ≥ 1 entity. Click the × to clear. Also
 * shows the current Select-mode indicator so the user knows when
 * they're in lasso mode.
 *
 * Subscribes to multiSelectStore.count() AND plumbingDrawStore.mode.
 * Returns null when neither is active — no screen noise otherwise.
 */

import { useMultiSelectStore } from '@store/multiSelectStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';

export function SelectionCountBadge() {
  const pipeIds = useMultiSelectStore((s) => s.pipeIds);
  const fixtureIds = useMultiSelectStore((s) => s.fixtureIds);
  const clear = useMultiSelectStore((s) => s.clear);
  const mode = usePlumbingDrawStore((s) => s.mode);
  const setMode = usePlumbingDrawStore((s) => s.setMode);

  const pCount = Object.keys(pipeIds).length;
  const fCount = Object.keys(fixtureIds).length;
  const total = pCount + fCount;
  const inSelect = mode === 'select';

  if (total === 0 && !inSelect) return null;

  return (
    <div style={styles.container}>
      {inSelect && (
        <div
          style={styles.modeBadge}
          title="Click or press S to exit Select mode"
          onClick={() => setMode('navigate')}
        >
          <span style={{ color: '#00e5ff' }}>◎</span> SELECT MODE
        </div>
      )}
      {total > 0 && (
        <div style={styles.countBadge}>
          <span style={styles.countNumber}>{total}</span>
          <span style={styles.countLabel}>
            {pCount} pipe{pCount === 1 ? '' : 's'} · {fCount} fixture{fCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            aria-label="Clear selection"
            style={styles.clearBtn}
            onClick={clear}
          >
            ×
          </button>
        </div>
      )}
      {inSelect && (
        <div style={styles.hint}>
          drag = lasso · Shift-drag = add · Shift+click = toggle · Alt+click = remove
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    top: 16,
    right: 16,
    zIndex: 30,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 4,
    pointerEvents: 'none', // children opt in
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  modeBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: 2,
    color: '#cfd8e3',
    background: 'rgba(0, 229, 255, 0.12)',
    border: '1px solid rgba(0, 229, 255, 0.45)',
    borderRadius: 4,
    pointerEvents: 'auto',
    cursor: 'pointer',
  },
  countBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'rgba(255, 213, 79, 0.12)',
    border: '1px solid rgba(255, 213, 79, 0.5)',
    borderRadius: 6,
    color: '#e0e6ef',
    pointerEvents: 'auto',
  },
  countNumber: {
    fontSize: 18,
    fontWeight: 800,
    color: '#ffd54f',
    fontFamily: 'ui-monospace, Consolas, monospace',
    lineHeight: 1,
  },
  countLabel: {
    fontSize: 10,
    color: '#aebbc9',
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: '#7a8592',
    fontSize: 16,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    marginLeft: 2,
  },
  hint: {
    fontSize: 9,
    color: '#7a8592',
    fontFamily: 'ui-monospace, Consolas, monospace',
    letterSpacing: 0.5,
    pointerEvents: 'none',
    maxWidth: 380,
    textAlign: 'right',
  },
};
