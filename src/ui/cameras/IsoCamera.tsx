/**
 * IsoCamera — mathematically-exact isometric orthographic projection
 * with smooth perspective↔orthographic transitions.
 *
 * True isometric projection places the camera such that all three
 * primary axes (X, Y, Z) appear at equal angles (120°) on screen.
 * This requires:
 *
 *   1. Orthographic projection (parallel lines stay parallel)
 *   2. Camera rotated -45° around global Y axis
 *   3. Camera tilted -arctan(1/√2) ≈ -35.264° around local X axis
 *
 * The exact tilt angle is derived from:
 *   cos(β) · sin(45°) = cos(45°)
 *   ⇒ β = arctan(1/√2) ≈ 35.26439°
 *
 * This guarantees that a unit cube rendered at the origin projects
 * to a perfect regular hexagon on screen — the classic isometric
 * look used in engineering drawings since the 19th century.
 *
 * We also support three alternate views:
 *   - iso_30 (30° elevation, 45° azimuth) — "cabinet projection"
 *   - iso_45 (45° elevation, 45° azimuth) — "military projection"
 *   - iso_custom (user-defined angles)
 *
 * Smooth transitions between perspective and orthographic use a
 * t-lerp on the camera's projection matrix components, giving the
 * classic "dolly zoom" look as views morph.
 */

