import { iso, ISO_DIMS } from './projection';

/**
 * AnnotationsIso — engineering callouts in iso space.
 *
 * Roof zone markers (Z1 field, Z2 edge, Z3 corner) per ASCE 7-22 §30 are
 * positioned at 3D world coordinates and projected to screen — they sit
 * ON the actual roof slope rather than floating above a 2D drawing.
 *
 * Plus the title block + north arrow + dimension callout for the building
 * width, all in screen-space (not iso-projected) so they read like a real
 * CAD drawing border overlay.
 */
interface Props {
  revision?: string;
}

const D = ISO_DIMS;

export default function AnnotationsIso({ revision = '2026.04.25' }: Props) {
  // Roof slope sample points for zone markers (front slope, mid-height)
  const slopeAt = (xFrac: number, yFrac: number): [number, number] => {
    const wx = D.mainW * xFrac;
    const wy = (D.mainD / 2) * yFrac; // ridge is at D.mainD/2
    const wz = D.mainH + D.roofR * yFrac; // height interpolates from eave to ridge
    return iso(wx, wy, wz);
  };

  // Z1 field — middle of roof slope
  const [z1x, z1y] = slopeAt(0.5, 0.5);
  // Z2 edge — 1/3 along slope, eave-near
  const [z2x, z2y] = slopeAt(0.5, 0.18);
  // Z3 corner — corner of roof, near right gable end
  const [z3x, z3y] = slopeAt(0.92, 0.18);

  return (
    <>
      {/* ═══════════ ROOF ZONE MARKERS (sit on the actual slope) ═══════════ */}
      <g className="rh-zones" aria-hidden="true">
        <circle cx={z3x} cy={z3y} r="9" fill="none" stroke="#eb6924" strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
        <text x={z3x} y={z3y - 14} fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#eb6924" textAnchor="middle" opacity="0.9">Z3</text>

        <circle cx={z2x} cy={z2y} r="9" fill="none" stroke="#f5894d" strokeWidth="1" strokeDasharray="2 2" opacity="0.55" />
        <text x={z2x} y={z2y - 14} fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" opacity="0.78">Z2</text>

        <circle cx={z1x} cy={z1y} r="9" fill="none" stroke="#c4bfbc" strokeWidth="1" strokeDasharray="2 2" opacity="0.45" />
        <text x={z1x} y={z1y - 14} fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#c4bfbc" textAnchor="middle" opacity="0.7">Z1</text>
      </g>

      {/* ═══════════ DIMENSION CALLOUT (height of main wall) ═══════════ */}
      <g className="rh-dims" aria-hidden="true">
        {(() => {
          // Vertical dimension along the right side of the front face
          const [x1, y1] = iso(D.mainW + 18, 0, 0);
          const [x2, y2] = iso(D.mainW + 18, 0, D.mainH);
          return (
            <>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f5894d" strokeWidth="0.6" markerStart="url(#rh-arrow)" markerEnd="url(#rh-arrow)" opacity="0.9" />
              <text x={x1 + 8} y={(y1 + y2) / 2} fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#f5894d" opacity="0.95">
                h = 12 ft
              </text>
            </>
          );
        })()}
        {(() => {
          // Horizontal dimension along the front-bottom edge
          const [x1, y1] = iso(0, 0, -18);
          const [x2, y2] = iso(D.mainW, 0, -18);
          return (
            <>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#f5894d" strokeWidth="0.6" markerStart="url(#rh-arrow)" markerEnd="url(#rh-arrow)" opacity="0.85" />
              <text x={(x1 + x2) / 2} y={y1 + 12} fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" opacity="0.9">
                b = 36 ft 6 in
              </text>
            </>
          );
        })()}
      </g>

      {/* ═══════════ TITLE BLOCK (screen-space, lower-right) ═══════════ */}
      <g className="rh-titleblock" aria-hidden="true" transform="translate(620 388)">
        <rect x="0" y="0" width="170" height="44" fill="rgba(20, 18, 16, 0.82)" stroke="rgba(245, 137, 77, 0.6)" strokeWidth="0.6" rx="2" />
        <line x1="0" y1="11" x2="170" y2="11" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <line x1="0" y1="27" x2="170" y2="27" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <line x1="100" y1="11" x2="100" y2="44" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <text x="5" y="8" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(245, 137, 77, 0.9)" letterSpacing="0.8">BEIT BUILDING CONTRACTORS LLC</text>
        <text x="5" y="20" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">DWG</text>
        <text x="20" y="20" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">WUV-001-ISO</text>
        <text x="105" y="20" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">PROJ</text>
        <text x="125" y="20" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">ISO 30°</text>
        <text x="5" y="36" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">REV</text>
        <text x="20" y="36" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">{revision}</text>
        <text x="105" y="36" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">SHEET</text>
        <text x="125" y="36" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">2 / 2</text>
      </g>

      {/* ═══════════ NORTH ARROW (lower-left) ═══════════ */}
      <g className="rh-north" aria-hidden="true" transform="translate(40 410)">
        <circle cx="0" cy="0" r="14" fill="rgba(20, 18, 16, 0.7)" stroke="rgba(245, 137, 77, 0.55)" strokeWidth="0.6" />
        <path d="M 0 -10 L 4 6 L 0 2 L -4 6 Z" fill="#f5894d" />
        <text x="0" y="-16" fontSize="8" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" fontWeight="600">N</text>
      </g>
    </>
  );
}
