/**
 * Annotations — the static "CAD overlay" on top of the scene.
 *
 * Four self-contained engineering callouts:
 *   1. Roof zone markers (Z1 field, Z2 edge, Z3 corner) per ASCE 7-22 §30
 *   2. Dimension callouts (mean roof height h = 12 ft, building width b = 36'6")
 *   3. Title block (lower-right) — drawing #, scale, revision, sheet
 *   4. North arrow (lower-left)
 *
 * None of these vary with wind speed, profile, or storm intensity, so the
 * component is pure / prop-less. Extracted from RanchHouseSVG so geometry
 * iteration on the house doesn't risk knocking out the engineering callouts
 * (and vice versa).
 *
 * Render order matters — these sit ABOVE the lawn but BELOW the weather
 * effects (rain, lightning) so engineers can read them through the storm.
 */
interface Props {
  /** Revision string shown in the title block (defaults to today's stamp) */
  revision?: string;
}

export default function Annotations({ revision = '2026.04.25' }: Props) {
  return (
    <>
      {/* ROOF zone markers */}
      <g className="rh-zones" aria-hidden="true">
        <circle cx="290" cy="225" r="9" fill="none" stroke="#eb6924" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
        <text x="290" y="212" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#eb6924" textAnchor="middle" opacity="0.85">Z3</text>
        <circle cx="395" cy="180" r="9" fill="none" stroke="#f5894d" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        <text x="395" y="167" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" opacity="0.75">Z2</text>
        <circle cx="500" cy="155" r="9" fill="none" stroke="#c4bfbc" strokeWidth="1" strokeDasharray="2 2" opacity="0.4" />
        <text x="500" y="142" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#c4bfbc" textAnchor="middle" opacity="0.65">Z1</text>
      </g>

      {/* DIMENSION CALLOUTS */}
      <g className="rh-dims" aria-hidden="true">
        <line x1="248" y1="136" x2="248" y2="240" stroke="#f5894d" strokeWidth="0.6" markerStart="url(#rh-arrow)" markerEnd="url(#rh-arrow)" opacity="0.85" />
        <line x1="243" y1="136" x2="253" y2="136" stroke="#f5894d" strokeWidth="0.6" opacity="0.85" />
        <line x1="243" y1="240" x2="253" y2="240" stroke="#f5894d" strokeWidth="0.6" opacity="0.85" />
        <text x="240" y="190" fontSize="10" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="end" opacity="0.95" transform="rotate(-90 240 190)">
          h = 12 ft (Kz=0.70)
        </text>

        <line x1="280" y1="455" x2="720" y2="455" stroke="#f5894d" strokeWidth="0.6" markerStart="url(#rh-arrow)" markerEnd="url(#rh-arrow)" opacity="0.7" />
        <text x="500" y="468" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" opacity="0.85">b = 36 ft 6 in</text>
      </g>

      {/* TITLE BLOCK */}
      <g className="rh-titleblock" aria-hidden="true" transform="translate(620 388)">
        <rect x="0" y="0" width="170" height="44" fill="rgba(20, 18, 16, 0.78)" stroke="rgba(245, 137, 77, 0.6)" strokeWidth="0.6" rx="2" />
        <line x1="0" y1="11" x2="170" y2="11" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <line x1="0" y1="27" x2="170" y2="27" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <line x1="100" y1="11" x2="100" y2="44" stroke="rgba(245, 137, 77, 0.4)" strokeWidth="0.4" />
        <text x="5" y="8" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(245, 137, 77, 0.9)" letterSpacing="0.8">BEIT BUILDING CONTRACTORS LLC</text>
        <text x="5" y="20" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">DWG</text>
        <text x="20" y="20" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">WUV-001</text>
        <text x="105" y="20" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">SCALE</text>
        <text x="125" y="20" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">NTS</text>
        <text x="5" y="36" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">REV</text>
        <text x="20" y="36" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">{revision}</text>
        <text x="105" y="36" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(196, 191, 188, 0.85)">SHEET</text>
        <text x="125" y="36" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#f5894d" fontWeight="600">1 / 1</text>
      </g>

      {/* North arrow */}
      <g className="rh-north" aria-hidden="true" transform="translate(40 410)">
        <circle cx="0" cy="0" r="14" fill="rgba(20, 18, 16, 0.6)" stroke="rgba(245, 137, 77, 0.5)" strokeWidth="0.6" />
        <path d="M 0 -10 L 4 6 L 0 2 L -4 6 Z" fill="#f5894d" />
        <text x="0" y="-16" fontSize="8" fontFamily="JetBrains Mono, monospace" fill="#f5894d" textAnchor="middle" fontWeight="600">N</text>
      </g>
    </>
  );
}
