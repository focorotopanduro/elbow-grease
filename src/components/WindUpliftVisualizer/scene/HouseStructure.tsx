import { lerpRgb } from './colors';

/**
 * HouseStructure — the structural envelope that does NOT fail in the wind
 * cascade: walls, foundation, doors, windows, gutters, chimney.
 *
 * Anatomy (viewBox 800×480):
 *   ─ GARAGE (x 100–280, y 234–440)
 *       small gable roof, stucco walls, side-wall extrusion + rim light,
 *       paneled overhead door, gable vent, gutter
 *   ─ MAIN HOUSE (x 280–720, y 238–445)
 *       walls + side-wall + rim light + eave/soffit shadow
 *       foundation skirt with extruded right edge
 *       drip edge / fascia / gutter / downspouts (hidden when sheathing gone)
 *       two windows (with hurricane shutters that close above 140 mph)
 *       porch overhang + posts
 *       paneled front door + handle + address plaque
 *       two porch light fixtures (warmer when calm)
 *       walkway pavers
 *   ─ CHIMNEY (x 553–582, y 178–230) with smoke that bends downwind
 *
 * The chimney is included here (not in RoofAssembly) because it's a wall
 * structure attached to the house — it doesn't lift in a hurricane.
 */
interface Props {
  /** 0–1 storm intensity */
  storm: number;
  /** Sun radial opacity — drives rim-light brightness on west walls */
  sunOpacity: number;
  /** 0–1 calm (1 - storm) — drives porch-light warmth */
  calm: number;
  /** Hurricane shutters closed (true above 140 mph) */
  shuttersClosed: boolean;
  /** Sheathing torn away — hide drip edge / fascia / gutter */
  sheathingGone: boolean;
  /** Drip-edge cascade stage triggered — flutter the metal tips */
  dripEdgeUp: boolean;
  /** Trim color (sills, frames, shutters) — drifts darker with storm */
  trimColor: string;
  /** Smoke-plume opacity (0 when calm or roof gone) */
  smokeOpacity: number;
  /** Lateral smoke offset in px — positive = bends right (with wind) */
  smokeBend: number;
  /** Front door fill color (from active DoorColor preset) */
  doorFill: string;
  /** Front door panel-stroke color (darker shade of doorFill) */
  doorPanelStroke: string;
  /** Interior window-glow opacity (from active TOD; 0 in day, ~0.9 at night) */
  interiorGlowOpacity?: number;
  /** Lightning interior flash active (boosts glow to 1.0 briefly) */
  lightningFlash?: boolean;
  /** Wind speed in mph — drives garage-door buckling at >160 mph */
  windSpeed?: number;
  /** Rain intensity 0–1 — drives wet-window drop streams */
  rainIntensity?: number;
  /** Power outage active — force interior window glow to 0 regardless of TOD.
   *  Fires when PowerInfrastructure detects line snap; reads as "lights out". */
  powerOut?: boolean;
}

