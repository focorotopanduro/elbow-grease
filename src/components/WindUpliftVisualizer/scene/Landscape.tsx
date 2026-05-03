import { lerpRgb } from './colors';
import { SceneElement } from './SceneElement';

/**
 * Landscape — everything that lives BELOW the horizon and OUTSIDE the house.
 *
 * Split into two visual zones because they need to render at different points
 * in the parent stack:
 *   - <LandscapeBackground />  → renders behind the house (distant palms only)
 *   - <LandscapeForeground />  → renders in front of the house (driveway,
 *                                garden beds, bushes, hibiscus, mid + front
 *                                palms, mailbox, lawn)
 *
 * Both consume the same `LandscapeProps` so the parent only computes sway +
 * storm once. Palette is derived inside this file from `storm` so iterating
 * vegetation colors stays local.
 */
export interface LandscapeProps {
  /** 0–1 storm intensity */
  storm: number;
  /** 0–1 calm (1 - storm); used for hibiscus opacity */
  calm: number;
  /** Sway angles in degrees, indexed by tree position */
  sway: {
    bgL: number;
    bgR: number;
    midL: number;
    frontL: number;
    frontR: number;
  };
  /** Rain intensity 0–1 — drives wet-sheen on ground surfaces */
  rainIntensity?: number;
}

/* ─────────────────────────────────────────────────────────────────────────
 * BACKGROUND — distant palms only. Renders behind the house structure.
 *
 * Phase-2 parallax: distant palms move OPPOSITE the camera tilt (negative
 * weight) — when the user nudges the mouse right, the BG slides slightly
 * left, selling the depth illusion.
 * ───────────────────────────────────────────────────────────────────────── */
