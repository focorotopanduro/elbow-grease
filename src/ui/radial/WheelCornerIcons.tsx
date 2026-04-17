/**
 * WheelCornerIcons — persistent corner-anchored access points for the
 * three weapon wheels.
 *
 * Three icons occupy the screen corners:
 *
 *   DRAWING           bottom-right   pipe pen icon
 *   FIXTURE           bottom-center  plumbing fixture icon (top of the
 *                                    lower edge for thumb-reach feel)
 *   CUSTOMER_EDIT     top-right      gear icon (edit-mode of fixtures)
 *
 * When the user clicks (or hovers long enough), the corresponding wheel
 * opens via openWheelAt, passing the icon's center as the wheelOrigin.
 * The wheel then grows from that corner rather than the screen center,
 * creating an "unfolding" game-menu feel.
 *
 * Each icon also renders:
 *   - Chord hint (e.g. "Ctrl + Space") on hover
 *   - Last-selected sector icon as a mini preview ring
 *   - Pulse animation when the corresponding chord fires
 *   - Disabled/greyed when wheel is already open (prevents re-click)
 *
 * Holding a corner icon for > 350ms opens the wheel WITHOUT committing,
 * letting the user "peek" at available options before committing with
 * a click.
 */

import { useRef, useState, useEffect } from 'react';
import { useRadialMenuStore } from '@store/radialMenuStore';

// ── Icon definitions ──────────────────────────────────────────

interface IconDef {
  id: 'drawing' | 'fixture' | 'customer_edit';
  label: string;
  icon: string;
  hint: string;
  chord: string;
  color: string;
  position: 'bottom_right' | 'bottom_left' | 'top_right_under_badge';
}

const ICONS: IconDef[] = [
  {
    id: 'drawing',
    label: 'DRAWING',
    icon: '✒',
    hint: 'Pipe material / diameter',
    chord: 'Ctrl + Space',
    color: '#4fc3f7',
    position: 'bottom_right',
  },
  {
    id: 'fixture',
    label: 'FIXTURES',
    icon: '🚽',
    hint: 'Place plumbing fixtures',
    chord: 'Ctrl + F',
    color: '#ffd54f',
    position: 'bottom_left',
  },
  {
    id: 'customer_edit',
    label: 'CUSTOMER',
    icon: '⚙',
    hint: 'Edit customer fixture templates',
    chord: 'Ctrl + E, F',
    color: '#26c6da',
    position: 'top_right_under_badge',
  },
];

// ── Component ─────────────────────────────────────────────────

export function WheelCornerIcons() {
  const activeId = useRadialMenuStore((s) => s.activeWheelId);
  const openWheelAt = useRadialMenuStore((s) => s.openWheelAt);

  return (
    <>
      {ICONS.map((def) => (
        <CornerIcon
          key={def.id}
          def={def}
          disabled={activeId !== null}
          onActivate={(x, y) => openWheelAt(def.id, x, y)}
        />
      ))}
    </>
  );
}

// ── Individual corner icon ────────────────────────────────────

