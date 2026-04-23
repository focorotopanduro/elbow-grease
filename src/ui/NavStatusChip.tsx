/**
 * NavStatusChip — compact top-center status indicator.
 *
 * Bug-fix pass: was previously a ~500 px-wide persistent bar with a
 * tutorial-style "▶ ORBIT · L-drag rotate · R-drag pan · wheel zoom"
 * string that the user correctly called out as intrusive. Collapsed
 * now into:
 *
 *   • Two tiny dots (NAV / CAM). Click either to snap back to default.
 *   • Warnings only appear when state is ABNORMAL (pending fixture,
 *     non-navigate mode, non-perspective camera, pivot lock).
 *   • The verbose help string is gone from the persistent HUD — it
 *     now lives in the hover tooltip of each chip, so new users can
 *     still discover bindings but existing users aren't nagged.
 */

import { useState } from 'react';
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

  const [expanded, setExpanded] = useState(false);

  const modeOk = mode === 'navigate';
  const camOk = cameraMode === 'perspective';
  const anomaly = !modeOk || !camOk || !!pending || pivoting;

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        display: 'flex',
        gap: 3,
        padding: '2px 4px',
        background: anomaly ? 'rgba(239,83,80,0.12)' : 'rgba(6,12,20,0.5)',
        border: `1px solid ${anomaly ? 'rgba(239,83,80,0.5)' : 'rgba(120,180,220,0.15)'}`,
        borderRadius: 12,
        fontFamily: 'Consolas, monospace',
        fontSize: 9,
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* MODE dot */}
      <button
        onClick={() => setMode('navigate')}
        title={`Mode: ${mode}. Click to switch to Navigate (orbit-ready).`}
        style={dotStyle(modeOk, '#66bb6a', expanded)}
      >
        {expanded ? (modeOk ? 'NAV' : mode.toUpperCase()) : (modeOk ? '●' : '○')}
      </button>

      {/* CAMERA dot */}
      <button
        onClick={() => setCameraMode('perspective')}
        title={`Camera: ${cameraMode}. Click to switch to Perspective (rotate-enabled).`}
        style={dotStyle(camOk, '#4fc3f7', expanded)}
      >
        {expanded ? cameraMode.toUpperCase().slice(0, 5) : (camOk ? '●' : '○')}
      </button>

      {/* Warnings (always visible, even collapsed) */}
      {pending && (
        <button
          onClick={() => setPending(null)}
          title="A fixture is pending placement — clicks drop that fixture. Click here to cancel."
          style={warnStyle('#ffa726')}
        >
          ✕ {pending.variant}
        </button>
      )}
      {pivoting && (
        <div style={warnStyle('#ffa726')}>⚠ PIVOT</div>
      )}

      {/* Expanded help (hover only) */}
      {expanded && !pending && !pivoting && (
        <div style={helpStyle}>
          {modeOk && camOk
            ? 'L-drag rotate · R-drag pan · wheel zoom'
            : modeOk
              ? 'Ortho view — pan + zoom (no rotate)'
              : 'Not in Navigate mode — click NAV to restore orbit'}
        </div>
      )}
    </div>
  );
}

function dotStyle(active: boolean, color: string, expanded: boolean): React.CSSProperties {
  return {
    padding: expanded ? '2px 6px' : '1px 4px',
    background: active ? `${color}22` : 'transparent',
    border: `1px solid ${active ? color : 'rgba(120,180,220,0.25)'}`,
    borderRadius: 8,
    color: active ? color : '#7a8592',
    cursor: 'pointer',
    fontFamily: 'Consolas, monospace',
    fontSize: 9,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
    minWidth: expanded ? 34 : 16,
    textAlign: 'center',
    transition: 'min-width 0.12s ease',
  };
}

function warnStyle(color: string): React.CSSProperties {
  return {
    padding: '1px 6px',
    background: `${color}22`,
    border: `1px solid ${color}`,
    borderRadius: 8,
    color,
    cursor: 'pointer',
    fontFamily: 'Consolas, monospace',
    fontSize: 9,
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  };
}

const helpStyle: React.CSSProperties = {
  padding: '1px 8px',
  color: '#7a8592',
  fontSize: 9,
  letterSpacing: 0.3,
  whiteSpace: 'nowrap',
  fontStyle: 'italic',
};
