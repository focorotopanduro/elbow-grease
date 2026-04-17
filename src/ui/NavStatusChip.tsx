/**
 * NavStatusChip — persistent top-center HUD showing the three things
 * that control whether orbit camera works:
 *
 *   [MODE: Navigate/Draw/Select] [CAM: Perspective/Top/...] [ORBIT: ON/OFF]
 *
 * When orbit is OFF, the chip shows WHY (which of the three conditions
 * isn't met) so you can fix it with one click. Each segment is
 * clickable to restore the needed state.
 */

import { useInteractionStore } from '@store/interactionStore';
import { useIsoCameraStore } from '@ui/cameras/IsoCamera';
import { usePipeStore } from '@store/pipeStore';
import { useCustomerStore } from '@store/customerStore';

export function NavStatusChip() {
  const mode = useInteractionStore((s) => s.mode);
  const setMode = useInteractionStore((s) => s.setMode);
  const cameraMode = useIsoCameraStore((s) => s.mode);
  const setCameraMode = useIsoCameraStore((s) => s.setMode);
  const pivoting = usePipeStore((s) => s.pivotSession !== null);
  const pending = useCustomerStore((s) => s.pendingFixture);
  const setPending = useCustomerStore((s) => s.setPendingFixture);

  // Camera controls always active unless a pipe-pivot is happening.
  //   Perspective       → rotate + pan + zoom
  //   Top/Front/Side/Iso → pan + zoom only (rotate locked for drafting)
  const canMove = !pivoting;
  const canRotate = cameraMode === 'perspective' && !pivoting;

  return (
    <div
      style={{
        position: 'fixed',
        top: 192,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        display: 'flex',
        gap: 4,
        padding: 4,
        background: 'rgba(6,12,20,0.92)',
        border: `1px solid ${canMove ? '#66bb6a' : '#ef5350'}`,
        borderRadius: 8,
        fontFamily: 'Consolas, monospace',
        fontSize: 10,
        pointerEvents: 'auto',
        boxShadow: canMove ? '0 0 10px rgba(102,187,106,0.35)' : '0 0 10px rgba(239,83,80,0.35)',
      }}
    >
      {/* MODE segment */}
      <button
        onClick={() => setMode('navigate')}
        title="Interaction mode — Navigate lets you orbit the camera"
        style={segStyle(mode === 'navigate', '#66bb6a')}
      >
        {mode === 'navigate' ? '◉' : '○'} NAV
      </button>

      {/* CAMERA segment */}
      <button
        onClick={() => setCameraMode('perspective')}
        title="Camera view — Perspective is the only one that lets you orbit"
        style={segStyle(cameraMode === 'perspective', '#4fc3f7')}
      >
        {cameraMode === 'perspective' ? '◉' : '○'} {cameraMode.toUpperCase().slice(0, 5)}
      </button>

      {/* PENDING fixture warning (blocks clicks even in navigate mode) */}
      {pending && (
        <button
          onClick={() => setPending(null)}
          title="A fixture is pending placement — clicks drop that fixture, not orbit"
          style={{ ...segStyle(false, '#ffa726'), cursor: 'pointer' }}
        >
          ✕ PENDING: {pending.variant}
        </button>
      )}

      {/* PIVOT warning */}
      {pivoting && (
        <div style={segStyle(false, '#ffa726')}>⚠ PIVOT</div>
      )}

      {/* Camera-control verdict */}
      <div
        style={{
          ...segStyle(canMove, canMove ? '#66bb6a' : '#ef5350'),
          fontWeight: 700,
          pointerEvents: 'none',
        }}
      >
        {!canMove
          ? '■ CAMERA LOCKED'
          : canRotate
            ? '▶ ORBIT · L-drag rotate · R-drag pan · wheel zoom'
            : '▶ PAN + ZOOM · R-drag pan · wheel zoom · (rotate locked in this view)'}
      </div>
    </div>
  );
}

function segStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: '5px 10px',
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? color : 'rgba(120,180,220,0.2)'}`,
    borderRadius: 4,
    color: active ? color : '#7a8592',
    cursor: 'pointer',
    fontFamily: 'Consolas, monospace',
    fontSize: 10,
    letterSpacing: 1,
    whiteSpace: 'nowrap',
  };
}
