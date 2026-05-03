/**
 * RoofAssembly — every visual layer of the main-house roof, the part that
 * actually fails in the wind cascade.
 *
 * Split into two named exports so the parent can sandwich `<HouseStructure>`
 * between them and preserve the original z-order:
 *
 *   <RoofBase />          ← drawn BEFORE the walls (roof + apex vent + lifts)
 *   <HouseStructure />    ← walls/windows/chimney paint on top of the eave
 *   <RoofCatastrophic />  ← drawn LAST so the tear-off flies above everything
 *
 * Roof geometry (viewBox 800×480):
 *   - Eave line       y = 238 (left x=280, right x=720)
 *   - Ridge peak      x = 500, y = 140 (sheathing layer at 138, shingles at 136)
 *   - Slope           ~7/12 — close to the FBC default for Orlando residential
 *   - Side end-cap    polygon revealing the gable thickness on the right side
 *
 * Failure cascade (driven by props from useVisualizerState):
 *   - shinglesLifting     → tabs rotate up + one tab flies off
 *   - underlaymentExposed → SWB pattern fades in beneath
 *   - sheathingGone       → entire roof complex hidden, RoofCatastrophic shown
 */

interface RoofBaseProps {
  /** 0–1 storm intensity — drives end-cap shadow depth */
  storm: number;
  /** Whether the assembly includes a Secondary Water Barrier (FBC §1518) */
  hasSWB: boolean;
  /** Shingles_lifting cascade stage triggered */
  shinglesLifting: boolean;
  /** Underlayment_exposed stage triggered */
  underlaymentExposed: boolean;
  /** Sheathing_gone stage triggered — hide entire base, show catastrophic */
  sheathingGone: boolean;
}

