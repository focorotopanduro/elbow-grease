/**
 * EditorElevationView — side-elevation SVG view of the fixture.
 *
 * Shows the fixture as if you were looking at it from the +X axis
 * (left side). Vertical axis = Y (up), horizontal axis = Z.
 *
 * This view is essential for verifying rough-in heights, which are
 * frequently specified vs finished floor:
 *   - DWV trap arm height (drainRoughIn)
 *   - Cold/Hot supply rough-in heights
 *   - Fixture overall height (seat, rim, shower head)
 *
 * Elements:
 *   1. Finished floor line (y = 0) — thick orange
 *   2. Wall line (rear)           — dashed grey
 *   3. Horizontal height gridlines every 6"
 *   4. Fixture elevation silhouette (simplified)
 *   5. Connection points as draggable discs — Y-draggable drives the
 *      associated *RoughIn param for that role
 *   6. Height labels along the left edge
 *
 * Dragging a handle vertically snaps to 1/2″ and writes into the
 * appropriate param (drainRoughIn / coldRoughIn / hotRoughIn).
 */

import { useRef, useState, useMemo } from 'react';
import { useFixtureEditorStore } from '@store/fixtureEditorStore';
import type { ConnectionPoint, FixtureGeometry } from '@core/fixtures/ConnectionPoints';
import { snapHalfInch } from '@core/fixtures/ConnectionPoints';

const INCH = 1 / 12;
const ROLE_COLORS: Record<string, string> = {
  drain:    '#ef5350',
  cold:     '#4fc3f7',
  hot:      '#ff7043',
  overflow: '#ab47bc',
  vent:     '#9ccc65',
  ref:      '#78909c',
};

const ROLE_TO_PARAM: Record<string, string> = {
  drain:    'drainRoughIn',
  cold:     'coldRoughIn',
  hot:      'hotRoughIn',
};

interface Props {
  geometry: FixtureGeometry;
}

export function EditorElevationView({ geometry }: Props) {
  const stagedParams = useFixtureEditorStore((s) => s.stagedParams);
  const activeHandle = useFixtureEditorStore((s) => s.activeHandle);
  const setActiveHandle = useFixtureEditorStore((s) => s.setActiveHandle);
  const updateParam = useFixtureEditorStore((s) => s.updateParam);
  const snap = useFixtureEditorStore((s) => s.snapHalfInch);
  const showDims = useFixtureEditorStore((s) => s.showDimensions);
  const showWalls = useFixtureEditorStore((s) => s.showWalls);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Viewport fits elevation height + a bit below the floor line for DWV
  const padding = 0.6;
  const footprintDepth = geometry.footprint.depth;
  const vbWidth = footprintDepth + padding * 2;
  const topY = geometry.footprint.height + padding;
  const botY = -0.5;
  const vbHeight = topY - botY;
  const viewBox = `${-vbWidth / 2} ${-topY} ${vbWidth} ${vbHeight}`;

  // Height gridlines every 6"
  const heightLines = useMemo(() => {
    const out: JSX.Element[] = [];
    const maxH = geometry.footprint.height + 0.5;
    for (let y = 0; y <= maxH; y += 0.5) {
      out.push(
        <line key={`y${y}`} x1={-vbWidth / 2} y1={-y} x2={vbWidth / 2} y2={-y}
              stroke="rgba(80,120,150,0.25)" strokeWidth={0.005} strokeDasharray="0.04,0.03" />,
      );
      // Height label
      out.push(
        <text key={`yl${y}`} x={-vbWidth / 2 + 0.06} y={-y - 0.02}
              fontSize={0.06} fontFamily="Consolas, monospace"
              fill="#7fb8d0" opacity={0.7}>
          {(y * 12).toFixed(0)}″
        </text>,
      );
    }
    return out;
  }, [vbWidth, geometry.footprint.height]);

  // Pointer drag for a handle
  const onHandleDown = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (!pt.draggable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setActiveHandle(pt.id);
  };

  const onHandleMove = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (activeHandle !== pt.id) return;
    const svgPt = clientToSvg(e, containerRef.current);
    if (!svgPt) return;
    let y = -svgPt.y; // invert (SVG y down)
    if (snap) y = snapHalfInch(y);
    y = Math.max(0, Math.min(geometry.footprint.height + 0.3, y));
    const paramKey = ROLE_TO_PARAM[pt.role];
    if (paramKey) {
      updateParam(paramKey, Math.round(y * 24) / 2); // feet → inches ½″ step
    }
  };

  const onHandleUp = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (activeHandle === pt.id) setActiveHandle(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: 'linear-gradient(180deg, rgba(18,28,40,1) 0%, rgba(10,18,26,1) 100%)' }}>
      <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: '100%', display: 'block' }}>
        <g>{heightLines}</g>

        {/* Floor line */}
        <line x1={-vbWidth / 2} y1={0} x2={vbWidth / 2} y2={0}
              stroke="#ff7043" strokeWidth={0.015} />
        <text x={-vbWidth / 2 + 0.06} y={0.1}
              fontSize={0.08} fontFamily="Consolas, monospace" fill="#ff7043">
          FF ‰ 0″
        </text>

        {/* Rear wall (if applicable) */}
        {showWalls && (
          <g>
            <line x1={-footprintDepth / 2} y1={-topY + padding} x2={-footprintDepth / 2} y2={0}
                  stroke="rgba(200,220,235,0.4)" strokeWidth={0.015} strokeDasharray="0.08,0.04" />
            <text x={-footprintDepth / 2 - 0.08} y={-topY / 2}
                  fontSize={0.065} fontFamily="Consolas, monospace"
                  fill="#b8cbd7" opacity={0.7}
                  transform={`rotate(-90, ${-footprintDepth / 2 - 0.08}, ${-topY / 2})`}>
              BACK WALL
            </text>
          </g>
        )}

        {/* Fixture silhouette (simplified — box outline of footprint) */}
        <rect
          x={-footprintDepth / 2}
          y={-geometry.footprint.height}
          width={footprintDepth}
          height={geometry.footprint.height}
          fill="rgba(120, 180, 220, 0.05)"
          stroke="rgba(255,213,79,0.3)"
          strokeWidth={0.01}
          strokeDasharray="0.06,0.04"
          rx={0.04}
        />

        {/* Connection handles */}
        {geometry.points.map((pt) => {
          const [, pty, ptz] = pt.position;
          const isActive = activeHandle === pt.id;
          const isHover = hoverId === pt.id;
          const color = ROLE_COLORS[pt.role] ?? '#ccc';
          const r = isActive ? 0.065 : isHover ? 0.055 : 0.045;
          const draggable = pt.draggable && ROLE_TO_PARAM[pt.role];
          return (
            <g key={pt.id}
               onPointerDown={(e) => onHandleDown(pt, e)}
               onPointerMove={(e) => onHandleMove(pt, e)}
               onPointerUp={(e) => onHandleUp(pt, e)}
               onPointerEnter={() => setHoverId(pt.id)}
               onPointerLeave={() => setHoverId(null)}
               style={{ cursor: draggable ? 'ns-resize' : 'default' }}>
              <circle cx={ptz} cy={-pty} r={r * 1.5}
                      fill="none" stroke={color} strokeWidth={0.008}
                      opacity={isActive ? 1 : 0.5} />
              <circle cx={ptz} cy={-pty} r={r} fill={color}
                      opacity={isActive ? 1 : 0.85} />
              <text x={ptz + r * 2} y={-pty + 0.02}
                    fontSize={0.065}
                    fontFamily="Consolas, monospace" fill={color}
                    style={{ pointerEvents: 'none' }}>
                {pt.label} · {(pty * 12).toFixed(1)}″
              </text>
            </g>
          );
        })}

        {/* Vertical dimension lines between ANY two handles */}
        {showDims && <VerticalDims geometry={geometry} vbWidth={vbWidth} />}

        {/* Corner axis labels */}
        <g fontFamily="Consolas, monospace" fontSize={0.065} fill="#7fb8d0">
          <text x={vbWidth / 2 - 0.4} y={-topY + padding + 0.1}>↑ Y</text>
          <text x={vbWidth / 2 - 0.3} y={0.1}>+Z →</text>
        </g>
      </svg>
    </div>
  );
}

