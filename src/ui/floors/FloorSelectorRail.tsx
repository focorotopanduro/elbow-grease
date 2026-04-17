/**
 * FloorSelectorRail — vertical right-edge UI for floor switching.
 *
 * Shows every defined floor stacked top→bottom (highest floor at top,
 * matching physical orientation). Each tile displays:
 *   - Floor icon (emoji)
 *   - Floor name + elevation range
 *   - Pipe count badge (spanning pipes count toward each floor they touch)
 *   - Total run length on that floor
 *   - Per-floor hide toggle (eye icon)
 *   - Active highlight (glowing accent ring + color-matched border)
 *
 * Interactions:
 *   - Click tile       → setActiveFloor(id)
 *   - Click eye icon   → toggleFloorHidden(id) (doesn't change active)
 *   - Shift+click      → Solo this floor (active + hide all others)
 *   - Right-click      → (reserved for per-floor context menu)
 *
 * Reactive to:
 *   - pipeStore.pipes  → re-aggregates counts
 *   - floorStore       → re-highlights active / hidden state
 */

import { useMemo } from 'react';
import { useFloorStore } from '@store/floorStore';
import { usePipeStore } from '@store/pipeStore';
import { aggregatePipesPerFloor } from '@core/floor/FloorResolver';

// ── Styling tokens ──────────────────────────────────────────────

const RAIL_WIDTH = 188;
const TILE_GAP = 6;

const baseTileStyle: React.CSSProperties = {
  position: 'relative',
  background: 'linear-gradient(135deg, rgba(8,14,22,0.92) 0%, rgba(16,24,36,0.86) 100%)',
  border: '1px solid rgba(120, 180, 220, 0.22)',
  borderRadius: 8,
  padding: '8px 10px',
  marginBottom: TILE_GAP,
  cursor: 'pointer',
  transition: 'transform 90ms ease, box-shadow 120ms ease, border-color 120ms ease',
  color: '#cfe4ef',
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  userSelect: 'none',
  backdropFilter: 'blur(4px)',
};

// ── Component ──────────────────────────────────────────────────

export function FloorSelectorRail() {
  const floors = useFloorStore((s) => s.floors);
  const activeFloorId = useFloorStore((s) => s.activeFloorId);
  const hiddenFloorIds = useFloorStore((s) => s.hiddenFloorIds);
  const setActiveFloor = useFloorStore((s) => s.setActiveFloor);
  const toggleFloorHidden = useFloorStore((s) => s.toggleFloorHidden);
  const pipes = usePipeStore((s) => s.pipes);

  // Sort highest-elevation first (matches physical building orientation)
  const ordered = useMemo(
    () => Object.values(floors).sort((a, b) => b.order - a.order),
    [floors],
  );

  const aggregates = useMemo(
    () => aggregatePipesPerFloor(Object.values(pipes)),
    [pipes],
  );

  const handleTileClick = (id: string, shiftKey: boolean) => {
    setActiveFloor(id);
    if (shiftKey) {
      // Solo: hide everything except this one
      const st = useFloorStore.getState();
      for (const f of Object.values(st.floors)) {
        const isHidden = st.hiddenFloorIds.has(f.id);
        if (f.id === id && isHidden) st.toggleFloorHidden(f.id);
        else if (f.id !== id && !isHidden) st.toggleFloorHidden(f.id);
      }
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        // Top 260 clears FloorVisibilityControls (top 12 + ~240 tall
        // when the ghost-opacity slider is expanded).
        top: 260,
        right: 12,
        width: RAIL_WIDTH,
        zIndex: 40,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: '#6a8fa8',
          padding: '0 4px 6px',
          fontFamily: 'Consolas, monospace',
        }}
      >
        ◢ FLOORS
      </div>

      {ordered.map((floor) => {
        const isActive = floor.id === activeFloorId;
        const isHidden = hiddenFloorIds.has(floor.id);
        const agg = aggregates.get(floor.id);
        const pipeCount = agg?.pipeCount ?? 0;
        const lengthFt = agg?.totalLengthFt ?? 0;

        const tileStyle: React.CSSProperties = {
          ...baseTileStyle,
          borderColor: isActive
            ? floor.color
            : isHidden
              ? 'rgba(255, 80, 80, 0.4)'
              : baseTileStyle.border as string,
          boxShadow: isActive
            ? `0 0 18px ${hexToRgba(floor.color, 0.55)}, inset 0 0 14px ${hexToRgba(floor.color, 0.18)}`
            : '0 2px 6px rgba(0, 0, 0, 0.35)',
          opacity: isHidden ? 0.45 : 1,
          transform: isActive ? 'translateX(-4px) scale(1.02)' : 'none',
        };

        return (
          <div
            key={floor.id}
            style={tileStyle}
            onClick={(e) => handleTileClick(floor.id, e.shiftKey)}
            onMouseEnter={(e) => {
              if (!isActive) e.currentTarget.style.borderColor = hexToRgba(floor.color, 0.6);
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.borderColor = 'rgba(120, 180, 220, 0.22)';
            }}
            title={`${floor.name} (${floor.elevationBase}' to ${floor.elevationTop}')${isActive ? ' — ACTIVE' : ''}${isHidden ? ' — HIDDEN' : ''}\nShift+Click to solo`}
          >
            {/* Color accent bar */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 6,
                bottom: 6,
                width: 3,
                background: floor.color,
                borderRadius: 2,
                boxShadow: isActive ? `0 0 8px ${floor.color}` : 'none',
              }}
            />

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 8 }}>
              <div style={{ fontSize: 18, filter: isActive ? `drop-shadow(0 0 4px ${floor.color})` : 'none' }}>
                {floor.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: isActive ? floor.color : '#d6e8f0',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: isActive ? `0 0 6px ${hexToRgba(floor.color, 0.8)}` : 'none',
                  }}
                >
                  {floor.name}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: '#7a92a3',
                    fontFamily: 'Consolas, monospace',
                    letterSpacing: 0.5,
                  }}
                >
                  {floor.elevationBase}'–{floor.elevationTop}' · {(floor.elevationTop - floor.elevationBase).toFixed(0)}ft
                </div>
              </div>

              {/* Eye toggle (hidden per floor) */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFloorHidden(floor.id);
                }}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 12,
                  background: isHidden ? 'rgba(255,80,80,0.15)' : 'rgba(80,160,200,0.1)',
                  border: `1px solid ${isHidden ? 'rgba(255,80,80,0.45)' : 'rgba(80,160,200,0.25)'}`,
                  cursor: 'pointer',
                }}
                title={isHidden ? 'Floor hidden — click to show' : 'Hide floor'}
              >
                {isHidden ? '⊘' : '◉'}
              </div>
            </div>

            {/* Stats row */}
            <div
              style={{
                marginTop: 6,
                paddingLeft: 8,
                display: 'flex',
                gap: 10,
                fontSize: 10,
                color: '#8aa0b1',
                fontFamily: 'Consolas, monospace',
              }}
            >
              <span style={{ color: pipeCount > 0 ? floor.color : '#4a5a6a' }}>
                ▰ {pipeCount}
              </span>
              <span>⟷ {lengthFt.toFixed(1)}ft</span>
            </div>

            {/* Active pulse */}
            {isActive && (
              <div
                style={{
                  position: 'absolute',
                  inset: -1,
                  borderRadius: 9,
                  border: `1px solid ${hexToRgba(floor.color, 0.4)}`,
                  pointerEvents: 'none',
                  animation: 'floorPulse 2.2s ease-in-out infinite',
                }}
              />
            )}
          </div>
        );
      })}

      <style>{`
        @keyframes floorPulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.015); }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
