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
 *
 * ─── Workspace-aware styling ─────────────────────────────────
 *
 * In plumbing mode: right-anchored (right: 12) — sits above the
 * FloorSelectorRail in the right column. Glass-morphism pairs with
 * the cyan-forward plumbing chrome.
 *
 * In roofing mode: left-anchored (left: 272, past the RoofingToolbar)
 * — the right column belongs to the RoofingInspector (420px wide,
 * right: 12). Active-state accent shifts from cyan to AMBER
 * (`SHARED_CHROME_ACCENTS.roofing`) so the view-mode panel reads as
 * "utility chrome", visually distinct from the orange roofing
 * primary accent.
 */

import { useFloorStore, type FloorVisibilityMode } from '@store/floorStore';
import { useAppModeStore, SHARED_CHROME_ACCENTS } from '@store/appModeStore';

const MODES: { id: FloorVisibilityMode; label: string; icon: string; tip: string }[] = [
  { id: 'all',         label: 'ALL',   icon: '▦', tip: 'All floors full brightness' },
  { id: 'ghost',       label: 'GHOST', icon: '◍', tip: 'Other floors dimmed' },
  { id: 'active_only', label: 'SOLO',  icon: '◉', tip: 'Only active floor' },
];

/** Derive a second accent tint (lighter / more glowy) from the base
 *  chrome accent. Simple hex → hsl lightness bump so we don't need a
 *  second palette constant per mode. */
function lightenHex(hex: string, amount = 0.18): string {
  const raw = hex.replace(/^#/, '');
  const long = raw.length === 3
    ? raw[0]! + raw[0]! + raw[1]! + raw[1]! + raw[2]! + raw[2]!
    : raw;
  const r = parseInt(long.slice(0, 2), 16);
  const g = parseInt(long.slice(2, 4), 16);
  const b = parseInt(long.slice(4, 6), 16);
  const lr = Math.min(255, Math.round(r + (255 - r) * amount));
  const lg = Math.min(255, Math.round(g + (255 - g) * amount));
  const lb = Math.min(255, Math.round(b + (255 - b) * amount));
  return `rgb(${lr},${lg},${lb})`;
}

/** Hex → rgba. Same helper shape as IsoCameraHUD's — kept local so
 *  each component owns its own color adapter. */
function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace(/^#/, '');
  const long = raw.length === 3
    ? raw[0]! + raw[0]! + raw[1]! + raw[1]! + raw[2]! + raw[2]!
    : raw;
  const r = parseInt(long.slice(0, 2), 16);
  const g = parseInt(long.slice(2, 4), 16);
  const b = parseInt(long.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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

  const appMode = useAppModeStore((s) => s.mode);
  const chromeAccent = SHARED_CHROME_ACCENTS[appMode];
  const chromeAccentLight = lightenHex(chromeAccent, 0.25);

  const clearHidden = () => {
    const st = useFloorStore.getState();
    const ids = [...st.hiddenFloorIds];
    ids.forEach((id) => st.toggleFloorHidden(id));
  };

  // Workspace-aware anchor: right side in plumbing, left side in
  // roofing (where the RoofingInspector owns the right column).
  const anchorStyle: React.CSSProperties = appMode === 'roofing'
    ? { left: 272, top: 12 }
    : { right: 12, top: 12 };

  return (
    <div
      style={{
        position: 'fixed',
        ...anchorStyle,
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
          border: `1px solid ${hexToRgba(chromeAccent, 0.28)}`,
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
            color: hexToRgba(chromeAccent, 0.65),
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
                    ? `linear-gradient(135deg, ${chromeAccent} 0%, ${chromeAccentLight} 100%)`
                    : 'rgba(30, 45, 60, 0.6)',
                  border: `1px solid ${isActive ? chromeAccentLight : hexToRgba(chromeAccent, 0.25)}`,
                  borderRadius: 5,
                  padding: '6px 0',
                  // Active tab uses dark text on bright accent (both cyan
                  // and amber pass WCAG AAA against #0a0a0f). Inactive
                  // stays muted.
                  color: isActive ? '#0a0a0f' : '#8aa0b1',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 1,
                  cursor: 'pointer',
                  boxShadow: isActive ? `0 0 10px ${hexToRgba(chromeAccentLight, 0.6)}` : 'none',
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
              <span style={{ color: chromeAccentLight }}>{Math.round(ghostOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={ghostOpacity}
              onChange={(e) => setGhostOpacity(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: chromeAccent }}
            />
          </div>
        )}

        {/* Checkboxes */}
        <ToggleRow
          label="Floor planes"
          checked={showPlanes}
          onChange={togglePlanes}
          accent={chromeAccent}
          accentLight={chromeAccentLight}
        />
        <ToggleRow
          label="Constrain draw"
          checked={constrainDraw}
          onChange={toggleConstrain}
          accent={chromeAccent}
          accentLight={chromeAccentLight}
        />

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
  accent,
  accentLight,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  accent: string;
  accentLight: string;
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
          background: checked ? accent : 'rgba(60, 75, 90, 0.6)',
          border: `1px solid ${checked ? accentLight : hexToRgba(accent, 0.3)}`,
          position: 'relative',
          transition: 'background 120ms ease',
          boxShadow: checked ? `0 0 6px ${hexToRgba(accentLight, 0.6)}` : 'none',
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
