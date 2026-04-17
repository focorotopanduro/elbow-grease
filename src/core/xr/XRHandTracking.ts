/**
 * XR Hand Tracking — maps hand joints and gestures to pipe interactions.
 *
 * Leverages WebXR Hand Input to detect:
 *   - Pinch (thumb + index) → select / grab pipe node
 *   - Pinch drag → route pipe along hand movement
 *   - Release → finalize pipe segment
 *   - Open palm → cancel / deselect
 *   - Point (index extended) → aim raycast for distant selection
 *
 * Falls back to controller ray + trigger when hand tracking is unavailable.
 * All gesture outputs are normalized into a GestureEvent that the
 * SpatialPipeInteraction system consumes via EventBus.
 */

import { eventBus } from '../EventBus';
import type { Vec3 } from '../events';

// ── Gesture events ──────────────────────────────────────────────

export const GESTURE_EV = {
  PINCH_START:    'gesture:pinch:start',
  PINCH_MOVE:     'gesture:pinch:move',
  PINCH_END:      'gesture:pinch:end',
  POINT_RAY:      'gesture:point:ray',
  OPEN_PALM:      'gesture:palm:open',
  GRIP_SQUEEZE:   'gesture:grip:squeeze',
  GRIP_RELEASE:   'gesture:grip:release',
} as const;

export type Handedness = 'left' | 'right';

export interface PinchPayload {
  hand: Handedness;
  position: Vec3;
  direction: Vec3;
  strength: number; // 0–1 pinch tightness
}

export interface PointRayPayload {
  hand: Handedness;
  origin: Vec3;
  direction: Vec3;
}

export interface PalmPayload {
  hand: Handedness;
  position: Vec3;
  normal: Vec3;
}

// ── Joint indices (WebXR hand joint enum) ───────────────────────

const THUMB_TIP = 4;
const INDEX_TIP = 9;
const MIDDLE_TIP = 14;
const WRIST = 0;

// ── Tracking processor ─────────────────────────────────────────

interface HandState {
  wasPinching: boolean;
  pinchStartPos: Vec3 | null;
}

export class XRHandTracker {
  private states: Record<Handedness, HandState> = {
    left:  { wasPinching: false, pinchStartPos: null },
    right: { wasPinching: false, pinchStartPos: null },
  };

  /** Pinch distance threshold in meters. */
  private pinchThreshold = 0.025;
  /** Point detection: middle finger must be curled while index is extended. */
  private pointCurlThreshold = 0.06;

  /**
   * Call each frame with the current XR frame and reference space.
   * Processes both hands and emits gesture events.
   */
  processFrame(frame: XRFrame, refSpace: XRReferenceSpace, sources: XRInputSourceArray): void {
    for (const source of sources) {
      if (!source.hand) continue;
      const hand = source.handedness as Handedness;
      if (hand !== 'left' && hand !== 'right') continue;

      this.processHand(frame, refSpace, source.hand, hand);
    }
  }

