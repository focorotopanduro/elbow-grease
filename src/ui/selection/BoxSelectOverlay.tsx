/**
 * BoxSelectOverlay — Phase 14.M
 *
 * DOM overlay + R3F "camera snooper" that together implement a
 * rectangular lasso selection:
 *
 *   CameraMatrixSnooper (R3F, mounts inside <Canvas>)
 *     • Every frame, copies camera.projectionMatrix and
 *       matrixWorldInverse into module-scope `cameraSnapshot`.
 *     • Also records viewport width/height from `useThree().size`.
 *
 *   BoxSelectOverlay (DOM, mounts at scene root)
 *     • Fixed-position full-window div.
 *     • Off by default (pointer-events: none).
 *     • When `interactionStore.mode === 'select'`, flips to
 *       pointer-events: auto + cursor: crosshair.
 *     • On pointer-down → pointer-move: renders an SVG rectangle.
 *     • On pointer-up: projects every pipe point + fixture position
 *       through cameraSnapshot, collects IDs within the rect,
 *       adds them to multiSelectStore (Shift = additive; bare = replace).
 *     • Escape during drag cancels without committing.
 *
 * Requires both pieces to be mounted: the snooper feeds the overlay.
 */

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useInteractionStore } from '@store/interactionStore';
import { useMultiSelectStore } from '@store/multiSelectStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import {
  filterEntitiesInRect,
  type Mat4,
} from '@core/selection/boxSelectMath';

// ── Shared camera snapshot ───────────────────────────────────

/**
 * Live snapshot of the camera's world-to-clip matrix + viewport size.
 * Updated every frame by `CameraMatrixSnooper` inside the Canvas,
 * consumed by `BoxSelectOverlay` outside it. Mutable in place so
 * no subscription / re-render cost.
 */
const cameraSnapshot = {
  /** Combined projectionMatrix · matrixWorldInverse as a column-major 16-length array. */
  worldToClip: new Float64Array(16),
  viewportWidth: 0,
  viewportHeight: 0,
  ready: false,
};

export function CameraMatrixSnooper() {
  const { camera, size } = useThree();
  const mode = useInteractionStore((s) => s.mode);
  const tmp = useRef(new THREE.Matrix4());
  useFrame(() => {
    // Phase 14.M perf: only keep the snapshot fresh while the user is
    // actively in Select mode (i.e. the box-select overlay is the one
    // thing that consumes it). Outside Select mode the per-frame
    // matrix copy + Float64Array.set was measurable lag during orbit.
    if (mode !== 'select') return;
    // world-to-clip = projection · view (view = matrixWorldInverse)
    tmp.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    cameraSnapshot.worldToClip.set(tmp.current.elements);
    cameraSnapshot.viewportWidth = size.width;
    cameraSnapshot.viewportHeight = size.height;
    cameraSnapshot.ready = true;
  });
  return null;
}

// ── Rectangle state ──────────────────────────────────────────

interface DragRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  additive: boolean;
}

// ── Overlay ──────────────────────────────────────────────────

export function BoxSelectOverlay() {
  const mode = useInteractionStore((s) => s.mode);
  const [drag, setDrag] = useState<DragRect | null>(null);
  const draggingRef = useRef(false);

  const active = mode === 'select';

  useEffect(() => {
    if (!active) return;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // left-button only
      // Only start if the event target is our overlay (not a modal /
      // HUD panel rendered on top of us).
      const target = e.target as HTMLElement | null;
      if (!target || !target.hasAttribute('data-box-select-layer')) return;
      draggingRef.current = true;
      setDrag({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY, additive: e.shiftKey });
      try { target.setPointerCapture(e.pointerId); } catch { /* fine */ }
    };

    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      setDrag((r) => (r ? { ...r, x2: e.clientX, y2: e.clientY } : r));
    };

    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const target = e.target as HTMLElement | null;
      try { target?.releasePointerCapture(e.pointerId); } catch { /* fine */ }
      const current = drag;
      setDrag((latestDrag) => {
        const r = latestDrag ?? current;
        if (r) commitDragSelection({ ...r, x2: e.clientX, y2: e.clientY });
        return null;
      });
    };

    const onKey = (e: KeyboardEvent) => {
      // Escape during drag cancels without committing.
      if (e.key === 'Escape' && draggingRef.current) {
        draggingRef.current = false;
        setDrag(null);
      }
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, drag]);

  // Overlay div. Covers the whole window; only captures events in
  // select mode. The `data-box-select-layer` attribute lets the down
  // handler distinguish this layer from other overlays (modal, HUD).
  return (
    <div
      data-box-select-layer="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: active ? 'auto' : 'none',
        cursor: active ? 'crosshair' : 'default',
        zIndex: active ? 15 : -1,
      }}
    >
      {drag && (
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <rect
            x={Math.min(drag.x1, drag.x2)}
            y={Math.min(drag.y1, drag.y2)}
            width={Math.abs(drag.x2 - drag.x1)}
            height={Math.abs(drag.y2 - drag.y1)}
            fill="rgba(255, 213, 79, 0.08)"
            stroke="#ffd54f"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        </svg>
      )}
    </div>
  );
}

// ── Commit ───────────────────────────────────────────────────

function commitDragSelection(rect: DragRect): void {
  if (!cameraSnapshot.ready) return;
  // Filter out accidental clicks — a 2-pixel "drag" is a click, not a lasso.
  const dx = Math.abs(rect.x2 - rect.x1);
  const dy = Math.abs(rect.y2 - rect.y1);
  if (dx < 3 && dy < 3) return;

  const worldToClip = Array.from(cameraSnapshot.worldToClip) as number[] as Mat4;
  const pipes = Object.values(usePipeStore.getState().pipes)
    .filter((p) => p.visible)
    .map((p) => ({ id: p.id, points: p.points }));
  const fixtures = Object.values(useFixtureStore.getState().fixtures)
    .map((f) => ({ id: f.id, position: f.position }));

  const { pipeIds, fixtureIds } = filterEntitiesInRect({
    worldToClip,
    viewport: {
      width: cameraSnapshot.viewportWidth,
      height: cameraSnapshot.viewportHeight,
    },
    rect: { x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2 },
    pipes,
    fixtures,
  });

  const multi = useMultiSelectStore.getState();
  if (rect.additive) {
    multi.addMany(pipeIds, fixtureIds);
  } else {
    multi.setSelection(pipeIds, fixtureIds);
  }
}
