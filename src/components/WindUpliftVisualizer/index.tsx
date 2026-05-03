import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
// ImmersiveFAB removed from in-sim placement — promoted to page-level
// PageImmersiveFAB in HurricaneUpliftPage so fullscreen captures the
// whole sim section (viewport + sidebar HUD) rather than just the SVG.
import RanchHouseSVG from './RanchHouseSVG';
import { RasterModeToast } from './scene/RasterModeToast';
import WindSlider from './WindSlider';
import InstallToggle from './InstallToggle';
import HouseConfigPanel from './HouseConfig';
import HouseCustomizer from './HouseCustomizer';
import RoofSurvivalQuiz from './RoofSurvivalQuiz';
import MaterialLegend from './MaterialLegend';
// StormReplay row is gone — its UX now lives in the bottom-right SceneHUD pod.
// Keep the file in case anyone wants the old row back; it isn't imported here.
import CompareProfiles from './CompareProfiles';
import OutcomeCard from './OutcomeCard';
import PressureCallouts from './PressureCallouts';
import FailureCascade from './FailureCascade';
import DisclosureDrawer from './DisclosureDrawer';
import CTASection from './CTASection';
import Narrative from './Narrative';
import UpliftChart from './UpliftChart';
import AchievementToast from './AchievementToast';
// AchievementsPanel row → AchievementHUD ribbon (top-center inside the scene).
// Old file kept on disk in case anyone wants the panel form back; not imported.
import { useVisualizerState } from './useVisualizerState';
import { useHouseTheme } from './useHouseTheme';
import { useViewMode } from './useViewMode';
import { useTimeOfDay } from './useTimeOfDay';
import { useTooltips } from './useTooltips';
import SceneHUD from './SceneHUD';
import { useAchievements } from './effects/useAchievements';
// useCameraTilt removed — pointer-driven perspective rotation forced
// continuous SVG re-compositing on every mouse move (the "hovering feels
// slow" complaint). Drama lurches stay — they only fire on cascade
// triggers, so zero idle cost.
import { useCameraDrama } from './effects/useCameraDrama';

// Phase-4 storm-replay cinematic — lazy-loaded so the WebP fetch + decode
// only happens when the user actually clicks "Play hurricane". Cold-start
// page load is unchanged whether or not Blender frames have been shipped.
const StormReplayCinematic = lazy(
  () => import('./scene/cinematic/StormReplayCinematic'),
);
import { ACHIEVEMENTS, type AchievementId } from '../../data/achievements';
import './WindUpliftVisualizer.css';

interface Props {
  ctaHref?: string;
}

