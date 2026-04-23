/**
 * PDFCalibrationInteraction — Phase 14.R.5.
 *
 * Scene-level invisible ground-plane catcher that captures the two
 * calibration clicks for the PDF underlay. Runs only when
 * `useRoofingPdfCalibStore.mode` is `calibrate-1` or `calibrate-2`,
 * so drawing a roof section and calibrating never conflict — only
 * one interaction catcher is live at a time.
 *
 * Invariants:
 *   • First click sets `firstPoint` (world XZ) + moves store to
 *     'calibrate-2'.
 *   • Second click sets `secondPoint` + moves to 'enter-distance'.
 *     A DOM dialog in RoofingPDFPanel handles the numeric entry.
 *   • ESC at any step → `reset()` → back to idle.
 *
 * The catcher plane sits at y = -0.003 so it's BELOW the PDF plane
 * (y = -0.005 ... -0.001 depending on height) — actually the PDF
 * plane is a flat square at y ≈ 0, so we sit just above that at
 * y = 0.002 so clicks land reliably on the underlay even with
 * section meshes nearby. Section meshes are at y ≥ 0 and their own
 * onClick stops propagation, so they won't accidentally swallow
 * calibration clicks unless the user clicks directly ON a section
 * (which is the correct behavior — don't calibrate off a roof mesh).
 */

import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import {
  useRoofingPdfCalibStore,
  type GroundPoint,
} from '@store/roofingPdfCalibStore';

function pointerToGround(e: ThreeEvent<PointerEvent>): GroundPoint {
  const p = e.point as THREE.Vector3;
  return [p.x, p.z];
}

export function PDFCalibrationInteraction() {
  const mode = useRoofingPdfCalibStore((s) => s.mode);
  const setFirst = useRoofingPdfCalibStore((s) => s.setFirstPoint);
  const setSecond = useRoofingPdfCalibStore((s) => s.setSecondPoint);
  const reset = useRoofingPdfCalibStore((s) => s.reset);

  const gl = useThree((s) => s.gl);

  // Crosshair while calibrating.
  useEffect(() => {
    const canvas = gl?.domElement;
    if (!canvas) return;
    if (mode === 'calibrate-1' || mode === 'calibrate-2') {
      canvas.style.setProperty('cursor', 'crosshair', 'important');
    } else {
      canvas.style.removeProperty('cursor');
    }
    return () => { canvas.style.removeProperty('cursor'); };
  }, [mode, gl]);

  // Escape cancels at any step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useRoofingPdfCalibStore.getState();
      if (st.mode === 'idle') return;
      reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reset]);

  if (mode !== 'calibrate-1' && mode !== 'calibrate-2') return null;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt = pointerToGround(e);
    if (mode === 'calibrate-1') {
      setFirst(pt);
    } else {
      setSecond(pt);
    }
  };

  return (
    <mesh
      position={[0, 0.002, 0]}
      rotation-x={-Math.PI / 2}
      onPointerDown={handlePointerDown}
    >
      <planeGeometry args={[500, 500]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthWrite={false}
        visible={false}
      />
    </mesh>
  );
}