  /**
   * Fallback: process controller input (trigger = pinch, grip = grab).
   */
  processController(source: XRInputSource, frame: XRFrame, refSpace: XRReferenceSpace): void {
    const pose = frame.getPose(source.targetRaySpace, refSpace);
    if (!pose) return;

    const hand = (source.handedness === 'left' ? 'left' : 'right') as Handedness;
    const pos = pose.transform.position;
    const dir = pose.transform.orientation;

    const origin: Vec3 = [pos.x, pos.y, pos.z];
    // Forward direction from quaternion
    const qx = dir.x, qy = dir.y, qz = dir.z, qw = dir.w;
    const fwd: Vec3 = [
      2 * (qx * qz + qw * qy),
      2 * (qy * qz - qw * qx),
      1 - 2 * (qx * qx + qy * qy),
    ];

    // Emit ray for pointing
    eventBus.emit<PointRayPayload>(GESTURE_EV.POINT_RAY, {
      hand,
      origin,
      direction: fwd,
    });

    // Check gamepad for trigger/grip
    if (source.gamepad) {
      const trigger = source.gamepad.buttons[0];
      const grip = source.gamepad.buttons[1];

      if (trigger?.pressed) {
        const state = this.states[hand];
        if (!state.wasPinching) {
          state.wasPinching = true;
          state.pinchStartPos = origin;
          eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_START, {
            hand, position: origin, direction: fwd, strength: trigger.value,
          });
        } else {
          eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_MOVE, {
            hand, position: origin, direction: fwd, strength: trigger.value,
          });
        }
      } else if (this.states[hand].wasPinching) {
        this.states[hand].wasPinching = false;
        eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_END, {
          hand, position: origin, direction: fwd, strength: 0,
        });
      }

      if (grip?.pressed) {
        eventBus.emit(GESTURE_EV.GRIP_SQUEEZE, { hand, position: origin });
      }
    }
  }

  // ── Internal ────────────────────────────────────────────────

  private processHand(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    hand: XRHand,
    handedness: Handedness,
  ): void {
    const thumbTip = this.getJointPosition(frame, refSpace, hand, THUMB_TIP);
    const indexTip = this.getJointPosition(frame, refSpace, hand, INDEX_TIP);
    const middleTip = this.getJointPosition(frame, refSpace, hand, MIDDLE_TIP);
    const wrist = this.getJointPosition(frame, refSpace, hand, WRIST);

    if (!thumbTip || !indexTip || !wrist) return;

    // ── Pinch detection ───────────────────────────────────────
    const pinchDist = this.distance(thumbTip, indexTip);
    const isPinching = pinchDist < this.pinchThreshold;
    const pinchPos = this.midpoint(thumbTip, indexTip);
    const pinchDir = this.normalize(this.subtract(indexTip, wrist));
    const state = this.states[handedness];

    if (isPinching && !state.wasPinching) {
      state.wasPinching = true;
      state.pinchStartPos = pinchPos;
      eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_START, {
        hand: handedness, position: pinchPos, direction: pinchDir,
        strength: 1 - pinchDist / this.pinchThreshold,
      });
    } else if (isPinching && state.wasPinching) {
      eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_MOVE, {
        hand: handedness, position: pinchPos, direction: pinchDir,
        strength: 1 - pinchDist / this.pinchThreshold,
      });
    } else if (!isPinching && state.wasPinching) {
      state.wasPinching = false;
      eventBus.emit<PinchPayload>(GESTURE_EV.PINCH_END, {
        hand: handedness, position: pinchPos, direction: pinchDir, strength: 0,
      });
    }

    // ── Point detection (index extended, middle curled) ──────
    if (middleTip && !isPinching) {
      const middleCurl = this.distance(middleTip, wrist);
      const indexExtend = this.distance(indexTip, wrist);
      if (indexExtend > middleCurl + this.pointCurlThreshold) {
        eventBus.emit<PointRayPayload>(GESTURE_EV.POINT_RAY, {
          hand: handedness,
          origin: indexTip,
          direction: pinchDir,
        });
      }
    }

    // ── Open palm detection (all fingers extended, no pinch) ─
    if (!isPinching && middleTip) {
      const allExtended = this.distance(indexTip, wrist) > 0.12 &&
                          this.distance(middleTip, wrist) > 0.12;
      if (allExtended) {
        const palmNormal = this.normalize(this.cross(
          this.subtract(indexTip, wrist),
          this.subtract(middleTip, wrist),
        ));
        eventBus.emit<PalmPayload>(GESTURE_EV.OPEN_PALM, {
          hand: handedness,
          position: wrist,
          normal: palmNormal,
        });
      }
    }
  }

  private getJointPosition(
    frame: XRFrame,
    refSpace: XRReferenceSpace,
    hand: XRHand,
    jointIndex: number,
  ): Vec3 | null {
    const joints = [...hand.values()];
    const joint = joints[jointIndex];
    if (!joint) return null;

    const pose = frame.getJointPose?.(joint, refSpace);
    if (!pose) return null;

    const p = pose.transform.position;
    return [p.x, p.y, p.z];
  }

  // ── Vec3 math helpers ───────────────────────────────────────

  private distance(a: Vec3, b: Vec3): number {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private midpoint(a: Vec3, b: Vec3): Vec3 {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  }

  private subtract(a: Vec3, b: Vec3): Vec3 {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }

  private normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
    return [v[0] / len, v[1] / len, v[2] / len];
  }

  private cross(a: Vec3, b: Vec3): Vec3 {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
}

export const handTracker = new XRHandTracker();