export function RoofBase({
  storm,
  hasSWB,
  shinglesLifting,
  underlaymentExposed,
  sheathingGone,
}: RoofBaseProps) {
  return (
    <>
      {/* ROOF END-CAP — gable triangle on the right showing the roof has
          depth into the page. Slightly receded + shadowed. */}
      <g data-label="gable-end">
        <polygon
          points="720,238 732,244 612,148 500,140"
          fill={`rgba(${24 - storm * 14}, ${20 - storm * 12}, ${16 - storm * 10}, 0.9)`}
          stroke="#0a0908"
          strokeWidth="0.5"
        />
        {/* Subtle gable face shading */}
        <polygon
          points="720,238 732,244 612,148 500,140"
          fill="url(#rh-roof-light)"
          style={{ mixBlendMode: 'multiply', opacity: 0.7 }}
        />
      </g>

      {/* RAKE BOARDS — trim boards running along the roof slope on both
          gable sides (left + right of the front-facing roof). Real
          gables have a fascia trim board capping the rake edge; without
          it the roof reads as paper-thin. Each rake gets bevel: top
          sun-catch + bottom shadow. The right-side rake also has a
          stronger cast shadow because that's the gable end facing the
          viewer.

          v2 ITERATION:
            - Visible BOARD THICKNESS (paired parallel polygons offset
              perpendicular to the slope = the board's front face)
            - 4 NAIL HEADS along each rake (specular pinholes inside)
            - EAVE RETURNS at the bottom (small horizontal trim where
              the rake meets the soffit, like a real gable kick-out)
            - CROWN MOLDING line below the rake (decorative under-trim) */}
      <g data-label="rake-board" pointerEvents="none">
        {/* LEFT rake — board face polygon shows visible thickness.
            Slope direction: (220, 98), perpendicular up: (-0.41, -0.92).
            Offset of 1.6px perpendicular sells the board's depth. */}
        <polygon
          points="500,136 280,234 279.3,232.4 499.3,134.4"
          fill="#0e0a06"
        />
        {/* Top edge sun-catch on the visible board face */}
        <line x1="499.3" y1="134.4" x2="279.3" y2="232.4" stroke="rgba(255, 232, 188, 0.55)" strokeWidth="0.3" />
        {/* Original beveled rake stroke + bevel highlights (kept) */}
        <line x1="500" y1="136" x2="280" y2="234" stroke="#1a1410" strokeWidth="2.5" />
        <line x1="500" y1="135.2" x2="280" y2="233.2" stroke="rgba(255, 230, 175, 0.45)" strokeWidth="0.4" />
        <line x1="500" y1="137.0" x2="280" y2="235.0" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.4" />
        {/* Crown molding below the rake — decorative narrow trim */}
        <line x1="500" y1="138.4" x2="280" y2="236.4" stroke="rgba(180, 160, 120, 0.30)" strokeWidth="0.3" />
        {/* NAIL HEADS along the rake — 4 evenly spaced */}
        {[0.2, 0.4, 0.6, 0.8].map((p, i) => {
          const x = 500 - 220 * p;
          const y = 136 + 98 * p;
          return (
            <g key={`rake-nail-l-${i}`}>
              <circle cx={x} cy={y} r="0.7" fill="#5a5048" stroke="#0a0908" strokeWidth="0.2" />
              <circle cx={x - 0.2} cy={y - 0.2} r="0.25" fill="rgba(255, 252, 240, 0.85)" />
            </g>
          );
        })}
        {/* EAVE RETURN at the bottom — small horizontal trim piece
            where the rake meets the soffit (the classic "boxed eave" detail) */}
        <rect x="272" y="234" width="14" height="3" fill="#1a1410" stroke="#0a0908" strokeWidth="0.3" />
        <line x1="272" y1="234.4" x2="286" y2="234.4" stroke="rgba(255, 230, 175, 0.42)" strokeWidth="0.3" />
        <line x1="272" y1="236.6" x2="286" y2="236.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
        {/* Eave-return outer end-block (the corner cap) */}
        <rect x="272" y="232" width="3" height="5" fill="#0e0a06" stroke="#0a0908" strokeWidth="0.3" />

        {/* RIGHT rake — same iteration, mirrored */}
        <polygon
          points="500,136 720,234 720.7,232.4 500.7,134.4"
          fill="#0e0a06"
        />
        <line x1="500.7" y1="134.4" x2="720.7" y2="232.4" stroke="rgba(255, 232, 188, 0.50)" strokeWidth="0.3" />
        <line x1="500" y1="136" x2="720" y2="234" stroke="#1a1410" strokeWidth="2.5" />
        <line x1="500" y1="135.2" x2="720" y2="233.2" stroke="rgba(255, 230, 175, 0.42)" strokeWidth="0.4" />
        <line x1="500" y1="137.0" x2="720" y2="235.0" stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.4" />
        <line x1="500" y1="138.4" x2="720" y2="236.4" stroke="rgba(180, 160, 120, 0.30)" strokeWidth="0.3" />
        {[0.2, 0.4, 0.6, 0.8].map((p, i) => {
          const x = 500 + 220 * p;
          const y = 136 + 98 * p;
          return (
            <g key={`rake-nail-r-${i}`}>
              <circle cx={x} cy={y} r="0.7" fill="#5a5048" stroke="#0a0908" strokeWidth="0.2" />
              <circle cx={x - 0.2} cy={y - 0.2} r="0.25" fill="rgba(255, 252, 240, 0.85)" />
            </g>
          );
        })}
        <rect x="714" y="234" width="14" height="3" fill="#1a1410" stroke="#0a0908" strokeWidth="0.3" />
        <line x1="714" y1="234.4" x2="728" y2="234.4" stroke="rgba(255, 230, 175, 0.42)" strokeWidth="0.3" />
        <line x1="714" y1="236.6" x2="728" y2="236.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
        <rect x="725" y="232" width="3" height="5" fill="#0e0a06" stroke="#0a0908" strokeWidth="0.3" />
      </g>

      {/* Sheathing layer (visible when shingles fail) */}
      <polygon
        data-label="sheathing"
        points="280,238 500,140 720,238"
        fill="url(#rh-sheathing-pat)"
        stroke="#3a2e22"
        strokeWidth="1"
      />

      {/* SWB layer */}
      {!sheathingGone && (
        <polygon
          points="280,236 500,138 720,236"
          fill={hasSWB ? 'url(#rh-swb-pat)' : '#3a2e22'}
          opacity={underlaymentExposed ? 1 : 0}
          style={{ transition: 'opacity 0.6s cubic-bezier(0.33, 1, 0.68, 1)' }}
        />
      )}

      {/* Shingles + lighting + heatmap */}
      {!sheathingGone && (
        <g>
          <polygon
            data-label="shingle-field"
            points="280,234 500,136 720,234"
            fill="url(#rh-shingles)"
            stroke="#0a0908"
            strokeWidth="1"
            opacity={shinglesLifting ? 0.82 : 1}
            style={{ transition: 'opacity 0.6s' }}
          />
          <polygon points="280,234 500,136 720,234" fill="url(#rh-roof-light)" style={{ mixBlendMode: 'overlay' }} />
          {/* Anisotropic specular streak — narrow bright band parallel to
              ridge, simulates sun grazing the asphalt granules. Screen
              blend so it adds light without crushing the shingle pattern. */}
          <polygon
            points="280,234 500,136 720,234"
            fill="url(#rh-roof-specular)"
            style={{ mixBlendMode: 'screen' }}
            pointerEvents="none"
          />
          <polygon points="280,234 500,136 720,234" fill="url(#rh-heat)" opacity="0.85" style={{ mixBlendMode: 'overlay', transition: 'opacity 0.4s' }} />

          {/* Visible shingle courses — each course gets a dark shadow line
              AND a thin warm highlight just above it. The highlight sells
              the 3D thickness of the tab catching the sun. */}
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((p, i) => {
            const yPeak = 136;
            const yEave = 234;
            const y = yPeak + (yEave - yPeak) * p;
            const xWidth = (p * (720 - 280)) / 2;
            const xL = 500 - xWidth;
            const xR = 500 + xWidth;
            return (
              <g key={`course-${i}`} pointerEvents="none">
                {/* Shadow under the tab */}
                <line
                  x1={xL}
                  y1={y}
                  x2={xR}
                  y2={y}
                  stroke="rgba(0,0,0,0.42)"
                  strokeWidth="0.7"
                />
                {/* Warm catchlight just ABOVE the shadow — sells the
                    physical thickness of the shingle tab */}
                <line
                  x1={xL}
                  y1={y - 0.6}
                  x2={xR}
                  y2={y - 0.6}
                  stroke={`rgba(255, 232, 188, ${0.28 * (i === 0 ? 1.2 : 1)})`}
                  strokeWidth="0.5"
                />
              </g>
            );
          })}

          {/* RIDGE CAP — raised cap shingles running the full length of
              the ridge (the apex line where the two roof slopes meet).
              Real ridges have a thicker layer of folded cap shingles
              + a darker shadow underneath. Now visible across the
              entire ridge, not just the small midpoint stub.

              v2 ITERATION: added per-cap tick marks along the full
              slope (suggests individual cap shingles, ~16 of them) +
              a warm sun-catch highlight stripe above the shadow line
              (the cap edge catches grazing light from above). */}
          {/* Cast shadow under cap (darker band on the slope below the cap) */}
          <line data-label="roof-ridge" x1="280" y1="234" x2="500" y2="136" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.5" pointerEvents="none" />
          <line data-label="roof-ridge" x1="500" y1="136" x2="720" y2="234" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.5" pointerEvents="none" />
          {/* Sun-catch highlight along the FULL ridge (cap leading edge) */}
          <line x1="280" y1="233.2" x2="500" y2="135.2" stroke="rgba(255, 232, 188, 0.42)" strokeWidth="0.4" pointerEvents="none" />
          <line x1="500" y1="135.2" x2="720" y2="233.2" stroke="rgba(255, 232, 188, 0.38)" strokeWidth="0.4" pointerEvents="none" />
          {/* Per-cap-shingle tick marks — small perpendicular hashes
              every ~30px along the ridge that read as the joint
              between individual cap shingles. Each tick is a tiny
              dark line + a paired bright sliver for 3D edge depth. */}
          <g pointerEvents="none">
            {[0.13, 0.26, 0.39, 0.52, 0.65, 0.78, 0.91].map((p, i) => {
              const x = 280 + 220 * p;
              const y = 234 - 98 * p;
              return (
                <g key={`cap-tick-l-${i}`}>
                  <line x1={x - 1.0} y1={y - 2.2} x2={x + 1.0} y2={y + 2.2} stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.35" />
                  <line x1={x - 0.6} y1={y - 2.4} x2={x + 0.6} y2={y - 1.0} stroke="rgba(255, 232, 188, 0.30)" strokeWidth="0.25" />
                </g>
              );
            })}
            {[0.09, 0.22, 0.35, 0.48, 0.61, 0.74, 0.87].map((p, i) => {
              const x = 500 + 220 * p;
              const y = 136 + 98 * p;
              return (
                <g key={`cap-tick-r-${i}`}>
                  <line x1={x - 1.0} y1={y + 2.2} x2={x + 1.0} y2={y - 2.2} stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.35" />
                  <line x1={x - 0.6} y1={y - 2.4} x2={x + 0.6} y2={y - 1.0} stroke="rgba(255, 232, 188, 0.30)" strokeWidth="0.25" />
                </g>
              );
            })}
          </g>
          {/* Apex cap stub — the raised crown over the peak with bevel */}
          <rect x="488" y="133" width="24" height="6" fill="#1a1612" stroke="#0a0908" strokeWidth="0.4" />
          <line x1="488" y1="133.4" x2="512" y2="133.4" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.4" />
          <line x1="488" y1="138.6" x2="512" y2="138.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.4" />
          {/* Cap-shingle dividers along the apex */}
          <line x1="494" y1="133" x2="494" y2="139" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="500" y1="133" x2="500" y2="139" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="506" y1="133" x2="506" y2="139" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          {/* Apex cap GRANULAR texture flecks (cap shingles have the
              same asphalt grit as field shingles) */}
          <circle cx="491" cy="135.6" r="0.25" fill="rgba(0, 0, 0, 0.30)" pointerEvents="none" />
          <circle cx="496" cy="136.4" r="0.30" fill="rgba(255, 220, 175, 0.18)" pointerEvents="none" />
          <circle cx="503" cy="135.4" r="0.25" fill="rgba(0, 0, 0, 0.30)" pointerEvents="none" />
          <circle cx="508" cy="137.0" r="0.28" fill="rgba(255, 220, 175, 0.18)" pointerEvents="none" />
          <circle cx="498" cy="137.2" r="0.22" fill="rgba(0, 0, 0, 0.25)" pointerEvents="none" />
          <line data-label="roof-ridge-hit" x1="492" y1="136" x2="508" y2="136" stroke="transparent" strokeWidth="3" />
          {/* Invisible hit-targets for the high-uplift corner zones — only
              "active" when Labels mode is on (CSS gates pointer-events) */}
          <rect data-label="shingle-corner" data-label-zone="hit" x="280" y="226" width="40" height="14" fill="transparent" />
          <rect data-label="shingle-corner" data-label-zone="hit" x="680" y="226" width="40" height="14" fill="transparent" />

          {/* Plumbing vent — beveled cylinder + cast shadow on roof.
              Reads as a true 3D pipe poking through the shingles. */}
          <g transform="translate(440 200)">
            {/* Cast shadow on roof to the lower-right (sun upper-left) */}
            <ellipse cx="2" cy="3" rx="5" ry="1.5" fill="rgba(0, 0, 0, 0.42)" pointerEvents="none" />
            {/* Pipe body */}
            <rect x="-3" y="-12" width="6" height="14" fill="#1a1612" stroke="#0a0908" strokeWidth="0.4" />
            {/* Left rim sun-catch (cylinder catches light on its left side) */}
            <line x1="-2.7" y1="-12" x2="-2.7" y2="2" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.4" />
            {/* Right rim shadow (the back of the cylinder) */}
            <line x1="2.7" y1="-12" x2="2.7" y2="2" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
            {/* Pipe cap (top ring) — beveled top */}
            <ellipse cx="0" cy="-12" rx="3" ry="1" fill="#3a3128" />
            <ellipse cx="0" cy="-12.3" rx="3" ry="0.6" fill="rgba(255, 230, 175, 0.25)" />
            {/* Inner pipe shadow (the dark hole down the pipe) */}
            <ellipse cx="0" cy="-11.7" rx="2" ry="0.5" fill="rgba(0, 0, 0, 0.85)" />
          </g>

          {/* Roof flashing band near peak — now beveled with sun-catch
              + bottom shadow so the flashing reads as raised metal */}
          <line x1="430" y1="172" x2="570" y2="172" stroke="rgba(168,150,120,0.4)" strokeWidth="1" pointerEvents="none" />
          <line x1="430" y1="171.5" x2="570" y2="171.5" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.3" pointerEvents="none" />
          <line x1="430" y1="172.5" x2="570" y2="172.5" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" pointerEvents="none" />

          {/* Roof vent — beveled box + per-louver bevel + cast shadow */}
          <ellipse cx="406" cy="204" rx="10" ry="1.5" fill="rgba(0, 0, 0, 0.40)" pointerEvents="none" />
          <rect x="395" y="195" width="18" height="7" fill="#221d18" stroke="#0a0908" strokeWidth="0.4" />
          {/* Outer-frame bevel — top + left sun, right + bottom shadow */}
          <line x1="395.4" y1="195" x2="395.4" y2="202" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
          <line x1="395" y1="195.4" x2="413" y2="195.4" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
          <line x1="412.6" y1="195" x2="412.6" y2="202" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="395" y1="201.6" x2="413" y2="201.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          {/* Per-louver beveled slits */}
          <line x1="395" y1="197" x2="413" y2="197" stroke="#0a0908" strokeWidth="0.4" />
          <line x1="395" y1="197.4" x2="413" y2="197.4" stroke="rgba(255, 220, 165, 0.22)" strokeWidth="0.3" />
          <line x1="395" y1="199" x2="413" y2="199" stroke="#0a0908" strokeWidth="0.4" />
          <line x1="395" y1="199.4" x2="413" y2="199.4" stroke="rgba(255, 220, 165, 0.22)" strokeWidth="0.3" />

          {shinglesLifting && (
            <>
              {/* CAST-SHADOW VOIDS on the roof — exposed dark felt where
                  the tabs USED to lay flat. Drawn FIRST so the lifted
                  tabs paint over their own pivot points. Suggests the
                  shingle has actually peeled away from the substrate
                  rather than just rotating in mid-air. */}
              <polygon
                points="282,234 332,234 326,239 286,239"
                fill="rgba(0, 0, 0, 0.65)"
                pointerEvents="none"
              />
              <line x1="282" y1="234.4" x2="332" y2="234.4" stroke="rgba(255, 230, 175, 0.18)" strokeWidth="0.4" pointerEvents="none" />
              <polygon
                points="660,234 718,234 712,239 666,239"
                fill="rgba(0, 0, 0, 0.65)"
                pointerEvents="none"
              />
              <line x1="660" y1="234.4" x2="718" y2="234.4" stroke="rgba(255, 230, 175, 0.18)" strokeWidth="0.4" pointerEvents="none" />

              {/* LEFT lifting tab — beveled with edge thickness, felt
                  strands, and granule debris for true 3D feel. */}
              <g
                className="rh-tab-lift"
                style={{ transformOrigin: '290px 234px', animationDelay: '0s' }}
                transform="translate(290 228) rotate(-22)"
              >
                {/* Tab top face (asphalt sun-side) */}
                <rect width="44" height="11" fill="#3a3128" stroke="#0a0908" strokeWidth="0.5" />
                {/* Sun-catch on the lifted leading edge (light grazes top) */}
                <line x1="0" y1="0.5" x2="44" y2="0.5" stroke="rgba(255, 232, 188, 0.55)" strokeWidth="0.5" />
                {/* Underside shadow band (the back of the tab is darker) */}
                <rect x="0" y="8.5" width="44" height="2.5" fill="rgba(0, 0, 0, 0.50)" />
                {/* VISIBLE EDGE THICKNESS on the leading (lifted) edge —
                    cross-section showing the asphalt + felt sandwich */}
                <rect x="43.5" y="0" width="2" height="11" fill="#1a1410" />
                <line x1="44.5" y1="0.4" x2="44.5" y2="10.6" stroke="rgba(255, 210, 160, 0.42)" strokeWidth="0.3" />
                <rect x="43.5" y="6" width="2" height="2" fill="#5a4030" />
                {/* Granular asphalt texture flecks across the face */}
                <circle cx="6" cy="3" r="0.35" fill="rgba(255, 220, 175, 0.20)" />
                <circle cx="14" cy="6" r="0.30" fill="rgba(0, 0, 0, 0.32)" />
                <circle cx="22" cy="4" r="0.32" fill="rgba(255, 220, 175, 0.18)" />
                <circle cx="30" cy="7" r="0.28" fill="rgba(0, 0, 0, 0.30)" />
                <circle cx="38" cy="3.5" r="0.32" fill="rgba(255, 220, 175, 0.20)" />
                {/* Trailing torn-felt strands hanging from the bottom
                    (where the tab is still attached to the roof) */}
                <g stroke="#1a1410" strokeWidth="0.45" fill="none" strokeLinecap="round">
                  <path d="M 4 11 Q 5 12.5 4.5 14" />
                  <path d="M 12 11 Q 13.5 13 12.8 14.5" />
                  <path d="M 22 11 Q 21 12.5 22 14.2" />
                  <path d="M 32 11 Q 33 13 32.4 14.4" />
                  <path d="M 40 11 Q 40.5 12.5 40 14" />
                </g>
                {/* Granule debris scattering off the leading edge */}
                <circle cx="48" cy="-1" r="0.45" fill="rgba(60, 50, 40, 0.75)" />
                <circle cx="51" cy="3" r="0.35" fill="rgba(50, 40, 32, 0.6)" />
                <circle cx="46" cy="5" r="0.40" fill="rgba(60, 50, 40, 0.55)" />
                <circle cx="53" cy="-3" r="0.30" fill="rgba(45, 38, 30, 0.55)" />
              </g>

              {/* RIGHT lifting tab — same bevel + edge + debris treatment */}
              <g
                className="rh-tab-lift"
                style={{ transformOrigin: '660px 234px', animationDelay: '0.18s' }}
                transform="translate(660 228) rotate(18)"
              >
                <rect width="52" height="11" fill="#3a3128" stroke="#0a0908" strokeWidth="0.5" />
                <line x1="0" y1="0.5" x2="52" y2="0.5" stroke="rgba(255, 232, 188, 0.55)" strokeWidth="0.5" />
                <rect x="0" y="8.5" width="52" height="2.5" fill="rgba(0, 0, 0, 0.50)" />
                {/* Edge thickness on the LEFT (this tab pivots from the
                    right, so the LEFT edge is the lifted one) */}
                <rect x="-1.5" y="0" width="2" height="11" fill="#1a1410" />
                <line x1="-1.5" y1="0.4" x2="-1.5" y2="10.6" stroke="rgba(255, 210, 160, 0.42)" strokeWidth="0.3" />
                <rect x="-1.5" y="6" width="2" height="2" fill="#5a4030" />
                {/* Granules across face */}
                <circle cx="6" cy="3.5" r="0.32" fill="rgba(255, 220, 175, 0.20)" />
                <circle cx="16" cy="6.2" r="0.30" fill="rgba(0, 0, 0, 0.32)" />
                <circle cx="26" cy="4" r="0.32" fill="rgba(255, 220, 175, 0.18)" />
                <circle cx="36" cy="7" r="0.28" fill="rgba(0, 0, 0, 0.30)" />
                <circle cx="46" cy="4" r="0.32" fill="rgba(255, 220, 175, 0.20)" />
                {/* Trailing felt strands */}
                <g stroke="#1a1410" strokeWidth="0.45" fill="none" strokeLinecap="round">
                  <path d="M 6 11 Q 7 12.5 6.5 14" />
                  <path d="M 16 11 Q 17.5 13 16.8 14.5" />
                  <path d="M 28 11 Q 27 12.5 28 14.2" />
                  <path d="M 38 11 Q 39 13 38.4 14.4" />
                  <path d="M 48 11 Q 48.5 12.5 48 14" />
                </g>
                {/* Granule debris scattering off the leading (left) edge */}
                <circle cx="-5" cy="-1" r="0.45" fill="rgba(60, 50, 40, 0.75)" />
                <circle cx="-8" cy="3" r="0.35" fill="rgba(50, 40, 32, 0.6)" />
                <circle cx="-3" cy="5" r="0.40" fill="rgba(60, 50, 40, 0.55)" />
                <circle cx="-10" cy="-3" r="0.30" fill="rgba(45, 38, 30, 0.55)" />
              </g>

              {/* FLYING TAB — 3D feel: top + bottom shadows on both
                  long edges since it's tumbling, plus a trailing
                  granule + felt-fragment cloud. */}
              <g
                className="rh-tab-fly"
                style={{ transformOrigin: '740px 184px', animationDelay: '0.4s' }}
                transform="translate(740 180) rotate(45)"
              >
                <rect width="38" height="9" fill="#3a3128" opacity="0.7" stroke="#0a0908" strokeWidth="0.5" />
                {/* Sun-catch on top edge (still picks up light while spinning) */}
                <line x1="0" y1="0.5" x2="38" y2="0.5" stroke="rgba(255, 232, 188, 0.50)" strokeWidth="0.5" />
                {/* Underside shadow on bottom edge */}
                <line x1="0" y1="8.5" x2="38" y2="8.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.5" />
                {/* Edge thickness — both ends now (it's been ripped off) */}
                <rect x="-1" y="0" width="1.5" height="9" fill="#1a1410" />
                <rect x="37.5" y="0" width="1.5" height="9" fill="#1a1410" />
                {/* Granule trail fading behind the spinning tab */}
                <circle cx="-4" cy="2" r="0.4" fill="rgba(60, 50, 40, 0.55)" />
                <circle cx="-7" cy="6" r="0.3" fill="rgba(60, 50, 40, 0.40)" />
                <circle cx="42" cy="3" r="0.4" fill="rgba(60, 50, 40, 0.50)" />
                <circle cx="46" cy="6" r="0.3" fill="rgba(60, 50, 40, 0.35)" />
              </g>
            </>
          )}
        </g>
      )}

      {/* GABLE VENT in roof apex — beveled trapezoid + interior depth.
          Sun-catch on the upper-left rake, shadow on the right rake +
          bottom edge, plus a darker inset polygon to suggest the vent
          opens into the dark attic space behind. */}
      <polygon points="490,180 510,180 502,168 498,168" fill="#1a1612" stroke="#0a0908" strokeWidth="0.5" />
      {/* Inset darker polygon — the actual louvered opening */}
      <polygon points="492,178 508,178 501,170 499,170" fill="#000000" />
      {/* Sun-rim on left rake (sun upper-left) */}
      <line x1="498" y1="168" x2="490" y2="180" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.4" />
      <line x1="490" y1="180" x2="510" y2="180" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.3" />
      {/* Right rake shadow */}
      <line x1="502" y1="168" x2="510" y2="180" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
      {/* Horizontal louver slats inside the vent (3 thin lines) */}
      <line x1="494" y1="173" x2="506" y2="173" stroke="rgba(255, 220, 165, 0.18)" strokeWidth="0.25" />
      <line x1="494" y1="175" x2="506" y2="175" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
      <line x1="494" y1="177" x2="506" y2="177" stroke="rgba(255, 220, 165, 0.18)" strokeWidth="0.25" />
    </>
  );
}