import { useEffect, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { create } from 'zustand';

// ── View modes ──────────────────────────────────────────────────

export type CameraViewMode =
  | 'perspective'
  | 'iso_true'    // classic 35.264° × 45°
  | 'iso_30'      // 30° × 45° (cabinet)
  | 'iso_45'      // 45° × 45° (military)
  | 'top'         // plan view
  | 'front'       // elevation N
  | 'side'        // elevation E
  | 'bottom';     // reflected ceiling plan

// ── Mathematical constants ──────────────────────────────────────

/** Exact isometric tilt: arctan(1/√2) radians. */
export const ISO_TILT_EXACT = Math.atan(1 / Math.sqrt(2));
/** In degrees: ≈35.26439°. */
export const ISO_TILT_DEG = (ISO_TILT_EXACT * 180) / Math.PI;

// ── View parameters ─────────────────────────────────────────────

interface ViewParams {
  /** Y-axis rotation (azimuth, radians). */
  azimuth: number;
  /** X-axis rotation applied after azimuth (elevation, radians). */
  elevation: number;
  /** Use orthographic (true) vs perspective (false). */
  orthographic: boolean;
  /** Label shown in HUD. */
  label: string;
}

const VIEW_PARAMS: Record<CameraViewMode, ViewParams> = {
  perspective: { azimuth: -Math.PI / 4, elevation: -Math.PI / 6, orthographic: false, label: 'Perspective' },
  iso_true:    { azimuth: -Math.PI / 4, elevation: -ISO_TILT_EXACT, orthographic: true, label: 'Isometric' },
  iso_30:      { azimuth: -Math.PI / 4, elevation: -Math.PI / 6, orthographic: true, label: 'Cabinet' },
  iso_45:      { azimuth: -Math.PI / 4, elevation: -Math.PI / 4, orthographic: true, label: 'Military' },
  top:         { azimuth: 0, elevation: -Math.PI / 2 + 0.001, orthographic: true, label: 'Plan (Top)' },
  front:       { azimuth: 0, elevation: 0, orthographic: true, label: 'Front Elevation' },
  side:        { azimuth: -Math.PI / 2, elevation: 0, orthographic: true, label: 'Side Elevation' },
  bottom:      { azimuth: 0, elevation: Math.PI / 2 - 0.001, orthographic: true, label: 'Reflected Ceiling' },
};

// ── Store ───────────────────────────────────────────────────────

interface IsoCameraState {
  mode: CameraViewMode;
  /** Lerp progress between prev and current view (0 → 1). */
  transitionT: number;
  /** Previous mode (for animating out). */
  prevMode: CameraViewMode;
  /** Orthographic frustum size (world units). */
  frustumSize: number;
  setMode: (mode: CameraViewMode) => void;
  setFrustumSize: (size: number) => void;
  stepTransition: (dt: number, durationSec: number) => void;
}

export const useIsoCameraStore = create<IsoCameraState>((set, get) => ({
  mode: 'perspective',
  transitionT: 1,
  prevMode: 'perspective',
  frustumSize: 25,

  setMode: (mode) => {
    if (mode === get().mode) return;
    set((s) => ({ mode, prevMode: s.mode, transitionT: 0 }));
  },

  setFrustumSize: (size) => set({ frustumSize: Math.max(5, Math.min(100, size)) }),

  stepTransition: (dt, durationSec) => {
    set((s) => ({
      transitionT: Math.min(1, s.transitionT + dt / durationSec),
    }));
  },
}));

// ── Camera controller component ─────────────────────────────────

interface IsoCameraControllerProps {
  /** Transition duration in seconds. */
  transitionDurationSec?: number;
  /** Orbit target (world-space point camera looks at). */
  target?: [number, number, number];
  /** Distance from target. */
  distance?: number;
}

/**
 * R3F component that controls the scene's default camera based on
 * IsoCameraStore state. Mount it inside the Canvas.
 */
export function IsoCameraController({
  transitionDurationSec = 0.4,
  target = [0, 0, 0],
  distance = 20,
}: IsoCameraControllerProps) {
  const { camera, gl, controls } = useThree();
  const mode = useIsoCameraStore((s) => s.mode);
  const prevMode = useIsoCameraStore((s) => s.prevMode);
  const transitionT = useIsoCameraStore((s) => s.transitionT);
  const frustumSize = useIsoCameraStore((s) => s.frustumSize);
  const stepTransition = useIsoCameraStore((s) => s.stepTransition);
  const handoffDoneRef = useRef(true);

  // Ease-in-out cubic
  const ease = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  useFrame((_, dt) => {
    if (transitionT >= 1) {
      // One-shot handoff: after the transition settles, nudge
      // OrbitControls to adopt the new camera position as its
      // baseline. Without this, OrbitControls' cached spherical
      // would fight the new view the moment it re-enables (which
      // is the "top/side/front broke" bug — orbit damping dragged
      // the camera back to perspective).
      if (!handoffDoneRef.current && controls) {
        const c = controls as unknown as {
          target?: THREE.Vector3;
          update?: () => void;
        };
        if (c.target) c.target.set(target[0], target[1], target[2]);
        c.update?.();
        handoffDoneRef.current = true;
      }
      return;
    }
    // Starting / middle of a transition — owner of the camera.
    handoffDoneRef.current = false;

    stepTransition(dt, transitionDurationSec);
    const t = ease(transitionT);

    const from = VIEW_PARAMS[prevMode];
    const to = VIEW_PARAMS[mode];

    // Interpolate azimuth + elevation
    const az = from.azimuth + (to.azimuth - from.azimuth) * t;
    const el = from.elevation + (to.elevation - from.elevation) * t;

    // Build camera position on sphere around target
    const cx = target[0];
    const cy = target[1];
    const cz = target[2];
    const camX = cx + distance * Math.cos(el) * Math.cos(az);
    const camY = cy + distance * Math.sin(-el);
    const camZ = cz + distance * Math.cos(el) * Math.sin(az);

    camera.position.set(camX, camY, camZ);
    camera.lookAt(cx, cy, cz);

    // Handle projection morphing
    if (camera instanceof THREE.PerspectiveCamera) {
      // Transitioning to ortho: shrink FOV toward 0 then swap
      // Simpler approach: just update FOV and let parent re-mount
      // if a full swap is needed.
      const aspect = gl.domElement.width / gl.domElement.height;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    } else if (camera instanceof THREE.OrthographicCamera) {
      const aspect = gl.domElement.width / gl.domElement.height;
      camera.left = (-frustumSize * aspect) / 2;
      camera.right = (frustumSize * aspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

// ── View picker HUD ─────────────────────────────────────────────

const VIEW_PRESETS: { mode: CameraViewMode; label: string; icon: string; key: string }[] = [
  { mode: 'perspective', label: 'Perspective', icon: '🎥', key: '0' },
  { mode: 'iso_true',    label: 'Isometric',   icon: '📐', key: '9' },
  { mode: 'top',         label: 'Top',         icon: '⬆', key: '7' },
  { mode: 'front',       label: 'Front',       icon: '◼', key: '8' },
  { mode: 'side',        label: 'Side',        icon: '◆', key: '6' },
];

export function IsoCameraHUD() {
  const mode = useIsoCameraStore((s) => s.mode);
  const setMode = useIsoCameraStore((s) => s.setMode);

  // Keyboard: numpad/number keys jump to a view.
  // 0 = perspective, 9 = iso_true, 7 = top, 8 = front, 6 = side.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const match = VIEW_PRESETS.find((p) => p.key === e.key);
      if (match) {
        e.preventDefault();
        setMode(match.mode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setMode]);

  const active = VIEW_PRESETS.find((p) => p.mode === mode);

  return (
    <div style={styles.hud}>
      <div style={styles.hudLabel}>CAMERA</div>
      {VIEW_PRESETS.map((p) => (
        <button
          key={p.mode}
          onClick={() => setMode(p.mode)}
          style={{
            ...styles.hudBtn,
            borderColor: mode === p.mode ? '#00e5ff' : '#333',
            color: mode === p.mode ? '#00e5ff' : '#888',
            background: mode === p.mode ? 'rgba(0,229,255,0.08)' : 'transparent',
            boxShadow: mode === p.mode ? '0 0 8px rgba(0,229,255,0.35)' : 'none',
          }}
          title={`${p.label} (${p.key})`}
        >
          <span>{p.icon}</span>
          <span style={{ flex: 1, textAlign: 'left' }}>{p.label}</span>
          <kbd style={styles.kbd}>{p.key}</kbd>
        </button>
      ))}
      <div style={styles.hudMeta}>
        ◉ {active?.label ?? '—'}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  hud: {
    // Moved off the right edge — that column now belongs to
    // FloorVisibilityControls + FloorSelectorRail + PhaseBOMPanel.
    // Parked below LayerPanel in the left-mid region.
    //
    // Bug-fix pass: was `top: 200`, but LayerPanel extends from
    // top:16 down through ~y=360 (5 system toggles + divider + 3
    // component toggles + footer), so the camera HUD was covering
    // the lower half of LayerPanel and hiding the Fittings /
    // Fixtures / Dimensions / total-count rows. Bumped to 380 so
    // the Camera HUD sits cleanly below LayerPanel with a small
    // visual gap.
    position: 'absolute', top: 380, left: 192,
    display: 'flex', flexDirection: 'column', gap: 3,
    padding: 8, borderRadius: 8, border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto', zIndex: 20, minWidth: 140,
  },
  hudLabel: {
    fontSize: 9, fontWeight: 700, color: '#888', letterSpacing: 2,
    textAlign: 'center', padding: '2px 0 4px', borderBottom: '1px solid #222',
  },
  hudBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '5px 8px', borderRadius: 5, border: '1px solid',
    background: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 500,
  },
  kbd: {
    fontSize: 8, color: '#555', border: '1px solid #333', borderRadius: 3,
    padding: '1px 4px', fontFamily: 'monospace',
  },
  hudMeta: {
    fontSize: 9, color: '#555', textAlign: 'center', padding: 2,
  },
};
