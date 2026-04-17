/**
 * FloorVisibilityControls — global floor visibility HUD.
 *
 * Sits above the FloorSelectorRail. Exposes:
 *
 *   [ALL]    [GHOST]    [SOLO]   ← visibility mode segmented toggle
 *   [Ghost opacity slider]       ← only when in GHOST mode
 *   [Floor planes ▢]             ← horizontal reference outlines on/off
 *   [Constrain draw ▢]           ← snap drawing Y to active floor
 *   [Reset hidden]               ← re-show any individually-hidden floors
 *
 * Visibility modes semantics:
 *   ALL   — every floor rendered at full brightness
 *   GHOST — active floor full, others dimmed + desaturated
 *   SOLO  — only active floor rendered; others completely hidden
 */

import { useFloorStore, type FloorVisibilityMode } from '@store/floorStore';

const MODES: { id: FloorVisibilityMode; label: string; icon: string; tip: string }[] = [
  { id: 'all',         label: 'ALL',   icon: '▦', tip: 'All floors full brightness' },
  { id: 'ghost',       label: 'GHOST', icon: '◍', tip: 'Other floors dimmed' },
  { id: 'active_only', label: 'SOLO',  icon: '◉', tip: 'Only active floor' },
];

export function FloorVisibilityControls() {
  const mode = useFloorStore((s) => s.visibilityMode);
  const setMode = useFloorStore((s) => s.setVisibilityMode);
  const ghostOpacity = useFloorStore((s) => s.ghostOpacity);
  const setGhostOpacity = useFloorStore((s) => s.setGhostOpacity);
  const showPlanes = useFloorStore((s) => s.showFloorPlanes);
  const togglePlanes = useFloorStore((s) => s.toggleShowFloorPlanes);
  const constrainDraw = useFloorStore((s) => s.constrainDrawToActiveFloor);
  const toggleConstrain = useFloorStore((s) => s.toggleConstrainDraw);
  const hiddenCount = useFloorStore((s) => s.hiddenFloorIds.size);

  const clearHidden = () => {
    const st = useFloorStore.getState();
    const ids = [...st.hiddenFloorIds];
    ids.forEach((id) => st.toggleFloorHidden(id));
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        width: 188,
        zIndex: 41,
        pointerEvents: 'auto',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        color: '#cfe4ef',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, rgba(6,12,20,0.95) 0%, rgba(14,22,34,0.9) 100%)',
          border: '1px solid rgba(120, 180, 220, 0.28)',
          borderRadius: 8,
          padding: 10,
          backdropFilter: 'blur(6px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: '#6a8fa8',
            marginBottom: 8,
            fontFamily: 'Consolas, monospace',
          }}
        >
          ◢ VIEW MODE
        </div>

        {/* Segmented mode toggle */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 3,
            marginBottom: 10,
          }}
        >
          {MODES.map((m) => {
            const isActive = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.tip}
                style={{
                  background: isActive
                    ? 'linear-gradient(135deg, #1e88e5 0%, #00bcd4 100%)'
                    : 'rgba(30, 45, 60, 0.6)',
                  border: `1px solid ${isActive ? '#4fc3f7' : 'rgba(120,180,220,0.25)'}`,
                  borderRadius: 5,
                  padding: '6px 0',
                  color: isActive ? '#fff' : '#8aa0b1',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 1,
                  cursor: 'pointer',
                  boxShadow: isActive ? '0 0 10px rgba(79,195,247,0.6)' : 'none',
                  transition: 'all 120ms ease',
                }}
              >
                <div style={{ fontSize: 13 }}>{m.icon}</div>
                <div>{m.label}</div>
              </button>
            );
          })}
        </div>

        {/* Ghost opacity slider */}
        {mode === 'ghost' && (
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 9,
                color: '#8aa0b1',
                marginBottom: 4,
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: 'Consolas, monospace',
              }}
            >
              <span>GHOST OPACITY</span>
              <span style={{ color: '#4fc3f7' }}>{Math.round(ghostOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={ghostOpacity}
              onChange={(e) => setGhostOpacity(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#4fc3f7' }}
            />
          </div>
        )}

        {/* Checkboxes */}
        <ToggleRow label="Floor planes" checked={showPlanes} onChange={togglePlanes} />
        <ToggleRow label="Constrain draw" checked={constrainDraw} onChange={toggleConstrain} />

        {hiddenCount > 0 && (
          <button
            onClick={clearHidden}
            style={{
              marginTop: 8,
              width: '100%',
              padding: '5px 0',
              background: 'rgba(255,100,100,0.12)',
              border: '1px solid rgba(255,100,100,0.35)',
              borderRadius: 4,
              color: '#ff8080',
              fontSize: 10,
              letterSpacing: 1,
              cursor: 'pointer',
              fontFamily: 'Consolas, monospace',
            }}
            title={`Restore ${hiddenCount} hidden floor${hiddenCount > 1 ? 's' : ''}`}
          >
            ✕ CLEAR {hiddenCount} HIDDEN
          </button>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div
      onClick={onChange}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        cursor: 'pointer',
        fontSize: 11,
        color: checked ? '#cfe4ef' : '#7a92a3',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 28,
          height: 14,
          borderRadius: 7,
          background: checked ? '#1e88e5' : 'rgba(60, 75, 90, 0.6)',
          border: `1px solid ${checked ? '#4fc3f7' : 'rgba(120,180,220,0.3)'}`,
          position: 'relative',
          transition: 'background 120ms ease',
          boxShadow: checked ? '0 0 6px rgba(79,195,247,0.6)' : 'none',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: checked ? 14 : 1,
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: checked ? '#fff' : '#8aa0b1',
            transition: 'left 120ms ease',
          }}
        />
      </span>
    </div>
  );
}