function CornerIcon({
  def, disabled, onActivate,
}: {
  def: IconDef;
  disabled: boolean;
  onActivate: (x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const lastSectorId = useRadialMenuStore((s) => s.memory[def.id]?.lastSectorId ?? null);
  const lastCommittedLabel = useRadialMenuStore((s) => s.lastCommittedLabel);
  const isActive = useRadialMenuStore((s) => s.activeWheelId === def.id);
  const [chordPulse, setChordPulse] = useState(false);

  // Pulse when wheel opens (even if opened via chord)
  useEffect(() => {
    if (isActive) {
      setChordPulse(true);
      const t = setTimeout(() => setChordPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [isActive]);

  const fire = () => {
    if (disabled) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    onActivate(cx, cy);
  };

  const onPointerDown = () => {
    setPressed(true);
    holdTimerRef.current = window.setTimeout(() => {
      fire();
      holdTimerRef.current = null;
    }, 350);
  };

  const onPointerUp = () => {
    setPressed(false);
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      fire(); // tap fires immediately on release if hold timer hadn't triggered
    }
  };

  return (
    <div
      ref={ref}
      style={{ ...positionStyle(def.position), pointerEvents: disabled ? 'none' : 'auto' }}
    >
      {/* Hint chip (appears on hover) */}
      {hovered && !disabled && (
        <div style={hintChipStyle(def)}>
          <div style={{ fontWeight: 600, color: def.color }}>{def.label}</div>
          <div style={{ color: '#b8cbd7', marginTop: 2 }}>{def.hint}</div>
          <div style={{ color: '#7fb8d0', marginTop: 4, fontFamily: 'Consolas, monospace', fontSize: 9 }}>
            [{def.chord}]
          </div>
        </div>
      )}

      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => { setHovered(false); setPressed(false); if (holdTimerRef.current !== null) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; } }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { setPressed(false); if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; } }}
        style={{
          ...iconButtonStyle(def, hovered, pressed, disabled, chordPulse),
        }}
      >
        {/* Ring around icon */}
        <div style={ringStyle(def, hovered, chordPulse)} />

        {/* Icon glyph */}
        <span style={{
          fontSize: 22,
          filter: hovered || chordPulse ? `drop-shadow(0 0 6px ${def.color})` : 'none',
          transform: pressed ? 'scale(0.9)' : 'scale(1)',
          transition: 'transform 120ms cubic-bezier(0.4, 2.2, 0.3, 1.2)',
          zIndex: 1,
          position: 'relative',
        }}>
          {def.icon}
        </span>

        {/* Last-selected mini preview */}
        {lastSectorId && lastCommittedLabel && hovered && (
          <div style={miniPreviewStyle(def.color)}>
            ↻ {lastCommittedLabel}
          </div>
        )}

        {/* Chord pulse ripple */}
        {chordPulse && <div style={chordRippleStyle(def.color)} />}
      </div>

      {/* Chord hint always shown (small) */}
      {!disabled && (
        <div style={chordHintStyle(def.position, def.color)}>
          {def.chord}
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

function positionStyle(pos: IconDef['position']): React.CSSProperties {
  const base: React.CSSProperties = { position: 'fixed', zIndex: 50 };
  switch (pos) {
    case 'bottom_right':
      // Offset 320px so we clear the PhaseBOMPanel (width 290 + margin).
      return { ...base, right: 320, bottom: 16 };
    case 'bottom_left':
      // Offset 360px so we clear CustomerBadge (maxWidth 320 + gap).
      return { ...base, left: 360, bottom: 16 };
    case 'top_right_under_badge':
      // Offset 220px clears FloorVisibilityControls (width 188 + margin).
      return { ...base, right: 220, top: 16 };
  }
}

function iconButtonStyle(def: IconDef, hovered: boolean, pressed: boolean, disabled: boolean, pulse: boolean): React.CSSProperties {
  const size = hovered ? 58 : 52;
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: disabled
      ? 'rgba(30,45,60,0.4)'
      : `radial-gradient(circle, ${def.color}22 0%, rgba(8,14,22,0.95) 70%)`,
    border: `1.5px solid ${disabled ? 'rgba(80,100,120,0.3)' : def.color}aa`,
    boxShadow: disabled
      ? 'none'
      : hovered
        ? `0 0 20px ${def.color}99, 0 4px 12px rgba(0,0,0,0.6), inset 0 0 14px ${def.color}33`
        : pulse
          ? `0 0 30px ${def.color}, 0 4px 10px rgba(0,0,0,0.6)`
          : `0 0 10px ${def.color}44, 0 4px 8px rgba(0,0,0,0.5)`,
    color: disabled ? '#4a5a6a' : def.color,
    userSelect: 'none',
    position: 'relative',
    transition: 'width 180ms cubic-bezier(0.2, 1.6, 0.4, 1), height 180ms cubic-bezier(0.2, 1.6, 0.4, 1), box-shadow 120ms',
    opacity: disabled ? 0.35 : 1,
    transform: pressed ? 'translateY(1px)' : 'translateY(0)',
  };
}

function ringStyle(def: IconDef, hovered: boolean, pulse: boolean): React.CSSProperties {
  // Only animate the spinning ring while hovered or pulsing. When
  // idle, keep a static dashed border — same look, zero compositor cost.
  const animate = hovered || pulse;
  return {
    position: 'absolute',
    inset: -4,
    borderRadius: '50%',
    border: `1px dashed ${def.color}66`,
    opacity: animate ? 1 : 0.5,
    animation: pulse
      ? 'wheelCornerPulse 600ms ease-out'
      : hovered
        ? 'wheelCornerSpin 14s linear infinite'
        : 'none',
  };
}

function hintChipStyle(def: IconDef): React.CSSProperties {
  return {
    position: 'absolute',
    bottom: 72,
    right: 0,
    minWidth: 160,
    padding: '8px 12px',
    background: 'linear-gradient(180deg, rgba(8,14,22,0.97), rgba(14,22,34,0.95))',
    border: `1px solid ${def.color}88`,
    borderRadius: 6,
    boxShadow: `0 4px 14px rgba(0,0,0,0.5), 0 0 14px ${def.color}44`,
    color: '#e0ecf3',
    fontSize: 11,
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    pointerEvents: 'none',
    animation: 'wheelCornerFadeIn 180ms ease-out',
  };
}

function chordHintStyle(pos: IconDef['position'], color: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    fontFamily: 'Consolas, monospace',
    fontSize: 8,
    letterSpacing: 1,
    color: color,
    opacity: 0.6,
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };
  if (pos === 'bottom_right' || pos === 'top_right_under_badge') {
    return { ...base, right: 58, top: '50%', transform: 'translateY(-50%)' };
  }
  return { ...base, left: 58, top: '50%', transform: 'translateY(-50%)' };
}

function miniPreviewStyle(color: string): React.CSSProperties {
  return {
    position: 'absolute',
    top: -22,
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: 9,
    padding: '2px 6px',
    background: 'rgba(8,14,22,0.9)',
    border: `1px solid ${color}88`,
    borderRadius: 3,
    color,
    fontFamily: 'Consolas, monospace',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  };
}

function chordRippleStyle(color: string): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: `2px solid ${color}`,
    pointerEvents: 'none',
    animation: 'wheelCornerRipple 600ms ease-out forwards',
  };
}

// Inject global keyframes once
if (typeof document !== 'undefined' && !document.getElementById('wheel-corner-keyframes')) {
  const style = document.createElement('style');
  style.id = 'wheel-corner-keyframes';
  style.textContent = `
    @keyframes wheelCornerSpin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }
    @keyframes wheelCornerPulse {
      0%   { transform: scale(1); opacity: 1; }
      100% { transform: scale(1.6); opacity: 0; }
    }
    @keyframes wheelCornerFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes wheelCornerRipple {
      0%   { transform: scale(1);   opacity: 0.8; }
      100% { transform: scale(1.8); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
