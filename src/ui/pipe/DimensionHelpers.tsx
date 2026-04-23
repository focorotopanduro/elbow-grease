/**
 * DimensionHelpers — 3D text annotations on selected pipes.
 *
 * When a pipe is selected, renders Billboard text labels showing:
 *   - Segment length at the midpoint of each straight run
 *   - Diameter label near the pipe start
 *   - Slope indicator for drainage pipes
 *
 * Labels always face the camera (Billboard) and are only visible
 * for the selected pipe to avoid visual clutter.
 */

import { useMemo } from 'react';
import { Text, Billboard } from '@react-three/drei';
import { usePipeStore } from '@store/pipeStore';
import { usePlumbingLayerStore } from '@store/plumbingLayerStore';
import { useFloorParams } from '@store/floorStore';
import type { Vec3 } from '@core/events';

// ── Helpers ─────────────────────────────────────────────────────

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  ];
}

function segmentLength(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function segmentSlope(a: Vec3, b: Vec3): number {
  const dy = Math.abs(b[1] - a[1]);
  const horiz = Math.sqrt((b[0] - a[0]) ** 2 + (b[2] - a[2]) ** 2);
  return horiz > 0 ? (dy / horiz) * 12 : 0; // in/ft
}

// ── Dimension label component ───────────────────────────────────

interface DimLabelProps {
  position: Vec3;
  text: string;
  color?: string;
  size?: number;
  offset?: number;
}

function DimLabel({ position, text, color = '#aaa', size = 0.08, offset = 0.25 }: DimLabelProps) {
  return (
    <Billboard position={[position[0], position[1] + offset, position[2]]}>
      {/* Background pill */}
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[text.length * size * 0.6 + 0.08, size * 1.8]} />
        <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} />
      </mesh>
      <Text
        fontSize={size}
        color={color}
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {text}
      </Text>
    </Billboard>
  );
}

// ── Main component ──────────────────────────────────────────────

export function DimensionHelpers() {
  const selectedId = usePipeStore((s) => s.selectedId);
  const pipe = usePipeStore((s) => s.selectedId ? s.pipes[s.selectedId] : null);
  const dimensionsVisible = usePlumbingLayerStore((s) => s.dimensions);
  const getFloorParams = useFloorParams();

  const labels = useMemo(() => {
    if (!pipe || !dimensionsVisible) return [];
    // Hide dimensions when the selected pipe is hidden/ghost on current floor mode
    let yMin = pipe.points[0]?.[1] ?? 0, yMax = yMin;
    for (const p of pipe.points) { if (p[1] < yMin) yMin = p[1]; if (p[1] > yMax) yMax = p[1]; }
    const fp = getFloorParams(yMin, yMax);
    if (!fp.visible || fp.opacity < 0.9) return [];

    const result: { position: Vec3; text: string; color: string }[] = [];
    const pts = pipe.points;

    // Diameter label at pipe start
    if (pts.length >= 1) {
      result.push({
        position: pts[0]!,
        text: `\u2300 ${pipe.diameter}"`,
        color: pipe.color,
      });
    }

    // Segment length labels at midpoints
    for (let i = 1; i < pts.length; i++) {
      const len = segmentLength(pts[i - 1]!, pts[i]!);
      if (len < 0.2) continue; // skip tiny segments

      const mid = midpoint(pts[i - 1]!, pts[i]!);
      result.push({
        position: mid,
        text: `${len.toFixed(1)}'`,
        color: '#aaa',
      });

      // Slope label for drainage segments with vertical drop
      if (pipe.system === 'waste') {
        const slope = segmentSlope(pts[i - 1]!, pts[i]!);
        if (slope > 0.01) {
          const slopeColor = slope >= 0.25 ? '#00e676' : slope >= 0.125 ? '#ffc107' : '#ff1744';
          result.push({
            position: [mid[0], mid[1] - 0.15, mid[2]],
            text: `${slope.toFixed(2)}"/ft`,
            color: slopeColor,
          });
        }
      }
    }

    // Total length label at pipe end
    if (pts.length >= 2) {
      let totalLen = 0;
      for (let i = 1; i < pts.length; i++) {
        totalLen += segmentLength(pts[i - 1]!, pts[i]!);
      }
      result.push({
        position: pts[pts.length - 1]!,
        text: `\u03A3 ${totalLen.toFixed(1)}'`,
        color: '#00e5ff',
      });
    }

    return result;
  }, [pipe, dimensionsVisible, getFloorParams]);

  if (!pipe || labels.length === 0) return null;

  return (
    <group>
      {labels.map((label, i) => (
        <DimLabel
          key={`${selectedId}-${i}`}
          position={label.position}
          text={label.text}
          color={label.color}
        />
      ))}
    </group>
  );
}

