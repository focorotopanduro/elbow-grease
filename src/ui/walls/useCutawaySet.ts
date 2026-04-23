/**
 * useCutawaySet — derive the dim-this-wall set every frame.
 *
 * The cutaway algorithm needs two things: where the camera is, and
 * where the camera is looking. For the "where looking" half we
 * project the camera's forward ray onto the ground plane — that gives
 * us the point on the floor the user is gazing at, which matches the
 * intuitive "focus" of any orbit-camera CAD view.
 *
 * If the camera is looking upward (away from the ground), we fall
 * back to the world origin. This is rare in normal plumbing views
 * (the user is almost always looking down into a building shell) but
 * keeps the math well-defined under any orientation.
 *
 * This hook updates at ~10 Hz via setInterval, not every frame.
 * Cutaway only needs to keep up with orbital motion — 10 Hz is
 * visually indistinguishable from 60 Hz for this and saves the
 * recompute cost on every render.
 */

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWallStore } from '@store/wallStore';
import { useRenderModeStore } from '@store/renderModeStore';
import { computeCutawaySet, type CutawayWall } from '@core/walls/cutawayAlgorithm';

const UPDATE_INTERVAL_MS = 100; // 10 Hz

export function useCutawaySet(): Set<string> {
  const { camera } = useThree();
  const mode = useRenderModeStore((s) => s.mode);
  const walls = useWallStore((s) => s.walls);
  const [cutawayIds, setCutawayIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (mode !== 'cutaway') {
      setCutawayIds(new Set());
      return;
    }

    const tmpForward = new THREE.Vector3();
    const tmpRay = new THREE.Ray();

    const recompute = () => {
      // Build the CutawayWall[] projection. We do this per-tick because
      // walls can be added / moved while the mode is active. Typical
      // scenes have < 100 walls so the allocation is cheap.
      const list: CutawayWall[] = [];
      for (const w of Object.values(walls)) {
        if (w.hidden) continue;
        list.push({ id: w.id, start: w.start, end: w.end });
      }

      if (list.length === 0) {
        setCutawayIds(new Set());
        return;
      }

      // Camera XZ.
      const cameraXZ: [number, number] = [camera.position.x, camera.position.z];

      // Forward ray in world coordinates.
      tmpForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      tmpRay.origin.copy(camera.position);
      tmpRay.direction.copy(tmpForward);

      // Intersect ground plane y=0. If the ray goes upward or is
      // parallel, fall back to the origin.
      let focusXZ: [number, number];
      if (tmpForward.y < -1e-4) {
        const t = -camera.position.y / tmpForward.y;
        const x = camera.position.x + tmpForward.x * t;
        const z = camera.position.z + tmpForward.z * t;
        focusXZ = [x, z];
      } else {
        focusXZ = [0, 0];
      }

      const next = computeCutawaySet({ camera: cameraXZ, focus: focusXZ, walls: list });

      // Update state only when the set actually changed — shallow
      // equality check prevents re-renders during a static orbit pose.
      setCutawayIds((prev) => {
        if (prev.size !== next.size) return next;
        for (const id of next) if (!prev.has(id)) return next;
        return prev;
      });
    };

    recompute();
    const id = window.setInterval(recompute, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [mode, walls, camera]);

  return cutawayIds;
}
