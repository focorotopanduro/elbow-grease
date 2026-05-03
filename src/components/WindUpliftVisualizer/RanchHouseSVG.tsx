import { useCallback, useRef, useState } from 'react';
import type { CascadeResult } from '../../physics/cascade';
import {
  DEFAULT_HOUSE_THEME,
  getWallTone,
  getRoofTone,
  getDoorColor,
  type HouseTheme,
} from '../../data/houseThemes';
import {
  DEFAULT_TIME_OF_DAY,
  getTimeOfDay,
  type TimeOfDayId,
} from '../../data/timeOfDay';
import { useReducedMotion } from './effects/useReducedMotion';
import { useIntersectionPause } from './effects/useIntersectionPause';
import { useWindEngine } from './effects/useWindEngine';
import { useFpsMonitor } from './effects/useFpsMonitor';
import { computeSway } from './effects/sway';
import PatternDefs from './scene/PatternDefs';
import Annotations from './scene/Annotations';
import SkyAtmosphere from './scene/SkyAtmosphere';
import {
  LandscapeBackground,
  LandscapeForeground,
  LandscapeDriveway,
  StormFlag,
  AdirondackChair,
} from './scene/Landscape';
import HouseStructure from './scene/HouseStructure';
import { RoofBase, RoofCatastrophic } from './scene/RoofAssembly';
import {
  WindStreamlines,
  GroundShadows,
  RainSystem,
  FlyingLeaves,
  Lightning,
  WindVortices,
  Hail,
} from './scene/WeatherEffects';
import HouseStructureIso from './scene/iso/HouseStructureIso';
import RoofAssemblyIso from './scene/iso/RoofAssemblyIso';
import AnnotationsIso from './scene/iso/AnnotationsIso';
import CloudShadows from './scene/CloudShadows';
import PowerInfrastructure from './scene/PowerInfrastructure';
import Vignette from './scene/Vignette';
import AtmosphericTurbulence from './scene/AtmosphericTurbulence';
import SceneTooltip from './SceneTooltip';
import { lerpRgb } from './scene/colors';
import type { ViewMode } from './useViewMode';

interface Props {
  cascade: CascadeResult;
  hasSWB: boolean;
  /** User-selected wall / roof / door palette. Optional → defaults to Florida
   *  Stucco + Charcoal Asphalt + Mahogany. */
  theme?: HouseTheme;
  /** Camera projection mode — 'front' is the cinematic view, 'iso' swaps
   *  the house + roof + annotations for an isometric blueprint version
   *  while keeping all weather/atmosphere/landscape shared. */
  viewMode?: ViewMode;
  /** Lighting palette — dawn / midday / dusk / night. Re-tints the entire
   *  scene without touching geometry. Storm physics are TOD-independent. */
  timeOfDay?: TimeOfDayId;
  /** Educational Labels mode — when true, hovering scene elements shows
   *  tooltips with code citations + dynamic state. */
  labelsEnabled?: boolean;
}

/**
 * Florida ranch — illustrative, larger, architecturally credible.
 *
 * House composition (viewBox 800×480):
 *   - Foundation skirt   y 435–445
 *   - Main house body    x 280–720, y 240–440
 *   - Attached garage    x 100–280, y 290–440 (slightly lower roof)
 *   - Porch overhang     x 420–520, y 320–355 (over front door)
 *   - Windows w/ shutters x left 320, right 580; gable vent in roof apex
 *   - Roof peak          x 500, y 152 (steeper than v1)
 *
 * Landscape:
 *   - 5 palms (2 background, 3 foreground varying sizes)
 *   - Garden beds with mulch + bushes between palms and house
 *   - Concrete-paver driveway to garage + walkway to front door
 *   - Mailbox at right edge
 *   - Lawn with grass texture
 */