// ── Always-on pitch indicators (Phase 14-bug-fix pass) ──────────
//
// The selected-pipe-only labels above are great for deep review of
// one pipe, but the user wants to SEE pitch across the whole scene
// without having to click each waste pipe in turn. This component
// renders a small slope tag at the midpoint of every horizontally-
// sloped waste-pipe segment, color-coded:
//
//   green  ≥ 0.25"/ft   (meets IPC 704.1 minimum for 3" and smaller)
//   amber  ≥ 0.125"/ft  (meets minimum for 4"+; also "flat but legal")
//   red    > 0.01"/ft   (slope exists but is below code minimum)
//
// Purely additive — doesn't touch the existing selected-pipe dim
// flow. Toggleable via the same `plumbingLayerStore.dimensions` flag so
// users who find it noisy can hide all labels at once.

export function PitchIndicators() {
  const pipes = usePipeStore((s) => s.pipes);
  const pipeOrder = usePipeStore((s) => s.pipeOrder);
  const dimensionsVisible = usePlumbingLayerStore((s) => s.dimensions);
  const getFloorParams = useFloorParams();

  const labels = useMemo(() => {
    if (!dimensionsVisible) return [];
    const out: { key: string; position: Vec3; text: string; color: string }[] = [];
    for (const id of pipeOrder) {
      const pipe = pipes[id];
      if (!pipe || !pipe.visible) continue;
      if (pipe.system !== 'waste' && pipe.system !== 'storm') continue;
      // Skip pipes that are off-floor / ghosted.
      let yMin = pipe.points[0]?.[1] ?? 0, yMax = yMin;
      for (const p of pipe.points) {
        if (p[1] < yMin) yMin = p[1];
        if (p[1] > yMax) yMax = p[1];
      }
      const fp = getFloorParams(yMin, yMax);
      // Bug-fix (user report "pitch gone"): same cull asymmetry as
      // FittingMeshes — the 0.9 threshold dropped pitch labels for
      // any riser (floorStore returns 0.82) or ghosted view. Cull
      // only when the floor is hidden or effectively zero ghost.
      if (!fp.visible || fp.opacity < 0.05) continue;

      for (let i = 1; i < pipe.points.length; i++) {
        const a = pipe.points[i - 1]!;
        const b = pipe.points[i]!;
        const slope = segmentSlope(a, b);
        if (slope < 0.01) continue; // skip flat (vertical riser handled elsewhere)
        const mid = midpoint(a, b);
        const color = slope >= 0.25 ? '#00e676' : slope >= 0.125 ? '#ffc107' : '#ff1744';
        out.push({
          key: `${id}-${i}`,
          position: [mid[0], mid[1] + 0.1, mid[2]],
          text: `${slope.toFixed(2)}″/ft`,
          color,
        });
      }
    }
    return out;
  }, [pipes, pipeOrder, dimensionsVisible, getFloorParams]);

  if (labels.length === 0) return null;
  return (
    <group>
      {labels.map((l) => (
        <DimLabel
          key={l.key}
          position={l.position}
          text={l.text}
          color={l.color}
          size={0.07}
          offset={0.08}
        />
      ))}
    </group>
  );
}
