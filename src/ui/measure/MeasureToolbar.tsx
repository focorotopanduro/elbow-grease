/**
 * MeasureToolbar — horizontal HUD with all Phase 2.G tools:
 *
 *   [Walls ▾ type picker] [Ruler] [Scale] [Backdrop ▾ manage]
 *
 * Each tool has a keyboard shortcut displayed in its tooltip:
 *   W   wall draw       (cycle type with repeated press)
 *   R   ruler
 *   K   scale calibrate
 *   B   open backdrop panel
 *
 * Additional controls:
 *   - Wall type dropdown (5 types)
 *   - Wall opacity slider
 *   - Clear all unpinned measurements
 *   - Reset scale to 1.0
 *   - Upload backdrop file (hidden input)
 */

import { useRef, useState } from 'react';
import { useWallStore, WALL_TYPE_META, type WallType } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useBackdropStore, uploadBackdropFile } from '@store/backdropStore';

export function MeasureToolbar() {
  const drawSession = useWallStore((s) => s.drawSession);
  const beginWallDraw = useWallStore((s) => s.beginWallDraw);
  const cancelWallDraw = useWallStore((s) => s.cancelWallDraw);
  const showWalls = useWallStore((s) => s.showWallsGlobal);
  const toggleShowWalls = useWallStore((s) => s.toggleShowWalls);
  const wallOpacity = useWallStore((s) => s.wallOpacity);
  const setWallOpacity = useWallStore((s) => s.setWallOpacity);

  const measureMode = useMeasureStore((s) => s.mode);
  const setMeasureMode = useMeasureStore((s) => s.setMode);
  const measurements = useMeasureStore((s) => s.measurements);
  const clearUnpinned = useMeasureStore((s) => s.clearAllUnpinned);
  const scaleFactor = useMeasureStore((s) => s.scaleFactor);
  const resetScale = useMeasureStore((s) => s.resetScale);

  const backdrops = useBackdropStore((s) => s.backdrops);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showBackdropPanel, setShowBackdropPanel] = useState(false);

  const wallActive = drawSession !== null;
  const currentType: WallType = drawSession?.type ?? 'interior';

  const toggleWallDraw = (type: WallType) => {
    if (wallActive && drawSession?.type === type) cancelWallDraw();
    else beginWallDraw(type);
  };

  const toggleRuler = () => {
    setMeasureMode(measureMode === 'ruler' ? 'off' : 'ruler');
  };

  const toggleScale = () => {
    setMeasureMode(measureMode === 'scale' ? 'off' : 'scale');
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      try { await uploadBackdropFile(f); } catch (err) { console.error(err); }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 68,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 42,
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'linear-gradient(180deg, rgba(6,12,20,0.96) 0%, rgba(14,22,34,0.9) 100%)',
          border: '1px solid rgba(120,180,220,0.25)',
          borderRadius: 8,
          backdropFilter: 'blur(6px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          pointerEvents: 'auto',
        }}
      >
        {/* Walls */}
        <ToolChip
          active={wallActive}
          onClick={() => toggleWallDraw(currentType)}
          title="Draw walls — click-click, Esc to cancel [W]"
          color={WALL_TYPE_META[currentType].color}
        >
          🧱 Wall
        </ToolChip>
        <select
          value={currentType}
          onChange={(e) => {
            const t = e.target.value as WallType;
            if (wallActive) beginWallDraw(t);
          }}
          style={selectStyle(wallActive)}
          title="Wall type"
        >
          {Object.entries(WALL_TYPE_META).map(([id, meta]) => (
            <option key={id} value={id}>{meta.label} · {(meta.defaultThicknessFt * 12).toFixed(1)}″</option>
          ))}
        </select>
        <button
          onClick={toggleShowWalls}
          title={showWalls ? 'Hide walls' : 'Show walls'}
          style={iconBtnStyle(showWalls)}
        >
          {showWalls ? '◉' : '○'}
        </button>

        <Divider />

        {/* Ruler */}
        <ToolChip
          active={measureMode === 'ruler'}
          onClick={toggleRuler}
          title="Ruler — click two points [R]"
          color="#26c6da"
        >
          📐 Ruler
        </ToolChip>
        {Object.keys(measurements).length > 0 && (
          <button onClick={clearUnpinned} style={smallBtnStyle('#607d8b')} title="Clear unpinned">
            ✕ {Object.keys(measurements).length}
          </button>
        )}

        <Divider />

        {/* Scale */}
        <ToolChip
          active={measureMode === 'scale'}
          onClick={toggleScale}
          title="Calibrate scale — click two points, enter real distance [K]"
          color="#ef5350"
        >
          ⚖ Scale
        </ToolChip>
        {Math.abs(scaleFactor - 1) > 0.001 && (
          <div
            onClick={resetScale}
            title={`Scale factor: ${scaleFactor.toFixed(4)} — click to reset`}
            style={{
              padding: '5px 8px',
              background: 'rgba(239,83,80,0.12)',
              border: '1px solid rgba(239,83,80,0.5)',
              borderRadius: 4,
              color: '#ef5350',
              fontSize: 10,
              fontFamily: 'Consolas, monospace',
              cursor: 'pointer',
            }}
          >
            ×{scaleFactor.toFixed(3)}
          </div>
        )}

        <Divider />

        {/* Backdrop */}
        <ToolChip
          active={showBackdropPanel}
          onClick={() => setShowBackdropPanel((v) => !v)}
          title="Blueprint backdrop — upload image to trace over [B]"
          color="#ffd54f"
        >
          🖼 Backdrop
        </ToolChip>
        <button
          onClick={() => fileInputRef.current?.click()}
          style={smallBtnStyle('#ffd54f')}
          title="Upload PNG/JPG backdrop"
        >
          ＋
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
        {Object.keys(backdrops).length > 0 && (
          <span style={{ color: '#7fb8d0', fontSize: 10, padding: '5px 4px', fontFamily: 'Consolas, monospace' }}>
            {Object.keys(backdrops).length}
          </span>
        )}
      </div>

      {showBackdropPanel && <BackdropManagePanel onClose={() => setShowBackdropPanel(false)} />}

      {/* Wall opacity floater when wall is visible */}
      {showWalls && Object.keys(useWallStore.getState().walls).length > 0 && (
        <div
          style={{
            position: 'fixed',
            top: 112,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 42,
            padding: '4px 10px',
            background: 'rgba(6,12,20,0.9)',
            border: '1px solid rgba(120,180,220,0.2)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 10,
            color: '#7fb8d0',
            fontFamily: 'Consolas, monospace',
          }}
        >
          <span>WALL OPACITY</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={wallOpacity}
            onChange={(e) => setWallOpacity(parseFloat(e.target.value))}
            style={{ accentColor: '#7fb8d0', width: 80 }}
          />
          <span style={{ color: '#ffd54f' }}>{Math.round(wallOpacity * 100)}%</span>
        </div>
      )}
    </>
  );
}