export default function WindUpliftVisualizer({ ctaHref = '/#contact' }: Props) {
  const v = useVisualizerState();
  const houseTheme = useHouseTheme();
  const view = useViewMode();
  const timeOfDay = useTimeOfDay();
  const tooltips = useTooltips();
  const [shareCopied, setShareCopied] = useState(false);
  const ach = useAchievements();
  const sliderTouched = useRef(false);
  // (vizRef + vizEl removed — ImmersiveFAB was promoted to page-level
  // PageImmersiveFAB in HurricaneUpliftPage so fullscreen targets the
  // whole .hup__viz section instead of just the SVG.)

  // Drama lurches only — kicked off on cascade triggers (sheathing tear,
  // shingles lift). Idle cost = 0. Pointer tilt was removed because the
  // continuous variable writes + perspective rotation re-composited the
  // entire SVG every mouse move.
  const drama = useCameraDrama(v.cascade);

  useEffect(() => {
    if (!shareCopied) return;
    const t = setTimeout(() => setShareCopied(false), 1800);
    return () => clearTimeout(t);
  }, [shareCopied]);

  const dramatic = v.cascade.highestStageReached === 'sheathing' ||
                   v.cascade.highestStageReached === 'underlayment';

  // ===== Achievement triggers =====
  // Wind crosses thresholds
  useEffect(() => {
    if (v.windSpeed > 130) ach.unlock('lightning_witnessed');
    if (v.windSpeed > 140) ach.unlock('shutters_slammed');
    if (v.windSpeed >= 200) ach.unlock('max_wind');
  }, [v.windSpeed, ach]);

  // Cascade reaches sheathing failure
  useEffect(() => {
    if (v.cascade.highestStageReached === 'sheathing') {
      ach.unlock('roof_lost');
    }
  }, [v.cascade.highestStageReached, ach]);

  // Storm replay starts unlocks the storm-specific achievement
  useEffect(() => {
    const s = v.replay.state.storm;
    if (!s) return;
    const map: Record<string, AchievementId> = {
      andrew_1992: 'survived_andrew',
      charley_2004: 'survived_charley',
      ian_2022: 'survived_ian',
      milton_2024: 'survived_milton',
    };
    const id = map[s.id];
    if (id) ach.unlock(id);
  }, [v.replay.state.storm, ach]);

  // Wrap setWindSpeed to unlock first_gust on first interaction
  const handleWindChange = (val: number) => {
    if (!sliderTouched.current) {
      sliderTouched.current = true;
      ach.unlock('first_gust');
    }
    v.setWindSpeed(val);
  };

  // Achievement share: copies a tailored message
  const onShareAchievement = async (id: AchievementId) => {
    const a = ACHIEVEMENTS[id];
    const url = window.location.href;
    const text = `${a.shareText} ${url}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: a.title, text, url });
      } else {
        await navigator.clipboard.writeText(text);
        setShareCopied(true);
      }
    } catch { /* user-cancelled */ }
  };

  // Engineer-mode unlock when geek-details opens
  const onGeekToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) ach.unlock('engineer_mode');
  };

  const onShare = async () => {
    if (typeof navigator === 'undefined') return;
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'How long would your Florida roof last in a hurricane?',
          text: `My roof at ${v.windSpeed} mph (${v.profile.label}) — try it yourself`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setShareCopied(true);
      }
    } catch {
      /* user-cancelled */
    }
  };

  return (
    <section
      className={`wuv ${dramatic ? 'wuv--dramatic' : ''}`}
      aria-label="Hurricane wind-uplift visualizer"
    >
      {/* HOOK — short, playful, action-oriented */}
      <header className="wuv__intro">
        <p className="eyebrow">Drag the slider &middot; Watch what happens</p>
        <h2 className="wuv__title">
          Your roof, <em>any wind speed.</em>
        </h2>
      </header>

      {/* RESPONSIVE LAYOUT — at <1024px (tablet + small) this is a
          plain vertical flex column (sim on top, controls stacked
          below). At ≥1024px it becomes a 2-column CSS grid: sim
          viewport on the left taking ~70%, controls sidebar on the
          right at ~30%. Sidebar contents (slider, toggle, compare,
          quiz, share, CTA) flow naturally inside .wuv__sidebar. */}
      <div className="wuv__layout">

      {/* HERO SCENE — full width on tablet, left column on desktop.
          SceneHUD docks two minimalist icon pods inside the scene
          corners (TOD + View). No chrome above the scene; spatially
          symmetric. */}
      <div
        className={[
          'wuv__viz',
          v.replay.state.isPlaying ? 'wuv__viz--cine' : '',
          drama === 'shingles' ? 'wuv__viz--drama-shingles' : '',
          drama === 'sheathing' ? 'wuv__viz--drama-sheathing' : '',
        ].filter(Boolean).join(' ')}
        style={
          v.replay.state.isPlaying
            ? ({ ['--cine-progress' as never]: v.replay.state.progress } as CSSProperties)
            : undefined
        }
      >
        <RanchHouseSVG
          cascade={v.cascade}
          hasSWB={v.profile.hasSWB}
          theme={houseTheme.theme}
          viewMode={view.mode}
          timeOfDay={timeOfDay.tod}
          labelsEnabled={tooltips.enabled}
        />
        {/* Photoreal Blender flipbook overlay — front view only; iso mode
            keeps the pure CAD blueprint look. Renders nothing if Blender
            frames aren't shipped (graceful SVG fallback). */}
        {v.replay.state.isPlaying && view.mode === 'front' && (
          <Suspense fallback={null}>
            <StormReplayCinematic
              progress={v.replay.state.progress}
              isPlaying={v.replay.state.isPlaying}
            />
          </Suspense>
        )}
        {/* MINIMAL HUD — top-center ribbon + perfect 4-corner pods:
              Trophy ribbon (TC) · TOD (TL) · View (TR) · Gauge (BL) · StormReplay (BR) */}
        <SceneHUD
          tod={timeOfDay.tod}
          onTodChange={timeOfDay.set}
          cycling={timeOfDay.cycling}
          onToggleCycle={timeOfDay.toggleCycle}
          viewMode={view.mode}
          onViewChange={view.set}
          windSpeed={v.windSpeed}
          replay={v.replay}
          achievementsUnlocked={ach.unlocked}
          onShareAchievement={onShareAchievement}
          labelsEnabled={tooltips.enabled}
          onToggleLabels={tooltips.toggle}
        />
        {v.replay.state.isPlaying && (
          <div className="wuv__cine-bar" aria-hidden="true">
            <span style={{ width: `${v.replay.state.progress * 100}%` }} />
          </div>
        )}
      </div>

      {/* SIDEBAR (desktop) / STACK (tablet) — wraps every interactive
          control so the desktop CSS-grid layout can put them in the
          right column while tablet keeps them stacked below the sim. */}
      <aside className="wuv__sidebar">

      {/* NARRATIVE — sits BELOW the scene, no longer covering the lawn */}
      <Narrative cascade={v.cascade} profile={v.profile} />

      {/* OUTCOME — gamified live status (the dopamine hit) */}
      <OutcomeCard cascade={v.cascade} profile={v.profile} />

      {/* STORM REPLAY — moved into the bottom-right SceneHUD pod.
          Page is ~150px shorter as a result; the in-scene HUD owns
          the entire replay UX (idle play button → storm picker popover
          → playing progress ring → paused mini-toolbar). */}

      {/* PRIMARY CONTROLS — wind + roof, two side-by-side */}
      <div className="wuv__controls-row">
        <WindSlider
          value={v.windSpeed}
          onChange={handleWindChange}
          disabled={v.replay.state.isPlaying}
        />
        <InstallToggle value={v.installId} onChange={v.setInstallId} />
      </div>

      {/* ACHIEVEMENTS — moved to the top-center ribbon inside SceneHUD.
          The toast (AchievementToast) still fires on every fresh unlock;
          the ribbon also celebrates with a gold halo + count bump. */}

      {/* COMPARE — the conversion lever (dollar figures) */}
      <CompareProfiles windSpeed={v.windSpeed} config={v.config} />

      {/* SURVIVAL QUIZ — plain-language entry point. Six everyday-
          language questions that map to BOTH the house config + the
          install profile, then auto-runs the storm replay. The verdict
          reveals after the wind ramp finishes. Power users can still
          drag the slider / tweak the engineering drawer; this panel
          is the streamlined funnel for the median visitor. */}
      <RoofSurvivalQuiz
        cascade={v.cascade}
        isReplaying={v.replay.state.isPlaying}
        onApply={({ config, install, storm }) => {
          v.setConfig(config);
          v.setInstallId(install);
          v.replay.start(storm);
          ach.unlock('quiz_complete');
        }}
        ctaHref={ctaHref}
      />

      {/* SHARE prompt — surfaces only at dramatic moments, drives viral */}
      {dramatic && (
        <div className="wuv__share">
          <p>
            <strong>Send this to your spouse.</strong> The link captures
            exactly what you're looking at right now &mdash; same wind, same
            roof, same outcome.
          </p>
          <button type="button" onClick={onShare} className="btn btn--ghost btn--ghost-on-dark">
            {shareCopied ? 'Link copied ✓' : 'Share this scene →'}
          </button>
        </div>
      )}

      {/* PRIMARY CTA — the lead-capture moment */}
      <CTASection
        cascade={v.cascade}
        profile={v.profile}
        ctaHref={ctaHref}
      />

      </aside>
      </div>{/* /.wuv__layout */}

      {/* ACHIEVEMENT TOAST — pop-up announcer (sits OUTSIDE the layout
          grid because it's a fixed overlay, not part of the flow). */}
      <AchievementToast id={ach.recent} onDismiss={ach.dismissRecent} />

      {/* RASTER-MODE TOAST — confirms Alt+R / ?raster=off toggles. Lets
          the artist instantly compare their painted PNGs vs the SVG
          fallback. Self-mounting; only renders briefly after a toggle. */}
      <RasterModeToast />

      {/* ENGINEERING DETAILS — collapsed by default for casual visitors.
          Lives BELOW the responsive layout grid so it's always full-
          width regardless of breakpoint. */}
      <details className="wuv__geek" onToggle={onGeekToggle}>
        <summary className="wuv__geek-summary">
          <span className="wuv__geek-icon" aria-hidden="true">⚙</span>
          <span className="wuv__geek-text">
            <strong>For the engineers in the room</strong>
            <span>The full math, code citations, and house-tuning controls</span>
          </span>
          <span className="wuv__geek-toggle" aria-hidden="true">+</span>
        </summary>

        <div className="wuv__geek-body">
          {/* Note: TOD + ViewMode now live in the SceneHUD (in-scene corners).
              Geek panel keeps deeper config: house theme, structure, codes. */}
          <HouseCustomizer
            theme={houseTheme.theme}
            onWallChange={houseTheme.setWall}
            onRoofChange={houseTheme.setRoof}
            onDoorChange={houseTheme.setDoor}
            onReset={houseTheme.reset}
          />
          <HouseConfigPanel value={v.config} onChange={v.setConfig} />
          <MaterialLegend profile={v.profile} />
          <div className="wuv__panels">
            <PressureCallouts cascade={v.cascade} />
            <FailureCascade cascade={v.cascade} />
          </div>
          <UpliftChart cascade={v.cascade} resistance={v.cascade.resistance} />
          <DisclosureDrawer cascade={v.cascade} profile={v.profile} />
        </div>
      </details>

      {/* STICKY FREE INSPECTION CTA — always one tap away (Facebook-shared link friendly) */}
      <a
        href={`${ctaHref}?utm_source=visualizer&utm_medium=sticky&utm_campaign=wind_uplift_fb`}
        className="wuv__sticky-cta"
        aria-label="Schedule free inspection"
      >
        <span className="wuv__sticky-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
        <span className="wuv__sticky-text">
          <strong>Free inspection</strong>
          <span>30 min · No obligation</span>
        </span>
      </a>
    </section>
  );
}