interface RoofCatastrophicProps {
  /** Sheathing_gone stage triggered — show the tear + flying panel */
  sheathingGone: boolean;
}

/**
 * Catastrophic-failure layer. Renders LAST in the parent so the flying
 * panel + glowing tear hover above everything else for max drama.
 */
export function RoofCatastrophic({ sheathingGone }: RoofCatastrophicProps) {
  if (!sheathingGone) return null;
  return (
    <g className="rh-sheathing-fail">
      {/* TEAR HOLE — now a stacked 3D void:
            1. Outer "pit" polygon (the visible roof opening) with the
               glowing orange perimeter still pulsing.
            2. Inner shadow polygon offset down-right (the void below
               the surface — sells DEPTH not just a flat dark patch).
            3. Sun-catch highlight on the upper-left torn edge (sun
               still grazes the lifted lip of the surrounding shingles).
            4. Splintered wood shards along each torn edge — the
               fractured sheathing fibers hanging into the void. */}
      <polygon
        points="610,196 690,232 655,250 580,222"
        fill="#0a0908"
        stroke="#eb6924"
        strokeWidth="2"
        filter="url(#rh-glow)"
        className="rh-tear-glow"
      />
      {/* Inner void — even darker, recedes into the roof */}
      <polygon
        points="618,200 685,230 653,247 587,224"
        fill="rgba(0, 0, 0, 0.85)"
        pointerEvents="none"
      />
      {/* Deepest core — pure black at the center of the hole */}
      <polygon
        points="624,206 678,228 651,243 593,224"
        fill="#000000"
        pointerEvents="none"
      />
      {/* Sun-catch on the upper-left edge of the tear (still daytime
          even mid-catastrophe — sun grazes the lifted shingle rim) */}
      <line x1="610" y1="196" x2="690" y2="232" stroke="rgba(255, 232, 188, 0.55)" strokeWidth="0.6" pointerEvents="none" />
      <line x1="610" y1="196" x2="580" y2="222" stroke="rgba(255, 232, 188, 0.42)" strokeWidth="0.6" pointerEvents="none" />
      {/* Bottom-right edge shadow — the trailing rim falls into shade */}
      <line x1="690" y1="232" x2="655" y2="250" stroke="rgba(0, 0, 0, 0.85)" strokeWidth="0.6" pointerEvents="none" />
      {/* Splintered wood shards along the tear perimeter — sheathing
          fibers bent inward by the wind pressure that ripped it free */}
      <g stroke="#3a2818" strokeWidth="0.5" fill="none" strokeLinecap="round" pointerEvents="none">
        <path d="M 622 199 L 624 203 L 622 207" />
        <path d="M 640 207 L 642 212 L 640 216" />
        <path d="M 660 218 L 662 223 L 661 227" />
        <path d="M 680 230 L 678 232 L 681 236" />
        <path d="M 670 244 L 668 240 L 670 236" />
        <path d="M 640 240 L 642 235 L 642 230" />
        <path d="M 610 232 L 612 228 L 610 224" />
        <path d="M 595 222 L 598 218 L 595 214" />
      </g>
      {/* Granule + dust cloud erupting from the breach */}
      <g pointerEvents="none">
        <circle cx="640" cy="195" r="0.6" fill="rgba(120, 100, 75, 0.65)" />
        <circle cx="650" cy="190" r="0.45" fill="rgba(100, 85, 65, 0.55)" />
        <circle cx="635" cy="188" r="0.40" fill="rgba(110, 90, 70, 0.50)" />
        <circle cx="660" cy="185" r="0.50" fill="rgba(100, 85, 65, 0.45)" />
        <circle cx="670" cy="200" r="0.35" fill="rgba(120, 100, 75, 0.55)" />
        <circle cx="625" cy="192" r="0.40" fill="rgba(110, 90, 70, 0.50)" />
      </g>

      {/* Flying sheathing panel — now with TRUE THICKNESS:
            - Underside shadow polygon offset down + right (the panel
              has depth, you can see its edge from below as it tumbles).
            - Top-face bevel on all four sides (sun + shadow rims).
            - Splintered torn-out edges with bent wood fibers.
            - A few sheared nail heads still poking out where the panel
              ripped free of the rafters. */}
      <g className="rh-panel-fly" style={{ transformOrigin: '780px 140px' }}>
        <g transform="translate(720 110) rotate(15)">
          {/* UNDERSIDE shadow — offset to suggest the panel has thickness */}
          <rect x="2" y="2" width="120" height="60" fill="rgba(0, 0, 0, 0.45)" />
          <rect x="3" y="3" width="120" height="60" fill="rgba(0, 0, 0, 0.30)" />
          {/* Top face — OSB sheathing pattern */}
          <rect width="120" height="60" fill="url(#rh-sheathing-pat)" stroke="#3a2e22" strokeWidth="1" opacity="0.92" />
          {/* 4-sided bevel highlights + shadows on the top face */}
          <line x1="0" y1="0.5" x2="120" y2="0.5" stroke="rgba(255, 220, 165, 0.45)" strokeWidth="0.5" />
          <line x1="0.5" y1="0" x2="0.5" y2="60" stroke="rgba(255, 220, 165, 0.30)" strokeWidth="0.4" />
          <line x1="119.5" y1="0" x2="119.5" y2="60" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
          <line x1="0" y1="59.5" x2="120" y2="59.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.5" />
          {/* Splintered LEFT edge — torn wood fibers hanging out */}
          <g stroke="#1a1208" strokeWidth="0.6" fill="none" strokeLinecap="round">
            <path d="M 0 8 L -3 9 L -1 11" />
            <path d="M 0 22 L -4 24 L -1 26" />
            <path d="M 0 36 L -3 37 L -2 40" />
            <path d="M 0 50 L -4 52 L -1 53" />
          </g>
          {/* Splintered TOP edge */}
          <g stroke="#1a1208" strokeWidth="0.5" fill="none" strokeLinecap="round">
            <path d="M 18 0 L 19 -3 L 21 -1" />
            <path d="M 50 0 L 51 -4 L 53 -1" />
            <path d="M 82 0 L 84 -3 L 86 -1" />
          </g>
          {/* Sheared nail heads — silvery dots where rafter fasteners
              ripped free of the wood */}
          <circle cx="14" cy="6" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="13.5" cy="5.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          <circle cx="60" cy="6" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="59.5" cy="5.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          <circle cx="106" cy="6" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="105.5" cy="5.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          <circle cx="14" cy="54" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="13.5" cy="53.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          <circle cx="60" cy="54" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="59.5" cy="53.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          <circle cx="106" cy="54" r="0.8" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.3" />
          <circle cx="105.5" cy="53.5" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
          {/* Hot-edge ember outline (kept from original — sells the
              violence of the tear) */}
          <rect width="120" height="60" fill="none" stroke="#eb6924" strokeWidth="1" opacity="0.5" />
        </g>
      </g>
    </g>
  );
}
