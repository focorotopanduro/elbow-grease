/**
 * SpringArmController — runtime spring-arm camera boom.
 *
 * Mounts inside the R3F Canvas. Each frame it:
 *   1. Reads OrbitControls' target + the camera's current position.
 *   2. Hands them to `computeSpringArm` along with a raycaster that
 *      intersects the `collidables` set (meshes tagged
 *      `userData.cameraCollidable = true`).
 *   3. Lerps the actual camera distance toward the clamped distance
 *      via an exponential ease (~150 ms time constant) so clamps feel
 *      like a physical spring instead of a snap.
 *
 * Runs at `useFrame` priority 1 so OrbitControls (priority 0 / default)
 * updates FIRST and we post-process its output. Without this the
 * spring arm and OrbitControls would fight over camera.position.
 *
 * Feature-flag gated (`springArmCamera`, default off). A collision-
 * aware camera is ideal for close fixture inspection, less ideal
 * for top-down CAD where it would constantly clamp on the floor
 * plane. Users who want it for walk-mode style navigation toggle it
 * via the God Mode flags panel.
 *
 * No changes to OrbitControls itself — this is a pure overlay.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  computeSpringArm,
  lerpDistance,
  easeAlpha,
  type Vec3,
} from '@core/camera/springArm';
import { useFeatureFlagStore } from '@store/featureFlagStore';

// ── Tuning constants ──────────────────────────────────────────

const TIME_CONSTANT_SEC = 0.15;   // springiness — smaller = snappier
const MIN_DISTANCE = 0.5;          // clamp floor (feet)
const PADDING = 0.05;              // pull back 5% of desired on hit
const PERP_OFFSET = 0.1;           // corner-ray offset (feet)
const MAX_RECURSIVE_DEPTH = true;  // raycaster recurses into children

// ── Component ──────────────────────────────────────────────────

export function SpringArmController() {
  const enabled = useFeatureFlagStore((s) => s.springArmCamera);

  const { camera, scene, controls } = useThree();

  // Cached raycaster + scratch vectors. One allocation; reused every
  // frame. The spring arm is a 5-ray post-process at 60 Hz; per-frame
  // allocations would dominate its own cost.
  const raycaster = useMemo(() => {
    const r = new THREE.Raycaster();
    // Near 0.001 so the raycast starts from the target position, not
    // skipping objects very close to it.
    r.near = 0.001;
    return r;
  }, []);
  const scratchOrigin = useMemo(() => new THREE.Vector3(), []);
  const scratchDir = useMemo(() => new THREE.Vector3(), []);
  const scratchTarget = useMemo(() => new THREE.Vector3(), []);
  const scratchCamPos = useMemo(() => new THREE.Vector3(), []);

  // Current smoothed distance. Starts matching camera's position-to-target
  // so the first frame doesn't snap.
  const currentDistance = useRef<number | null>(null);

  // When the flag flips off, reset so re-enabling starts clean.
  useEffect(() => {
    if (!enabled) currentDistance.current = null;
  }, [enabled]);

  // Collect collidable meshes once per second (rescanning every frame is
  // wasteful). A mesh opts in via `userData.cameraCollidable = true`.
  // Fallback if none are tagged: walk the whole scene — collisions may
  // flicker against small props, but the user has an escape hatch
  // (disable the flag).
  const collidables = useRef<THREE.Object3D[]>([]);
  useEffect(() => {
    if (!enabled) return;
    const rescan = () => {
      const list: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh && obj.userData?.cameraCollidable === true) {
          list.push(obj);
        }
      });
      // Fallback: if nobody opted in, collide against the whole scene.
      // Better than nothing, but emits warnings in verbose mode.
      collidables.current = list.length > 0 ? list : [scene];
    };
    rescan();
    const id = window.setInterval(rescan, 1000);
    return () => window.clearInterval(id);
  }, [enabled, scene]);

  useFrame((_, dt) => {
    if (!enabled) return;

    // Orthographic cameras are distance-invariant — shrinking the boom
    // has no visual effect and would risk parking the camera inside
    // geometry. Spring arm only matters for perspective views.
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return;

    // Controls may be null briefly on first render.
    const orbit = controls as unknown as { target?: THREE.Vector3 } | null;
    if (!orbit?.target) return;

    scratchTarget.copy(orbit.target);
    scratchCamPos.copy(camera.position);

    const target: Vec3 = [scratchTarget.x, scratchTarget.y, scratchTarget.z];
    const camPos: Vec3 = [scratchCamPos.x, scratchCamPos.y, scratchCamPos.z];

    const result = computeSpringArm(
      {
        target,
        cameraPosition: camPos,
        minDistance: MIN_DISTANCE,
        padding: PADDING,
        perpOffset: PERP_OFFSET,
      },
      (origin, direction, maxDist) => {
        scratchOrigin.set(origin[0], origin[1], origin[2]);
        scratchDir.set(direction[0], direction[1], direction[2]);
        raycaster.set(scratchOrigin, scratchDir);
        raycaster.far = maxDist;
        // Recurse so grouped meshes (fixtures, walls) are considered.
        const hits = raycaster.intersectObjects(collidables.current, MAX_RECURSIVE_DEPTH);
        for (const h of hits) {
          // Ignore objects whose own userData opts them out (e.g.
          // decorative halos that happen to be tagged for raycast).
          if (h.object.userData?.cameraInvisible === true) continue;
          return h.distance;
        }
        return null;
      },
    );

    // Smooth the distance toward the clamp. First frame snaps (no
    // previous value to lerp from), subsequent frames ease.
    const targetDist = result.clampedDistance;
    if (currentDistance.current === null) {
      currentDistance.current = targetDist;
    } else {
      const alpha = easeAlpha(dt, TIME_CONSTANT_SEC);
      currentDistance.current = lerpDistance(currentDistance.current, targetDist, alpha);
    }

    // Apply: camera position = target + direction * currentDistance.
    // Direction is preserved from the original orbit angle; only the
    // radius shrinks.
    if (result.desiredDistance < 1e-5) return; // degenerate; nothing to do
    const ratio = currentDistance.current / result.desiredDistance;
    camera.position.set(
      scratchTarget.x + (scratchCamPos.x - scratchTarget.x) * ratio,
      scratchTarget.y + (scratchCamPos.y - scratchTarget.y) * ratio,
      scratchTarget.z + (scratchCamPos.z - scratchTarget.z) * ratio,
    );
  });
  // ^^^ NOTE: this used to be `}, 1)` for "run AFTER OrbitControls."
  // Removed because R3F treats ANY useFrame with priority >= 1 as
  // "I'll render manually" and stops calling gl.render() itself.
  // Since this controller doesn't call gl.render, the result was a
  // completely black scene (0 draw calls, 93 meshes, full camera).
  // OrbitControls drives camera via pointer events, not useFrame, so
  // the ordering concern was moot anyway.

  return null;
}
