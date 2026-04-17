/**
 * WheelHolographics — sci-fi SVG overlay effects for the radial menu.
 *
 *   • Scan-line sweep — a horizontal bright line that periodically
 *     passes through the wheel, like a CRT refresh or targeting HUD.
 *
 *   • Electric tendril — a jagged, animated polyline connecting the
 *     center hub to the currently highlighted sector. Redraws every
 *     frame with randomized midpoints for a "crackling energy" feel.
 *
 *   • Holographic ring glint — a slow-rotating light arc on the outer
 *     ring, giving the wheel the glinting feel of a holographic
 *     projection.
 *
 *   • Depth rings — faint concentric rings inside the wheel that
 *     pulse outward when a commit happens, like sonar.
 *
 * All effects are purely visual and do not affect interaction.
 * Rendered via SVG so they scale crisply and layer cleanly over the
 * existing WheelSVG geometry.
 */

import { useEffect, useRef, useState } from 'react';

// ── Props ───────────────────────────────────────────────────────

export interface HolographicsProps {
  centerX: number;
  centerY: number;
  outerRadius: number;
  innerRadius: number;
  /** Angle (radians, 0 east, CCW) of the highlighted sector center. */
  hoverAngleRad: number | null;
  /** Accent color. */
  color: string;
  /** Whether the wheel is active (controls visibility of effects). */
  active: boolean;
}

// ── Component ───────────────────────────────────────────────────

export function WheelHolographics({
  centerX, centerY, outerRadius, innerRadius,
  hoverAngleRad, color, active,
}: HolographicsProps) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);

  // Run animation loop while active
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const loop = () => {
      frame++;
      setTick(frame);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  if (!active) return null;

  const t = tick / 60; // seconds

  // Scan line position: sweeps top-to-bottom with 3s period
  const scanCycle = (t * 0.333) % 1;
  const scanY = centerY - outerRadius + scanCycle * (outerRadius * 2);
  const scanOpacity = Math.sin(scanCycle * Math.PI) * 0.5;

  // Ring glint: rotates at 0.3 Hz
  const glintAngle = t * 0.6;

  // Electric tendril points if hovered
  const tendrilPath = hoverAngleRad !== null
    ? buildTendrilPath(centerX, centerY, hoverAngleRad, innerRadius, outerRadius, t)
    : null;

  const svgSize = outerRadius * 2 + 80;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      style={{
        position: 'absolute',
        top: centerY - svgSize / 2,
        left: centerX - svgSize / 2,
        pointerEvents: 'none',
        zIndex: 1001,
        overflow: 'visible',
      }}
    >
      <defs>
        {/* Scan line gradient */}
        <linearGradient id="scan-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0" />
          <stop offset="50%" stopColor={color} stopOpacity="0.8" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>

        {/* Glint gradient */}
        <radialGradient id="glint-grad">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>

        {/* Tendril glow filter */}
        <filter id="tendril-glow">
          <feGaussianBlur stdDeviation="2" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Clip path to keep scan line inside the ring */}
        <clipPath id="wheel-clip">
          <circle cx={svgSize / 2} cy={svgSize / 2} r={outerRadius} />
        </clipPath>
      </defs>

      {/* Scan line (clipped to ring) */}
      <g clipPath="url(#wheel-clip)">
        <rect
          x={0}
          y={scanY - centerY + svgSize / 2}
          width={svgSize}
          height={3}
          fill="url(#scan-grad)"
          opacity={scanOpacity}
        />
        {/* Trailing afterglow */}
        <rect
          x={0}
          y={scanY - centerY + svgSize / 2 - 20}
          width={svgSize}
          height={20}
          fill={color}
          opacity={scanOpacity * 0.05}
        />
      </g>

      {/* Ring glint — a small arc of extra-bright ring segment */}
      <g transform={`rotate(${(glintAngle * 180 / Math.PI)} ${svgSize / 2} ${svgSize / 2})`}>
        <circle
          cx={svgSize / 2 + outerRadius}
          cy={svgSize / 2}
          r={6}
          fill="url(#glint-grad)"
          opacity={0.8}
        />
      </g>

      {/* Depth rings (pulsing outward) */}
      {[0, 1, 2].map((i) => {
        const phase = (t * 0.5 + i * 0.33) % 1;
        const radius = innerRadius + phase * (outerRadius - innerRadius);
        const opacity = (1 - phase) * 0.15;
        return (
          <circle
            key={i}
            cx={svgSize / 2}
            cy={svgSize / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={0.5}
            opacity={opacity}
          />
        );
      })}

      {/* Electric tendril — jagged animated polyline from center to hover */}
      {tendrilPath && (
        <>
          <path
            d={tendrilPath}
            stroke={color}
            strokeWidth={2}
            fill="none"
            filter="url(#tendril-glow)"
            opacity={0.7}
          />
          <path
            d={tendrilPath}
            stroke="#ffffff"
            strokeWidth={0.6}
            fill="none"
            opacity={0.9}
          />
        </>
      )}

      {/* Corner bracket marks — targeting HUD feel */}
      {[0, 90, 180, 270].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const cx = svgSize / 2 + Math.cos(rad) * (outerRadius + 14);
        const cy = svgSize / 2 - Math.sin(rad) * (outerRadius + 14);
        const size = 8;
        return (
          <g key={deg} transform={`translate(${cx},${cy}) rotate(${-deg})`}>
            <path
              d={`M ${-size} 0 L 0 0 L 0 ${-size}`}
              stroke={color}
              strokeWidth={1.5}
              fill="none"
              opacity={0.5}
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Tendril path builder ────────────────────────────────────────

function buildTendrilPath(
  cx: number, cy: number,
  angleRad: number,
  innerRadius: number,
  outerRadius: number,
  t: number,
): string {
  // The tendril stretches from (innerRadius) to (outerRadius * 0.85),
  // along the hover direction, with N wavy midpoints
  const start = {
    x: cx + Math.cos(angleRad) * innerRadius,
    y: cy - Math.sin(angleRad) * innerRadius,
  };
  const endRadius = outerRadius * 0.88;
  const end = {
    x: cx + Math.cos(angleRad) * endRadius,
    y: cy - Math.sin(angleRad) * endRadius,
  };

  // Direction vector from start → end
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;

  const segments = 7;
  const points: { x: number; y: number }[] = [{ x: start.x - cx, y: start.y - cy }];

  for (let i = 1; i < segments; i++) {
    const tt = i / segments;
    const baseX = start.x + dx * tt;
    const baseY = start.y + dy * tt;
    // Jitter perpendicular to the main axis, synchronized phase
    const jitterAmp = (1 - Math.abs(tt - 0.5) * 2) * (len * 0.14); // triangular envelope
    const jitterPhase = t * 18 + i * 2.3;
    const jitter = Math.sin(jitterPhase) * jitterAmp + Math.cos(jitterPhase * 1.7) * jitterAmp * 0.5;
    points.push({
      x: (baseX + px * jitter) - cx,
      y: (baseY + py * jitter) - cy,
    });
  }
  points.push({ x: end.x - cx, y: end.y - cy });

  // SVG is positioned so its center is at (cx, cy) — we used svgSize/2 as the center
  // but the path coordinates here are svg-local, so we need to offset by svgSize/2
  const svgCenterOffset = outerRadius + 40; // matches svgSize/2
  const path = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${(p.x + svgCenterOffset).toFixed(2)} ${(p.y + svgCenterOffset).toFixed(2)}`,
  ).join(' ');

  return path;
}