export default function HouseStructure({
  storm,
  sunOpacity,
  calm,
  shuttersClosed,
  sheathingGone,
  dripEdgeUp,
  trimColor,
  smokeOpacity,
  smokeBend,
  doorFill,
  doorPanelStroke,
  interiorGlowOpacity = 0,
  lightningFlash = false,
  windSpeed = 0,
  rainIntensity = 0,
  powerOut = false,
}: Props) {
  // Effective interior glow: power outage > lightning flash > TOD base.
  // Lightning still arcs through windows during an outage (it's external),
  // so the flash boost survives even if the grid is down.
  const effectiveGlow = lightningFlash
    ? 1
    : powerOut
      ? 0
      : interiorGlowOpacity;
  // Garage door buckling — real FBC §1714 failure mode at extreme winds
  const garageBuckle = windSpeed > 160;
  const buckleSeverity = Math.min(1, Math.max(0, (windSpeed - 160) / 30));
  // Window glass damage — escalates with wind speed when shutters
  // weren't deployed in time:
  //   >120 mph: spider cracks at single impact point
  //   >150 mph: secondary impact points + tinted darkened glass
  //   >175 mph: full shatter with hanging shards
  //   >195 mph: BLOWN OUT — entire pane gone, dark interior void
  const glassCracks = windSpeed > 120 && !shuttersClosed;
  const glassShattered = windSpeed > 175 && !shuttersClosed;
  const glassBlownOut = windSpeed > 195 && !shuttersClosed;
  const crackSeverity = Math.min(1, Math.max(0, (windSpeed - 120) / 40));
  const multiImpact = crackSeverity > 0.6;
  // Stucco corner cracks — extreme wind pressure cracks corners first.
  // Real FBC failure mode: walls flex at corners under suction loads.
  const stuccoCrack = storm > 0.78;
  const stuccoCrackSeverity = Math.min(1, Math.max(0, (storm - 0.78) / 0.22));
  // Garage interior void — deep buckle at >175 mph reveals the dark
  // interior behind the bowed-in door (light spills out at night via
  // the existing interior glow).
  const garageInteriorVisible = windSpeed > 175;
  // 3D depth tones — local to this module so iterating shadow strength
  // doesn't touch the rest of the SVG.
  const sideWallShadow = `rgba(${20 - storm * 12}, ${18 - storm * 12}, ${15 - storm * 10}, 0.85)`;
  const sideWallShadowMain = `rgba(${20 - storm * 12}, ${18 - storm * 12}, ${15 - storm * 10}, 0.88)`;
  const chimneyShadow = `rgba(${20 - storm * 12}, ${18 - storm * 12}, ${15 - storm * 10}, 0.85)`;
  const chimneyCapShadow = `rgba(${15 - storm * 10}, ${14 - storm * 9}, ${12 - storm * 8}, 0.9)`;
  const garageEndCapFill = `rgba(0, 0, 0, ${0.55 + storm * 0.2})`;
  const foundationTone = lerpRgb([130, 118, 100], [60, 54, 46], storm);
  const foundationDeep = lerpRgb([90, 80, 68], [40, 36, 30], storm);
  const chimneyFace = lerpRgb([60, 50, 42], [32, 28, 24], storm);
  const chimneyCap = lerpRgb([42, 36, 30], [22, 20, 18], storm);

  return (
    <>
      {/* ════════════════════════════════════════════════════════════════
          GARAGE — 2-CAR variant matching Sandra's house at 2703 Dobbin.
          Wider footprint (x 80–280, was 100–280), 5-panel overhead door
          (was 4-panel), centered peak at x=180. Accent gable with
          board-and-batten siding pops above the garage roofline as the
          characteristic Florida-ranch architectural detail.
          ════════════════════════════════════════════════════════════════ */}
      <g>
        {/* Garage roof (lower, peak now centered at x=180) */}
        <polygon points="80,290 180,234 280,290" fill="url(#rh-shingles)" stroke="#0a0908" strokeWidth="1" />
        <polygon points="80,290 180,234 280,290" fill="url(#rh-roof-light)" style={{ mixBlendMode: 'overlay' }} />
        {/* Roof gable end-cap — small triangle at right showing 3D depth.
            Brick texture + sun rim along the top edge. */}
        <polygon
          points="280,290 286,290 182,236 180,234"
          fill={garageEndCapFill}
          stroke="#0a0908"
          strokeWidth="0.6"
        />
        <polygon
          points="280,290 286,290 182,236 180,234"
          fill="url(#rh-chimney-brick)"
          opacity="0.45"
          pointerEvents="none"
        />
        {/* Top sun-rim along the diagonal — catches light against the
            roof slope */}
        <line x1="180" y1="234" x2="280" y2="290" stroke="rgba(255, 230, 180, 0.20)" strokeWidth="0.4" />

        {/* ── ACCENT GABLE above garage — board-and-batten dormer-style
            architectural feature popping above the main garage roofline.
            Sits centered over the garage at x=180, peaking at y=206.
            This is the architectural detail that turns the garage from
            a generic box into the Sandra-house "look." ── */}
        <polygon
          points="156,234 180,206 204,234"
          fill="url(#rh-board-batten)"
          stroke="#0a0908"
          strokeWidth="0.6"
        />
        {/* Accent-gable trim board across the base — the cornice that
            visually separates the dormer from the roof below */}
        <rect x="154" y="232" width="52" height="2.5" fill="#3a2f24" stroke="#0a0908" strokeWidth="0.3" />
        {/* Sun-edge highlight along the left rake of the accent gable */}
        <line x1="156" y1="234" x2="180" y2="206" stroke="rgba(255, 240, 200, 0.32)" strokeWidth="0.5" />
        {/* Right-rake shadow */}
        <line x1="180" y1="206" x2="204" y2="234" stroke="rgba(0, 0, 0, 0.38)" strokeWidth="0.5" />
        {/* Tiny round vent window in the gable peak (Florida ranch staple) */}
        <circle cx="180" cy="222" r="3.5" fill="#1a1612" stroke="#3a2f24" strokeWidth="0.5" />
        <circle cx="180" cy="222" r="2.2" fill="rgba(255, 220, 140, 0.18)" />
        <line x1="176.5" y1="222" x2="183.5" y2="222" stroke="#3a2f24" strokeWidth="0.4" />
        <line x1="180" y1="218.5" x2="180" y2="225.5" stroke="#3a2f24" strokeWidth="0.4" />

        {/* Garage walls (widened to x=80–280) */}
        <rect x="80" y="288" width="200" height="152" fill="url(#rh-wall)" stroke="#0a0908" strokeWidth="0.8" />
        <rect x="80" y="288" width="200" height="152" fill="url(#rh-stucco)" pointerEvents="none" />
        {/* CMU concrete-block underlay — Sandra's house is real CMU
            construction. Low opacity so the running-bond mortar joints
            read subtly through the stucco finish. */}
        <rect x="80" y="288" width="200" height="152" fill="url(#rh-cmu-block)" opacity="0.32" pointerEvents="none" />
        {/* Garage face-light — sun cue */}
        <rect x="80" y="288" width="200" height="152" fill="url(#rh-face-light)" pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />

        {/* Garage SIDE-WALL EXTRUSION — narrow shadow strip on right edge */}
        <rect
          x="280"
          y="290"
          width="8"
          height="150"
          fill={sideWallShadow}
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Side-face vertical depth */}
        <rect x="280" y="290" width="8" height="150" fill="url(#rh-side-shadow)" pointerEvents="none" />
        {/* Side-wall vertical edge accent */}
        <line x1="280" y1="290" x2="280" y2="440" stroke="rgba(0,0,0,0.7)" strokeWidth="0.6" />

        {/* Rim light on garage LEFT edge (sun catching the corner) */}
        <line
          x1="80" y1="290" x2="80" y2="440"
          stroke={`rgba(255, 240, 200, ${0.25 * sunOpacity})`}
          strokeWidth="1.2"
        />

        {/* Garage soffit shadow */}
        <rect x="80" y="288" width="200" height="6" fill="rgba(0,0,0,0.35)" />

        {/* 2-CAR garage door — paneled white, 5 panels per row.
            Buckling transform at >160 mph still applies (FBC §1714).
            Center now at x=180 (was 190). */}
        <g
          data-label="garage-door"
          className={garageBuckle ? 'rh-garage-buckle' : ''}
          style={garageBuckle ? {
            transformOrigin: '180px 379px',
            transform: `scaleX(${1 - buckleSeverity * 0.07}) scaleY(${1 - buckleSeverity * 0.02})`,
          } : undefined}
        >
          <rect x="96" y="320" width="168" height="118" fill="#e8e3da" stroke="#0a0908" strokeWidth="0.8" />
          {/* Door face-light — sun cue on the white panels */}
          <rect x="96" y="320" width="168" height="118" fill="url(#rh-face-light)" pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
          {/* Top-of-door cast shadow from the lintel above */}
          <rect x="96" y="320" width="168" height="6" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.7" />
          {/* Outer-frame bevel — top + left rim highlights, right + bottom
              edge shadows. Reads as the door extruded slightly forward of
              the surrounding stucco wall. */}
          <line x1="96.5" y1="320" x2="96.5" y2="438" stroke="rgba(255, 245, 220, 0.40)" strokeWidth="0.5" />
          <line x1="96" y1="320.5" x2="264" y2="320.5" stroke="rgba(255, 245, 220, 0.30)" strokeWidth="0.4" />
          <line x1="263.5" y1="320" x2="263.5" y2="438" stroke="rgba(0, 0, 0, 0.32)" strokeWidth="0.5" />
          <line x1="96" y1="437.5" x2="264" y2="437.5" stroke="rgba(0, 0, 0, 0.40)" strokeWidth="0.5" />
          {/* Panel divisions — 4 horizontal rows, 5 vertical panels per row.
              Each horizontal divider gets the AO band + sun-catch lip. */}
          {[0, 1, 2, 3].map((row) => (
            <g key={`gh-${row}`}>
              <line x1="96" y1={320 + row * 30} x2="264" y2={320 + row * 30} stroke="#7d7466" strokeWidth="0.6" />
              <rect x="96" y={320 + row * 30} width="168" height="3" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.65" />
              <line x1="98" y1={320 + row * 30 + 3.2} x2="262" y2={320 + row * 30 + 3.2} stroke="rgba(255, 250, 235, 0.42)" strokeWidth="0.4" />
            </g>
          ))}
          {[0, 1, 2, 3].map((col) => {
            const x = 96 + (col + 1) * 33.6;
            return (
              <g key={`gv-${col}`}>
                {/* Vertical separator line + thin sun-catch on its right side */}
                <line x1={x} y1="320" x2={x} y2="438" stroke="#7d7466" strokeWidth="0.4" />
                <line x1={x + 0.6} y1="320" x2={x + 0.6} y2="438" stroke="rgba(255, 250, 235, 0.20)" strokeWidth="0.3" />
              </g>
            );
          })}
          {/* Garage door handle — beveled lift bar with embossed grip.
              Top sun-rim + bottom shadow, plus a hot pinhole specular
              dot reading as polished metal. */}
          <g aria-hidden="true">
            <rect x="176" y="376" width="8" height="6" fill="#3a3128" />
            {/* Top sun-edge rim */}
            <line x1="176" y1="376.4" x2="184" y2="376.4" stroke="rgba(255, 230, 175, 0.55)" strokeWidth="0.5" />
            {/* Bottom shadow rim */}
            <line x1="176" y1="381.6" x2="184" y2="381.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.5" />
            {/* Left + right edge bevel */}
            <line x1="176.3" y1="376" x2="176.3" y2="382" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.3" />
            <line x1="183.7" y1="376" x2="183.7" y2="382" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.3" />
            {/* Polished metal pinhole specular */}
            <circle cx="178" cy="377.4" r="0.5" fill="rgba(255, 250, 230, 0.85)" />
          </g>
          {/* Buckle damage — visible inward bow + diagonal cracks. */}
          {garageBuckle && (
            <g style={{ opacity: buckleSeverity }} aria-hidden="true">
              {/* Inward-bowing left edge highlight (deeper bow on wider door) */}
              <path
                d={`M 96 320 Q ${(96 + 10 * buckleSeverity).toFixed(1)} 379 96 438`}
                stroke="rgba(60, 50, 38, 0.85)"
                strokeWidth={1.4 + buckleSeverity * 1.2}
                fill="none"
              />
              {/* Inward-bowing right edge highlight */}
              <path
                d={`M 264 320 Q ${(264 - 10 * buckleSeverity).toFixed(1)} 379 264 438`}
                stroke="rgba(60, 50, 38, 0.85)"
                strokeWidth={1.4 + buckleSeverity * 1.2}
                fill="none"
              />
              {/* Buckled center seam — vertical pleat down the middle (x=180) */}
              <line
                x1="180" y1={332 + 4 * buckleSeverity}
                x2="180" y2={428 - 4 * buckleSeverity}
                stroke="rgba(50, 40, 30, 0.7)"
                strokeWidth={0.8 + buckleSeverity * 1.0}
                strokeDasharray={buckleSeverity > 0.5 ? "4 2" : ""}
              />
              {/* Diagonal crack lines (rebuilt for wider door) */}
              <path d="M 122 332 L 148 360 L 142 378 L 162 405" stroke="rgba(40, 30, 22, 0.85)" strokeWidth="1.0" fill="none" />
              <path d="M 238 340 L 222 372 L 232 398 L 218 432" stroke="rgba(40, 30, 22, 0.75)" strokeWidth="0.8" fill="none" />
              {/* Shadow inside the buckle (the dark recess where door bows in) */}
              <path
                d={`M 104 326 Q 180 ${340 + 18 * buckleSeverity} 256 326 L 256 432 Q 180 ${418 + 18 * buckleSeverity} 104 432 Z`}
                fill="rgba(0, 0, 0, 0.18)"
                opacity={buckleSeverity * 0.6}
              />
              {/* GARAGE INTERIOR VOID — at extreme buckle (>175 mph)
                  the door has bowed in enough that you can see DARK
                  GARAGE SPACE behind it. Pure black recess + a few
                  visible interior elements (rafter shadows, joist
                  outline) to sell the depth.

                  v2 ITERATION: progressive interior reveal as winds
                  escalate:
                    >175 mph → basic void + rafter bands
                    >182 mph → CONCRETE FLOOR band + INTERIOR CONTENTS
                               silhouette (car bumper / shelving)
                    >188 mph → INSULATION BATTS hanging in shreds
                    >194 mph → TORN METAL door panels curling inward
                               + sheared bolts visible at the rim */}
              {garageInteriorVisible && (
                <g aria-hidden="true" style={{ opacity: Math.min(1, (windSpeed - 175) / 20) }} pointerEvents="none">
                  {/* Inner void — pure black behind the bowed door */}
                  <path
                    d="M 132 350 Q 180 380 228 350 L 228 410 Q 180 425 132 410 Z"
                    fill="#000000"
                  />
                  {/* v3 — INTERIOR GARAGE LIGHT GLOW. The garage's
                      overhead bulb is still on (when power is on);
                      its glow spills through the void as a warm
                      halo. Suppressed during power outage. */}
                  {!powerOut && (
                    <g>
                      <radialGradient id="rh-garage-bulb-glow" cx="50%" cy="20%" r="60%">
                        <stop offset="0%" stopColor="rgba(255, 220, 130, 0.60)" />
                        <stop offset="60%" stopColor="rgba(255, 200, 110, 0.20)" />
                        <stop offset="100%" stopColor="rgba(255, 180, 90, 0)" />
                      </radialGradient>
                      <ellipse cx="180" cy="368" rx="50" ry="22" fill="url(#rh-garage-bulb-glow)" style={{ mixBlendMode: 'screen' }} />
                      {/* The bulb itself — small bright dot at the
                          opener motor unit position */}
                      <circle cx="180" cy="361" r="0.9" fill="rgba(255, 250, 200, 0.95)" />
                      <circle cx="180" cy="361" r="2.2" fill="rgba(255, 230, 165, 0.45)" />
                    </g>
                  )}
                  {/* Visible rafter shadows inside the void (3 horizontal bands) */}
                  <line x1="138" y1="365" x2="222" y2="365" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.6" />
                  <line x1="138" y1="385" x2="222" y2="385" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.6" />
                  <line x1="140" y1="402" x2="220" y2="402" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.6" />

                  {/* CONCRETE FLOOR band visible at the bottom of the
                      void (lighter horizontal sliver near the bottom
                      of the curved opening) */}
                  {windSpeed > 182 && (
                    <g aria-hidden="true">
                      <path
                        d="M 138 415 Q 180 422 222 415 L 220 421 Q 180 427 140 421 Z"
                        fill="#3a342a"
                      />
                      <line x1="138" y1="415" x2="222" y2="415" stroke="rgba(180, 160, 130, 0.32)" strokeWidth="0.4" />
                      {/* Concrete texture flecks */}
                      <circle cx="156" cy="418" r="0.3" fill="rgba(120, 105, 85, 0.55)" />
                      <circle cx="180" cy="419" r="0.25" fill="rgba(160, 140, 115, 0.45)" />
                      <circle cx="204" cy="418" r="0.3" fill="rgba(120, 105, 85, 0.55)" />
                    </g>
                  )}

                  {/* INTERIOR CONTENTS — silhouettes of stuff inside
                      the garage. A horizontal car bumper line + a
                      vertical ladder/shelf silhouette suggest "this
                      is a real garage with stuff in it" */}
                  {windSpeed > 182 && (
                    <g aria-hidden="true">
                      {/* Car bumper silhouette (horizontal dark band
                          mid-void with subtle highlight on top) */}
                      <rect x="148" y="395" width="64" height="6" fill="rgba(20, 15, 10, 1)" />
                      <line x1="148" y1="395.4" x2="212" y2="395.4" stroke="rgba(180, 160, 130, 0.32)" strokeWidth="0.3" />
                      {/* Bumper headlight glints (catching outdoor light) */}
                      <circle cx="158" cy="397.5" r="0.7" fill="rgba(220, 200, 160, 0.55)" />
                      <circle cx="202" cy="397.5" r="0.7" fill="rgba(220, 200, 160, 0.55)" />
                      {/* Wall-mounted ladder silhouette on the left side */}
                      <line x1="142" y1="362" x2="142" y2="395" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.5" />
                      <line x1="146" y1="362" x2="146" y2="395" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.5" />
                      <line x1="142" y1="370" x2="146" y2="370" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.4" />
                      <line x1="142" y1="378" x2="146" y2="378" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.4" />
                      <line x1="142" y1="386" x2="146" y2="386" stroke="rgba(40, 30, 20, 0.85)" strokeWidth="0.4" />
                      {/* Garage door opener motor unit silhouette
                          (small box hanging from rafter) */}
                      <rect x="174" y="358" width="12" height="5" fill="rgba(30, 25, 18, 1)" />
                      <line x1="174" y1="358.4" x2="186" y2="358.4" stroke="rgba(180, 160, 130, 0.30)" strokeWidth="0.3" />
                      {/* Status LED on the opener (small pinhole) */}
                      <circle cx="184" cy="361" r="0.4" fill="rgba(120, 220, 100, 0.65)" />
                    </g>
                  )}

                  {/* INSULATION BATTS — pink/yellow fiberglass hanging
                      in shreds from the ceiling/rafters once the wind
                      has ripped through the rafter bays */}
                  {windSpeed > 188 && (
                    <g aria-hidden="true" style={{ opacity: Math.min(1, (windSpeed - 188) / 8) }}>
                      <path
                        d="M 156 358 Q 158 366 154 374 Q 156 380 152 386"
                        stroke="rgba(220, 175, 195, 0.75)"
                        strokeWidth="2.2"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 198 360 Q 200 368 202 376 Q 200 382 204 388"
                        stroke="rgba(220, 175, 195, 0.70)"
                        strokeWidth="2.0"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 218 364 Q 220 372 218 378"
                        stroke="rgba(220, 175, 195, 0.65)"
                        strokeWidth="1.8"
                        fill="none"
                        strokeLinecap="round"
                      />
                      {/* Yellow-cream fiberglass core showing through */}
                      <path
                        d="M 156 360 Q 156 368 154 374"
                        stroke="rgba(245, 230, 175, 0.55)"
                        strokeWidth="0.8"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 198 362 Q 200 370 202 376"
                        stroke="rgba(245, 230, 175, 0.55)"
                        strokeWidth="0.8"
                        fill="none"
                        strokeLinecap="round"
                      />
                    </g>
                  )}

                  {/* TORN METAL EDGES + SHEARED BOLTS — at extreme
                      buckle the door panel itself has shredded around
                      the void perimeter, with twisted metal flaps
                      curling inward and sheared galvanized bolts
                      around the rim where the panel ripped from the
                      door track */}
                  {windSpeed > 194 && (
                    <g aria-hidden="true" style={{ opacity: Math.min(1, (windSpeed - 194) / 6) }}>
                      {/* Torn metal flaps curling INTO the void */}
                      <path
                        d="M 132 350 L 138 358 L 144 354 L 142 360"
                        stroke="rgba(240, 235, 225, 0.55)"
                        strokeWidth="0.6"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 228 350 L 222 358 L 216 354 L 218 360"
                        stroke="rgba(240, 235, 225, 0.55)"
                        strokeWidth="0.6"
                        fill="none"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 180 412 L 176 418 L 184 418 L 182 412"
                        stroke="rgba(240, 235, 225, 0.55)"
                        strokeWidth="0.6"
                        fill="none"
                        strokeLinecap="round"
                      />
                      {/* Sheared bolts around the void perimeter
                          (silvery dots with hot specular pinholes,
                          same treatment as the sheathing-panel nails) */}
                      <circle cx="138" cy="354" r="0.7" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.2" />
                      <circle cx="137.7" cy="353.7" r="0.25" fill="rgba(255, 252, 240, 0.85)" />
                      <circle cx="222" cy="354" r="0.7" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.2" />
                      <circle cx="221.7" cy="353.7" r="0.25" fill="rgba(255, 252, 240, 0.85)" />
                      <circle cx="180" cy="378" r="0.7" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.2" />
                      <circle cx="179.7" cy="377.7" r="0.25" fill="rgba(255, 252, 240, 0.85)" />
                      <circle cx="160" cy="416" r="0.7" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.2" />
                      <circle cx="159.7" cy="415.7" r="0.25" fill="rgba(255, 252, 240, 0.85)" />
                      <circle cx="200" cy="416" r="0.7" fill="#c8c2b8" stroke="#3a2818" strokeWidth="0.2" />
                      <circle cx="199.7" cy="415.7" r="0.25" fill="rgba(255, 252, 240, 0.85)" />
                      {/* Bent door-track rail visible across the top
                          (twisted aluminum extrusion) */}
                      <path
                        d="M 138 360 Q 162 365 180 362 Q 198 365 222 360"
                        stroke="rgba(180, 175, 165, 0.65)"
                        strokeWidth="0.8"
                        fill="none"
                      />
                      <path
                        d="M 138 360 Q 162 365 180 362 Q 198 365 222 360"
                        stroke="rgba(255, 245, 220, 0.30)"
                        strokeWidth="0.3"
                        fill="none"
                      />
                    </g>
                  )}

                  {/* v3 — CURLING DOOR PANEL EDGES at storm > 178 mph.
                      The door panels themselves are visibly rolling
                      back from the void perimeter. Each panel curl
                      shows the inner steel skin (lighter color) +
                      exterior paint (white) wrapping around. */}
                  {windSpeed > 178 && (
                    <g style={{ opacity: Math.min(1, (windSpeed - 178) / 12) }}>
                      {/* Left curl — door panel rolling back toward
                          the upper-left, showing inside surface */}
                      <path
                        d="M 132 350 Q 124 354 120 362 Q 122 358 130 354"
                        fill="rgba(220, 215, 210, 0.85)"
                        stroke="#0a0908"
                        strokeWidth="0.4"
                      />
                      {/* Inner curl shadow */}
                      <path
                        d="M 124 354 Q 120 360 122 358"
                        stroke="rgba(0, 0, 0, 0.55)"
                        strokeWidth="0.4"
                        fill="none"
                      />
                      {/* Right curl — mirrored on the other side */}
                      <path
                        d="M 228 350 Q 236 354 240 362 Q 238 358 230 354"
                        fill="rgba(220, 215, 210, 0.85)"
                        stroke="#0a0908"
                        strokeWidth="0.4"
                      />
                      <path
                        d="M 236 354 Q 240 360 238 358"
                        stroke="rgba(0, 0, 0, 0.55)"
                        strokeWidth="0.4"
                        fill="none"
                      />
                      {/* Bottom curl — middle of the void where the
                          panel sags downward, peeling off the floor */}
                      <path
                        d="M 158 414 Q 162 420 168 422 Q 164 418 162 414"
                        fill="rgba(220, 215, 210, 0.78)"
                        stroke="#0a0908"
                        strokeWidth="0.4"
                      />
                      <path
                        d="M 198 414 Q 202 420 196 422 Q 198 418 200 414"
                        fill="rgba(220, 215, 210, 0.78)"
                        stroke="#0a0908"
                        strokeWidth="0.4"
                      />
                    </g>
                  )}

                  {/* Rim light along the torn opening edge (light still
                      catches the lifted door panel where it pulls away).
                      Drawn LAST so it sits on top of any interior content. */}
                  <path
                    d="M 132 350 Q 180 380 228 350"
                    stroke="rgba(255, 230, 175, 0.55)"
                    strokeWidth="0.5"
                    fill="none"
                  />
                </g>
              )}
            </g>
          )}
        </g>

        {/* Gutter along garage eave (widened to span new garage footprint) */}
        <rect x="78" y="289" width="204" height="3" fill="#0e0c0a" />
      </g>

      {/* ════════════════════════════════════════════════════════════════
          MAIN HOUSE — walls + foundation + drip edge + windows + porch
          ════════════════════════════════════════════════════════════════ */}
      <g>
        {/* Main house body */}
        <g data-label="wall-stucco">
          <rect x="280" y="238" width="440" height="202" fill="url(#rh-wall)" stroke="#0a0908" strokeWidth="1" />
          <rect x="280" y="238" width="440" height="202" fill="url(#rh-stucco)" pointerEvents="none" />
          {/* CMU concrete-block underlay — Sandra's actual house at 2703
              Dobbin is real CMU construction (Central FL hurricane-rated).
              Low opacity so the running-bond mortar joints read subtly
              through the stucco finish, the way they do in person. */}
          <rect x="280" y="238" width="440" height="202" fill="url(#rh-cmu-block)" opacity="0.30" pointerEvents="none" />
          <rect x="280" y="238" width="440" height="202" fill="url(#rh-siding)" pointerEvents="none" opacity="0.6" />
        </g>
        {/* Sun-facing face light — top-bright → bottom-dark vertical cue */}
        <rect x="280" y="238" width="440" height="202" fill="url(#rh-face-light)" pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
        {/* Reflected fill light — warm bounce from the lawn UP onto the lower wall */}
        <rect x="280" y="320" width="440" height="120" fill="url(#rh-fill-light)" pointerEvents="none" style={{ mixBlendMode: 'screen' }} />

        {/* MAIN HOUSE SIDE-WALL EXTRUSION — right-side shadow gives the 3D box look */}
        <rect
          x="720"
          y="244"
          width="12"
          height="196"
          fill={sideWallShadowMain}
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Side-face vertical depth gradient — top brighter than bottom */}
        <rect x="720" y="244" width="12" height="196" fill="url(#rh-side-shadow)" pointerEvents="none" />
        <line x1="720" y1="240" x2="720" y2="440" stroke="rgba(0,0,0,0.75)" strokeWidth="0.6" />
        {/* Subtle texture on the side wall */}
        <rect x="720" y="244" width="12" height="196" fill="url(#rh-siding)" opacity="0.4" />

        {/* RIM LIGHT on main-house LEFT edge — sun-catching highlight */}
        <line
          x1="280" y1="240" x2="280" y2="440"
          stroke={`rgba(255, 245, 215, ${0.32 * sunOpacity})`}
          strokeWidth="1.5"
        />

        {/* SOFFIT PANEL — ribbed underside of the eave projecting out from
            the wall. The soffit fixture is the strongest architectural-
            depth cue on a real house. */}
        <rect x="272" y="238" width="456" height="5" fill="url(#rh-soffit)" pointerEvents="none" />
        {/* Soffit deep shadow line where it meets the wall */}
        <rect x="280" y="243" width="440" height="2" fill="rgba(0,0,0,0.65)" />
        {/* Cornice trim band — narrow decorative strip below soffit,
            now beveled so the molding reads as a raised painted band
            rather than a flat color stripe */}
        <rect x="276" y="245" width="448" height="2" fill={trimColor} opacity="0.85" />
        <line x1="276" y1="245.3" x2="724" y2="245.3" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.3" />
        <line x1="276" y1="246.7" x2="724" y2="246.7" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />

        {/* Original eave/soffit shadow band kept narrower */}
        <rect x="280" y="247" width="440" height="3" fill="rgba(0,0,0,0.32)" />

        {/* Foundation skirt — bevel: top sun-highlight + middle horizontal
            scoreline + bottom deep-shadow band so the slab reads as a
            raised concrete course supporting the wall above. */}
        <rect x="280" y="436" width="440" height="9" fill={foundationTone} stroke="#0a0908" strokeWidth="0.5" />
        {/* Top edge highlight (sun catches the lip where wall meets foundation) */}
        <line x1="280" y1="436.5" x2="720" y2="436.5" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.6" />
        {/* Mid scoreline (where the concrete pour seam runs) */}
        <line x1="280" y1="440" x2="720" y2="440" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="0.4" />
        {/* Bottom shadow band where foundation meets earth */}
        <rect x="280" y="443.5" width="440" height="1.5" fill="rgba(0, 0, 0, 0.45)" />
        {/* Foundation extruded on right */}
        <rect x="720" y="436" width="12" height="9" fill={foundationDeep} stroke="#0a0908" strokeWidth="0.4" />
        {/* Top-edge bevel on right extrusion too */}
        <line x1="720" y1="436.5" x2="732" y2="436.5" stroke="rgba(255, 240, 210, 0.18)" strokeWidth="0.4" />

        {/* STUCCO CORNER CRACKS — extreme storm pressure cracks the
            stucco at the corners first (real failure mode: corners
            flex under suction loads). Each crack has the dark fissure
            line + a 0.4px sun-catch alongside so it reads as a true
            3D split, not surface graffiti. Severity ramps with storm. */}
        {stuccoCrack && (
          <g aria-hidden="true" style={{ opacity: 0.55 + stuccoCrackSeverity * 0.45 }} pointerEvents="none">
            {/* Top-left corner crack web — radiates from corner inward */}
            <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth={0.5 + stuccoCrackSeverity * 0.4} fill="none" strokeLinecap="round">
              <path d="M 282 250 L 296 268 L 290 290 L 304 312" />
              <path d="M 282 270 L 295 285 L 308 290" />
              <path d="M 290 312 L 305 320 L 310 340" />
            </g>
            <g stroke="rgba(255, 240, 210, 0.35)" strokeWidth="0.25" fill="none" strokeLinecap="round">
              <path d="M 282.4 249.6 L 296.4 267.6 L 290.4 289.6 L 304.4 311.6" />
              <path d="M 282.4 269.6 L 295.4 284.6 L 308.4 289.6" />
              <path d="M 290.4 311.6 L 305.4 319.6 L 310.4 339.6" />
            </g>
            {/* Top-right corner crack web */}
            <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth={0.5 + stuccoCrackSeverity * 0.4} fill="none" strokeLinecap="round">
              <path d="M 718 250 L 704 268 L 710 290 L 696 312" />
              <path d="M 718 270 L 705 285 L 692 290" />
              <path d="M 710 312 L 695 320 L 690 340" />
            </g>
            <g stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.25" fill="none" strokeLinecap="round">
              <path d="M 717.6 250.4 L 703.6 268.4 L 709.6 290.4 L 695.6 312.4" />
              <path d="M 717.6 270.4 L 704.6 285.4 L 691.6 290.4" />
              <path d="M 709.6 312.4 L 694.6 320.4 L 689.6 340.4" />
            </g>
            {/* Above each window header — stucco bulges + cracks at the
                lintel ends (real failure pattern in CMU walls) */}
            {stuccoCrackSeverity > 0.4 && (
              <g stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.4" fill="none" strokeLinecap="round">
                <path d="M 314 295 L 318 286 L 326 282" />
                <path d="M 396 295 L 392 286 L 384 282" />
                <path d="M 604 295 L 608 286 L 616 282" />
                <path d="M 686 295 L 682 286 L 674 282" />
              </g>
            )}

            {/* v2 ITERATION — BOTTOM CORNER CRACKS at severity > 0.6.
                Suction loads on the wall pull the lower corners apart
                too. Mirrored crack web at both bottom corners + the
                door header gets its own crack pattern. */}
            {stuccoCrackSeverity > 0.6 && (
              <>
                <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth={0.5 + (stuccoCrackSeverity - 0.6) * 0.5} fill="none" strokeLinecap="round">
                  <path d="M 282 425 L 296 410 L 290 388 L 304 366" />
                  <path d="M 282 405 L 295 392 L 308 386" />
                  <path d="M 290 366 L 305 358 L 310 338" />
                </g>
                <g stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.25" fill="none" strokeLinecap="round">
                  <path d="M 282.4 424.6 L 296.4 409.6 L 290.4 387.6 L 304.4 365.6" />
                  <path d="M 282.4 404.6 L 295.4 391.6 L 308.4 385.6" />
                  <path d="M 290.4 365.6 L 305.4 357.6 L 310.4 337.6" />
                </g>
                <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth={0.5 + (stuccoCrackSeverity - 0.6) * 0.5} fill="none" strokeLinecap="round">
                  <path d="M 718 425 L 704 410 L 710 388 L 696 366" />
                  <path d="M 718 405 L 705 392 L 692 386" />
                  <path d="M 710 366 L 695 358 L 690 338" />
                </g>
                <g stroke="rgba(255, 240, 210, 0.28)" strokeWidth="0.25" fill="none" strokeLinecap="round">
                  <path d="M 717.6 425.4 L 703.6 410.4 L 709.6 388.4 L 695.6 366.4" />
                  <path d="M 717.6 405.4 L 704.6 392.4 L 691.6 386.4" />
                  <path d="M 709.6 366.4 L 694.6 358.4 L 689.6 338.4" />
                </g>
                {/* Door header cracks (cracks fan out from the door's
                    corners — door cuts the wall, weak point under load) */}
                <g stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.4" fill="none" strokeLinecap="round">
                  <path d="M 448 340 L 442 332 L 432 328" />
                  <path d="M 512 340 L 518 332 L 528 328" />
                </g>
              </>
            )}

            {/* v2 ITERATION — STUCCO SPALLING at severity > 0.78.
                Small irregular patches where the stucco skin has
                popped off, exposing the dark CMU substrate beneath.
                Each spall has a darker fill + a beveled rim showing
                the cratered broken edge (sun-catch on top, deep
                shadow on bottom of the recessed pit). */}
            {stuccoCrackSeverity > 0.78 && (
              <g style={{ opacity: (stuccoCrackSeverity - 0.78) * 4 }}>
                {/* Top-left wall spall */}
                <polygon points="318,310 332,304 340,316 336,328 322,326" fill="#2a2218" />
                <polygon points="318,310 332,304 340,316 336,328 322,326" fill="url(#rh-cmu-block)" opacity="0.85" />
                <polyline points="318,310 332,304 340,316" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.5" fill="none" />
                <polyline points="340,316 336,328 322,326 318,310" stroke="rgba(0, 0, 0, 0.75)" strokeWidth="0.5" fill="none" />
                {/* Top-right wall spall */}
                <polygon points="690,344 702,338 706,352 700,362 692,358" fill="#2a2218" />
                <polygon points="690,344 702,338 706,352 700,362 692,358" fill="url(#rh-cmu-block)" opacity="0.85" />
                <polyline points="690,344 702,338 706,352" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.5" fill="none" />
                <polyline points="706,352 700,362 692,358 690,344" stroke="rgba(0, 0, 0, 0.75)" strokeWidth="0.5" fill="none" />
                {/* Mid-left wall spall (between L window + door) */}
                <polygon points="412,372 422,366 428,378 420,386 414,382" fill="#2a2218" />
                <polygon points="412,372 422,366 428,378 420,386 414,382" fill="url(#rh-cmu-block)" opacity="0.80" />
                <polyline points="412,372 422,366 428,378" stroke="rgba(255, 240, 210, 0.42)" strokeWidth="0.4" fill="none" />
                <polyline points="428,378 420,386 414,382 412,372" stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.4" fill="none" />
                {/* Bottom-left foundation-area spall */}
                <polygon points="296,418 308,412 312,424 304,430 298,426" fill="#2a2218" />
                <polygon points="296,418 308,412 312,424 304,430 298,426" fill="url(#rh-cmu-block)" opacity="0.80" />
                <polyline points="296,418 308,412 312,424" stroke="rgba(255, 240, 210, 0.40)" strokeWidth="0.4" fill="none" />
                <polyline points="312,424 304,430 298,426 296,418" stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.4" fill="none" />
              </g>
            )}

            {/* v3 ITERATION — HANGING STUCCO PATCH at severity > 0.84.
                A patch of stucco partially detached from the wall,
                hanging by one corner with visible cracking around the
                attachment + the rest of the patch sagging away. The
                "about to fall" stage between spalling + total loss. */}
            {stuccoCrackSeverity > 0.84 && (
              <g style={{ opacity: Math.min(1, (stuccoCrackSeverity - 0.84) * 6) }} pointerEvents="none">
                {/* Hanging patch — quadrilateral tilted away from wall */}
                <polygon points="468,348 484,346 488,372 472,374" fill="rgba(180, 175, 165, 0.85)" stroke="#0a0908" strokeWidth="0.4" />
                {/* CMU exposed where the patch pulled away from */}
                <polygon points="466,346 484,344 482,348 466,350" fill="#2a2218" />
                <polygon points="466,346 484,344 482,348 466,350" fill="url(#rh-cmu-block)" opacity="0.85" />
                {/* Sun-catch on the visible top edge of the hanging patch */}
                <line x1="468" y1="348.4" x2="484" y2="346.4" stroke="rgba(255, 240, 210, 0.50)" strokeWidth="0.4" />
                {/* Bottom shadow on the sagging edge */}
                <line x1="488" y1="372" x2="472" y2="374" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.4" />
                {/* Crack line across where the patch is barely attached */}
                <path d="M 466 346 L 484 344" stroke="rgba(0, 0, 0, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
              </g>
            )}

            {/* v3 ITERATION — FALLEN STUCCO CHUNKS on the foundation
                + lawn at severity > 0.86. Pieces that have already
                detached and fallen, accumulating at the wall base.
                Each chunk has a dark substrate underneath + bright
                broken-edge stroke for 3D depth. */}
            {stuccoCrackSeverity > 0.86 && (
              <g style={{ opacity: Math.min(1, (stuccoCrackSeverity - 0.86) * 7) }} pointerEvents="none">
                {/* Chunks at foundation level (just below wall) */}
                <polygon points="290,448 302,446 308,454 296,455" fill="rgba(180, 175, 165, 0.85)" stroke="rgba(255, 240, 210, 0.55)" strokeWidth="0.3" />
                <polygon points="312,452 320,450 326,456 318,457" fill="rgba(180, 175, 165, 0.78)" stroke="rgba(255, 240, 210, 0.50)" strokeWidth="0.3" />
                <polygon points="395,452 408,450 412,456 400,457" fill="rgba(180, 175, 165, 0.82)" stroke="rgba(255, 240, 210, 0.55)" strokeWidth="0.3" />
                <polygon points="558,448 570,446 576,454 564,455" fill="rgba(180, 175, 165, 0.85)" stroke="rgba(255, 240, 210, 0.55)" strokeWidth="0.3" />
                <polygon points="685,452 696,450 700,456 690,457" fill="rgba(180, 175, 165, 0.78)" stroke="rgba(255, 240, 210, 0.50)" strokeWidth="0.3" />
                {/* Smaller fragment dust around the chunks */}
                <circle cx="296" cy="456" r="0.6" fill="rgba(160, 155, 145, 0.85)" />
                <circle cx="306" cy="455" r="0.5" fill="rgba(160, 155, 145, 0.78)" />
                <circle cx="318" cy="458" r="0.5" fill="rgba(160, 155, 145, 0.78)" />
                <circle cx="402" cy="458" r="0.6" fill="rgba(160, 155, 145, 0.85)" />
                <circle cx="566" cy="456" r="0.6" fill="rgba(160, 155, 145, 0.85)" />
                <circle cx="690" cy="458" r="0.5" fill="rgba(160, 155, 145, 0.78)" />
                {/* Bottom shadow under each chunk pile */}
                <ellipse cx="300" cy="457" rx="14" ry="1.2" fill="rgba(0, 0, 0, 0.40)" />
                <ellipse cx="404" cy="458" rx="12" ry="1.0" fill="rgba(0, 0, 0, 0.38)" />
                <ellipse cx="568" cy="457" rx="14" ry="1.2" fill="rgba(0, 0, 0, 0.40)" />
                <ellipse cx="693" cy="458" rx="11" ry="1.0" fill="rgba(0, 0, 0, 0.38)" />
              </g>
            )}

            {/* v3 ITERATION — EXPOSED REBAR at severity > 0.96.
                The catastrophic-end-stage where stucco + CMU have
                fallen away enough to reveal the structural reinforcing
                steel inside. Rusted orange-red bars visible at the
                deepest spalling areas. */}
            {stuccoCrackSeverity > 0.96 && (
              <g style={{ opacity: Math.min(1, (stuccoCrackSeverity - 0.96) * 25) }} pointerEvents="none">
                {/* Vertical rebar exposed in the top-left spalling area */}
                <line x1="328" y1="306" x2="328" y2="328" stroke="#7a3a18" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="328" y1="306" x2="328" y2="328" stroke="rgba(180, 100, 50, 0.55)" strokeWidth="0.4" strokeLinecap="round" />
                {/* Rust drip stain below */}
                <path d="M 328 328 L 327 336 L 326 344" stroke="rgba(120, 50, 22, 0.75)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
                {/* Vertical rebar in the top-right spalling area */}
                <line x1="700" y1="342" x2="700" y2="364" stroke="#7a3a18" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="700" y1="342" x2="700" y2="364" stroke="rgba(180, 100, 50, 0.55)" strokeWidth="0.4" strokeLinecap="round" />
                <path d="M 700 364 L 699 372 L 698 380" stroke="rgba(120, 50, 22, 0.75)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
                {/* Horizontal rebar tie at mid-wall */}
                <line x1="416" y1="378" x2="430" y2="378" stroke="#7a3a18" strokeWidth="1.0" strokeLinecap="round" />
                <line x1="416" y1="378" x2="430" y2="378" stroke="rgba(180, 100, 50, 0.55)" strokeWidth="0.4" strokeLinecap="round" />
              </g>
            )}

            {/* v2 ITERATION — DIAGONAL SHEAR CRACKS at severity > 0.92.
                The classic 45° fracture lines that propagate across
                CMU walls under combined wind shear + uplift. These
                cross the entire wall span. Real catastrophic-failure
                pattern — the wall is about to give. */}
            {stuccoCrackSeverity > 0.92 && (
              <g style={{ opacity: (stuccoCrackSeverity - 0.92) * 12 }} pointerEvents="none">
                <g stroke="rgba(0, 0, 0, 0.85)" strokeWidth="0.7" fill="none" strokeLinecap="round">
                  {/* Long diagonal crossing the upper wall (left to right) */}
                  <path d="M 296 268 L 360 296 L 412 314 L 478 332" />
                  {/* Mirrored shear (right to left) */}
                  <path d="M 706 282 L 644 308 L 588 324 L 522 340" />
                  {/* Vertical-ish drop crack (foundation to lintel) */}
                  <path d="M 410 422 L 416 388 L 412 354 L 418 322" />
                </g>
                <g stroke="rgba(255, 240, 210, 0.42)" strokeWidth="0.3" fill="none" strokeLinecap="round">
                  <path d="M 296.4 267.6 L 360.4 295.6 L 412.4 313.6 L 478.4 331.6" />
                  <path d="M 706.4 281.6 L 644.4 307.6 L 588.4 323.6 L 522.4 339.6" />
                  <path d="M 410.4 421.6 L 416.4 387.6 L 412.4 353.6 L 418.4 321.6" />
                </g>
              </g>
            )}
          </g>
        )}

        {/* DRIP EDGE + FASCIA + GUTTER — every metal element now has a
            top sun-rim + bottom shadow so it reads as physical sheet
            metal projecting forward from the wall plane. */}
        {!sheathingGone && (
          <g data-label="drip-edge">
            {/* Fascia trim — beveled aluminum board */}
            <rect x="272" y="236" width="456" height="4" fill="#1a1612" />
            <line x1="272" y1="236.4" x2="728" y2="236.4" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.3" />
            <line x1="272" y1="239.6" x2="728" y2="239.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
            {/* Gutter — beveled half-round, top-edge highlight + bottom shadow */}
            <rect x="272" y="240" width="456" height="3" fill="#0e0c0a" />
            <line x1="272" y1="240.4" x2="728" y2="240.4" stroke="rgba(255, 230, 175, 0.42)" strokeWidth="0.4" />
            <line x1="272" y1="242.6" x2="728" y2="242.6" stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.4" />
            {/* Downspout left — beveled tube: left highlight + right shadow
                so the downspout reads as a cylindrical aluminum pipe */}
            <rect x="282" y="244" width="3" height="195" fill="#1a1612" />
            <line x1="282.3" y1="244" x2="282.3" y2="439" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.3" />
            <line x1="284.7" y1="244" x2="284.7" y2="439" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
            {/* Downspout left bottom-elbow */}
            <rect x="280" y="437" width="8" height="3" fill="#1a1612" />
            <line x1="280" y1="437.4" x2="288" y2="437.4" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
            <line x1="280" y1="439.6" x2="288" y2="439.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
            {/* Downspout right — same bevel */}
            <rect x="715" y="244" width="3" height="195" fill="#1a1612" />
            <line x1="715.3" y1="244" x2="715.3" y2="439" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.3" />
            <line x1="717.7" y1="244" x2="717.7" y2="439" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
            <rect x="713" y="437" width="8" height="3" fill="#1a1612" />
            <line x1="713" y1="437.4" x2="721" y2="437.4" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
            <line x1="713" y1="439.6" x2="721" y2="439.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
            {/* Drip edge tips */}
            <line
              x1="270" y1={dripEdgeUp ? 230 : 236} x2="272" y2="240"
              stroke="#eb6924" strokeWidth="2"
              opacity={dripEdgeUp ? 1 : 0.55}
              className={dripEdgeUp ? 'rh-drip-flutter' : ''}
              style={{ transition: 'all 0.5s cubic-bezier(0.33, 1, 0.68, 1)' }}
            />
            <line
              x1="730" y1={dripEdgeUp ? 230 : 236} x2="728" y2="240"
              stroke="#eb6924" strokeWidth="2"
              opacity={dripEdgeUp ? 1 : 0.55}
              className={dripEdgeUp ? 'rh-drip-flutter' : ''}
              style={{
                transition: 'all 0.5s cubic-bezier(0.33, 1, 0.68, 1)',
                animationDelay: '0.15s',
              }}
            />
          </g>
        )}

        {/* WINDOWS — left + right of door, with sills, mullions, shutters.
            Each window now has a concrete LINTEL above its frame — the
            structural beam cast over the opening in CMU construction.
            The lintel is the architectural reason real CMU homes have a
            distinct horizontal band above each window. */}
        {/* Left window */}
        <g data-label="front-window">
          {/* Concrete lintel — slightly cooler tone than the wall stucco,
              with top sun-highlight + bottom shadow for raised reading */}
          <rect x="316" y="290" width="78" height="5" fill="#5a5650" stroke="#0a0908" strokeWidth="0.3" />
          <line x1="316" y1="290.4" x2="394" y2="290.4" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="316" y1="294.6" x2="394" y2="294.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          {/* Sill — beveled: top sun-highlight makes the sill cap read
              as projecting outward from the wall plane */}
          <rect x="316" y="382" width="78" height="5" fill={trimColor} stroke="#0a0908" strokeWidth="0.4" />
          <line x1="316" y1="382.4" x2="394" y2="382.4" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.5" />
          <line x1="316" y1="386.5" x2="394" y2="386.5" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
          {/* Frame — bevel: top + left highlights, bottom + right shadows */}
          <rect x="320" y="296" width="70" height="86" fill={trimColor} stroke="#0a0908" strokeWidth="0.6" />
          <line x1="320" y1="296.5" x2="390" y2="296.5" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="320.5" y1="296" x2="320.5" y2="382" stroke="rgba(255, 240, 210, 0.22)" strokeWidth="0.4" />
          <line x1="389.5" y1="296" x2="389.5" y2="382" stroke="rgba(0, 0, 0, 0.30)" strokeWidth="0.4" />
          {/* Glass */}
          <rect x="324" y="300" width="62" height="78" fill="url(#rh-glass)" />
          {/* Interior warm glow (dusk/night) — visible through the glass.
              Lightning flash briefly maxes this out. */}
          {effectiveGlow > 0 && (
            <rect
              x="324" y="300" width="62" height="78"
              fill="url(#rh-interior-glow)"
              opacity={effectiveGlow}
              pointerEvents="none"
              style={{ mixBlendMode: 'screen', transition: 'opacity 0.15s ease-out' }}
            />
          )}
          <rect x="324" y="300" width="62" height="78" fill="url(#rh-glass-sheen)" pointerEvents="none" />
          {/* AO recess — top + left edges of glass catch frame shadow */}
          <rect x="324" y="300" width="62" height="6" fill="url(#rh-ao-top)" pointerEvents="none" />
          <rect x="324" y="300" width="6" height="78" fill="url(#rh-ao-left)" pointerEvents="none" />
          {/* Mullions — beveled cross. Each stroke gets a sun-side
              highlight + opposite-side shadow so the mullion reads as a
              raised wood divider rather than a flat painted line. */}
          <line x1="355" y1="300" x2="355" y2="378" stroke={trimColor} strokeWidth="2" />
          <line x1="354.2" y1="300" x2="354.2" y2="378" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="356.0" y1="300" x2="356.0" y2="378" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          <line x1="324" y1="339" x2="386" y2="339" stroke={trimColor} strokeWidth="2" />
          <line x1="324" y1="338.2" x2="386" y2="338.2" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.4" />
          <line x1="324" y1="340.0" x2="386" y2="340.0" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          {/* Glass highlights */}
          <line x1="328" y1="304" x2="350" y2="304" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          <line x1="360" y1="304" x2="382" y2="304" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          {/* Sill cast shadow on the wall below the sill */}
          <rect x="316" y="387" width="78" height="3" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.65" />

          {/* GLASS DAMAGE — spider cracks radiating from impact point
              when winds exceed 120 mph without shutters deployed.
              Each crack line gets a bright sun-catch beside the dark
              fracture so the glass reads as fractured 3D, not just
              ink scribbles on the surface.
              v2 ITERATION: tinted glass under heavy damage + secondary
              impact points at higher severity. */}
          {glassCracks && !shuttersClosed && !glassBlownOut && (
            <g aria-hidden="true" style={{ opacity: 0.55 + crackSeverity * 0.45 }} pointerEvents="none">
              {/* GLASS TINT — fractured glass scatters more light, the
                  whole pane reads as darker/cooler under heavy damage */}
              {crackSeverity > 0.4 && (
                <rect
                  x="324" y="300" width="62" height="78"
                  fill="rgba(20, 30, 45, 1)"
                  opacity={(crackSeverity - 0.4) * 0.60}
                  pointerEvents="none"
                />
              )}
              {/* Primary impact point — small bright burst at the crack origin */}
              <circle cx="350" cy="335" r={1.2 + crackSeverity * 0.8} fill="rgba(255, 252, 240, 0.85)" />
              <circle cx="350" cy="335" r={2 + crackSeverity * 1.4} fill="none" stroke="rgba(255, 230, 175, 0.45)" strokeWidth="0.4" />
              {/* SECONDARY IMPACT POINTS — at high severity, multiple
                  debris hits visible across the pane */}
              {multiImpact && (
                <>
                  <circle cx="368" cy="318" r="0.8" fill="rgba(255, 252, 240, 0.78)" />
                  <circle cx="368" cy="318" r="1.6" fill="none" stroke="rgba(255, 230, 175, 0.38)" strokeWidth="0.3" />
                  <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth="0.4" fill="none" strokeLinecap="round">
                    <path d="M 368 318 L 358 308" />
                    <path d="M 368 318 L 380 312" />
                    <path d="M 368 318 L 384 322" />
                    <path d="M 368 318 L 376 332" />
                  </g>
                  <circle cx="332" cy="354" r="0.7" fill="rgba(255, 252, 240, 0.72)" />
                  <circle cx="332" cy="354" r="1.4" fill="none" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
                  <g stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.35" fill="none" strokeLinecap="round">
                    <path d="M 332 354 L 326 364" />
                    <path d="M 332 354 L 322 348" />
                    <path d="M 332 354 L 340 364" />
                  </g>
                </>
              )}
              {/* Radial fracture lines — dark crack + sun-catch parallel */}
              <g stroke="rgba(0, 0, 0, 0.85)" strokeWidth={0.5 + crackSeverity * 0.4} fill="none" strokeLinecap="round">
                <path d="M 350 335 L 332 308" />
                <path d="M 350 335 L 366 308" />
                <path d="M 350 335 L 376 320" />
                <path d="M 350 335 L 380 348" />
                <path d="M 350 335 L 360 372" />
                <path d="M 350 335 L 332 365" />
                <path d="M 350 335 L 326 348" />
                <path d="M 350 335 L 326 320" />
              </g>
              {/* Sun-catch on each fracture (parallel offset 0.4px for
                  3D edge highlight on the broken glass) */}
              <g stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.25" fill="none" strokeLinecap="round">
                <path d="M 350.4 334.6 L 332.4 307.6" />
                <path d="M 350.4 334.6 L 366.4 307.6" />
                <path d="M 350.4 334.6 L 376.4 319.6" />
                <path d="M 350.4 335.6 L 380.4 348.6" />
                <path d="M 350.4 335.6 L 360.4 372.6" />
                <path d="M 349.6 335.6 L 331.6 365.6" />
                <path d="M 349.6 335.6 L 325.6 348.6" />
                <path d="M 349.6 334.6 L 325.6 320.6" />
              </g>
              {/* Concentric web cracks (interlinking the radials) */}
              {crackSeverity > 0.3 && (
                <g stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" fill="none" strokeLinecap="round">
                  <path d="M 338 320 Q 350 314 362 320 Q 358 330 350 332 Q 342 330 338 320 Z" />
                  <path d="M 332 348 Q 342 354 358 354 Q 366 348 364 340" />
                </g>
              )}
              {/* SHATTER SHARDS — fully blown glass at >175 mph: a few
                  jagged triangular shards hanging from the frame */}
              {glassShattered && (
                <g aria-hidden="true">
                  <polygon points="324,300 330,318 326,322 324,304" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="386,300 380,316 384,320 386,306" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="324,378 332,372 336,376 332,378" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="386,378 376,374 374,378 380,378" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                </g>
              )}
            </g>
          )}

          {/* BLOWN-OUT WINDOW — at >195 mph the entire pane is gone.
              The original glass + sheen still render below this layer;
              we paint over with a pure-black interior void and a few
              residual shards still clinging to the frame. The wind +
              rain are now blowing INTO the room.
              v3: BROKEN-GLASS PILE on the sill + INTERIOR CONTENTS
              silhouettes (curtain rod, lampshade) for true depth. */}
          {glassBlownOut && (
            <g aria-hidden="true" pointerEvents="none">
              {/* Pure-black interior void — what was glass is now a
                  hole into the dark room beyond */}
              <rect x="324" y="300" width="62" height="78" fill="#000000" />
              {/* Faint interior glow (lit room) bleeding out through
                  the void if power is still on */}
              {effectiveGlow > 0 && !powerOut && (
                <rect
                  x="324" y="300" width="62" height="78"
                  fill="url(#rh-interior-glow)"
                  opacity={effectiveGlow * 0.55}
                  style={{ mixBlendMode: 'screen' }}
                />
              )}
              {/* INTERIOR CONTENTS visible through the void — curtain
                  rod silhouette spanning the top + a lampshade hint
                  at the lower-right. Only readable when interior
                  glow is on (otherwise the void stays pure black). */}
              {effectiveGlow > 0 && !powerOut && (
                <g>
                  {/* Curtain rod — horizontal dark bar at the top */}
                  <line x1="328" y1="306" x2="382" y2="306" stroke="rgba(40, 30, 22, 0.85)" strokeWidth="1.2" />
                  <circle cx="328" cy="306" r="1.2" fill="rgba(40, 30, 22, 0.90)" />
                  <circle cx="382" cy="306" r="1.2" fill="rgba(40, 30, 22, 0.90)" />
                  {/* Lampshade silhouette in lower-right — trapezoid
                      with a brighter warm interior glow inside */}
                  <polygon points="368,348 380,348 384,366 364,366" fill="rgba(255, 215, 130, 0.65)" />
                  <polygon points="370,350 378,350 381,364 367,364" fill="rgba(255, 235, 165, 0.85)" />
                  <line x1="374" y1="366" x2="374" y2="374" stroke="rgba(40, 30, 22, 0.75)" strokeWidth="0.6" />
                </g>
              )}
              {/* Residual shards still clinging to the frame */}
              <g>
                <polygon points="324,300 332,322 326,330 324,308" fill="rgba(120, 145, 175, 0.55)" stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.35" />
                <polygon points="386,300 378,318 384,328 386,310" fill="rgba(120, 145, 175, 0.55)" stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.35" />
                <polygon points="354,300 348,310 358,312 360,300" fill="rgba(120, 145, 175, 0.45)" stroke="rgba(255, 245, 220, 0.45)" strokeWidth="0.3" />
                <polygon points="324,378 334,368 340,374 332,378" fill="rgba(120, 145, 175, 0.50)" stroke="rgba(255, 245, 220, 0.50)" strokeWidth="0.3" />
                <polygon points="386,378 376,370 372,376 380,378" fill="rgba(120, 145, 175, 0.50)" stroke="rgba(255, 245, 220, 0.50)" strokeWidth="0.3" />
              </g>
              {/* BROKEN-GLASS PILE on the sill — chunks of pane that
                  fell when the window blew. Each shard has a bright
                  edge stroke (catches light) + cool tint (reads as
                  glass, not stone). Settles at sill y=382-386. */}
              <g>
                <polygon points="320,383 326,381 330,386 322,386" fill="rgba(140, 165, 195, 0.75)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="335,381 343,383 340,386 333,386" fill="rgba(140, 165, 195, 0.78)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="350,383 358,380 360,386 348,386" fill="rgba(140, 165, 195, 0.72)" stroke="rgba(255, 250, 235, 0.80)" strokeWidth="0.4" />
                <polygon points="367,381 374,383 372,386 365,386" fill="rgba(140, 165, 195, 0.78)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="378,383 386,381 388,386 376,386" fill="rgba(140, 165, 195, 0.75)" stroke="rgba(255, 250, 235, 0.82)" strokeWidth="0.4" />
                {/* Tiny glass chips scattered around */}
                <circle cx="324" cy="385" r="0.5" fill="rgba(255, 250, 235, 0.85)" />
                <circle cx="346" cy="385.5" r="0.4" fill="rgba(255, 250, 235, 0.75)" />
                <circle cx="362" cy="385" r="0.5" fill="rgba(255, 250, 235, 0.85)" />
                <circle cx="383" cy="385.5" r="0.4" fill="rgba(255, 250, 235, 0.75)" />
              </g>
              {/* CURTAIN remnant — torn fabric flapping in the void */}
              <path
                d="M 350 300 Q 354 320 348 340 Q 352 358 346 376"
                stroke="rgba(180, 165, 140, 0.55)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 350 300 Q 354 320 348 340 Q 352 358 346 376"
                stroke="rgba(255, 240, 210, 0.30)"
                strokeWidth="0.6"
                fill="none"
                strokeLinecap="round"
              />
              {/* Rain INGRESS — drops actively blowing into the void */}
              {rainIntensity > 0.15 && (
                <g style={{ opacity: rainIntensity }}>
                  <line x1="332" y1="306" x2="338" y2="316" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                  <line x1="346" y1="312" x2="352" y2="324" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                  <line x1="362" y1="304" x2="370" y2="318" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="372" y1="318" x2="378" y2="330" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                </g>
              )}
            </g>
          )}

          {/* WET WINDOW STREAMS — raindrops trickling down the glass.
              Varied widths + lengths + speeds for organic feel. Pure CSS
              keyframe = 60fps GPU. Suppressed when shutters closed
              OR when the window is blown out (no glass = no streams). */}
          {rainIntensity > 0.15 && !shuttersClosed && !glassBlownOut && (
            <g className="rh-wet-stream" aria-hidden="true" style={{ opacity: rainIntensity }} pointerEvents="none">
              {[
                { x: 330, delay: -0.2, dur: 2.4, w: 0.7, len: 6 },
                { x: 345, delay: -1.1, dur: 3.1, w: 1.4, len: 9 },  // fat drop
                { x: 360, delay: -0.6, dur: 1.8, w: 0.6, len: 5 },
                { x: 372, delay: -1.6, dur: 2.6, w: 0.9, len: 7 },
                { x: 384, delay: -0.9, dur: 3.6, w: 1.2, len: 10 }, // long streak
              ].map((d) => (
                <line
                  key={`lws-${d.x}`}
                  x1={d.x} y1={304} x2={d.x} y2={304 + d.len}
                  stroke={d.w > 1 ? 'rgba(225, 240, 255, 0.95)' : 'rgba(210, 225, 240, 0.78)'}
                  strokeWidth={d.w}
                  strokeLinecap="round"
                  className="rh-wet-drop"
                  style={{
                    animationDuration: `${d.dur}s`,
                    animationDelay: `${d.delay}s`,
                  }}
                />
              ))}
            </g>
          )}

          {/* HURRICANE SHUTTERS — close above 140 mph. Modeled as a
              FL-code-compliant aluminum storm-panel set: 3 corrugated
              panels bolted into permanent header + sill tracks, with
              a horizontal mid-brace stiffener. The bolt heads + tracks
              + panel seams sell it as real hardware, not flat plywood. */}
          {shuttersClosed && (
            <g style={{ animation: 'rh-shutter-close 0.5s var(--ease) both' }}>
              {/* Header track — permanent extruded-aluminum rail bolted
                  to the wall above the window. Shutters lock into this. */}
              <rect x="318" y="293" width="74" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="318" y1="293.4" x2="392" y2="293.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="318" y1="295.6" x2="392" y2="295.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
              {/* The shutter panel itself */}
              <rect x="320" y="296" width="70" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.6" />
              {/* Outer rim bevel on the deployed panel */}
              <line x1="320.5" y1="296" x2="320.5" y2="382" stroke="rgba(255, 230, 180, 0.32)" strokeWidth="0.4" />
              <line x1="389.5" y1="296" x2="389.5" y2="382" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              <line x1="320" y1="296.5" x2="390" y2="296.5" stroke="rgba(255, 230, 180, 0.28)" strokeWidth="0.4" />
              <line x1="320" y1="381.5" x2="390" y2="381.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              {/* Vertical panel seams — 3-panel set, seams at 1/3 + 2/3 */}
              <line x1="343" y1="296" x2="343" y2="382" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
              <line x1="343.5" y1="296" x2="343.5" y2="382" stroke="rgba(255, 230, 180, 0.22)" strokeWidth="0.3" />
              <line x1="367" y1="296" x2="367" y2="382" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
              <line x1="367.5" y1="296" x2="367.5" y2="382" stroke="rgba(255, 230, 180, 0.22)" strokeWidth="0.3" />
              {/* Horizontal mid-brace stiffener — extruded aluminum
                  bar that prevents wind-pressure bowing */}
              <rect x="320" y="337" width="70" height="4" fill="#2a2620" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="320" y1="337.4" x2="390" y2="337.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="320" y1="340.6" x2="390" y2="340.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
              {/* Bolt heads — galvanized hex bolts at all 4 corners +
                  midpoints. The hot specular pinhole sells them as
                  polished metal under the storm-light. */}
              {[
                [325, 299], [385, 299],          // top corners
                [325, 339], [385, 339],          // mid-brace ends
                [325, 379], [385, 379],          // bottom corners
              ].map(([cx, cy]) => (
                <g key={`bolt-l-${cx}-${cy}`}>
                  <circle cx={cx} cy={cy} r="1.4" fill="#7a766c" stroke="#0a0908" strokeWidth="0.3" />
                  <circle cx={cx - 0.3} cy={cy - 0.3} r="0.45" fill="rgba(255, 250, 230, 0.85)" />
                </g>
              ))}
              {/* Sill track — mirrors the header */}
              <rect x="318" y="382" width="74" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="318" y1="382.4" x2="392" y2="382.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="318" y1="384.6" x2="392" y2="384.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
            </g>
          )}
          {/* Fixed open shutter panels (decorative) when not closed.
              Filled with the louver pattern so each shutter reads as a
              real wood louvered shutter, not a flat dark rectangle. */}
          {!shuttersClosed && (
            <g aria-hidden="true">
              <rect x="306" y="296" width="12" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.4" />
              <rect x="392" y="296" width="12" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.4" />
              {/* Outer-frame bevel — sun rim on left edge of each panel */}
              <line x1="306.4" y1="296" x2="306.4" y2="382" stroke="rgba(255, 230, 180, 0.25)" strokeWidth="0.3" />
              <line x1="392.4" y1="296" x2="392.4" y2="382" stroke="rgba(255, 230, 180, 0.25)" strokeWidth="0.3" />
              <line x1="317.6" y1="296" x2="317.6" y2="382" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" />
              <line x1="403.6" y1="296" x2="403.6" y2="382" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" />
            </g>
          )}
        </g>

        {/* Right window — same pattern, mirrored */}
        <g data-label="front-window">
          {/* Concrete lintel */}
          <rect x="606" y="290" width="78" height="5" fill="#5a5650" stroke="#0a0908" strokeWidth="0.3" />
          <line x1="606" y1="290.4" x2="684" y2="290.4" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="606" y1="294.6" x2="684" y2="294.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          {/* Sill bevel */}
          <rect x="606" y="382" width="78" height="5" fill={trimColor} stroke="#0a0908" strokeWidth="0.4" />
          <line x1="606" y1="382.4" x2="684" y2="382.4" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.5" />
          <line x1="606" y1="386.5" x2="684" y2="386.5" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
          {/* Frame bevel */}
          <rect x="610" y="296" width="70" height="86" fill={trimColor} stroke="#0a0908" strokeWidth="0.6" />
          <line x1="610" y1="296.5" x2="680" y2="296.5" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="610.5" y1="296" x2="610.5" y2="382" stroke="rgba(255, 240, 210, 0.22)" strokeWidth="0.4" />
          <line x1="679.5" y1="296" x2="679.5" y2="382" stroke="rgba(0, 0, 0, 0.30)" strokeWidth="0.4" />
          <rect x="614" y="300" width="62" height="78" fill="url(#rh-glass)" />
          {effectiveGlow > 0 && (
            <rect
              x="614" y="300" width="62" height="78"
              fill="url(#rh-interior-glow)"
              opacity={effectiveGlow}
              pointerEvents="none"
              style={{ mixBlendMode: 'screen', transition: 'opacity 0.15s ease-out' }}
            />
          )}
          <rect x="614" y="300" width="62" height="78" fill="url(#rh-glass-sheen)" pointerEvents="none" />
          {/* AO recess — top + left edges */}
          <rect x="614" y="300" width="62" height="6" fill="url(#rh-ao-top)" pointerEvents="none" />
          <rect x="614" y="300" width="6" height="78" fill="url(#rh-ao-left)" pointerEvents="none" />
          {/* Beveled cross-mullion */}
          <line x1="645" y1="300" x2="645" y2="378" stroke={trimColor} strokeWidth="2" />
          <line x1="644.2" y1="300" x2="644.2" y2="378" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="646.0" y1="300" x2="646.0" y2="378" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          <line x1="614" y1="339" x2="676" y2="339" stroke={trimColor} strokeWidth="2" />
          <line x1="614" y1="338.2" x2="676" y2="338.2" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.4" />
          <line x1="614" y1="340.0" x2="676" y2="340.0" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          <line x1="618" y1="304" x2="640" y2="304" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          <line x1="650" y1="304" x2="672" y2="304" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
          {/* Sill cast shadow on the wall below */}
          <rect x="606" y="387" width="78" height="3" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.65" />

          {/* GLASS DAMAGE — same spider-crack treatment + v2 iteration
              (tinted glass, multi-impact, blown-out state) */}
          {glassCracks && !shuttersClosed && !glassBlownOut && (
            <g aria-hidden="true" style={{ opacity: 0.55 + crackSeverity * 0.45 }} pointerEvents="none">
              {crackSeverity > 0.4 && (
                <rect
                  x="614" y="300" width="62" height="78"
                  fill="rgba(20, 30, 45, 1)"
                  opacity={(crackSeverity - 0.4) * 0.60}
                  pointerEvents="none"
                />
              )}
              <circle cx="638" cy="338" r={1.2 + crackSeverity * 0.8} fill="rgba(255, 252, 240, 0.85)" />
              <circle cx="638" cy="338" r={2 + crackSeverity * 1.4} fill="none" stroke="rgba(255, 230, 175, 0.45)" strokeWidth="0.4" />
              {multiImpact && (
                <>
                  <circle cx="656" cy="320" r="0.8" fill="rgba(255, 252, 240, 0.78)" />
                  <circle cx="656" cy="320" r="1.6" fill="none" stroke="rgba(255, 230, 175, 0.38)" strokeWidth="0.3" />
                  <g stroke="rgba(0, 0, 0, 0.75)" strokeWidth="0.4" fill="none" strokeLinecap="round">
                    <path d="M 656 320 L 646 310" />
                    <path d="M 656 320 L 668 314" />
                    <path d="M 656 320 L 672 326" />
                    <path d="M 656 320 L 664 334" />
                  </g>
                  <circle cx="620" cy="356" r="0.7" fill="rgba(255, 252, 240, 0.72)" />
                  <circle cx="620" cy="356" r="1.4" fill="none" stroke="rgba(255, 230, 175, 0.35)" strokeWidth="0.3" />
                  <g stroke="rgba(0, 0, 0, 0.70)" strokeWidth="0.35" fill="none" strokeLinecap="round">
                    <path d="M 620 356 L 614 366" />
                    <path d="M 620 356 L 612 350" />
                    <path d="M 620 356 L 628 366" />
                  </g>
                </>
              )}
              <g stroke="rgba(0, 0, 0, 0.85)" strokeWidth={0.5 + crackSeverity * 0.4} fill="none" strokeLinecap="round">
                <path d="M 638 338 L 620 314" />
                <path d="M 638 338 L 656 312" />
                <path d="M 638 338 L 670 326" />
                <path d="M 638 338 L 668 354" />
                <path d="M 638 338 L 650 372" />
                <path d="M 638 338 L 624 370" />
                <path d="M 638 338 L 614 350" />
                <path d="M 638 338 L 614 322" />
              </g>
              <g stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.25" fill="none" strokeLinecap="round">
                <path d="M 638.4 337.6 L 620.4 313.6" />
                <path d="M 638.4 337.6 L 656.4 311.6" />
                <path d="M 638.4 337.6 L 670.4 325.6" />
                <path d="M 638.4 338.6 L 668.4 354.6" />
                <path d="M 638.4 338.6 L 650.4 372.6" />
                <path d="M 637.6 338.6 L 623.6 370.6" />
                <path d="M 637.6 338.6 L 613.6 350.6" />
                <path d="M 637.6 337.6 L 613.6 322.6" />
              </g>
              {crackSeverity > 0.3 && (
                <g stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" fill="none" strokeLinecap="round">
                  <path d="M 626 322 Q 638 316 650 322 Q 646 332 638 334 Q 630 332 626 322 Z" />
                  <path d="M 620 350 Q 632 356 648 356 Q 656 350 654 342" />
                </g>
              )}
              {glassShattered && (
                <g aria-hidden="true">
                  <polygon points="614,300 620,318 616,322 614,304" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="676,300 670,316 674,320 676,306" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="614,378 622,372 626,376 622,378" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                  <polygon points="676,378 666,374 664,378 670,378" fill="rgba(80, 100, 120, 0.45)" stroke="rgba(255, 245, 220, 0.35)" strokeWidth="0.3" />
                </g>
              )}
            </g>
          )}

          {/* BLOWN-OUT (>195 mph) — same treatment as L window */}
          {glassBlownOut && (
            <g aria-hidden="true" pointerEvents="none">
              <rect x="614" y="300" width="62" height="78" fill="#000000" />
              {effectiveGlow > 0 && !powerOut && (
                <rect
                  x="614" y="300" width="62" height="78"
                  fill="url(#rh-interior-glow)"
                  opacity={effectiveGlow * 0.55}
                  style={{ mixBlendMode: 'screen' }}
                />
              )}
              {/* Interior contents — curtain rod + lampshade */}
              {effectiveGlow > 0 && !powerOut && (
                <g>
                  <line x1="618" y1="306" x2="672" y2="306" stroke="rgba(40, 30, 22, 0.85)" strokeWidth="1.2" />
                  <circle cx="618" cy="306" r="1.2" fill="rgba(40, 30, 22, 0.90)" />
                  <circle cx="672" cy="306" r="1.2" fill="rgba(40, 30, 22, 0.90)" />
                  <polygon points="620,348 632,348 636,366 616,366" fill="rgba(255, 215, 130, 0.65)" />
                  <polygon points="622,350 630,350 633,364 619,364" fill="rgba(255, 235, 165, 0.85)" />
                  <line x1="626" y1="366" x2="626" y2="374" stroke="rgba(40, 30, 22, 0.75)" strokeWidth="0.6" />
                </g>
              )}
              {/* Residual frame shards */}
              <g>
                <polygon points="614,300 622,322 616,330 614,308" fill="rgba(120, 145, 175, 0.55)" stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.35" />
                <polygon points="676,300 668,318 674,328 676,310" fill="rgba(120, 145, 175, 0.55)" stroke="rgba(255, 245, 220, 0.55)" strokeWidth="0.35" />
                <polygon points="644,300 638,310 648,312 650,300" fill="rgba(120, 145, 175, 0.45)" stroke="rgba(255, 245, 220, 0.45)" strokeWidth="0.3" />
                <polygon points="614,378 624,368 630,374 622,378" fill="rgba(120, 145, 175, 0.50)" stroke="rgba(255, 245, 220, 0.50)" strokeWidth="0.3" />
                <polygon points="676,378 666,370 662,376 670,378" fill="rgba(120, 145, 175, 0.50)" stroke="rgba(255, 245, 220, 0.50)" strokeWidth="0.3" />
              </g>
              {/* Broken-glass pile on the sill */}
              <g>
                <polygon points="610,383 616,381 620,386 612,386" fill="rgba(140, 165, 195, 0.75)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="625,381 633,383 630,386 623,386" fill="rgba(140, 165, 195, 0.78)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="640,383 648,380 650,386 638,386" fill="rgba(140, 165, 195, 0.72)" stroke="rgba(255, 250, 235, 0.80)" strokeWidth="0.4" />
                <polygon points="657,381 664,383 662,386 655,386" fill="rgba(140, 165, 195, 0.78)" stroke="rgba(255, 250, 235, 0.85)" strokeWidth="0.4" />
                <polygon points="668,383 676,381 678,386 666,386" fill="rgba(140, 165, 195, 0.75)" stroke="rgba(255, 250, 235, 0.82)" strokeWidth="0.4" />
                <circle cx="614" cy="385" r="0.5" fill="rgba(255, 250, 235, 0.85)" />
                <circle cx="636" cy="385.5" r="0.4" fill="rgba(255, 250, 235, 0.75)" />
                <circle cx="652" cy="385" r="0.5" fill="rgba(255, 250, 235, 0.85)" />
                <circle cx="673" cy="385.5" r="0.4" fill="rgba(255, 250, 235, 0.75)" />
              </g>
              <path
                d="M 640 300 Q 644 320 638 340 Q 642 358 636 376"
                stroke="rgba(180, 165, 140, 0.55)"
                strokeWidth="3"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M 640 300 Q 644 320 638 340 Q 642 358 636 376"
                stroke="rgba(255, 240, 210, 0.30)"
                strokeWidth="0.6"
                fill="none"
                strokeLinecap="round"
              />
              {rainIntensity > 0.15 && (
                <g style={{ opacity: rainIntensity }}>
                  <line x1="622" y1="306" x2="628" y2="316" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                  <line x1="636" y1="312" x2="642" y2="324" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                  <line x1="652" y1="304" x2="660" y2="318" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="662" y1="318" x2="668" y2="330" stroke="rgba(210, 230, 250, 0.85)" strokeWidth="0.6" strokeLinecap="round" />
                </g>
              )}
            </g>
          )}

          {shuttersClosed && (
            <g style={{ animation: 'rh-shutter-close 0.5s var(--ease) both' }}>
              {/* Header track */}
              <rect x="608" y="293" width="74" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="608" y1="293.4" x2="682" y2="293.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="608" y1="295.6" x2="682" y2="295.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
              {/* Shutter panel + outer rim bevel */}
              <rect x="610" y="296" width="70" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.6" />
              <line x1="610.5" y1="296" x2="610.5" y2="382" stroke="rgba(255, 230, 180, 0.32)" strokeWidth="0.4" />
              <line x1="679.5" y1="296" x2="679.5" y2="382" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              <line x1="610" y1="296.5" x2="680" y2="296.5" stroke="rgba(255, 230, 180, 0.28)" strokeWidth="0.4" />
              <line x1="610" y1="381.5" x2="680" y2="381.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              {/* 3-panel set seams */}
              <line x1="633" y1="296" x2="633" y2="382" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
              <line x1="633.5" y1="296" x2="633.5" y2="382" stroke="rgba(255, 230, 180, 0.22)" strokeWidth="0.3" />
              <line x1="657" y1="296" x2="657" y2="382" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
              <line x1="657.5" y1="296" x2="657.5" y2="382" stroke="rgba(255, 230, 180, 0.22)" strokeWidth="0.3" />
              {/* Mid-brace stiffener */}
              <rect x="610" y="337" width="70" height="4" fill="#2a2620" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="610" y1="337.4" x2="680" y2="337.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="610" y1="340.6" x2="680" y2="340.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
              {/* Bolt heads */}
              {[
                [615, 299], [675, 299],
                [615, 339], [675, 339],
                [615, 379], [675, 379],
              ].map(([cx, cy]) => (
                <g key={`bolt-r-${cx}-${cy}`}>
                  <circle cx={cx} cy={cy} r="1.4" fill="#7a766c" stroke="#0a0908" strokeWidth="0.3" />
                  <circle cx={cx - 0.3} cy={cy - 0.3} r="0.45" fill="rgba(255, 250, 230, 0.85)" />
                </g>
              ))}
              {/* Sill track */}
              <rect x="608" y="382" width="74" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="608" y1="382.4" x2="682" y2="382.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="608" y1="384.6" x2="682" y2="384.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
            </g>
          )}
          {!shuttersClosed && (
            <g aria-hidden="true">
              <rect x="596" y="296" width="12" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.4" />
              <rect x="682" y="296" width="12" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.4" />
              {/* Outer-frame bevel — sun rim on left, shadow on right */}
              <line x1="596.4" y1="296" x2="596.4" y2="382" stroke="rgba(255, 230, 180, 0.25)" strokeWidth="0.3" />
              <line x1="682.4" y1="296" x2="682.4" y2="382" stroke="rgba(255, 230, 180, 0.25)" strokeWidth="0.3" />
              <line x1="607.6" y1="296" x2="607.6" y2="382" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" />
              <line x1="693.6" y1="296" x2="693.6" y2="382" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" />
            </g>
          )}
          {/* WET STREAMS — right window, varied per drop. Suppressed
              when window is blown out (no glass surface). */}
          {rainIntensity > 0.15 && !shuttersClosed && !glassBlownOut && (
            <g className="rh-wet-stream" aria-hidden="true" style={{ opacity: rainIntensity }} pointerEvents="none">
              {[
                { x: 622, delay: -0.4, dur: 2.6, w: 0.8, len: 6 },
                { x: 636, delay: -1.4, dur: 1.9, w: 0.6, len: 5 },
                { x: 650, delay: -0.1, dur: 3.4, w: 1.5, len: 11 }, // fat + long
                { x: 662, delay: -1.9, dur: 2.5, w: 1.0, len: 8 },
                { x: 670, delay: -0.7, dur: 2.1, w: 0.7, len: 6 },
              ].map((d) => (
                <line
                  key={`rws-${d.x}`}
                  x1={d.x} y1={304} x2={d.x} y2={304 + d.len}
                  stroke={d.w > 1 ? 'rgba(225, 240, 255, 0.95)' : 'rgba(210, 225, 240, 0.78)'}
                  strokeWidth={d.w}
                  strokeLinecap="round"
                  className="rh-wet-drop"
                  style={{
                    animationDuration: `${d.dur}s`,
                    animationDelay: `${d.delay}s`,
                  }}
                />
              ))}
            </g>
          )}
        </g>

        {/* ── R2 — narrow utility / bedroom window filling the right
            empty wall space (was unused stucco between R1 and the side-
            wall extrusion). Single horizontal mullion (2-pane), no
            decorative open shutters (wall is too narrow), but the
            closed hurricane shutter still deploys above 140 mph. ── */}
        <g data-label="front-window-r2">
          {/* Concrete lintel */}
          <rect x="680" y="290" width="32" height="5" fill="#5a5650" stroke="#0a0908" strokeWidth="0.3" />
          <line x1="680" y1="290.4" x2="712" y2="290.4" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="680" y1="294.6" x2="712" y2="294.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
          {/* Sill bevel */}
          <rect x="680" y="382" width="32" height="5" fill={trimColor} stroke="#0a0908" strokeWidth="0.4" />
          <line x1="680" y1="382.4" x2="712" y2="382.4" stroke="rgba(255, 240, 210, 0.45)" strokeWidth="0.5" />
          <line x1="680" y1="386.5" x2="712" y2="386.5" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
          {/* Frame bevel — narrower than other windows */}
          <rect x="684" y="296" width="24" height="86" fill={trimColor} stroke="#0a0908" strokeWidth="0.6" />
          <line x1="684" y1="296.5" x2="708" y2="296.5" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
          <line x1="684.5" y1="296" x2="684.5" y2="382" stroke="rgba(255, 240, 210, 0.22)" strokeWidth="0.4" />
          <line x1="707.5" y1="296" x2="707.5" y2="382" stroke="rgba(0, 0, 0, 0.30)" strokeWidth="0.4" />
          {/* Glass */}
          <rect x="688" y="300" width="16" height="78" fill="url(#rh-glass)" />
          {effectiveGlow > 0 && (
            <rect
              x="688" y="300" width="16" height="78"
              fill="url(#rh-interior-glow)"
              opacity={effectiveGlow}
              pointerEvents="none"
              style={{ mixBlendMode: 'screen', transition: 'opacity 0.15s ease-out' }}
            />
          )}
          <rect x="688" y="300" width="16" height="78" fill="url(#rh-glass-sheen)" pointerEvents="none" />
          {/* AO recess — top + left */}
          <rect x="688" y="300" width="16" height="6" fill="url(#rh-ao-top)" pointerEvents="none" />
          <rect x="688" y="300" width="6" height="78" fill="url(#rh-ao-left)" pointerEvents="none" />
          {/* Single horizontal mullion (2-over-2 style) — beveled */}
          <line x1="688" y1="339" x2="704" y2="339" stroke={trimColor} strokeWidth="1.5" />
          <line x1="688" y1="338.4" x2="704" y2="338.4" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.3" />
          <line x1="688" y1="339.6" x2="704" y2="339.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.3" />
          {/* Glass highlights on each pane */}
          <line x1="691" y1="304" x2="700" y2="304" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
          <line x1="691" y1="343" x2="700" y2="343" stroke="rgba(255,255,255,0.14)" strokeWidth="1.5" />
          {/* Sill cast shadow */}
          <rect x="680" y="387" width="32" height="3" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.65" />

          {/* Closed hurricane shutter (above 140 mph) — narrow panel,
              single-panel set, no mid-brace (too short to need one). */}
          {shuttersClosed && (
            <g style={{ animation: 'rh-shutter-close 0.5s var(--ease) both' }}>
              {/* Header track */}
              <rect x="682" y="293" width="28" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="682" y1="293.4" x2="710" y2="293.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="682" y1="295.6" x2="710" y2="295.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
              {/* Shutter panel + outer rim bevel */}
              <rect x="684" y="296" width="24" height="86" fill="url(#rh-shutter-louver)" stroke="#0a0908" strokeWidth="0.6" />
              <line x1="684.5" y1="296" x2="684.5" y2="382" stroke="rgba(255, 230, 180, 0.32)" strokeWidth="0.4" />
              <line x1="707.5" y1="296" x2="707.5" y2="382" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              <line x1="684" y1="296.5" x2="708" y2="296.5" stroke="rgba(255, 230, 180, 0.28)" strokeWidth="0.4" />
              <line x1="684" y1="381.5" x2="708" y2="381.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
              {/* 4 bolt heads — corners only, narrow panel doesn't need
                  a mid-brace */}
              {[
                [688, 299], [704, 299],
                [688, 379], [704, 379],
              ].map(([cx, cy]) => (
                <g key={`bolt-r2-${cx}-${cy}`}>
                  <circle cx={cx} cy={cy} r="1.2" fill="#7a766c" stroke="#0a0908" strokeWidth="0.3" />
                  <circle cx={cx - 0.25} cy={cy - 0.25} r="0.4" fill="rgba(255, 250, 230, 0.85)" />
                </g>
              ))}
              {/* Sill track */}
              <rect x="682" y="382" width="28" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.3" />
              <line x1="682" y1="382.4" x2="710" y2="382.4" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
              <line x1="682" y1="384.6" x2="710" y2="384.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
            </g>
          )}

          {/* WET STREAMS — sparser, fits the narrower frame */}
          {rainIntensity > 0.15 && !shuttersClosed && (
            <g className="rh-wet-stream" aria-hidden="true" style={{ opacity: rainIntensity }}>
              {[
                { x: 691, delay: -0.5, dur: 2.3, w: 0.7, len: 5 },
                { x: 696, delay: -1.2, dur: 2.8, w: 1.1, len: 8 },
                { x: 701, delay: -0.3, dur: 2.0, w: 0.6, len: 5 },
              ].map((d) => (
                <line
                  key={`r2ws-${d.x}`}
                  x1={d.x} y1={304} x2={d.x} y2={304 + d.len}
                  stroke={d.w > 1 ? 'rgba(225, 240, 255, 0.95)' : 'rgba(210, 225, 240, 0.78)'}
                  strokeWidth={d.w}
                  strokeLinecap="round"
                  className="rh-wet-drop"
                  style={{
                    animationDuration: `${d.dur}s`,
                    animationDelay: `${d.delay}s`,
                  }}
                />
              ))}
            </g>
          )}
        </g>

        {/* PORCH OVERHANG above front door */}
        <g>
          {/* Overhang fascia — top sun-edge highlight + bottom soffit shadow */}
          <rect x="430" y="320" width="140" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.5" />
          <line x1="430" y1="320.4" x2="570" y2="320.4" stroke="rgba(255, 240, 200, 0.32)" strokeWidth="0.4" />
          <rect x="432" y="326" width="136" height="3" fill="#1a1612" />
          {/* Porch posts — beveled square columns: left + top sun rim,
              right + bottom shadow. Reads as architectural columns. */}
          <rect x="434" y="326" width="4" height="113" fill="#3a3128" />
          <line x1="434.3" y1="326" x2="434.3" y2="439" stroke="rgba(255, 240, 200, 0.42)" strokeWidth="0.5" />
          <line x1="437.7" y1="326" x2="437.7" y2="439" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.5" />
          {/* Top + bottom cap on left post (capital + base) */}
          <rect x="432.5" y="326" width="7" height="2.5" fill="#5a4f44" stroke="#0a0908" strokeWidth="0.3" />
          <rect x="432.5" y="436.5" width="7" height="2.5" fill="#5a4f44" stroke="#0a0908" strokeWidth="0.3" />
          <rect x="562" y="326" width="4" height="113" fill="#3a3128" />
          <line x1="562.3" y1="326" x2="562.3" y2="439" stroke="rgba(255, 240, 200, 0.42)" strokeWidth="0.5" />
          <line x1="565.7" y1="326" x2="565.7" y2="439" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.5" />
          <rect x="560.5" y="326" width="7" height="2.5" fill="#5a4f44" stroke="#0a0908" strokeWidth="0.3" />
          <rect x="560.5" y="436.5" width="7" height="2.5" fill="#5a4f44" stroke="#0a0908" strokeWidth="0.3" />
          {/* Cast shadow on wall + door from the overhang above */}
          <rect x="430" y="329" width="140" height="18" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.75" />
        </g>

        {/* FRONT DOOR with panels + handle, flanked by glass sidelights */}
        <g>
          {/* SIDELIGHTS — narrow vertical glass panels flanking the door,
              an architectural detail common on Florida ranch front
              entries. Each sidelight has its own trim, glass, sheen,
              AO recess, and a single horizontal mullion mid-height.
              Interior glow (TOD) and lightning flash both pass through
              just like the windows do. Drawn BEFORE the door rect so
              the door overlays cleanly on top. */}
          <g aria-hidden="true">
            {/* LEFT sidelight */}
            <rect x="440" y="340" width="8" height="100" fill={trimColor} stroke="#0a0908" strokeWidth="0.4" />
            <rect x="441.5" y="341.5" width="5" height="97" fill="url(#rh-glass)" />
            {effectiveGlow > 0 && (
              <rect
                x="441.5" y="341.5" width="5" height="97"
                fill="url(#rh-interior-glow)"
                opacity={effectiveGlow * 0.85}
                pointerEvents="none"
                style={{ mixBlendMode: 'screen', transition: 'opacity 0.15s ease-out' }}
              />
            )}
            <rect x="441.5" y="341.5" width="5" height="97" fill="url(#rh-glass-sheen)" pointerEvents="none" />
            {/* AO recess at top — porch overhang shadow falls here */}
            <rect x="441.5" y="341.5" width="5" height="4" fill="url(#rh-ao-top)" pointerEvents="none" />
            {/* Horizontal mullion at mid-height — beveled */}
            <line x1="441.5" y1="389" x2="446.5" y2="389" stroke={trimColor} strokeWidth="0.8" />
            <line x1="441.5" y1="388.5" x2="446.5" y2="388.5" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.25" />
            <line x1="441.5" y1="389.5" x2="446.5" y2="389.5" stroke="rgba(0, 0, 0, 0.40)" strokeWidth="0.25" />
            {/* Top + bottom trim bevel highlights */}
            <line x1="440" y1="340.4" x2="448" y2="340.4" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
            <line x1="440" y1="439.6" x2="448" y2="439.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
            {/* Vertical trim bevel — left edge sun, right edge shadow */}
            <line x1="440.4" y1="340" x2="440.4" y2="440" stroke="rgba(255, 240, 210, 0.22)" strokeWidth="0.3" />
            <line x1="447.6" y1="340" x2="447.6" y2="440" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="0.3" />

            {/* RIGHT sidelight */}
            <rect x="512" y="340" width="8" height="100" fill={trimColor} stroke="#0a0908" strokeWidth="0.4" />
            <rect x="513.5" y="341.5" width="5" height="97" fill="url(#rh-glass)" />
            {effectiveGlow > 0 && (
              <rect
                x="513.5" y="341.5" width="5" height="97"
                fill="url(#rh-interior-glow)"
                opacity={effectiveGlow * 0.85}
                pointerEvents="none"
                style={{ mixBlendMode: 'screen', transition: 'opacity 0.15s ease-out' }}
              />
            )}
            <rect x="513.5" y="341.5" width="5" height="97" fill="url(#rh-glass-sheen)" pointerEvents="none" />
            <rect x="513.5" y="341.5" width="5" height="4" fill="url(#rh-ao-top)" pointerEvents="none" />
            <line x1="513.5" y1="389" x2="518.5" y2="389" stroke={trimColor} strokeWidth="0.8" />
            <line x1="513.5" y1="388.5" x2="518.5" y2="388.5" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.25" />
            <line x1="513.5" y1="389.5" x2="518.5" y2="389.5" stroke="rgba(0, 0, 0, 0.40)" strokeWidth="0.25" />
            <line x1="512" y1="340.4" x2="520" y2="340.4" stroke="rgba(255, 240, 210, 0.32)" strokeWidth="0.4" />
            <line x1="512" y1="439.6" x2="520" y2="439.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
            <line x1="512.4" y1="340" x2="512.4" y2="440" stroke="rgba(255, 240, 210, 0.22)" strokeWidth="0.3" />
            <line x1="519.6" y1="340" x2="519.6" y2="440" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="0.3" />
          </g>

          <rect x="450" y="340" width="60" height="100" fill={doorFill} stroke="#0a0908" strokeWidth="0.6" />
          {/* Door face-light — sun cue */}
          <rect x="450" y="340" width="60" height="100" fill="url(#rh-face-light)" pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
          {/* Panels — true 4-sided beveled mortise.
              AO on top + left edges (recessed face catching shadow) +
              fine highlight strokes on right + bottom edges (sun glances
              off the opposing rim). Reads as actual recessed wood panel. */}
          {[[454, 346, 22, 38], [484, 346, 22, 38], [454, 390, 22, 46], [484, 390, 22, 46]].map(([x, y, w, h]) => (
            <g key={`pnl-${x}-${y}`}>
              <rect x={x} y={y} width={w} height={h} fill="none" stroke={doorPanelStroke} strokeWidth="0.6" />
              {/* AO recess (top + left) */}
              <rect x={x} y={y} width={w} height="4" fill="url(#rh-ao-top)" pointerEvents="none" />
              <rect x={x} y={y} width="3" height={h} fill="url(#rh-ao-left)" pointerEvents="none" />
              {/* Bevel highlights (right + bottom catch sun on the rim) */}
              <line x1={x + w - 0.4} y1={y} x2={x + w - 0.4} y2={y + h} stroke="rgba(255, 235, 200, 0.18)" strokeWidth="0.4" />
              <line x1={x} y1={y + h - 0.4} x2={x + w} y2={y + h - 0.4} stroke="rgba(255, 235, 200, 0.18)" strokeWidth="0.4" />
            </g>
          ))}
          {/* Door handle — domed brass knob with hot specular pinhole.
              The dark inner ring + offset white highlight at upper-left
              sells the spherical curvature that a flat circle can't.
              Polish: brighter specular at extreme storm for vibrant high. */}
          <g aria-hidden="true">
            {/* Backplate (recessed escutcheon ring around the knob) */}
            <circle cx="497" cy="402" r="3.2" fill="rgba(0, 0, 0, 0.45)" />
            <circle cx="497" cy="402" r="3.2" fill="none" stroke="rgba(255, 230, 180, 0.20)" strokeWidth="0.3" />
            {/* Knob body */}
            <circle cx="497" cy="402" r="2" fill="#d4a04a" />
            {/* Outer rim shadow (away from sun = lower-right) */}
            <circle cx="497.3" cy="402.3" r="2" fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" strokeDasharray="2.5 4" />
            {/* Sun-side rim highlight (upper-left arc) */}
            <circle cx="496.7" cy="401.7" r="2" fill="none" stroke="rgba(255, 245, 210, 0.55)" strokeWidth="0.3" strokeDasharray="2.5 4" />
            {/* Pinhole specular highlight at upper-left — outer warm
                halo + hot core (intensifies under lightning flash) */}
            <circle cx="496.3" cy="401.4" r="1.0" fill="rgba(255, 240, 180, 0.45)" />
            <circle cx="496.3" cy="401.4" r="0.6" fill={lightningFlash ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 252, 230, 0.95)'} />
          </g>
          {/* Address plaque — beveled brass plate with embossed numerals.
              SVG doesn't have inset text-shadow, so we fake the emboss by
              stacking three text layers: dark shadow offset down-right,
              light highlight offset up-left, then the main body on top. */}
          <rect x="462" y="328" width="36" height="9" fill="rgba(0,0,0,0.62)" stroke={trimColor} strokeWidth="0.4" />
          {/* Plaque bevel — top + left rim catch sun, bottom + right shadow */}
          <line x1="462.4" y1="328" x2="462.4" y2="337" stroke="rgba(255, 240, 200, 0.32)" strokeWidth="0.4" />
          <line x1="462" y1="328.4" x2="498" y2="328.4" stroke="rgba(255, 240, 200, 0.32)" strokeWidth="0.4" />
          <line x1="497.6" y1="328" x2="497.6" y2="337" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
          <line x1="462" y1="336.6" x2="498" y2="336.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.4" />
          {/* Embossed numerals: dark shadow base, gold body on top */}
          <text x="480.5" y="335.5" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(0, 0, 0, 0.85)" textAnchor="middle" letterSpacing="1">2703</text>
          <text x="479.6" y="334.6" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill="rgba(255, 240, 200, 0.45)" textAnchor="middle" letterSpacing="1">2703</text>
          <text x="480" y="335" fontSize="6.5" fontFamily="JetBrains Mono, monospace" fill={trimColor} textAnchor="middle" letterSpacing="1">2703</text>
        </g>

        {/* PORCH LIGHT FIXTURES — beveled wall-mount sconces with
            embossed housing + glowing dome bulb. Each fixture has:
              - dark mounting plate against the wall (top-shadow band
                under it = the recessed wall mount)
              - top sun rim + bottom shadow on the housing
              - radial glow + pinhole specular on the bulb dome
              - warm cast-light halo behind the bulb */}
        <g aria-hidden="true">
          {/* LEFT sconce */}
          <ellipse cx="440" cy="346" rx="6" ry="4" fill={`rgba(255, 220, 140, ${0.18 * calm})`} pointerEvents="none" />
          <rect x="438" y="338" width="4" height="6" fill="#1a1612" />
          <line x1="438.3" y1="338" x2="438.3" y2="344" stroke="rgba(255, 230, 180, 0.32)" strokeWidth="0.3" />
          <line x1="441.7" y1="338" x2="441.7" y2="344" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="438" y1="338.3" x2="442" y2="338.3" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
          <line x1="438" y1="343.7" x2="442" y2="343.7" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <circle cx="440" cy="346" r="2.5" fill={`rgba(255, 220, 140, ${0.4 + calm * 0.6})`} stroke="#1a1612" strokeWidth="0.4" />
          {/* Bulb specular pinhole + dome shading */}
          <circle cx="439.3" cy="345.4" r="0.6" fill={`rgba(255, 252, 220, ${0.5 + calm * 0.5})`} />
          <circle cx="440.5" cy="346.5" r="1.4" fill="none" stroke="rgba(0, 0, 0, 0.30)" strokeWidth="0.3" strokeDasharray="2 4" />

          {/* RIGHT sconce — mirrored */}
          <ellipse cx="560" cy="346" rx="6" ry="4" fill={`rgba(255, 220, 140, ${0.18 * calm})`} pointerEvents="none" />
          <rect x="558" y="338" width="4" height="6" fill="#1a1612" />
          <line x1="558.3" y1="338" x2="558.3" y2="344" stroke="rgba(255, 230, 180, 0.32)" strokeWidth="0.3" />
          <line x1="561.7" y1="338" x2="561.7" y2="344" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="558" y1="338.3" x2="562" y2="338.3" stroke="rgba(255, 230, 180, 0.42)" strokeWidth="0.3" />
          <line x1="558" y1="343.7" x2="562" y2="343.7" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <circle cx="560" cy="346" r="2.5" fill={`rgba(255, 220, 140, ${0.4 + calm * 0.6})`} stroke="#1a1612" strokeWidth="0.4" />
          <circle cx="559.3" cy="345.4" r="0.6" fill={`rgba(255, 252, 220, ${0.5 + calm * 0.5})`} />
          <circle cx="560.5" cy="346.5" r="1.4" fill="none" stroke="rgba(0, 0, 0, 0.30)" strokeWidth="0.3" strokeDasharray="2 4" />
        </g>

        {/* DOORBELL — small chrome button mounted on the trim just to
            the right of the front door. Tiny element but recognizable
            human-scale detail that sells the entry as a real entry. */}
        <g aria-hidden="true" pointerEvents="none">
          {/* Backplate */}
          <rect x="524" y="394" width="3" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.2" />
          <line x1="524" y1="394.3" x2="527" y2="394.3" stroke="rgba(255, 230, 175, 0.32)" strokeWidth="0.2" />
          <line x1="524" y1="399.7" x2="527" y2="399.7" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.2" />
          {/* Button */}
          <circle cx="525.5" cy="397" r="0.9" fill="#c8c2b8" />
          <circle cx="525.3" cy="396.8" r="0.3" fill="rgba(255, 252, 240, 0.85)" />
        </g>

        {/* WELCOME MAT — beveled rect at the base of the door, sitting
            just above where the walkway begins. Subtle horizontal weave
            lines suggest the typical coir-fiber doormat texture. */}
        <g aria-hidden="true" pointerEvents="none">
          <rect x="450" y="437" width="60" height="4" fill="#3a2a1c" stroke="#0a0908" strokeWidth="0.3" />
          {/* Mat bevel — top sun-catch + bottom shadow, sells slight raised height */}
          <line x1="450" y1="437.4" x2="510" y2="437.4" stroke="rgba(255, 230, 175, 0.32)" strokeWidth="0.3" />
          <line x1="450" y1="440.6" x2="510" y2="440.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
          {/* Coir-weave horizontal lines (3 fibers) */}
          <line x1="452" y1="438.5" x2="508" y2="438.5" stroke="rgba(80, 60, 40, 0.55)" strokeWidth="0.25" />
          <line x1="452" y1="439.5" x2="508" y2="439.5" stroke="rgba(80, 60, 40, 0.55)" strokeWidth="0.25" />
          {/* Side-edge trim */}
          <line x1="450.4" y1="437" x2="450.4" y2="441" stroke="rgba(20, 14, 8, 0.85)" strokeWidth="0.3" />
          <line x1="509.6" y1="437" x2="509.6" y2="441" stroke="rgba(20, 14, 8, 0.85)" strokeWidth="0.3" />
        </g>

        {/* GFCI OUTLET — weather-resistant outdoor outlet on the wall
            between the left window and the door. Required by code on
            FBC-compliant exterior walls. */}
        <g aria-hidden="true" pointerEvents="none">
          <rect x="418" y="402" width="6" height="9" fill="#e8e3da" stroke="#0a0908" strokeWidth="0.3" />
          {/* Plate bevel */}
          <line x1="418" y1="402.3" x2="424" y2="402.3" stroke="rgba(255, 250, 235, 0.65)" strokeWidth="0.2" />
          <line x1="418" y1="410.7" x2="424" y2="410.7" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.2" />
          {/* Receptacle slots — two horizontal pairs */}
          <rect x="419.5" y="403.8" width="3" height="0.4" fill="#1a1612" />
          <rect x="419.5" y="404.5" width="3" height="0.4" fill="#1a1612" />
          <rect x="419.5" y="408.0" width="3" height="0.4" fill="#1a1612" />
          <rect x="419.5" y="408.7" width="3" height="0.4" fill="#1a1612" />
          {/* Test/Reset button at top (the GFCI-specific hardware) */}
          <rect x="420.3" y="403" width="1.4" height="0.5" fill="#c84a3a" />
        </g>

        {/* HOSE BIB / SPIGOT — outdoor faucet on the right side of the
            facade. Small chrome valve with handle. Florida ranches
            always have one for irrigation/hosing the driveway. */}
        <g aria-hidden="true" pointerEvents="none">
          {/* Stem coming out of wall */}
          <rect x="586" y="408" width="2" height="3" fill="#1a1612" stroke="#0a0908" strokeWidth="0.2" />
          {/* Spout body (downward L-shape) */}
          <rect x="586.5" y="411" width="1.2" height="4" fill="#7a6e60" stroke="#0a0908" strokeWidth="0.2" />
          {/* Spout opening at the bottom */}
          <ellipse cx="587.1" cy="415" rx="0.8" ry="0.4" fill="rgba(0, 0, 0, 0.85)" />
          {/* Round handle/wheel */}
          <circle cx="591" cy="409" r="1.3" fill="#9a4a2a" stroke="#0a0908" strokeWidth="0.2" />
          <circle cx="591" cy="409" r="0.5" fill="rgba(60, 30, 18, 0.85)" />
          <line x1="588.7" y1="409" x2="591" y2="409" stroke="#1a1612" strokeWidth="0.4" />
          {/* Drip stain on stucco below the spout (cumulative weathering) */}
          <path d="M 587.1 415 L 587 421 L 587.2 425" stroke="rgba(0, 0, 0, 0.20)" strokeWidth="0.4" fill="none" strokeLinecap="round" />
        </g>

        {/* GARAGE SCONCE — small wall-mounted cylindrical light fixture
            centered above the garage door. Always-on dusk-to-dawn for
            Florida ranches. Glow brightens with calm/dusk via existing
            calm prop, same logic as the porch sconces. */}
        <g aria-hidden="true" pointerEvents="none">
          {/* Mounting plate */}
          <rect x="178" y="304" width="4" height="3" fill="#1a1612" />
          <line x1="178" y1="304.3" x2="182" y2="304.3" stroke="rgba(255, 230, 175, 0.32)" strokeWidth="0.25" />
          <line x1="178" y1="306.7" x2="182" y2="306.7" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.25" />
          {/* Cylindrical fixture body */}
          <rect x="178" y="307" width="4" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.25" />
          <line x1="178.4" y1="307" x2="178.4" y2="313" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.25" />
          <line x1="181.6" y1="307" x2="181.6" y2="313" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.25" />
          {/* Bulb glow at the bottom (warmer when calm) */}
          <ellipse cx="180" cy="313.5" rx="3" ry="1.5" fill={`rgba(255, 220, 140, ${0.18 * calm})`} />
          <circle cx="180" cy="313" r="1.0" fill={`rgba(255, 220, 140, ${0.45 + calm * 0.5})`} stroke="#1a1612" strokeWidth="0.25" />
          <circle cx="179.7" cy="312.7" r="0.3" fill={`rgba(255, 252, 220, ${0.55 + calm * 0.4})`} />
        </g>

        {/* GRANULE STREAKS — dark vertical streaks running down the
            wall below the eave where shingle granules have washed off
            the deteriorating roof. Gated to dripEdgeUp (early roof-
            failure cascade stage), so zero render cost when calm. */}
        {dripEdgeUp && (
          <g aria-hidden="true" pointerEvents="none" shapeRendering="optimizeSpeed">
            {/* 6 staggered granule wash streaks across the front facade */}
            <path d="M 296 250 L 295 280 L 296 330" stroke="rgba(60, 45, 30, 0.42)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
            <path d="M 408 250 L 410 285 L 408 340" stroke="rgba(60, 45, 30, 0.38)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
            <path d="M 532 250 L 534 280 L 532 320" stroke="rgba(60, 45, 30, 0.45)" strokeWidth="0.6" fill="none" strokeLinecap="round" />
            <path d="M 596 250 L 598 285 L 596 340" stroke="rgba(60, 45, 30, 0.38)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
            <path d="M 664 250 L 666 280 L 664 330" stroke="rgba(60, 45, 30, 0.42)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
            <path d="M 706 250 L 707 280 L 705 340" stroke="rgba(60, 45, 30, 0.40)" strokeWidth="0.5" fill="none" strokeLinecap="round" />
            {/* Granule particles scattered on foundation skirt below
                the streaks (where they pile up after washing down) */}
            <circle cx="296" cy="441" r="0.4" fill="rgba(60, 45, 30, 0.85)" />
            <circle cx="410" cy="441" r="0.4" fill="rgba(60, 45, 30, 0.85)" />
            <circle cx="534" cy="441" r="0.5" fill="rgba(60, 45, 30, 0.85)" />
            <circle cx="598" cy="441" r="0.4" fill="rgba(60, 45, 30, 0.85)" />
            <circle cx="664" cy="441" r="0.4" fill="rgba(60, 45, 30, 0.85)" />
            <circle cx="706" cy="441" r="0.4" fill="rgba(60, 45, 30, 0.85)" />
          </g>
        )}

        {/* WALKWAY pavers from door to lawn — beveled perimeter edge so
            the walkway slab reads as raised slightly above the lawn,
            not flush with it. Sun-side rakes (top + left) catch
            highlight, opposite rakes catch shadow. */}
        <polygon points="446,440 514,440 528,475 432,475" fill="url(#rh-pavers)" stroke="#3d3528" strokeWidth="0.5" />
        {/* Top edge sun-catch (where walkway meets house foundation) */}
        <line x1="446" y1="440.4" x2="514" y2="440.4" stroke="rgba(255, 240, 200, 0.32)" strokeWidth="0.4" />
        {/* Left rake highlight */}
        <line x1="446" y1="440" x2="432" y2="475" stroke="rgba(255, 240, 200, 0.22)" strokeWidth="0.4" />
        {/* Right rake shadow */}
        <line x1="514" y1="440" x2="528" y2="475" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
        {/* Bottom edge shadow (where slab meets lawn at far end) */}
        <line x1="432" y1="474.6" x2="528" y2="474.6" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.4" />
      </g>

      {/* ════════════════════════════════════════════════════════════════
          CHIMNEY + smoke — sits on top of the roof, attached to the wall
          ════════════════════════════════════════════════════════════════ */}
      <g data-label="chimney">
        {/* Cast shadow on the roof to the right of the chimney (sun is
            upper-left). Drawn FIRST so the chimney itself paints over its
            own base. */}
        <ellipse
          cx="600"
          cy="218"
          rx="40"
          ry="9"
          fill="url(#rh-contact-shadow)"
          opacity={0.65 * sunOpacity}
          pointerEvents="none"
        />
        {/* Chimney side-wall extrusion (right side in shadow) — 3D depth */}
        <rect
          x="577"
          y="180"
          width="5"
          height="50"
          fill={chimneyShadow}
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Side-face vertical depth gradient */}
        <rect x="577" y="180" width="5" height="50" fill="url(#rh-side-shadow)" pointerEvents="none" />
        <rect
          x="577"
          y="178"
          width="6"
          height="6"
          fill={chimneyCapShadow}
          stroke="#0a0908"
          strokeWidth="0.4"
        />
        {/* Main chimney face — base color underlay (so the brick pattern's
            mortar joints have something to "shadow" against) */}
        <rect x="555" y="180" width="22" height="50" fill={chimneyFace} stroke="#0a0908" strokeWidth="1" />
        {/* Brick + mortar pattern with per-brick bevel — the texture upgrade */}
        <rect x="555" y="180" width="22" height="50" fill="url(#rh-chimney-brick)" pointerEvents="none" />
        {/* Face-light on chimney (sun cue) — applied AFTER brick so the
            entire face still gets the warm directional gradient */}
        <rect x="555" y="180" width="22" height="50" fill="url(#rh-face-light)" pointerEvents="none" style={{ mixBlendMode: 'overlay' }} />
        {/* RIGHT-side inset shadow — the brick face's own thickness
            casts a thin shadow onto the side wall extrusion seam. */}
        <rect x="575" y="180" width="2.5" height="50" fill="rgba(0, 0, 0, 0.40)" pointerEvents="none" />
        {/* Bottom edge AO — shadow where chimney meets roof shingles */}
        <rect x="555" y="227" width="22" height="3" fill="url(#rh-ao-top)" pointerEvents="none" opacity="0.65" />

        {/* v2 ITERATION — WEATHERING STREAKS down the brick face.
            Vertical dark stains where rainwater has run off the cap
            edge and dragged soot + algae down the face over decades.
            Real chimneys always have these. */}
        <g pointerEvents="none">
          <path d="M 558 184 L 558 226" stroke="rgba(0, 0, 0, 0.20)" strokeWidth="0.6" />
          <path d="M 562 184 L 562.5 224" stroke="rgba(0, 0, 0, 0.16)" strokeWidth="0.5" />
          <path d="M 566 184 L 566 228" stroke="rgba(0, 0, 0, 0.24)" strokeWidth="0.7" />
          <path d="M 570 184 L 569.5 224" stroke="rgba(0, 0, 0, 0.17)" strokeWidth="0.5" />
          <path d="M 574 184 L 574 226" stroke="rgba(0, 0, 0, 0.15)" strokeWidth="0.5" />
        </g>
        {/* Chimney cap (slightly wider, thicker top course) */}
        <rect x="553" y="178" width="26" height="6" fill={chimneyCap} stroke="#0a0908" strokeWidth="1" />
        {/* Cap bevel — top highlight + bottom shadow read as raised stone cap */}
        <line x1="553" y1="178.4" x2="579" y2="178.4" stroke="rgba(255, 240, 210, 0.30)" strokeWidth="0.5" />
        <line x1="553" y1="183.6" x2="579" y2="183.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.5" />
        {/* Rim light on chimney left edge */}
        <line x1="555" y1="180" x2="555" y2="230" stroke={`rgba(255, 240, 200, ${0.3 * sunOpacity})`} strokeWidth="0.8" />

        {/* v2 ITERATION — STEP FLASHING at the chimney base where the
            brick face meets the roof shingles. Real chimneys have this
            L-shaped sheet-metal band that diverts water away from the
            seam. Drawn as a thin raised band with stepped vertical
            seams (each step = one piece of overlapping flashing). */}
        <g pointerEvents="none">
          <rect x="551" y="225" width="30" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.3" />
          {/* Sun-rim top + shadow bottom on the metal band */}
          <line x1="551" y1="225.4" x2="581" y2="225.4" stroke="rgba(255, 230, 175, 0.45)" strokeWidth="0.3" />
          <line x1="551" y1="230.6" x2="581" y2="230.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
          {/* Step seams — each piece of step-flashing overlaps the next */}
          <line x1="557" y1="225" x2="557" y2="231" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="557.5" y1="225" x2="557.5" y2="231" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.2" />
          <line x1="563" y1="225" x2="563" y2="231" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="563.5" y1="225" x2="563.5" y2="231" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.2" />
          <line x1="569" y1="225" x2="569" y2="231" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="569.5" y1="225" x2="569.5" y2="231" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.2" />
          <line x1="575" y1="225" x2="575" y2="231" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="575.5" y1="225" x2="575.5" y2="231" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.2" />
          {/* Counter-flashing tucked into the brick course above */}
          <line x1="551" y1="223.4" x2="581" y2="223.4" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
          <line x1="551" y1="223.8" x2="581" y2="223.8" stroke="rgba(255, 230, 175, 0.20)" strokeWidth="0.2" />
        </g>

        {/* v2 ITERATION — CORONA + SPARK ARRESTOR at the very top.
            Real chimneys often have a wider top course (the corona)
            above the cap, plus a wire-mesh spark arrestor over the
            actual flue opening. Adds vertical bulk + reads as a true
            functional chimney rather than just a brick stub. */}
        <g pointerEvents="none">
          {/* CORONA — narrow projecting course above the existing cap */}
          <rect x="550" y="173" width="32" height="3.5" fill={chimneyCap} stroke="#0a0908" strokeWidth="0.3" />
          <line x1="550" y1="173.4" x2="582" y2="173.4" stroke="rgba(255, 230, 175, 0.50)" strokeWidth="0.3" />
          <line x1="550" y1="176.1" x2="582" y2="176.1" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
          {/* Corona left-edge sun rim, right-edge shadow */}
          <line x1="550.4" y1="173" x2="550.4" y2="176.5" stroke="rgba(255, 230, 175, 0.32)" strokeWidth="0.3" />
          <line x1="581.6" y1="173" x2="581.6" y2="176.5" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />

          {/* SPARK ARRESTOR — wire-mesh box over the flue opening */}
          <rect x="562" y="167" width="8" height="6" fill="#3a3128" stroke="#0a0908" strokeWidth="0.3" />
          {/* Mesh grid pattern */}
          <line x1="562" y1="168.5" x2="570" y2="168.5" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          <line x1="562" y1="170" x2="570" y2="170" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          <line x1="562" y1="171.5" x2="570" y2="171.5" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          <line x1="564" y1="167" x2="564" y2="173" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          <line x1="566" y1="167" x2="566" y2="173" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          <line x1="568" y1="167" x2="568" y2="173" stroke="rgba(0, 0, 0, 0.7)" strokeWidth="0.2" />
          {/* Arrestor housing bevel */}
          <line x1="562" y1="167.4" x2="570" y2="167.4" stroke="rgba(255, 230, 175, 0.40)" strokeWidth="0.25" />
          <line x1="562.4" y1="167" x2="562.4" y2="173" stroke="rgba(255, 230, 175, 0.30)" strokeWidth="0.25" />
          <line x1="569.6" y1="167" x2="569.6" y2="173" stroke="rgba(0, 0, 0, 0.60)" strokeWidth="0.25" />
          {/* Dark interior void inside the arrestor (the actual flue hole) */}
          <rect x="563.5" y="168.5" width="5" height="3.5" fill="rgba(0, 0, 0, 0.85)" />

          {/* SOOT STAINS around the arrestor + corona top — decades
              of woodsmoke residue darkening the surrounding stone */}
          <ellipse cx="566" cy="173" rx="9" ry="1.6" fill="rgba(0, 0, 0, 0.45)" />
          <ellipse cx="566" cy="172" rx="6" ry="1.0" fill="rgba(0, 0, 0, 0.55)" />
          <ellipse cx="566" cy="167.5" rx="4" ry="0.8" fill="rgba(0, 0, 0, 0.35)" />
        </g>
        {smokeOpacity > 0 && (
          <g style={{ opacity: smokeOpacity }} aria-hidden="true">
            {/* Smoke now emanates from the SPARK ARRESTOR opening
                (y=167) — the actual flue exit — instead of the
                chimney face below the cap. Was a v2 chimney bug:
                the corona + arrestor were added above the original
                origin (y=178) so smoke was visually emerging from
                INSIDE the masonry. */}
            <path
              d={`M 566 167 Q ${(566 + smokeBend * 0.3).toFixed(1)} 145, ${(566 + smokeBend * 0.7).toFixed(1)} 125 Q ${(566 + smokeBend).toFixed(1)} 105, ${(566 + smokeBend * 1.4).toFixed(1)} 85`}
              stroke="rgba(220, 218, 215, 0.5)"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d={`M 566 167 Q ${(566 + smokeBend * 0.4).toFixed(1)} 150, ${(566 + smokeBend * 0.9).toFixed(1)} 135`}
              stroke="rgba(220, 218, 215, 0.35)"
              strokeWidth="9"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        )}
      </g>
    </>
  );
}
