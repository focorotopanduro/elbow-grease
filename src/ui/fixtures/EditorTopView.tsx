/**
 * EditorTopView — 2D plan view rendered as a single responsive SVG.
 *
 * SVG chosen over R3F here for crisper vector rendering at any zoom and
 * for trivial pointer-capture-based dragging. Coordinate system:
 *
 *    X →   right
 *    Z ↓   down  (Z in world → Y in SVG)
 *
 * Units: feet. A viewport scale auto-fits to the fixture footprint so
 * that small fixtures (floor drain) and large ones (60" tub) both fill
 * the panel nicely.
 *
 * Elements drawn, back-to-front:
 *   1. Light grid (1" minor, 6" major)
 *   2. Fixture footprint (dashed rectangle)
 *   3. Fixture silhouette (simplified top-down outline)
 *   4. Dimension lines between handles
 *   5. Connection-point handles (draggable)
 *   6. Rotation ring (if enabled)
 *   7. Axis labels
 */

import { useMemo, useRef, useState } from 'react';
import type { ConnectionPoint, FixtureGeometry } from '@core/fixtures/ConnectionPoints';
import { snapTubDrainSideFromZ, snapHalfInch } from '@core/fixtures/ConnectionPoints';
import { useFixtureEditorStore } from '@store/fixtureEditorStore';

const INCH = 1 / 12;
const ROLE_COLORS: Record<string, string> = {
  drain:    '#ef5350',
  cold:     '#4fc3f7',
  hot:      '#ff7043',
  overflow: '#ab47bc',
  vent:     '#9ccc65',
  ref:      '#78909c',
};

interface Props {
  geometry: FixtureGeometry;
}

