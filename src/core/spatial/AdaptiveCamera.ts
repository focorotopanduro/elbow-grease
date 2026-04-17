/**
 * Adaptive Camera — intelligent desktop 3D camera that reduces
 * the cognitive tax of visuospatial transformation.
 *
 * Instead of a dumb orbit camera, this system:
 *   - Auto-frames the active work area when routing
 *   - Smoothly transitions between overview and detail views
 *   - Provides "snap views" (top, front, iso) via keyboard
 *   - Tracks the user's focus region and keeps it centered
 *   - Disables itself in VR (HMD is the camera)
 *
 * The goal: the user never fights the camera. It anticipates
 * where they need to look based on FSM state.
 */

import { eventBus } from '../EventBus';
import { EV, type Vec3, type StateTransitionPayload } from '../events';

// ── Preset views ────────────────────────────────────────────────

export interface CameraPreset {
  position: Vec3;
  target: Vec3;
  fov: number;
  label: string;
}

export const CAMERA_PRESETS: Record<string, CameraPreset> = {
  iso: {
    position: [8, 10, 8],
    target: [0, 0, 0],
    fov: 50,
    label: 'Isometric',
  },
  top: {
    position: [0, 15, 0.01],
    target: [0, 0, 0],
    fov: 45,
    label: 'Top Down',
  },
  front: {
    position: [0, 4, 12],
    target: [0, 2, 0],
    fov: 50,
    label: 'Front',
  },
  side: {
    position: [12, 4, 0],
    target: [0, 2, 0],
    fov: 50,
    label: 'Side',
  },
  detail: {
    position: [3, 3, 3],
    target: [0, 0, 0],
    fov: 35,
    label: 'Detail',
  },
};

// ── Camera state ────────────────────────────────────────────────

export interface CameraState {
  position: Vec3;
  target: Vec3;
  fov: number;
  /** Current lerp progress (0 = at start, 1 = at destination). */
  t: number;
  /** Where we're lerping from. */
  fromPosition: Vec3;
  fromTarget: Vec3;
  fromFov: number;
  /** Whether a transition is active. */
  transitioning: boolean;
  /** Transition duration in seconds. */
  duration: number;
}

export const CAMERA_EV = {
  TRANSITION_START: 'camera:transition:start',
  TRANSITION_END:   'camera:transition:end',
  PRESET_APPLIED:   'camera:preset',
} as const;

// ── Adaptive logic ──────────────────────────────────────────────

export class AdaptiveCamera {
  state: CameraState;
  private enabled = true;

  constructor() {
    const iso = CAMERA_PRESETS.iso!;
    this.state = {
      position: [...iso.position],
      target: [...iso.target],
      fov: iso.fov,
      t: 1,
      fromPosition: [...iso.position],
      fromTarget: [...iso.target],
      fromFov: iso.fov,
      transitioning: false,
      duration: 0.6,
    };
    this.wireEvents();
  }

  /** Disable adaptive behavior (e.g. when entering VR). */
  disable(): void {
    this.enabled = false;
  }

  enable(): void {
    this.enabled = true;
  }

  /** Smoothly transition to a preset view. */
  applyPreset(name: string): void {
    const preset = CAMERA_PRESETS[name];
    if (!preset) return;
    this.transitionTo(preset.position, preset.target, preset.fov);
    eventBus.emit(CAMERA_EV.PRESET_APPLIED, { name, label: preset.label });
  }

  /** Smoothly transition to an arbitrary position/target. */
  transitionTo(position: Vec3, target: Vec3, fov?: number): void {
    this.state.fromPosition = [...this.state.position];
    this.state.fromTarget = [...this.state.target];
    this.state.fromFov = this.state.fov;
    this.state.position = [...position];
    this.state.target = [...target];
    this.state.fov = fov ?? this.state.fov;
    this.state.t = 0;
    this.state.transitioning = true;
    eventBus.emit(CAMERA_EV.TRANSITION_START, null);
  }

  /** Auto-frame a bounding box (e.g. the active route). */
  frameRegion(min: Vec3, max: Vec3, padding = 2): void {
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const dx = max[0] - min[0] + padding;
    const dy = max[1] - min[1] + padding;
    const dz = max[2] - min[2] + padding;
    const dist = Math.max(dx, dy, dz) * 1.2;

    this.transitionTo(
      [cx + dist * 0.6, cy + dist * 0.8, cz + dist * 0.6],
      [cx, cy, cz],
    );
  }

  /**
   * Call each frame with deltaTime. Returns interpolated camera values.
   * The R3F component reads these to update the Three.js camera.
   */
  tick(dt: number): { position: Vec3; target: Vec3; fov: number } {
    if (this.state.transitioning) {
      this.state.t = Math.min(1, this.state.t + dt / this.state.duration);
      const e = this.easeOutCubic(this.state.t);

      if (this.state.t >= 1) {
        this.state.transitioning = false;
        eventBus.emit(CAMERA_EV.TRANSITION_END, null);
      }

      return {
        position: this.lerp3(this.state.fromPosition, this.state.position, e),
        target: this.lerp3(this.state.fromTarget, this.state.target, e),
        fov: this.state.fromFov + (this.state.fov - this.state.fromFov) * e,
      };
    }

    return {
      position: [...this.state.position],
      target: [...this.state.target],
      fov: this.state.fov,
    };
  }

  // ── FSM-driven auto-framing ─────────────────────────────────

  private wireEvents(): void {
    eventBus.on<StateTransitionPayload>(EV.STATE_TRANSITION, (payload) => {
      if (!this.enabled) return;

      switch (payload.to) {
        case 'routing':
          // Zoom in slightly for detail work
          this.applyPreset('detail');
          break;
        case 'previewing':
          // Pull back to show the full route
          this.applyPreset('iso');
          break;
        case 'idle':
          if (payload.from === 'confirming') {
            // After commit, return to overview
            this.applyPreset('iso');
          }
          break;
      }
    });
  }

  // ── Math helpers ──────────────────────────────────────────────

  private easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  private lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }
}

export const adaptiveCamera = new AdaptiveCamera();
