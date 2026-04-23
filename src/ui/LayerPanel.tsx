/**
 * LayerPanel — HUD with toggle buttons per plumbing system.
 *
 * Positioned top-right, below the route suggestion panel.
 * Each button shows system name, color swatch, and pipe count.
 * Double-click to solo a system (hide all others).
 *
 * Also has toggles for fittings, fixtures, and dimensions.
 */

import { useMemo } from 'react';
import {
  usePlumbingLayerStore,
  SYSTEM_COLORS,
  SYSTEM_LABELS,
  type LayerState,
} from '@store/plumbingLayerStore';
import { usePipeStore } from '@store/pipeStore';
import type { SystemType } from '../engine/graph/GraphNode';

// ── System types to render ──────────────────────────────────────

const SYSTEMS: SystemType[] = ['waste', 'vent', 'cold_supply', 'hot_supply', 'storm'];

// ── Component toggles ───────────────────────────────────────────

interface ComponentToggle {
  key: 'fittings' | 'fixtures' | 'dimensions';
  label: string;
  shortcut: string;
}

const COMPONENT_TOGGLES: ComponentToggle[] = [
  { key: 'fittings',   label: 'Fittings',   shortcut: 'F' },
  { key: 'fixtures',   label: 'Fixtures',   shortcut: 'X' },
  { key: 'dimensions', label: 'Dimensions', shortcut: 'D' },
];

// ── System button ───────────────────────────────────────────────

function SystemButton({
  system,
  visible,
  pipeCount,
  onToggle,
  onSolo,
}: {
  system: SystemType;
  visible: boolean;
  pipeCount: number;
  onToggle: () => void;
  onSolo: () => void;
}) {
  const color = SYSTEM_COLORS[system];
  const label = SYSTEM_LABELS[system];

  return (
    <button
      style={{
        ...styles.systemBtn,
        borderColor: visible ? color : '#333',
        opacity: visible ? 1 : 0.4,
      }}
      onClick={onToggle}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSolo();
      }}
      title={`Click: toggle ${label}\nDouble-click: solo`}
    >
      <div style={{ ...styles.swatch, backgroundColor: color, opacity: visible ? 1 : 0.3 }} />
      <span style={styles.systemLabel}>{label}</span>
      {pipeCount > 0 && (
        <span style={styles.count}>{pipeCount}</span>
      )}
    </button>
  );
}

// ── Component toggle button ─────────────────────────────────────

function ComponentButton({
  toggle,
  visible,
  onToggle,
}: {
  toggle: ComponentToggle;
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      style={{
        ...styles.compBtn,
        borderColor: visible ? '#555' : '#222',
        opacity: visible ? 0.9 : 0.35,
      }}
      onClick={onToggle}
      title={`${toggle.shortcut}: toggle ${toggle.label}`}
    >
      <span style={styles.compLabel}>{toggle.label}</span>
      <span style={styles.shortcut}>{toggle.shortcut}</span>
    </button>
  );
}

// ── Main panel ──────────────────────────────────────────────────

export function LayerPanel() {
  const store = usePlumbingLayerStore();
  const pipes = usePipeStore((s) => s.pipes);

  // Count pipes per system
  const pipeCounts = useMemo(() => {
    const counts: Record<SystemType, number> = {
      waste: 0, vent: 0, cold_supply: 0, hot_supply: 0, storm: 0, condensate: 0,
    };
    for (const pipe of Object.values(pipes)) {
      counts[pipe.system]++;
    }
    return counts;
  }, [pipes]);

  const totalPipes = Object.values(pipes).length;

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>LAYERS</span>
        <button
          style={styles.allBtn}
          onClick={store.showAllSystems}
          title="A: Show all systems"
        >
          ALL
        </button>
      </div>

      {/* System toggles */}
      <div style={styles.systemGroup}>
        {SYSTEMS.map((sys) => (
          <SystemButton
            key={sys}
            system={sys}
            visible={store.systems[sys]}
            pipeCount={pipeCounts[sys]}
            onToggle={() => store.toggleSystem(sys)}
            onSolo={() => store.soloSystem(sys)}
          />
        ))}
      </div>

      {/* Divider */}
      <div style={styles.divider} />

      {/* Component toggles */}
      <div style={styles.compGroup}>
        {COMPONENT_TOGGLES.map((toggle) => (
          <ComponentButton
            key={toggle.key}
            toggle={toggle}
            visible={store[toggle.key]}
            onToggle={() => {
              if (toggle.key === 'fittings') store.toggleFittings();
              else if (toggle.key === 'fixtures') store.toggleFixtures();
              else if (toggle.key === 'dimensions') store.toggleDimensions();
            }}
          />
        ))}
      </div>

      {/* Footer: total pipe count */}
      {totalPipes > 0 && (
        <div style={styles.footer}>
          {totalPipes} pipe{totalPipes !== 1 ? 's' : ''} total
        </div>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    // Moved well below FloorVisibilityControls + FloorSelectorRail
    // which now occupy the top-right column down through ~top: 500.
    // Stacks with IsoCameraHUD to its left (top-left mid region).
    top: 16,
    left: 192,
    width: 180,
    padding: 10,
    borderRadius: 10,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 20,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 10,
    fontWeight: 700,
    color: '#eee',
    letterSpacing: 2,
  },
  allBtn: {
    fontSize: 9,
    fontWeight: 600,
    color: '#888',
    background: 'none',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
    letterSpacing: 1,
  },
  systemGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  systemBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '5px 8px',
    borderRadius: 6,
    border: '1px solid',
    background: 'rgba(255,255,255,0.03)',
    cursor: 'pointer',
    transition: 'opacity 0.15s, border-color 0.15s',
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 2,
    flexShrink: 0,
  },
  systemLabel: {
    fontSize: 11,
    color: '#ccc',
    flex: 1,
    textAlign: 'left' as const,
  },
  count: {
    fontSize: 9,
    color: '#777',
    minWidth: 16,
    textAlign: 'right' as const,
  },
  divider: {
    height: 1,
    background: '#222',
    margin: '8px 0',
  },
  compGroup: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  compBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid',
    background: 'none',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  compLabel: {
    fontSize: 9,
    color: '#aaa',
  },
  shortcut: {
    fontSize: 8,
    color: '#555',
    border: '1px solid #333',
    borderRadius: 3,
    padding: '0 3px',
    lineHeight: '14px',
  },
  footer: {
    marginTop: 8,
    fontSize: 9,
    color: '#555',
    textAlign: 'center' as const,
  },
};