export default function RanchHouseSVG({ cascade, hasSWB, theme = DEFAULT_HOUSE_THEME, viewMode = 'front', timeOfDay = DEFAULT_TIME_OF_DAY, labelsEnabled = false }: Props) {
  const V = cascade.windSpeed;
  const isIso = viewMode === 'iso';
  const wallTone = getWallTone(theme.wall);
  const roofTone = getRoofTone(theme.roof);
  const doorColor = getDoorColor(theme.door);
  const tod = getTimeOfDay(timeOfDay);
  const reduced = useReducedMotion();
  const [containerRef, paused] = useIntersectionPause<SVGSVGElement>();
  const quality = useFpsMonitor({ paused, reducedMotion: reduced });

  const triggered = (id: string) =>
    cascade.stages.find((s) => s.id === id)?.triggered ?? false;
  const dripEdgeUp = triggered('drip_edge');
  const shinglesLifting = triggered('field_shingles');
  const underlaymentExposed = triggered('underlayment');
  const sheathingGone = triggered('sheathing');

  const storm = Math.max(0, Math.min(1, (V - 60) / 140));
  const calm = 1 - storm;

  const wind = useWindEngine(storm, { paused, reducedMotion: reduced });
  const rainIntensity = Math.max(0, Math.min(1, (V - 80) / 120));
  // Rain is now pure CSS — no React-state particles needed

  // Sky / sun / horizon driven by the active Time-of-Day palette + storm.
  // Each TOD has calm + storm endpoints; we lerp by storm intensity.
  const skyTop = lerpRgb(tod.skyTopCalm, tod.skyTopStorm, storm);
  const skyMid = lerpRgb(tod.skyMidCalm, tod.skyMidStorm, storm);
  const skyHorizon = lerpRgb(tod.skyHorizonCalm, tod.skyHorizonStorm, storm);
  const sunOpacity = Math.max(0, calm * tod.sunOpacityMul);
  const horizonColor = lerpRgb(tod.horizonColor, [22, 18, 22], storm);

  // Wall + trim colors driven by the active WallTone preset (calm → storm
  // lerp), with an OPTIONAL TOD warm-shift mixed in. At dawn/dusk the wall
  // picks up a warm orange tint; at night a cool blue.
  const baseWallTop = lerpRgb(wallTone.topCalm, wallTone.topStorm, storm);
  const baseWallBot = lerpRgb(wallTone.botCalm, wallTone.botStorm, storm);
  const baseTrim = lerpRgb(wallTone.trimCalm, wallTone.trimStorm, storm);
  const todTint = lerpRgb(tod.wallTintCalm, tod.wallTintStorm, storm);
  // Mix base wall + TOD tint by tintStrength using a quick CSS color-mix-ish
  // approach via lerpRgb. We need to convert baseWallTop string → triplet.
  // Cheap: parse the rgb() string back to numbers.
  const parseRgb = (s: string): [number, number, number] => {
    const m = s.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [128, 128, 128];
  };
  const mix = (a: string, b: string, t: number): string =>
    lerpRgb(parseRgb(a), parseRgb(b), t);
  const wallTop = tod.wallTintStrength > 0 ? mix(baseWallTop, todTint, tod.wallTintStrength) : baseWallTop;
  const wallBot = tod.wallTintStrength > 0 ? mix(baseWallBot, todTint, tod.wallTintStrength * 0.85) : baseWallBot;
  const trimColor = tod.wallTintStrength > 0 ? mix(baseTrim, todTint, tod.wallTintStrength * 0.6) : baseTrim;

  // Sway
  const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000;
  const swayFrontL = reduced ? 0 : computeSway(t, wind.baseline, wind.gust, wind.noise, 0);
  const swayFrontR = reduced ? 0 : computeSway(t, wind.baseline, wind.gust, wind.noise, 1.4);
  const swayMidL = reduced ? 0 : computeSway(t, wind.baseline, wind.gust, wind.noise, 0.7) * 0.7;
  const swayBgL = reduced ? 0 : computeSway(t, wind.baseline, wind.gust, wind.noise, 0.5) * 0.55;
  const swayBgR = reduced ? 0 : computeSway(t, wind.baseline, wind.gust, wind.noise, 2.1) * 0.6;
  // Smoke bends WITH the wind (positive = right, matches streamline direction)
  const smokeBend = wind.current * 35;
  const smokeOpacity = calm > 0.3 && !sheathingGone ? Math.min(0.55, calm) : 0;

  // Heatmap
  const heat = (uplift: number, cap: number) =>
    Math.max(0, Math.min(1.5, uplift / cap)) / 1.5;
  const heatField = heat(cascade.uplift.field, cascade.resistance.shingleCapPsf);
  const heatEdge = heat(cascade.uplift.edge, cascade.resistance.shingleCapPsf);
  const heatCorner = heat(cascade.uplift.corner, cascade.resistance.shingleCapPsf);
  const heatColor = (h: number) => {
    if (h < 0.2) return 'rgba(244, 237, 224, 0)';
    if (h < 0.5) return `rgba(245, 137, 77, ${0.25 + h * 0.5})`;
    if (h < 0.85) return `rgba(235, 105, 36, ${0.45 + h * 0.4})`;
    return `rgba(168, 66, 26, ${0.65 + (h - 0.85) * 0.6})`;
  };

  // Lawn gradient stops — precomputed here so PatternDefs stays palette-agnostic
  const lawnTop = lerpRgb([62, 78, 48], [30, 35, 25], storm);
  const lawnBot = lerpRgb([34, 42, 28], [16, 20, 14], storm);

  // Lightning interior flash — when a bolt fires, briefly boost interior
  // glow so the windows blaze white through the storm. Auto-clears after
  // 220ms.
  const [lightningFlash, setLightningFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const onBoltFire = useCallback(() => {
    setLightningFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setLightningFlash(false), 220);
  }, []);

  // Power-line snap → brief interior outage. PowerInfrastructure fires
  // onPowerOut(true) the instant a line breaks, then onPowerOut(false)
  // ~2.2s later. Window glow drops to 0 during the outage regardless of TOD.
  const [powerOut, setPowerOut] = useState(false);
  const onPowerOut = useCallback((out: boolean) => setPowerOut(out), []);

  // Tooltip / Labels state — drives the hover educational layer
  const [tooltip, setTooltip] = useState<{ id: string; x: number; y: number } | null>(null);
  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!labelsEnabled) return;
    const target = e.target as Element | null;
    const labeled = target?.closest('[data-label]') as Element | null;
    if (!labeled) {
      setTooltip(null);
      return;
    }
    const id = labeled.getAttribute('data-label');
    if (!id) return;
    setTooltip({ id, x: e.clientX, y: e.clientY });
  }, [labelsEnabled]);
  const onSvgPointerLeave = useCallback(() => {
    if (labelsEnabled) setTooltip(null);
  }, [labelsEnabled]);

  const streamCount = reduced ? 0 : Math.round((4 + storm * 14) * quality);
  const debrisCount = reduced ? 0 : Math.round(storm * 14 * quality);
  const birdsOpacity = Math.max(0, (90 - V) / 30);

  // Hurricane shutters close above 140 mph
  const shuttersClosed = V > 140;

  return (
    <>
    <svg
      ref={containerRef}
      className={`rh-svg ${paused ? 'is-paused' : ''} ${labelsEnabled ? 'is-labels-on' : ''}`}
      viewBox="0 0 800 480"
      role="img"
      aria-labelledby="rh-title rh-desc"
      preserveAspectRatio="xMidYMid slice"
      onPointerMove={onSvgPointerMove}
      onPointerLeave={onSvgPointerLeave}
    >
      <title id="rh-title">
        Cross-section of a Florida ranch home with attached garage, hurricane
        shutters, and landscaping under {V} mph wind
      </title>
      <desc id="rh-desc">
        Architecturally detailed scene: stucco walls, gable roof with visible
        shingle courses, hurricane shutters that close above 140 mph, attached
        garage with paver driveway, palms swaying with wind, atmospheric sky
        and weather effects.
      </desc>

      <PatternDefs
        skyTop={skyTop}
        skyMid={skyMid}
        skyHorizon={skyHorizon}
        sunOpacity={sunOpacity}
        storm={storm}
        wallTop={wallTop}
        wallBot={wallBot}
        heatColorCorner={heatColor(heatCorner)}
        heatColorEdge={heatColor(heatEdge)}
        heatColorField={heatColor(heatField)}
        lawnTop={lawnTop}
        lawnBot={lawnBot}
        shingleLight={roofTone.light}
        shingleMid={roofTone.mid}
        shingleDark={roofTone.dark}
        shingleShadow={roofTone.shadow}
        shingleHighlight={roofTone.highlight}
        ambientFill={tod.ambientFill}
        rainIntensity={rainIntensity}
      />

      {isIso ? (
        <>
          {/* ISO MODE BACKGROUND — flat CAD navy + blueprint grid only.
              No sky/sun/clouds/birds/wind/landscape — keep it pure schematic. */}
          <rect x="0" y="0" width="800" height="480" fill="#101418" />
          <rect x="0" y="0" width="800" height="480" fill="url(#rh-blueprint)" pointerEvents="none" />
          <rect x="0" y="0" width="800" height="480" fill="url(#rh-blueprint-major)" pointerEvents="none" />
        </>
      ) : (
        <>
          {/* FRONT MODE — full atmospheric stack */}
          <SkyAtmosphere
            storm={storm}
            sunOpacity={sunOpacity}
            birdsOpacity={tod.isDark ? 0 : birdsOpacity}
            horizonColor={horizonColor}
            sunX={tod.sunX}
            sunY={tod.sunY}
            sunCore={tod.sunCore}
            isDark={tod.isDark}
            starOpacity={tod.starOpacity}
          />
          {/* DISTANT vegetation — sits behind the house */}
          <LandscapeBackground
            storm={storm}
            calm={calm}
            sway={{ bgL: swayBgL, bgR: swayBgR, midL: swayMidL, frontL: swayFrontL, frontR: swayFrontR }}
          />
          {/* CLOUD SHADOWS — soft shadows drifting across the lawn,
              implying clouds passing overhead (ground depth cue) */}
          <CloudShadows storm={storm} reduced={reduced} />
          {/* PROCEDURAL ATMOSPHERIC TURBULENCE — single SVG-noise rect
              that drifts horizontally; renders nothing when storm < 0.3 */}
          <AtmosphericTurbulence storm={storm} reduced={reduced} />
          {/* WIND + GROUND SHADOWS — atmospheric layer between landscape and house */}
          <WindStreamlines storm={storm} streamCount={streamCount} windGust={wind.gust} />
          <GroundShadows />
        </>
      )}

      {/* DRIVEWAY (pavers leading to garage) — front view only.
          Heat shimmer only at calm + midday (the conditions where real
          pavement actually shimmers). */}
      {!isIso && (
        <LandscapeDriveway
          rainIntensity={rainIntensity}
          heatShimmer={timeOfDay === 'midday' && storm < 0.15}
        />
      )}

      {/* POWER INFRASTRUCTURE — utility pole + lines + snap moment.
          Front view only; iso mode would need iso-projected geometry. */}
      {!isIso && (
        <PowerInfrastructure V={V} reduced={reduced} onPowerOut={onPowerOut} />
      )}

      {isIso ? (
        <>
          {/* ISO ENGINEER VIEW — same physics, blueprint projection */}
          <HouseStructureIso
            wallFill={wallTop}
            trimColor={trimColor}
            doorFill={doorColor.fill}
            doorPanelStroke={doorColor.panelStroke}
          />
          <RoofAssemblyIso
            hasSWB={hasSWB}
            shinglesLifting={shinglesLifting}
            underlaymentExposed={underlaymentExposed}
            sheathingGone={sheathingGone}
          />
        </>
      ) : (
        <>
          {/* FRONT CINEMATIC VIEW */}
          {/* ROOF — drawn before walls so wall stroke paints over the eave seam */}
          <RoofBase
            storm={storm}
            hasSWB={hasSWB}
            shinglesLifting={shinglesLifting}
            underlaymentExposed={underlaymentExposed}
            sheathingGone={sheathingGone}
          />

          {/* HOUSE STRUCTURE — garage + main walls + windows + porch + chimney */}
          <HouseStructure
            storm={storm}
            sunOpacity={sunOpacity}
            calm={calm}
            shuttersClosed={shuttersClosed}
            sheathingGone={sheathingGone}
            dripEdgeUp={dripEdgeUp}
            trimColor={trimColor}
            smokeOpacity={smokeOpacity}
            smokeBend={smokeBend}
            doorFill={doorColor.fill}
            doorPanelStroke={doorColor.panelStroke}
            interiorGlowOpacity={tod.interiorGlowOpacity}
            lightningFlash={lightningFlash}
            windSpeed={V}
            rainIntensity={rainIntensity}
            powerOut={powerOut}
          />

          {/* CATASTROPHIC ROOF FAILURE — drawn LAST so the flying panel + glowing
              tear hover above the chimney + walls for max drama */}
          <RoofCatastrophic sheathingGone={sheathingGone} />
        </>
      )}

      {/* FOREGROUND vegetation, mailbox, lawn — front view only */}
      {!isIso && (
        <LandscapeForeground
          storm={storm}
          calm={calm}
          sway={{ bgL: swayBgL, bgR: swayBgR, midL: swayMidL, frontL: swayFrontL, frontR: swayFrontR }}
          rainIntensity={rainIntensity}
        />
      )}

      {/* STORM FLAG — universal "look how windy it is" indicator */}
      {!isIso && <StormFlag V={V} calm={calm} />}

      {/* ADIRONDACK CHAIR — sits on lawn calm; tumbles + blows away in storm */}
      {!isIso && <AdirondackChair V={V} />}

      {/* ENGINEERING ANNOTATIONS — zones, dimensions, title block, north */}
      {isIso ? <AnnotationsIso /> : <Annotations />}

      {/* TOP-LAYER WEATHER — rain, debris, lightning. Drawn last so they
          hover above every structure and aren't clipped by walls. Front
          view only; iso mode is a clean technical drawing. */}
      {!isIso && (
        <>
          <RainSystem rainIntensity={rainIntensity} reduced={reduced} windCurrent={wind.current} />
          <FlyingLeaves storm={storm} debrisCount={debrisCount} />
          {/* Wind vortices behind solid obstacles — von Kármán street.
              Sits below lightning so the bolt's flash overpowers them. */}
          <WindVortices storm={storm} reduced={reduced} />
          {/* Hail at extreme storm (>0.85). Comes after rain so pellets
              read on top of the rain streaks. */}
          <Hail storm={storm} reduced={reduced} />
          <Lightning V={V} storm={storm} paused={paused} reduced={reduced} onBoltFire={onBoltFire} />
        </>
      )}

      {/* VIGNETTE — subtle dark fade from corners inward. */}
      {!isIso && <Vignette storm={storm} />}

      {/* COLOR GRADE — final scene-wide tone shift, applied AFTER
          the vignette so it coheres ALL the per-element accents into
          one storm mood. Three stacked overlays:
            1. MULTIPLY sickly green-yellow midtone tint (the
               supercell-weather palette)
            2. SCREEN warm amber highlight lift (vibrant highs —
               makes chromes, lightning, splash specular pop)
            3. MULTIPLY deep navy corner crush (vibrant lows —
               crushes blacks at the periphery for tension)
          Only renders at storm > 0.85 so calm scenes stay flat. */}
      {!isIso && storm > 0.85 && (
        <g className="rh-color-grade" aria-hidden="true" pointerEvents="none">
          <rect
            x="0" y="0" width="800" height="480"
            fill="rgb(160, 168, 110)"
            opacity={Math.min(0.32, (storm - 0.85) * 1.8)}
            style={{ mixBlendMode: 'multiply' }}
          />
          <rect
            x="0" y="0" width="800" height="480"
            fill="rgb(255, 195, 110)"
            opacity={Math.min(0.10, (storm - 0.85) * 0.5)}
            style={{ mixBlendMode: 'screen' }}
          />
          <rect
            x="0" y="0" width="800" height="480"
            fill="url(#rh-grade-vignette)"
            opacity={Math.min(1, (storm - 0.85) * 4)}
            style={{ mixBlendMode: 'multiply' }}
          />
        </g>
      )}
    </svg>
    {/* SCENE TOOLTIP — only renders when Labels mode active + a labeled
        element is being hovered. position: fixed so it lives outside the
        SVG transform pipeline (camera tilt + cine zoom don't affect it). */}
    {labelsEnabled && tooltip && (
      <SceneTooltip
        activeId={tooltip.id}
        x={tooltip.x}
        y={tooltip.y}
        cascade={cascade}
        windSpeed={V}
      />
    )}
    </>
  );
}