// ── Backdrop manage panel ──────────────────────────────────────

function BackdropManagePanel({ onClose }: { onClose: () => void }) {
  const backdrops = useBackdropStore((s) => s.backdrops);
  const selectedId = useBackdropStore((s) => s.selectedId);
  const selectBackdrop = useBackdropStore((s) => s.selectBackdrop);
  const removeBackdrop = useBackdropStore((s) => s.removeBackdrop);
  const updateBackdrop = useBackdropStore((s) => s.updateBackdrop);
  const toggleLock = useBackdropStore((s) => s.toggleLock);
  const toggleHidden = useBackdropStore((s) => s.toggleHidden);

  const list = Object.values(backdrops);

  return (
    <div
      style={{
        position: 'fixed',
        top: 112,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 43,
        width: 360,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'linear-gradient(180deg, rgba(6,12,20,0.97) 0%, rgba(14,22,34,0.95) 100%)',
        border: '1px solid rgba(255,213,79,0.45)',
        borderRadius: 8,
        padding: 10,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        color: '#e0ecf3',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 11, color: '#ffd54f', letterSpacing: 1, fontWeight: 600 }}>
          BLUEPRINT BACKDROPS
        </span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#ff8080', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>
      {list.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: '#7fb8d0' }}>
          Upload a PNG/JPG using the ＋ button.<br />
          Then use the Scale tool to calibrate.
        </div>
      )}
      {list.map((b) => (
        <div
          key={b.id}
          onClick={() => selectBackdrop(b.id)}
          style={{
            padding: '8px 10px',
            marginBottom: 6,
            background: b.id === selectedId ? 'rgba(255,213,79,0.1)' : 'rgba(30,45,60,0.5)',
            border: `1px solid ${b.id === selectedId ? '#ffd54f' : 'rgba(120,180,220,0.2)'}`,
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: b.id === selectedId ? '#ffd54f' : '#e0ecf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {b.name}
            </span>
            <button onClick={(e) => { e.stopPropagation(); toggleHidden(b.id); }} style={tinyBtn} title={b.hidden ? 'Show' : 'Hide'}>
              {b.hidden ? '⊘' : '◉'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); toggleLock(b.id); }} style={tinyBtn} title={b.locked ? 'Unlock' : 'Lock'}>
              {b.locked ? '🔒' : '🔓'}
            </button>
            <button onClick={(e) => { e.stopPropagation(); removeBackdrop(b.id); }} style={{ ...tinyBtn, color: '#ef5350' }} title="Remove">
              🗑
            </button>
          </div>
          <div style={{ fontSize: 9, color: '#7fb8d0', fontFamily: 'Consolas, monospace', marginTop: 2 }}>
            {b.pixelWidth}×{b.pixelHeight}px · {b.widthFt.toFixed(1)}′×{b.depthFt.toFixed(1)}′
          </div>
          {b.id === selectedId && (
            <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 50px', gap: 4, marginTop: 6, alignItems: 'center', fontSize: 9, fontFamily: 'Consolas, monospace' }}>
              <span style={{ color: '#b8cbd7' }}>Opacity</span>
              <input type="range" min={0.05} max={1} step={0.05} value={b.opacity}
                onChange={(e) => updateBackdrop(b.id, { opacity: parseFloat(e.target.value) })}
                style={{ accentColor: '#ffd54f' }}
                onClick={(e) => e.stopPropagation()} />
              <span style={{ color: '#ffd54f', textAlign: 'right' }}>{Math.round(b.opacity * 100)}%</span>

              <span style={{ color: '#b8cbd7' }}>Rotate</span>
              <input type="range" min={-Math.PI} max={Math.PI} step={Math.PI / 60} value={b.rotationY}
                onChange={(e) => updateBackdrop(b.id, { rotationY: parseFloat(e.target.value) })}
                style={{ accentColor: '#ffd54f' }}
                onClick={(e) => e.stopPropagation()} />
              <span style={{ color: '#ffd54f', textAlign: 'right' }}>{(b.rotationY * 180 / Math.PI).toFixed(0)}°</span>

              <span style={{ color: '#b8cbd7' }}>Width</span>
              <input type="number" value={b.widthFt.toFixed(2)} step={0.5}
                onChange={(e) => {
                  const w = parseFloat(e.target.value);
                  if (w > 0) {
                    const aspect = b.depthFt / b.widthFt;
                    updateBackdrop(b.id, { widthFt: w, depthFt: w * aspect });
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={numInput} />
              <span style={{ color: '#ffd54f', textAlign: 'right' }}>ft</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Shared chip / button styles ────────────────────────────────

function ToolChip({ active, onClick, title, color, children }: { active: boolean; onClick: () => void; title: string; color: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 10px',
        background: active ? `linear-gradient(135deg, ${color}cc, ${color}88)` : 'rgba(30,45,60,0.6)',
        border: `1px solid ${active ? color : 'rgba(120,180,220,0.25)'}`,
        borderRadius: 5,
        color: active ? '#fff' : color,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.5,
        cursor: 'pointer',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
        boxShadow: active ? `0 0 8px ${color}55` : 'none',
        transition: 'all 120ms',
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, background: 'rgba(120,180,220,0.2)', margin: '2px 4px' }} />;
}

function selectStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 6px',
    background: 'rgba(30,45,60,0.7)',
    border: `1px solid ${active ? '#7fb8d0' : 'rgba(120,180,220,0.25)'}`,
    borderRadius: 4,
    color: '#cfe4ef',
    fontSize: 10,
    fontFamily: 'Consolas, monospace',
    cursor: 'pointer',
  };
}

function iconBtnStyle(on: boolean): React.CSSProperties {
  return {
    padding: '5px 8px',
    background: on ? 'rgba(38,198,218,0.2)' : 'rgba(30,45,60,0.6)',
    border: `1px solid ${on ? '#4dd0e1' : 'rgba(120,180,220,0.25)'}`,
    borderRadius: 4,
    color: on ? '#4dd0e1' : '#7fb8d0',
    cursor: 'pointer',
    fontSize: 11,
  };
}

function smallBtnStyle(color: string): React.CSSProperties {
  return {
    padding: '5px 8px',
    background: `${color}22`,
    border: `1px solid ${color}66`,
    borderRadius: 4,
    color,
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'Consolas, monospace',
  };
}

const tinyBtn: React.CSSProperties = {
  background: 'rgba(30,45,60,0.6)',
  border: '1px solid rgba(120,180,220,0.2)',
  borderRadius: 3,
  color: '#7fb8d0',
  cursor: 'pointer',
  padding: '2px 6px',
  fontSize: 10,
};

const numInput: React.CSSProperties = {
  background: 'rgba(8,14,22,0.85)',
  border: '1px solid rgba(120,180,220,0.25)',
  color: '#e0ecf3',
  padding: '2px 6px',
  borderRadius: 3,
  fontFamily: 'Consolas, monospace',
  fontSize: 10,
  outline: 'none',
};
