/**
 * DraftRectanglePreview — Phase 14.R.4.
 *
 * Translucent ghost rectangle drawn between the draft start and the
 * live cursor position while the user is mid-click in `draw-rect`
 * mode. Shows:
 *
 *   • Filled footprint (dashed edges)
 *   • Live length + run labels at the midpoints of the edges
 *   • Corner markers at the 4 vertices
 *
 * Subscribes ONLY to `draftStart` + `draftEnd` — the preview never
 * re-renders when committed sections change or when the user picks
 * a different roof type. This keeps pointer-move cost to a single
 * React tree update per frame (~1ms).
 *
 * Mount guard: only renders when both anchor points exist AND
 * draft-rect mode is active — otherwise returns null and pays zero
 * cost.
 */

import { useMemo } from 'react';
import { Line, Text } from '@react-three/drei';
import {
  useRoofingDrawStore,
  draftRectToSection,
} from '@store/roofingDrawStore';

const PREVIEW_COLOR = '#ff9800';  // orange — matches roofing accent
const PREVIEW_OPACITY = 0.35;

function fmtFt(n: number): string {
  return `${n.toFixed(1)} ft`;
}

export function DraftRectanglePreview() {
  const mode = useRoofingDrawStore((s) => s.mode);
  const draftStart = useRoofingDrawStore((s) => s.draftStart);
  const draftEnd = useRoofingDrawStore((s) => s.draftEnd);

  const rect = useMemo(() => {
    if (!draftStart || !draftEnd) return null;
    return draftRectToSection(draftStart, draftEnd);
  }, [draftStart, draftEnd]);

  if (mode !== 'draw-rect' || !rect) return null;
  if (rect.length <= 0 || rect.run <= 0) return null;

  // Corners (three.js coords: plan-x → x, plan-y → z, y ≈ 0 is ground).
  const y = 0.01; // tiny offset so it renders above the ground grid
  const c0: [number, number, number] = [rect.x,                 y, rect.y];
  const c1: [number, number, number] = [rect.x + rect.length,   y, rect.y];
  const c2: [number, number, number] = [rect.x + rect.length,   y, rect.y + rect.run];
  const c3: [number, number, number] = [rect.x,                 y, rect.y + rect.run];

  return (
    <group>
      {/* Filled footprint — semi-transparent */}
      <mesh position={[rect.x + rect.length / 2, y, rect.y + rect.run / 2]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[rect.length, rect.run]} />
        <meshBasicMaterial
          color={PREVIEW_COLOR}
          transparent
          opacity={PREVIEW_OPACITY}
          depthWrite={false}
        />
      </mesh>

      {/* Dashed edges */}
      <Line points={[c0, c1, c2, c3, c0]} color={PREVIEW_COLOR} lineWidth={2} dashed dashSize={0.4} gapSize={0.25} />

      {/* Dimension labels */}
      <Text
        position={[rect.x + rect.length / 2, y + 0.2, rect.y - 0.6]}
        fontSize={0.5}
        color={PREVIEW_COLOR}
        anchorX="center"
        anchorY="middle"
        rotation={[-Math.PI / 2, 0, 0]}
      >
        {fmtFt(rect.length)}
      </Text>
      <Text
        position={[rect.x + rect.length + 0.6, y + 0.2, rect.y + rect.run / 2]}
        fontSize={0.5}
        color={PREVIEW_COLOR}
        anchorX="center"
        anchorY="middle"
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
      >
        {fmtFt(rect.run)}
      </Text>
    </group>
  );
}