function VerticalDims({
  geometry, vbWidth,
}: {
  geometry: FixtureGeometry;
  vbWidth: number;
}) {
  // Show height differences between drain and each supply on the right edge
  const drain = geometry.points.find((p) => p.role === 'drain');
  if (!drain) return null;
  const others = geometry.points.filter((p) => p.role === 'cold' || p.role === 'hot');
  const x = vbWidth / 2 - 0.2;
  return (
    <g>
      {others.map((s) => {
        const y1 = -drain.position[1];
        const y2 = -s.position[1];
        const dy = Math.abs(s.position[1] - drain.position[1]);
        const midY = (y1 + y2) / 2;
        return (
          <g key={s.id} style={{ pointerEvents: 'none' }}>
            <line x1={x} y1={y1} x2={x} y2={y2}
                  stroke={ROLE_COLORS[s.role] ?? '#7fb8d0'}
                  strokeWidth={0.006} strokeDasharray="0.03,0.02"
                  opacity={0.7} />
            <line x1={x - 0.03} y1={y1} x2={x + 0.03} y2={y1} stroke={ROLE_COLORS[s.role] ?? '#7fb8d0'} strokeWidth={0.006} />
            <line x1={x - 0.03} y1={y2} x2={x + 0.03} y2={y2} stroke={ROLE_COLORS[s.role] ?? '#7fb8d0'} strokeWidth={0.006} />
            <text x={x + 0.05} y={midY}
                  fontSize={0.055}
                  fontFamily="Consolas, monospace"
                  fill={ROLE_COLORS[s.role] ?? '#7fb8d0'}
                  opacity={0.85}>
              Δ{(dy * 12).toFixed(1)}″
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ── Coordinate transform helper ───────────────────────────────

function clientToSvg(
  e: React.PointerEvent,
  container: HTMLDivElement | null,
): { x: number; y: number } | null {
  if (!container) return null;
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const inv = ctm.inverse();
  const local = pt.matrixTransform(inv);
  return { x: local.x, y: local.y };
}
