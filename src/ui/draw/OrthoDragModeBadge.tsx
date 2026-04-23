/**
 * OrthoDragModeBadge — Phase 14.AD.27.
 *
 * Small corner indicator showing the user:
 *   • Which orthographic view is active (TOP / FRONT / SIDE / BOTTOM)
 *   • Whether ortho click-drag mode is currently engaged
 *   • The Shift+O keyboard hint for the toggle
 *
 * Stays invisible in perspective / isometric views. When ortho-drag
 * is OFF (classic draw tool mode), the badge grays out and shows the
 * hint so the user can find the toggle quickly. When ON, the badge
 * colors itself with the view's accent so it reads as "this view is
 * in CAD-draw mode, grab a pipe to extend / branch".
 *
 * DOM overlay (not in Canvas) so it renders crisply at any zoom.
 */

import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { useIsoCameraStore } from '@ui/cameras/IsoCamera';

// ── View-mode accents (match IsoCamera.tsx's palette spirit) ─────

const VIEW_ACCENT: Record<string, { label: string; color: string }> = {
  top:    { label: 'TOP',    color: '#00e5ff' },
  front:  { label: 'FRONT',  color: '#ff9800' },
  side:   { label: 'SIDE',   color: '#7c4dff' },
  bottom: { label: 'BOTTOM', color: '#ef5350' },
};

export function OrthoDragModeBadge() {
  const cameraMode = useIsoCameraStore((s) => s.mode);
  const orthoClickDrag = usePlumbingDrawStore((s) => s.orthoClickDragMode);
  const toggle = usePlumbingDrawStore((s) => s.toggleOrthoClickDragMode);

  const accent = VIEW_ACCENT[cameraMode];
  if (!accent) return null; // not an ortho view

  const active = orthoClickDrag;
  const bg = active ? `${accent.color}22` : '#1a1a2066';
  const fg = active ? accent.color : '#888';
  const border = active ? accent.color : '#333';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: '8px 14px',
        color: fg,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        lineHeight: 1.4,
        userSelect: 'none',
        cursor: 'pointer',
        backdropFilter: 'blur(4px)',
        zIndex: 100,
        minWidth: 160,
      }}
      onClick={toggle}
      title="Toggle CAD click-drag mode (Shift+O)"
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{ fontWeight: 600, letterSpacing: 1, fontSize: 11 }}>
          {accent.label}
        </span>
        <span style={{
          padding: '2px 8px',
          background: active ? accent.color : '#0006',
          color: active ? '#000' : fg,
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          {active ? 'DRAG ON' : 'DRAG OFF'}
        </span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, opacity: 0.7 }}>
        {active
          ? 'Drag pipe mid → branch · end → extend'
          : 'Click to enable · ⇧O'}
      </div>
    </div>
  );
}