export function EditorTopView({ geometry }: Props) {
  const subtype = useFixtureEditorStore((s) => s.subtype);
  const stagedParams = useFixtureEditorStore((s) => s.stagedParams);
  const activeHandle = useFixtureEditorStore((s) => s.activeHandle);
  const setActiveHandle = useFixtureEditorStore((s) => s.setActiveHandle);
  const updateParam = useFixtureEditorStore((s) => s.updateParam);
  const bulkUpdate = useFixtureEditorStore((s) => s.bulkUpdate);
  const snap = useFixtureEditorStore((s) => s.snapHalfInch);
  const showDimensions = useFixtureEditorStore((s) => s.showDimensions);
  const showRotationHandle = useFixtureEditorStore((s) => s.showRotationHandle);
  const showWalls = useFixtureEditorStore((s) => s.showWalls);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverHandle, setHoverHandle] = useState<string | null>(null);

  // Compute scale + padding so the footprint fills the viewport with margins
  const { width, depth } = geometry.footprint;
  const padding = 0.6;
  const vbWidth = width + padding * 2;
  const vbDepth = depth + padding * 2;
  const viewBox = `${-vbWidth / 2} ${-vbDepth / 2} ${vbWidth} ${vbDepth}`;

  // Rotation (in degrees, from staged params)
  const rotationDeg = Number(stagedParams.rotationDeg ?? 0);

  // Grid lines
  const gridMinor = useMemo(() => {
    const lines: JSX.Element[] = [];
    const maxExt = Math.max(vbWidth, vbDepth);
    for (let v = -maxExt / 2; v <= maxExt / 2; v += INCH) {
      const isMajor = Math.abs((v / INCH) % 6) < 0.01;
      lines.push(
        <line key={`v${v}`} x1={v} y1={-vbDepth / 2} x2={v} y2={vbDepth / 2}
              stroke={isMajor ? 'rgba(80,120,150,0.35)' : 'rgba(50,70,90,0.15)'}
              strokeWidth={isMajor ? 0.012 : 0.004} />,
        <line key={`h${v}`} x1={-vbWidth / 2} y1={v} x2={vbWidth / 2} y2={v}
              stroke={isMajor ? 'rgba(80,120,150,0.35)' : 'rgba(50,70,90,0.15)'}
              strokeWidth={isMajor ? 0.012 : 0.004} />,
      );
    }
    return lines;
  }, [vbWidth, vbDepth]);

  // Drag a handle
  const onHandlePointerDown = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (!pt.draggable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setActiveHandle(pt.id);
  };

  const onHandlePointerMove = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (activeHandle !== pt.id) return;
    const svgPt = clientToSvg(e, containerRef.current);
    if (!svgPt) return;
    // svgPt.x maps to world X; svgPt.y maps to world Z (flipped)
    let newX = svgPt.x;
    let newZ = svgPt.y;
    if (snap) { newX = snapHalfInch(newX); newZ = snapHalfInch(newZ); }
    // Clamp to footprint
    newX = Math.max(-width/2, Math.min(width/2, newX));
    newZ = Math.max(-depth/2, Math.min(depth/2, newZ));

    // Subtype-specific behaviors
    if (subtype === 'bathtub' && (pt.id === 'drain')) {
      const lengthFt = (Number(stagedParams.length ?? 60)) * INCH;
      const side = snapTubDrainSideFromZ(newZ, lengthFt);
      bulkUpdate({ drainSide: side });
      return;
    }
    // Generic: just stash X/Z into fine params (extension point for future)
    // For now we only mutate driven params listed in pt.drivenBy; keep the
    // updateParam noop when no drivers so the UI remains responsive.
    if (pt.drivenBy && pt.drivenBy.length > 0) {
      // Map Y from handle CL heights driven by drainRoughIn etc. (not via this drag — this is planar only)
    }
  };

  const onHandlePointerUp = (pt: ConnectionPoint, e: React.PointerEvent) => {
    if (activeHandle === pt.id) setActiveHandle(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  // Drag the rotation ring
  const [rotDragging, setRotDragging] = useState(false);
  const onRotPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setRotDragging(true);
  };
  const onRotPointerMove = (e: React.PointerEvent) => {
    if (!rotDragging) return;
    const svgPt = clientToSvg(e, containerRef.current);
    if (!svgPt) return;
    // Angle from origin, CW from north
    const angle = (Math.atan2(svgPt.x, -svgPt.y) * 180) / Math.PI;
    const snapped = Math.round(angle / 5) * 5;
    updateParam('rotationDeg', ((snapped % 360) + 360) % 360);
  };
  const onRotPointerUp = (e: React.PointerEvent) => {
    setRotDragging(false);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', background: 'radial-gradient(ellipse at center, rgba(18,28,40,1) 0%, rgba(8,14,22,1) 100%)' }}>
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {/* Grid (always unrotated — it's the world grid) */}
        <g>{gridMinor}</g>

        {/* Center cross */}
        <g stroke="rgba(255,213,79,0.4)" strokeWidth={0.006}>
          <line x1={-vbWidth/2} y1={0} x2={vbWidth/2} y2={0} strokeDasharray="0.05,0.05" />
          <line x1={0} y1={-vbDepth/2} x2={0} y2={vbDepth/2} strokeDasharray="0.05,0.05" />
        </g>

        {/* Walls (back-wall for alcove / wall-mount fixtures) */}
        {showWalls && (
          <WallOutlines subtype={subtype} params={stagedParams} footprint={geometry.footprint} />
        )}

        {/* Fixture body — rotates with rotationDeg */}
        <g transform={`rotate(${rotationDeg})`}>
          {/* Footprint */}
          <rect
            x={-width/2}
            y={-depth/2}
            width={width}
            height={depth}
            fill="rgba(120, 180, 220, 0.05)"
            stroke="rgba(255,213,79,0.4)"
            strokeWidth={0.012}
            strokeDasharray="0.08,0.06"
            rx={0.08}
          />
          <FixtureSilhouette subtype={subtype} params={stagedParams} geometry={geometry} />

          {/* Dimension lines between handles */}
          {showDimensions && <DimensionLayer geometry={geometry} />}

          {/* Connection handles */}
          {geometry.points.map((pt) => {
            const isActive = activeHandle === pt.id;
            const isHover = hoverHandle === pt.id;
            const color = ROLE_COLORS[pt.role] ?? '#ccc';
            const r = isActive ? 0.075 : isHover ? 0.065 : 0.055;
            return (
              <g key={pt.id}
                 onPointerDown={(e) => onHandlePointerDown(pt, e)}
                 onPointerMove={(e) => onHandlePointerMove(pt, e)}
                 onPointerUp={(e) => onHandlePointerUp(pt, e)}
                 onPointerEnter={() => setHoverHandle(pt.id)}
                 onPointerLeave={() => setHoverHandle(null)}
                 style={{ cursor: pt.draggable ? 'grab' : 'default' }}>
                {/* Outer ring */}
                <circle cx={pt.position[0]} cy={pt.position[2]} r={r * 1.5}
                        fill="none" stroke={color} strokeWidth={0.008}
                        opacity={isActive ? 1 : 0.5} />
                {/* Fill */}
                <circle cx={pt.position[0]} cy={pt.position[2]} r={r}
                        fill={color} opacity={isActive ? 1 : 0.85} />
                {/* Label */}
                <text x={pt.position[0] + r * 2} y={pt.position[2] + 0.02}
                      fontSize={0.08}
                      fontFamily="Consolas, monospace"
                      fill={color} style={{ pointerEvents: 'none' }}>
                  {pt.label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Rotation ring — not rotated (world frame) */}
        {showRotationHandle && (
          <g onPointerDown={onRotPointerDown} onPointerMove={onRotPointerMove} onPointerUp={onRotPointerUp}
             style={{ cursor: 'grab' }}>
            <circle cx={0} cy={0}
                    r={Math.max(width, depth) / 2 + 0.25}
                    fill="none"
                    stroke="rgba(255,213,79,0.45)"
                    strokeWidth={0.012}
                    strokeDasharray="0.1,0.06" />
            {/* Rotation handle dot */}
            {(() => {
              const ringR = Math.max(width, depth) / 2 + 0.25;
              const a = (rotationDeg - 90) * Math.PI / 180; // 0° points up
              const hx = Math.cos(a) * ringR;
              const hy = Math.sin(a) * ringR;
              return (
                <g>
                  <circle cx={hx} cy={hy} r={0.07} fill="#ffd54f" stroke="#000" strokeWidth={0.008} />
                  <text x={hx + 0.12} y={hy + 0.02} fontSize={0.07} fontFamily="Consolas, monospace" fill="#ffd54f" style={{ pointerEvents: 'none' }}>
                    {rotationDeg.toFixed(0)}°
                  </text>
                </g>
              );
            })()}
          </g>
        )}

        {/* Corner axis indicators */}
        <g fontFamily="Consolas, monospace" fontSize={0.07} fill="#7fb8d0">
          <text x={-vbWidth/2 + 0.08} y={-vbDepth/2 + 0.15}>+X →</text>
          <text x={-vbWidth/2 + 0.08} y={vbDepth/2 - 0.08}>+Z ↓</text>
        </g>
      </svg>
    </div>
  );
}

// ── Wall outlines — per subtype ────────────────────────────────

function WallOutlines({
  subtype, params, footprint,
}: {
  subtype: string | null;
  params: Record<string, unknown>;
  footprint: { width: number; depth: number; height: number };
}) {
  if (!subtype) return null;
  const wallStroke = 'rgba(200, 220, 235, 0.38)';
  const wallSw = 0.02;
  const dash = '0.12,0.06';

  // Which walls are relevant?
  //  - water_closet, urinal, hose_bibb, lavatory: BACK wall
  //  - bathtub alcove: BACK + two SIDE walls
  //  - shower: depends on pan (treat as alcove for now)
  //  - everything else: no walls
  const back = <line x1={-footprint.width} y1={-footprint.depth / 2} x2={footprint.width} y2={-footprint.depth / 2}
                     stroke={wallStroke} strokeWidth={wallSw} strokeDasharray={dash} />;

  if (subtype === 'bathtub') {
    const style = String(params.tubStyle ?? 'alcove');
    if (style === 'alcove') {
      return (
        <g>
          {back}
          <line x1={-footprint.width/2} y1={-footprint.depth/2} x2={-footprint.width/2} y2={footprint.depth/2}
                stroke={wallStroke} strokeWidth={wallSw} strokeDasharray={dash} />
          <line x1={footprint.width/2} y1={-footprint.depth/2} x2={footprint.width/2} y2={footprint.depth/2}
                stroke={wallStroke} strokeWidth={wallSw} strokeDasharray={dash} />
        </g>
      );
    }
    if (style === 'corner') {
      return (
        <g>
          {back}
          <line x1={-footprint.width/2} y1={-footprint.depth/2} x2={-footprint.width/2} y2={footprint.depth/2}
                stroke={wallStroke} strokeWidth={wallSw} strokeDasharray={dash} />
        </g>
      );
    }
    return null;
  }
  if (subtype === 'shower') {
    return (
      <g>
        {back}
        <line x1={-footprint.width/2} y1={-footprint.depth/2} x2={-footprint.width/2} y2={footprint.depth/2}
              stroke={wallStroke} strokeWidth={wallSw} strokeDasharray={dash} />
      </g>
    );
  }
  if (['water_closet', 'urinal', 'lavatory', 'hose_bibb', 'drinking_fountain', 'clothes_washer', 'dishwasher', 'mop_sink'].includes(subtype)) {
    return back;
  }
  return null;
}

// ── Silhouette (simple top-down outline per subtype) ───────────

function FixtureSilhouette({
  subtype, params, geometry,
}: {
  subtype: string | null;
  params: Record<string, unknown>;
  geometry: FixtureGeometry;
}) {
  if (!subtype) return null;
  const fill = 'rgba(255,255,255,0.06)';
  const stroke = 'rgba(200, 220, 235, 0.4)';
  const sw = 0.012;

  switch (subtype) {
    case 'bathtub': {
      const lengthFt = Number(params.length ?? 60) * INCH;
      const widthFt = Number(params.width ?? 32) * INCH;
      return (
        <g>
          <rect x={-widthFt/2} y={-lengthFt/2} width={widthFt} height={lengthFt}
                rx={0.08} fill={fill} stroke={stroke} strokeWidth={sw} />
          <rect x={-widthFt/2 + 0.04} y={-lengthFt/2 + 0.04}
                width={widthFt - 0.08} height={lengthFt - 0.08}
                rx={0.05} fill="rgba(144, 164, 174, 0.08)" stroke={stroke} strokeWidth={sw * 0.6} />
        </g>
      );
    }
    case 'water_closet': {
      const roughIn = Number(params.roughInDistance ?? 12) * INCH;
      const tank = params.wallMounted === true;
      return (
        <g>
          {/* Bowl oval */}
          <ellipse cx={0} cy={-0.3 + roughIn} rx={0.22} ry={0.32} fill={fill} stroke={stroke} strokeWidth={sw} />
          {/* Tank rect (back-wall side) */}
          {!tank && (
            <rect x={-0.16} y={-0.4} width={0.32} height={0.15} fill={fill} stroke={stroke} strokeWidth={sw} />
          )}
        </g>
      );
    }
    case 'kitchen_sink':
    case 'lavatory':
    case 'mop_sink': {
      const footW = geometry.footprint.width * 0.8;
      const footD = geometry.footprint.depth * 0.8;
      return (
        <g>
          <rect x={-footW/2} y={-footD/2} width={footW} height={footD} rx={0.05}
                fill={fill} stroke={stroke} strokeWidth={sw} />
          {/* Bowls */}
          {subtype === 'kitchen_sink' && (() => {
            const bowlCount = Number(params.bowlCount ?? 2);
            if (bowlCount === 1) {
              return <rect x={-footW/2 + 0.05} y={-footD/2 + 0.05} width={footW - 0.1} height={footD - 0.1}
                           rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />;
            }
            if (bowlCount === 2) {
              return (
                <g>
                  <rect x={-footW/2 + 0.05} y={-footD/2 + 0.05} width={footW/2 - 0.08} height={footD - 0.1}
                        rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />
                  <rect x={0.03} y={-footD/2 + 0.05} width={footW/2 - 0.08} height={footD - 0.1}
                        rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />
                </g>
              );
            }
            return (
              <g>
                <rect x={-footW/2 + 0.04} y={-footD/2 + 0.05} width={footW/3 - 0.04} height={footD - 0.1}
                      rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />
                <rect x={-footW/6 + 0.02} y={-footD/2 + 0.08} width={footW/3 - 0.08} height={footD - 0.16}
                      rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />
                <rect x={footW/6} y={-footD/2 + 0.05} width={footW/3 - 0.04} height={footD - 0.1}
                      rx={0.03} fill="rgba(120,144,156,0.3)" stroke={stroke} strokeWidth={sw * 0.6} />
              </g>
            );
          })()}
        </g>
      );
    }
    case 'shower': {
      const panSize = String(params.panSize ?? '36x36');
      const parts = panSize.split('x').map((s) => parseInt(s, 10) * INCH);
      const w = parts[0] ?? 0.6;
      const d = parts[1] ?? 0.6;
      return <rect x={-w/2} y={-d/2} width={w} height={d} rx={0.04} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
    case 'floor_drain': {
      const size = Number(params.size ?? 2) * INCH;
      return <rect x={-size*1.5} y={-size*1.5} width={size*3} height={size*3} fill={fill} stroke={stroke} strokeWidth={sw * 0.5} />;
    }
    case 'urinal': {
      return <rect x={-0.25} y={-0.2} width={0.5} height={0.4} rx={0.08} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
    case 'hose_bibb': {
      return <circle cx={0} cy={0} r={0.15} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
    default: {
      const w = geometry.footprint.width * 0.7;
      const d = geometry.footprint.depth * 0.7;
      return <rect x={-w/2} y={-d/2} width={w} height={d} rx={0.04} fill={fill} stroke={stroke} strokeWidth={sw} />;
    }
  }
}

// ── Dimension layer: pairwise labels between drain and supplies ─

function DimensionLayer({ geometry }: { geometry: FixtureGeometry }) {
  const drains = geometry.points.filter((p) => p.role === 'drain');
  const supplies = geometry.points.filter((p) => p.role === 'cold' || p.role === 'hot');
  const elements: JSX.Element[] = [];

  for (const d of drains) {
    for (const s of supplies) {
      const dx = s.position[0] - d.position[0];
      const dz = s.position[2] - d.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.05) continue;
      const midX = (s.position[0] + d.position[0]) / 2;
      const midZ = (s.position[2] + d.position[2]) / 2;
      elements.push(
        <g key={`${d.id}-${s.id}`} style={{ pointerEvents: 'none' }}>
          <line x1={d.position[0]} y1={d.position[2]} x2={s.position[0]} y2={s.position[2]}
                stroke="rgba(127, 184, 208, 0.45)"
                strokeWidth={0.005}
                strokeDasharray="0.04,0.03" />
          <text x={midX} y={midZ - 0.03} fontSize={0.055}
                textAnchor="middle"
                fontFamily="Consolas, monospace"
                fill="#7fb8d0" opacity={0.8}>
            {(dist * 12).toFixed(1)}″
          </text>
        </g>
      );
    }
  }
  return <>{elements}</>;
}

// ── Helpers ────────────────────────────────────────────────────

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