export function LandscapeBackground({ storm, sway }: LandscapeProps) {
  const palmBgColor = lerpRgb([42, 50, 38], [18, 20, 18], storm);
  return (
    /* CSS class adds atmospheric perspective: filter: blur(0.6px) +
       slight desaturation. Sells "this is in the distance" without
       changing geometry. */
    <g className="rh-landscape-bg" aria-hidden="true">
      {/* DISTANT background palms */}
      <g
        style={{
          color: palmBgColor,
          opacity: 0.65,
          transformOrigin: '40px 320px',
          transform: `rotate(${sway.bgL.toFixed(2)}deg)`,
        }}
      >
        <SceneElement id="background/palm-bg-left" symbolHref="#rh-palm" x={0} y={200} w={80} h={200} />
      </g>
      <g
        style={{
          color: palmBgColor,
          opacity: 0.65,
          transformOrigin: '770px 320px',
          transform: `rotate(${sway.bgR.toFixed(2)}deg)`,
        }}
      >
        <SceneElement id="background/palm-bg-right" symbolHref="#rh-palm" x={730} y={220} w={60} h={160} />
      </g>
      {/* Atmospheric haze overlay — bluish gradient on top of distant
          vegetation only. Sits in this group, blurred along with palms. */}
      <rect
        x="0" y="180" width="800" height="220"
        fill="url(#rh-atmosphere)"
        pointerEvents="none"
        opacity="0.55"
      />
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * FOREGROUND — driveway + garden + bushes + flowers + mid/front palms +
 * mailbox + lawn. Renders IN FRONT of the house structure.
 * ───────────────────────────────────────────────────────────────────────── */
export function LandscapeForeground({ storm, calm, sway, rainIntensity = 0 }: LandscapeProps) {
  const bushColor = lerpRgb([34, 48, 28], [18, 24, 16], storm);
  const palmMidColor = lerpRgb([32, 42, 28], [14, 18, 14], storm);
  const palmFrontColor = lerpRgb([28, 36, 24], [12, 14, 12], storm);
  const mailboxColor = lerpRgb([122, 88, 50], [54, 42, 30], storm);

  return (
    <>
      {/* GARDEN BEDS w/ mulch */}
      <g aria-hidden="true">
        <rect x="290" y="430" width="142" height="12" fill="url(#rh-mulch)" />
        <rect x="528" y="430" width="190" height="12" fill="url(#rh-mulch)" />
      </g>

      {/* BUSHES — denser, more variety */}
      <g style={{ color: bushColor }} aria-hidden="true">
        <SceneElement id="foreground/bush-1" symbolHref="#rh-bush" x={290} y={406} w={80} h={32} />
        <SceneElement id="foreground/bush-2" symbolHref="#rh-bush" x={370} y={412} w={64} h={28} />
        <SceneElement id="foreground/bush-3" symbolHref="#rh-bush" x={528} y={412} w={70} h={28} />
        <SceneElement id="foreground/bush-4" symbolHref="#rh-bush" x={600} y={408} w={80} h={32} />
        <SceneElement id="foreground/bush-5" symbolHref="#rh-bush" x={660} y={414} w={56} h={26} />
      </g>

      {/* HIBISCUS flowers (Florida signature) */}
      <g aria-hidden="true" style={{ opacity: 0.7 + calm * 0.3 }}>
        <SceneElement id="foreground/hibiscus-1" symbolHref="#rh-hibiscus" x={304} y={416} w={9} h={9} />
        <SceneElement id="foreground/hibiscus-2" symbolHref="#rh-hibiscus" x={392} y={420} w={8} h={8} />
        <SceneElement id="foreground/hibiscus-3" symbolHref="#rh-hibiscus" x={552} y={420} w={9} h={9} />
        <SceneElement id="foreground/hibiscus-4" symbolHref="#rh-hibiscus" x={624} y={416} w={9} h={9} />
        <SceneElement id="foreground/hibiscus-5" symbolHref="#rh-hibiscus" x={688} y={422} w={7} h={7} />
      </g>

      {/* FRONT-LEFT OAK — the big oak with Spanish moss draped that
          dominates Sandra's front yard at 2703 Dobbin Dr. Wide canopy
          arches over the lawn. Sways gently in heavy wind (oak trunks
          flex less than palms — smaller sway multiplier). */}
      <g
        data-label="palm-tree"
        style={{
          color: palmFrontColor,
          transformOrigin: '90px 460px',
          transform: `rotate(${(sway.frontL * 0.35).toFixed(2)}deg)`,
        }}
        aria-hidden="true"
      >
        <SceneElement id="foreground/oak-tree-left" symbolHref="#rh-oak" x={-30} y={190} w={220} h={260} />
      </g>

      {/* FRONT-RIGHT OAK — second specimen on the right edge */}
      <g
        style={{
          color: palmFrontColor,
          transformOrigin: '740px 460px',
          transform: `rotate(${(sway.frontR * 0.35).toFixed(2)}deg)`,
        }}
        aria-hidden="true"
      >
        <SceneElement id="foreground/oak-tree-right" symbolHref="#rh-oak" x={650} y={210} w={180} h={240} />
      </g>

      {/* MID-DEPTH oak — between background and foreground */}
      <g
        style={{
          color: palmMidColor,
          opacity: 0.85,
          transformOrigin: '350px 460px',
          transform: `rotate(${(sway.midL * 0.35).toFixed(2)}deg)`,
        }}
        aria-hidden="true"
      >
        <SceneElement id="foreground/oak-tree-mid" symbolHref="#rh-oak" x={270} y={240} w={160} h={220} />
      </g>

      {/* MAILBOX — beveled body + flag */}
      <g aria-hidden="true">
        {/* Post — slight inner highlight on the left edge for cylindrical feel */}
        <line x1="752" y1="430" x2="752" y2="440" stroke="#1a1612" strokeWidth="2.4" />
        <line x1="751" y1="430" x2="751" y2="440" stroke="rgba(255, 240, 200, 0.18)" strokeWidth="0.4" />
        {/* Body — base + bevel (top + left highlights, right + bottom shadow) */}
        <rect x="740" y="416" width="26" height="14" fill={mailboxColor} stroke="#0a0908" strokeWidth="0.6" />
        <line x1="740.4" y1="416" x2="740.4" y2="430" stroke="rgba(255, 240, 200, 0.30)" strokeWidth="0.4" />
        <line x1="740" y1="416.4" x2="766" y2="416.4" stroke="rgba(255, 240, 200, 0.30)" strokeWidth="0.4" />
        <line x1="765.6" y1="416" x2="765.6" y2="430" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
        <line x1="740" y1="429.6" x2="766" y2="429.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
        {/* Door knob — recessed lock with tiny highlight */}
        <circle cx="753" cy="423" r="1.2" fill="#0a0908" />
        <circle cx="752.6" cy="422.6" r="0.4" fill="rgba(255, 240, 200, 0.40)" />
        {/* Flag — beveled red signal */}
        <rect x="762" y="420" width="3" height="3" fill="#eb6924" />
        <line x1="762.3" y1="420" x2="762.3" y2="423" stroke="rgba(255, 220, 160, 0.55)" strokeWidth="0.3" />
        <line x1="762" y1="420.3" x2="765" y2="420.3" stroke="rgba(255, 220, 160, 0.55)" strokeWidth="0.3" />
        <line x1="764.7" y1="420" x2="764.7" y2="423" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.3" />
        <line x1="762" y1="422.7" x2="765" y2="422.7" stroke="rgba(0, 0, 0, 0.50)" strokeWidth="0.3" />
      </g>

      {/* LAWN */}
      <rect x="0" y="438" width="800" height="42" fill="url(#rh-lawn)" />
      <rect x="0" y="438" width="800" height="42" fill="url(#rh-grass)" opacity="0.5" />
      {/* WET SHEEN — diagonal specular streak on the lawn during rain.
          Modulated by rain intensity so it appears progressively. */}
      {rainIntensity > 0.1 && (
        <rect
          x="0" y="438" width="800" height="42"
          fill="url(#rh-wet-sheen)"
          pointerEvents="none"
          style={{ mixBlendMode: 'screen' }}
        />
      )}

      {/* AC CONDENSER UNIT — outdoor compressor sitting on a small
          concrete pad on the right side of the lawn. Required HVAC
          equipment for any Florida home. Beveled box with vent grille
          fins on the side, fan grille on top, and a rusted refrigerant
          line running back to the house. */}
      <g aria-hidden="true" pointerEvents="none">
        {/* Concrete pad it sits on */}
        <rect x="734" y="438" width="22" height="3" fill="#9a9690" stroke="#3a3128" strokeWidth="0.3" />
        <line x1="734" y1="438.4" x2="756" y2="438.4" stroke="rgba(255, 245, 220, 0.32)" strokeWidth="0.3" />
        <line x1="734" y1="440.6" x2="756" y2="440.6" stroke="rgba(0, 0, 0, 0.65)" strokeWidth="0.3" />
        {/* Cast shadow under condenser */}
        <ellipse cx="745" cy="441" rx="13" ry="1.4" fill="rgba(0, 0, 0, 0.45)" />
        {/* Body — beige metal cabinet */}
        <rect x="736" y="424" width="18" height="14" fill="#a89c88" stroke="#0a0908" strokeWidth="0.4" />
        {/* 4-side bevel — left + top sun, right + bottom shadow */}
        <line x1="736.4" y1="424" x2="736.4" y2="438" stroke="rgba(255, 240, 210, 0.42)" strokeWidth="0.3" />
        <line x1="736" y1="424.4" x2="754" y2="424.4" stroke="rgba(255, 240, 210, 0.42)" strokeWidth="0.3" />
        <line x1="753.6" y1="424" x2="753.6" y2="438" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
        <line x1="736" y1="437.6" x2="754" y2="437.6" stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
        {/* Vent grille fins on the front (5 horizontal slats) */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={`acv-${i}`} x1="738" y1={428 + i * 1.8} x2="752" y2={428 + i * 1.8} stroke="rgba(0, 0, 0, 0.55)" strokeWidth="0.3" />
        ))}
        {/* Top fan grille — circular guard on the top of the unit */}
        <ellipse cx="745" cy="424" rx="7" ry="1.6" fill="rgba(60, 50, 42, 0.55)" />
        <ellipse cx="745" cy="423.5" rx="7" ry="1.4" fill="none" stroke="#1a1612" strokeWidth="0.3" />
        {/* Fan blade hint visible through the grille */}
        <line x1="740" y1="423.5" x2="750" y2="424" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="0.4" />
        <line x1="743" y1="422.8" x2="747" y2="425" stroke="rgba(0, 0, 0, 0.35)" strokeWidth="0.4" />
        {/* Refrigerant lines running back to the house (insulated black tube) */}
        <path d="M 736 432 Q 730 432 728 436" stroke="#2a221c" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <path d="M 736 434 Q 730 434 728 438" stroke="#2a221c" strokeWidth="1.0" fill="none" strokeLinecap="round" />
        {/* Brand-plate hint (small rectangle on front) */}
        <rect x="744" y="430" width="3" height="1.5" fill="rgba(0, 0, 0, 0.55)" />
      </g>

      {/* CONTACT SHADOWS — rendered AFTER the lawn so they sit visibly on
          the grass. Anchors palms + mailbox in physical space (Phase 1). */}
      <g aria-hidden="true">
        {/* Mid-depth palm */}
        <ellipse cx="70" cy="448" rx="22" ry="3.5" fill="url(#rh-contact-shadow)" opacity="0.6" />
        {/* Front-left palm */}
        <ellipse cx="60" cy="452" rx="34" ry="4.5" fill="url(#rh-contact-shadow)" opacity="0.72" />
        {/* Front-right palm */}
        <ellipse cx="740" cy="450" rx="28" ry="4" fill="url(#rh-contact-shadow)" opacity="0.7" />
        {/* Mailbox post */}
        <ellipse cx="754" cy="442" rx="14" ry="2.6" fill="url(#rh-contact-shadow)" opacity="0.65" />
      </g>

      {/* AMBIENT GROUND DEBRIS — broken twigs, scattered leaves, and
          torn paper accumulating on the lawn as the storm escalates.
          Three layered density tiers so the lawn progressively reads
          as "wind has been raking debris across it for a while". */}
      {storm > 0.50 && (
        <g
          aria-hidden="true"
          pointerEvents="none"
          shapeRendering="optimizeSpeed"
          style={{ opacity: Math.min(1, (storm - 0.50) * 2.2) }}
        >
          {/* Tier 1 — scattered leaves (oak amber tint, matches the
              flying-leaves color palette so it reads as accumulated
              flying debris that finally landed) */}
          <use href="#rh-leaf" x="320" y="466" width="7" height="5" style={{ color: 'rgba(140, 100, 40, 0.85)' }} />
          <use href="#rh-leaf" x="520" y="468" width="6" height="4" style={{ color: 'rgba(120, 85, 35, 0.85)' }} />
          <use href="#rh-leaf" x="170" y="464" width="8" height="5" style={{ color: 'rgba(140, 100, 40, 0.85)' }} />
          <use href="#rh-leaf" x="640" y="466" width="7" height="5" style={{ color: 'rgba(120, 85, 35, 0.78)' }} />
          <use href="#rh-leaf" x="450" y="468" width="6" height="4" style={{ color: 'rgba(140, 100, 40, 0.85)' }} />
          <use href="#rh-leaf" x="600" y="471" width="7" height="5" style={{ color: 'rgba(110, 78, 32, 0.78)' }} />
          {/* Tier 2 — broken twigs (small dark dashes oriented to
              suggest snapped branch pieces lying on the grass) */}
          {storm > 0.65 && (
            <g style={{ opacity: Math.min(1, (storm - 0.65) * 4) }}>
              <line x1="380" y1="468" x2="392" y2="471" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.8" strokeLinecap="round" />
              <line x1="240" y1="465" x2="252" y2="463" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.8" strokeLinecap="round" />
              <line x1="560" y1="467" x2="568" y2="471" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.8" strokeLinecap="round" />
              <line x1="690" y1="464" x2="704" y2="466" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.9" strokeLinecap="round" />
              <line x1="120" y1="468" x2="132" y2="466" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.8" strokeLinecap="round" />
              {/* Twig branch fork detail (small Y shape) */}
              <path d="M 405 467 L 414 469 L 419 466 M 414 469 L 416 472" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.7" fill="none" strokeLinecap="round" />
              <path d="M 660 470 L 668 472 L 672 469 M 668 472 L 670 475" stroke="rgba(60, 42, 26, 0.85)" strokeWidth="0.7" fill="none" strokeLinecap="round" />
            </g>
          )}
          {/* Tier 3 — heavy debris (palm frond fragments, larger
              torn material) at extreme storm */}
          {storm > 0.80 && (
            <g style={{ opacity: Math.min(1, (storm - 0.80) * 5) }}>
              {/* Torn palm frond fragment */}
              <path d="M 280 470 Q 300 466 320 470 Q 310 472 295 471 Q 285 472 280 470 Z" fill="rgba(40, 56, 32, 0.78)" />
              <line x1="280" y1="470" x2="320" y2="470" stroke="rgba(20, 32, 18, 0.85)" strokeWidth="0.4" />
              {/* Crumpled paper / debris sheet */}
              <polygon points="490,469 498,466 506,470 502,473 494,472" fill="rgba(220, 215, 200, 0.78)" stroke="rgba(140, 130, 110, 0.55)" strokeWidth="0.3" />
              {/* Larger torn-leaf fragment */}
              <path d="M 720 472 Q 730 468 740 471 Q 736 474 728 473 Z" fill="rgba(60, 42, 26, 0.75)" />
              {/* Roof shingle granule pile (granules torn from the roof) */}
              <ellipse cx="370" cy="473" rx="14" ry="2" fill="rgba(45, 38, 28, 0.65)" />
              <circle cx="362" cy="472.5" r="0.5" fill="rgba(60, 50, 40, 0.85)" />
              <circle cx="370" cy="473" r="0.5" fill="rgba(50, 42, 32, 0.85)" />
              <circle cx="378" cy="472.5" r="0.5" fill="rgba(60, 50, 40, 0.85)" />
            </g>
          )}
        </g>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * DRIVEWAY — sits beside the garage; rendered just before the garage so
 * the garage walls overlap it slightly. Exposed separately so we can tuck
 * it in at exactly the right z-order in the parent.
 * ───────────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────────
 * ADIRONDACK CHAIR — classic Florida-yard wood chair sitting on the lawn.
 *
 * Visual states tied to wind speed:
 *   - calm   (V < 80)    — sits upright, small contact shadow
 *   - leaning(V < 130)   — tilts back ~10° from wind pressure
 *   - tumbled(V < 170)   — rotated 90°, lying on side, displaced right
 *   - gone   (V ≥ 170)   — vanished (blown out of frame)
 *
 * Universal "windy day" cue homeowners instantly recognise.
 * ───────────────────────────────────────────────────────────────────────── */
export function AdirondackChair({ V }: { V: number }) {
  if (V >= 170) return null; // Blown away

  const tilt = V < 80 ? 0 : V < 130 ? -8 : -90;
  const dx = V < 130 ? 0 : 28;     // tumbled chair displaces right
  const dy = V < 130 ? 0 : 12;     // settles on its side
  const tumbled = V >= 130;

  return (
    <g
      aria-hidden="true"
      style={{
        transformOrigin: '305px 470px',
        transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg)`,
        transition: 'transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Contact shadow under chair */}
      {!tumbled && (
        <ellipse cx="305" cy="468" rx="18" ry="3" fill="url(#rh-contact-shadow)" opacity="0.6" />
      )}
      {/* Chair body — slatted Adirondack profile */}
      <g>
        {/* Back slats (5 vertical) */}
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={`back-${i}`}
            x={296 + i * 2.4}
            y={444}
            width="1.6"
            height="20"
            fill={i % 2 ? '#a06a44' : '#8e5e3c'}
            stroke="#2a1c10"
            strokeWidth="0.25"
          />
        ))}
        {/* Top crossbar of back */}
        <rect x="295" y="444" width="13" height="2" fill="#6a4628" stroke="#2a1c10" strokeWidth="0.3" />
        {/* Seat slats (3 horizontal) */}
        {[0, 1, 2].map((i) => (
          <rect
            key={`seat-${i}`}
            x={297}
            y={464 + i * 1.5}
            width={14}
            height="1"
            fill={i % 2 ? '#9c6840' : '#8e5e3c'}
            stroke="#2a1c10"
            strokeWidth="0.2"
          />
        ))}
        {/* Front legs (visible when upright only) */}
        {!tumbled && (
          <>
            <rect x="296" y="467" width="1.4" height="3" fill="#5a3c20" />
            <rect x="309" y="467" width="1.4" height="3" fill="#5a3c20" />
          </>
        )}
        {/* Armrests */}
        <rect x="294" y="461" width="2.5" height="6" fill="#7a5230" stroke="#2a1c10" strokeWidth="0.25" />
        <rect x="310" y="461" width="2.5" height="6" fill="#7a5230" stroke="#2a1c10" strokeWidth="0.25" />
      </g>
    </g>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * STORM FLAG — American flag on a vertical pole, anchored on the lawn.
 *
 * Visual states tied to wind speed:
 *   - calm  (V < 30)   — flag droops vertically
 *   - light (V < 80)   — flag flutters lazily
 *   - heavy (V < 140)  — flag horizontal, snapping
 *   - extreme (V ≥ 140) — flag horizontal AND tattered (one stripe missing)
 *
 * Animation via CSS keyframe + skewX driven by wind tier. Rendered as part
 * of the foreground so it sits on top of the lawn.
 * ───────────────────────────────────────────────────────────────────────── */
export function StormFlag({ V, calm }: { V: number; calm: number }) {
  const tier =
    V < 30 ? 'droop' :
    V < 80 ? 'light' :
    V < 140 ? 'heavy' : 'extreme';
  // Damage progression: starts at 140, full destruction by 200 mph
  const damage = Math.max(0, Math.min(1, (V - 140) / 60));
  const showRip1 = V >= 140;
  const showRip2 = V >= 155;
  const showRip3 = V >= 170;
  const showShredded = V >= 185;

  return (
    <g aria-hidden="true" data-label="storm-flag">
      {/* Flagpole — silver pole, base on lawn. Bends slightly under load. */}
      <g
        style={{
          transformOrigin: '430px 478px',
          transform: `rotate(${(V > 100 ? -1 - damage * 1.4 : 0).toFixed(2)}deg)`,
          transition: 'transform 0.6s ease',
        }}
      >
        <line x1="430" y1="478" x2="430" y2="370" stroke="#c4bfbc" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="430" cy="368" r="2.4" fill="#d4a04a" />
        {/* Halyard rope (small line down the side) */}
        <line x1="431.5" y1="372" x2="431.5" y2="430" stroke="rgba(180, 175, 168, 0.55)" strokeWidth="0.4" />

        {/* Flag — group anchored at top of pole, animated tier via className */}
        <g
          className={`rh-flag rh-flag--${tier}`}
          style={{ transformOrigin: '430px 382px', opacity: 0.85 + calm * 0.15 }}
        >
          {/* Stripes (7 red + 6 white) */}
          <rect x="430" y="372" width="40" height="3.5" fill="#b22234" />
          <rect x="430" y="375.5" width="40" height="3.5" fill="#ffffff" />
          <rect x="430" y="379" width="40" height="3.5" fill="#b22234" />
          <rect x="430" y="382.5" width="40" height="3.5" fill="#ffffff" />
          <rect x="430" y="386" width="40" height="3.5" fill="#b22234" />
          <rect x="430" y="389.5" width="40" height="3.5" fill="#ffffff" />
          <rect x="430" y="393" width="40" height="3.5" fill="#b22234" />
          {/* Canton */}
          <rect x="430" y="372" width="18" height="14" fill="#3c3b6e" />
          {/* SHADING GRADIENT — soft dark band across the lower half of
              the flag suggests the trough of a wave self-shadowing the
              fabric. Static (no animation) — the moving keyframes on
              the parent <g> drag this with them so the shadow shifts
              naturally as the flag bends. */}
          <linearGradient id="rh-flag-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="55%" stopColor="rgba(0, 0, 0, 0)" />
            <stop offset="100%" stopColor="rgba(0, 0, 0, 0.30)" />
          </linearGradient>
          <rect x="430" y="372" width="40" height="24.5" fill="url(#rh-flag-shade)" pointerEvents="none" />
          {/* TRAVELING WAVE-CREST HIGHLIGHT — only renders for fluttering
              tiers (light/heavy/extreme). Slides L-to-R across the flag
              via CSS keyframe in sync with the flap cycle, suggesting a
              wave-of-light traveling along the fabric the way real
              cloth catches sun on its peaks. */}
          {tier !== 'droop' && (
            <rect
              className="rh-flag-wave-crest"
              x="430"
              y="372"
              width="8"
              height="24.5"
              fill="url(#rh-glass-sheen)"
              pointerEvents="none"
            />
          )}
          {[
            [433, 374], [437, 374], [441, 374], [445, 374],
            [435, 377], [439, 377], [443, 377],
            [433, 380], [437, 380], [441, 380], [445, 380],
            [435, 383], [439, 383], [443, 383],
          ].map(([x, y], i) => (
            <circle key={`star-${i}`} cx={x} cy={y} r="0.6" fill="#ffffff" />
          ))}

          {/* Progressive damage — rips appear at increasing wind speeds */}
          {showRip1 && (
            <path d="M 462 372 L 470 376 L 466 382 L 470 388 L 462 384 Z"
                  fill="#0a0908" opacity={0.85 + damage * 0.15} />
          )}
          {showRip2 && (
            <path d="M 458 388 L 466 392 L 462 396 L 458 396 Z"
                  fill="#0a0908" opacity={0.85 + damage * 0.15} />
          )}
          {showRip3 && (
            <>
              <path d="M 454 376 L 460 384 L 456 388 Z"
                    fill="#0a0908" opacity={0.9} />
              <path d="M 466 382 L 470 388 L 464 392 L 462 386 Z"
                    fill="#0a0908" opacity={0.92} />
            </>
          )}
          {showShredded && (
            <>
              {/* Multiple horizontal slashes — flag shredded into strips */}
              <rect x="450" y="378" width="20" height="0.8" fill="#0a0908" />
              <rect x="446" y="385" width="24" height="0.8" fill="#0a0908" />
              <rect x="452" y="391" width="18" height="0.8" fill="#0a0908" />
              {/* Trailing torn fabric strip */}
              <path
                d="M 470 380 Q 480 386, 478 396 Q 472 402, 466 398"
                fill="none" stroke="#b22234" strokeWidth="2" opacity="0.7"
                strokeLinecap="round"
                className="rh-flag-strip"
              />
            </>
          )}
        </g>
      </g>
    </g>
  );
}

export function LandscapeDriveway({
  rainIntensity = 0,
  heatShimmer = false,
}: {
  rainIntensity?: number;
  /** True only when calm + midday → render heat-distortion shimmer */
  heatShimmer?: boolean;
}) {
  return (
    <>
      {/* Plain pour concrete (matches 2703 Dobbin Dr) — top edge widened
          to span the full 2-car garage frontage (x=80–280) since Stage 2
          made the garage a 2-car. Pavers pattern still available in
          PatternDefs as `rh-pavers` for a future "Coastal Florida"
          yard preset. */}
      <polygon
        points="80,440 280,440 290,475 80,475"
        fill="url(#rh-concrete)"
        stroke="#5a564f"
        strokeWidth="0.5"
      />
      {/* Expansion joints — diagonal scorelines a real concrete driveway
          would have to control cracking. Spaced for the wider 2-car drive.
          Each joint now beveled: shadow (recess) + sun-catch on the next
          slab so the joint reads as a poured-concrete saw cut. */}
      <line x1="120" y1="440" x2="110" y2="475" stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
      <line x1="120.5" y1="440" x2="110.5" y2="475" stroke="rgba(255, 245, 215, 0.18)" strokeWidth="0.3" />
      <line x1="160" y1="440" x2="155" y2="475" stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
      <line x1="160.5" y1="440" x2="155.5" y2="475" stroke="rgba(255, 245, 215, 0.18)" strokeWidth="0.3" />
      <line x1="200" y1="440" x2="200" y2="475" stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
      <line x1="200.5" y1="440" x2="200.5" y2="475" stroke="rgba(255, 245, 215, 0.18)" strokeWidth="0.3" />
      <line x1="240" y1="440" x2="245" y2="475" stroke="rgba(0,0,0,0.45)" strokeWidth="0.5" />
      <line x1="240.5" y1="440" x2="245.5" y2="475" stroke="rgba(255, 245, 215, 0.18)" strokeWidth="0.3" />
      {/* Driveway top edge bevel where concrete meets lawn */}
      <line x1="80" y1="440.4" x2="280" y2="440.4" stroke="rgba(255, 245, 220, 0.32)" strokeWidth="0.4" />
      {/* Driveway right edge bevel (slab corner) */}
      <line x1="280" y1="440" x2="290" y2="475" stroke="rgba(0, 0, 0, 0.40)" strokeWidth="0.4" />
      {/* Far front edge shadow where slab meets lawn at the curb */}
      <line x1="80" y1="474.6" x2="290" y2="474.6" stroke="rgba(0, 0, 0, 0.45)" strokeWidth="0.4" />
      {rainIntensity > 0.1 && (
        <polygon
          points="80,440 280,440 290,475 80,475"
          fill="url(#rh-wet-sheen)"
          pointerEvents="none"
          style={{ mixBlendMode: 'screen' }}
        />
      )}

      {/* DRIVEWAY PUDDLES — translucent water pools in low spots of
          the concrete slab when rain is heavy enough to overwhelm the
          surface drainage. Each puddle has its own sky-reflection
          ellipse + a subtle ripple ring that animates only via CSS.
          Gated to rainIntensity > 0.40 so light rain doesn't bog
          down with extra elements. */}
      {rainIntensity > 0.40 && (
        <g aria-hidden="true" pointerEvents="none" shapeRendering="optimizeSpeed" style={{ opacity: Math.min(1, (rainIntensity - 0.40) * 2.5) }}>
          {/* 4 puddles at low spots in the slab */}
          {/* Puddle 1 — large, near top-center of driveway */}
          <ellipse cx="160" cy="452" rx="22" ry="3" fill="rgba(80, 110, 135, 0.55)" />
          <ellipse cx="160" cy="451.5" rx="20" ry="2.4" fill="rgba(140, 175, 200, 0.45)" />
          {/* Sky-reflection sliver on top of the puddle */}
          <ellipse cx="160" cy="450.8" rx="14" ry="1.0" fill="rgba(220, 235, 245, 0.45)" />
          {/* Puddle 2 — smaller, mid-driveway */}
          <ellipse cx="220" cy="465" rx="18" ry="2.6" fill="rgba(80, 110, 135, 0.55)" />
          <ellipse cx="220" cy="464.5" rx="16" ry="2.0" fill="rgba(140, 175, 200, 0.42)" />
          <ellipse cx="220" cy="464" rx="11" ry="0.9" fill="rgba(220, 235, 245, 0.42)" />
          {/* Puddle 3 — bottom-left corner */}
          <ellipse cx="105" cy="468" rx="16" ry="2.2" fill="rgba(80, 110, 135, 0.55)" />
          <ellipse cx="105" cy="467.5" rx="14" ry="1.8" fill="rgba(140, 175, 200, 0.42)" />
          <ellipse cx="105" cy="467" rx="9" ry="0.8" fill="rgba(220, 235, 245, 0.42)" />
          {/* Puddle 4 — small, near garage edge */}
          <ellipse cx="265" cy="458" rx="14" ry="2.0" fill="rgba(80, 110, 135, 0.50)" />
          <ellipse cx="265" cy="457.5" rx="12" ry="1.6" fill="rgba(140, 175, 200, 0.40)" />
          <ellipse cx="265" cy="457" rx="8" ry="0.7" fill="rgba(220, 235, 245, 0.40)" />
          {/* RAIN-DROP RIPPLE RINGS — animated CSS expand on each
              puddle, suggesting raindrop impacts. Reuses the new
              rh-pressure-pulse keyframe at slower speed. */}
          <ellipse cx="160" cy="452" rx="3" ry="0.5" fill="none" stroke="rgba(220, 235, 245, 0.55)" strokeWidth="0.4" className="rh-pressure-wave rh-pressure-wave--1" style={{ transformOrigin: '160px 452px', animationDuration: '2.4s' }} />
          <ellipse cx="220" cy="465" rx="3" ry="0.5" fill="none" stroke="rgba(220, 235, 245, 0.55)" strokeWidth="0.4" className="rh-pressure-wave rh-pressure-wave--2" style={{ transformOrigin: '220px 465px', animationDuration: '2.4s' }} />
          <ellipse cx="105" cy="468" rx="3" ry="0.5" fill="none" stroke="rgba(220, 235, 245, 0.55)" strokeWidth="0.4" className="rh-pressure-wave rh-pressure-wave--3" style={{ transformOrigin: '105px 468px', animationDuration: '2.4s' }} />
        </g>
      )}
      {/* HEAT SHIMMER — wavy lines just above the driveway suggesting
          heat distortion. Only visible when calm + midday (the conditions
          where pavement actually shimmers). */}
      {heatShimmer && (
        <g className="rh-heat-shimmer" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <path
              key={`hs-${i}`}
              d={`M ${90 + i * 50} 438 q 8 -3 16 0 t 16 0 t 16 0`}
              fill="none"
              stroke="rgba(255, 240, 200, 0.32)"
              strokeWidth="0.6"
              strokeLinecap="round"
              className={`rh-heat-wave rh-heat-wave--${i}`}
            />
          ))}
        </g>
      )}
    </>
  );
}
