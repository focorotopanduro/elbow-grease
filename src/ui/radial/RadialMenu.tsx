/**
 * RadialMenu — futuristic radial menu with mouse-following sector expansion.
 *
 * Feature stack (layered, top to bottom in visual order):
 *
 *   • CSS backdrop blur (compositor-accelerated dim of background)
 *   • Holographic scan-line + ring glint + HUD brackets
 *   • Particle emission from the hovered sector (energy stream)
 *   • SVG wheel with FISHEYE-DEFORMED sectors:
 *       — The sector nearest the cursor EXPANDS its angular width
 *       — Neighboring sectors compress proportionally (gaussian falloff)
 *       — Strength ramps in smoothly as cursor leaves the dead zone
 *       — Hit-testing uses BASE (stable) layout to prevent feedback loops
 *   • Spring-based sector lens scale (hovered 1.15×, others 0.92×)
 *   • Cursor trail (fading canvas tail)
 *   • Ripple on commit
 *   • Web Audio feedback (open, sector tick, hover-lock, confirm, cancel)
 *   • Center hub with subtype preview + keyboard hint + favorite state
 *   • Electric tendril from center to hovered sector (jagged animated bolt)
 *   • Depth rings pulsing outward (sonar)
 *   • Recents dot indicators
 *   • Keyboard navigation (arrows / Tab / Enter)
 *   • Marking mode (release-to-commit for power users)
 */

import { forwardRef, useEffect, useRef, useState, useMemo } from 'react';
import { useRadialMenuStore, sectorAtAngle } from '@store/radialMenuStore';
import { radialAudio } from './RadialMenuAudio';
import {
  deformSectors,
  lerpDeformed,
  strengthForDistance,
  findSectorAtAngle,
  type DeformedSector,
} from './FisheyeDeformer';
import { WheelParticles, type WheelParticlesHandle } from './WheelParticles';
import { WheelHolographics } from './WheelHolographics';
// Phase 5 — velocity-predicted sector pre-highlight + a11y.
import { SectorPredictor } from './SectorPredictor';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { useAccentPulse } from './useAccentPulse';

// ── Config types (unchanged external API) ──────────────────────

export interface WheelSector {
  id: string;
  label: string;
  icon: string;
  color: string;
  centerAngleRad: number;
  halfWidthRad: number;
  subtypes?: SectorSubtype[];
  onSelect?: (subtypeIndex: number) => void;
  description?: string;
  childWheelId?: string;
}

export interface SectorSubtype {
  id: string;
  label: string;
  icon?: string;
}

export interface WheelConfig {
  id: string;
  title: string;
  accentColor: string;
  sectors: WheelSector[];
  outerRadiusPx: number;
  innerRadiusPx: number;
  tapToSelect?: boolean;
  markingEnabled?: boolean;
  showRecents?: boolean;
  showFavorites?: boolean;
  /** Fisheye expansion factor (default 1.45). */
  fisheyeExpansion?: number;
  /** Fisheye gaussian σ (default 1.1). */
  fisheyeSigma?: number;
}

// ── Main component ──────────────────────────────────────────────

/** Spring-ease scale curve: 0 → 1.08 (slight overshoot) → 1. */
function springScale(p: number): number {
  // Quadratic ease with small overshoot near end
  if (p < 0.9) return 0.55 + p * 0.55; // 0.55 → 1.05
  return 1.05 - (p - 0.9) * 0.5;       // 1.05 → 1.00
}

export function RadialMenu({ config }: { config: WheelConfig }) {
  const activeId = useRadialMenuStore((s) => s.activeWheelId);
  const setCursor = useRadialMenuStore((s) => s.setCursor);
  const setHighlighted = useRadialMenuStore((s) => s.setHighlighted);
  const highlightedId = useRadialMenuStore((s) => s.highlightedSectorId);
  const cycleSubtype = useRadialMenuStore((s) => s.cycleSubtype);
  const selectSector = useRadialMenuStore((s) => s.selectSector);
  const closeWheel = useRadialMenuStore((s) => s.closeWheel);
  const entryProgress = useRadialMenuStore((s) => s.entryProgress);
  const getSubtypeIndex = useRadialMenuStore((s) => s.getSubtypeIndex);
  const addTrailSample = useRadialMenuStore((s) => s.addTrailSample);
  const clearTrail = useRadialMenuStore((s) => s.clearTrail);
  const triggerRipple = useRadialMenuStore((s) => s.triggerRipple);
  const toggleFavorite = useRadialMenuStore((s) => s.toggleFavorite);
  const getRecents = useRadialMenuStore((s) => s.getRecents);
  const markingMode = useRadialMenuStore((s) => s.markingMode);

  // Origin set by openWheelAt (corner-icon launch). Fallback to screen center.
  const wheelOrigin = useRadialMenuStore((s) => s.wheelOrigin);
  const [centerPos, setCenterPos] = useState({
    x: wheelOrigin?.x ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 0),
    y: wheelOrigin?.y ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 0),
  });

  // Keep centerPos in sync with wheelOrigin when it changes
  useEffect(() => {
    if (wheelOrigin) setCenterPos(wheelOrigin);
    else setCenterPos({
      x: typeof window !== 'undefined' ? window.innerWidth / 2 : 0,
      y: typeof window !== 'undefined' ? window.innerHeight / 2 : 0,
    });
  }, [wheelOrigin]);

  const isActive = activeId === config.id;
  const lastHighlightRef = useRef<string | null>(null);
  const mouseMovedSinceOpen = useRef(false);
  const particleHandleRef = useRef<WheelParticlesHandle | null>(null);

  // Phase 5 — OS-level reduce-motion. When true, skip scale animations
  // AND disable velocity prediction (pre-highlighting without visible
  // cursor motion violates the preference's intent).
  const prefersReducedMotion = usePrefersReducedMotion();

  // Phase 5 — SectorPredictor instance kept stable across renders.
  // Reset whenever the wheel opens so stale samples from a previous
  // session don't leak into a new prediction.
  const predictorRef = useRef<SectorPredictor>(new SectorPredictor());

  // Base sectors (stable, hit-test uses these)
  const baseSectors = useMemo(
    () => config.sectors.map((s) => ({
      id: s.id,
      centerAngleRad: s.centerAngleRad,
      halfWidthRad: s.halfWidthRad,
    })),
    [config.sectors],
  );

  // Deformed sectors (visualization, updated per-frame)
  const [deformed, setDeformed] = useState<DeformedSector[]>(() =>
    baseSectors.map((s) => ({ ...s, lensScale: 1, distanceFromHover: 1 })),
  );

  // Cursor angle + distance refs (updated per-move without triggering render)
  const cursorAngleRef = useRef(0);
  const cursorDistRef = useRef(0);

  // Smooth strength ramping
  const currentStrengthRef = useRef(0);

  // ── Window resize ───────────────────────────────────────────

  useEffect(() => {
    const onResize = () =>
      setCenterPos({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Open sound ──────────────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;
    radialAudio.unlock();
    radialAudio.open();
    mouseMovedSinceOpen.current = false;
    return () => { radialAudio.close(); };
  }, [isActive]);

  // ── Per-frame deformation loop ──────────────────────────────

  // FISHEYE DISABLED — sectors stay at their base positions. The
  // lens effect was visually confusing (sectors shifting under the
  // cursor made the "thing you were about to click" slide away) and
  // was rAF-intensive. Flat sectors are predictable and fast.
  useEffect(() => {
    if (!isActive) return;
    // Force deformed = base so the wheel renders statically.
    setDeformed(baseSectors.map((s) => ({ ...s, lensScale: 1, distanceFromHover: 1 })));
    return () => {};
  }, [isActive, baseSectors, config.innerRadiusPx, config.outerRadiusPx, config.fisheyeExpansion, config.fisheyeSigma]);

  // ── Mouse tracking + commit logic ───────────────────────────

  // Wheel open → fresh predictor. Close handled by the cleanup below.
  useEffect(() => {
    if (!isActive) return;
    predictorRef.current.clear();
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;

    const onMove = (e: MouseEvent) => {
      mouseMovedSinceOpen.current = true;
      const dx = e.clientX - centerPos.x;
      const dy = e.clientY - centerPos.y;
      const angle = Math.atan2(-dy, dx);
      const normAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const dist = Math.sqrt(dx * dx + dy * dy);

      cursorAngleRef.current = normAngle;
      cursorDistRef.current = dist;
      setCursor(normAngle, dist);
      addTrailSample(dx, dy);

      // Phase 5 — feed the predictor. We pass (-dy) so the
      // predictor's geometry matches sectorAtAngle's angle convention.
      // Sample timestamping uses performance.now() for monotonic Δt.
      predictorRef.current.addSample(dx, -dy, performance.now());

      // Hit-test uses BASE sectors (stable).
      let hit: string | null = null;
      if (dist >= config.innerRadiusPx) {
        hit = sectorAtAngle(normAngle, baseSectors);
      }

      // If the cursor isn't yet inside a sector, ask the predictor
      // where it's headed. This gives the highlight a ~3-frame head
      // start on short flicks. When the cursor arrives, the real
      // hit-test takes over — `hit` trumps the prediction.
      //
      // prefers-reduced-motion disables prediction: pre-highlighting
      // without accompanying cursor motion is a motion cue the user
      // asked to reduce.
      if (hit === null && !prefersReducedMotion) {
        hit = predictorRef.current.predict({
          baseSectors,
          innerRadius: config.innerRadiusPx,
          outerRadius: config.outerRadiusPx,
          lookaheadMs: 90,
        });
      }

      if (hit !== lastHighlightRef.current) {
        if (hit) radialAudio.hoverLock();
        else if (lastHighlightRef.current) radialAudio.sectorCross();
        lastHighlightRef.current = hit;

        // Update particle emitter for new hover
        if (particleHandleRef.current) {
          const sector = hit ? config.sectors.find((s) => s.id === hit) : null;
          particleHandleRef.current.setEmitter({
            active: !!sector,
            hoverAngleRad: sector?.centerAngleRad ?? 0,
            color: sector?.color ?? config.accentColor,
            spawnRadius: config.outerRadiusPx * 0.7,
            emitRate: 40,
          });
        }
      }
      setHighlighted(hit);
    };

    const commit = (sectorId: string) => {
      const sector = config.sectors.find((s) => s.id === sectorId);
      if (!sector) return;
      const subtypeIdx = getSubtypeIndex(config.id, sectorId);
      const subLabel = sector.subtypes?.[subtypeIdx]?.label ?? '';
      selectSector(sectorId, sector.label + (subLabel ? ` → ${subLabel}` : ''));
      triggerRipple();
      radialAudio.confirm();

      // Burst of particles on commit
      if (particleHandleRef.current) {
        particleHandleRef.current.burst(40);
      }

      sector.onSelect?.(subtypeIdx);
      if (config.tapToSelect) {
        setTimeout(() => closeWheel(), 80);
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const current = useRadialMenuStore.getState().highlightedSectorId;
      if (!current) return;
      commit(current);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!markingMode && !config.markingEnabled) return;
      const current = useRadialMenuStore.getState().highlightedSectorId;
      if (!current) return;
      if (!mouseMovedSinceOpen.current) return;
      commit(current);
    };

    const onWheel = (e: WheelEvent) => {
      // ALWAYS consume the wheel event while the radial menu is open —
      // otherwise scrolling bubbles up to OrbitControls and zooms the
      // scene camera through the wheel backdrop.
      e.preventDefault();
      e.stopPropagation();

      const current = useRadialMenuStore.getState().highlightedSectorId;
      if (!current) return;
      const sector = config.sectors.find((s) => s.id === current);
      if (!sector?.subtypes || sector.subtypes.length === 0) return;
      const direction: 1 | -1 = e.deltaY > 0 ? 1 : -1;
      cycleSubtype(direction, sector.subtypes.length);
      const newIdx = getSubtypeIndex(config.id, current);
      radialAudio.subtypeCycle(newIdx, sector.subtypes.length);
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const current = useRadialMenuStore.getState().highlightedSectorId;
      if (current) {
        toggleFavorite(current);
        radialAudio.hoverLock();
      } else {
        radialAudio.cancel();
        closeWheel();
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('click', onClick);
    window.addEventListener('mouseup', onMouseUp);
    // Capture phase so we intercept the wheel event BEFORE OrbitControls'
    // canvas listener can consume it for camera zoom.
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('contextmenu', onContextMenu);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions);
      window.removeEventListener('contextmenu', onContextMenu);
      clearTrail();
      lastHighlightRef.current = null;
      predictorRef.current.clear();
      if (particleHandleRef.current) {
        particleHandleRef.current.setEmitter({ active: false });
      }
    };
  }, [
    isActive, centerPos, config, baseSectors, markingMode, prefersReducedMotion,
    setCursor, addTrailSample, setHighlighted, cycleSubtype,
    selectSector, closeWheel, getSubtypeIndex, toggleFavorite,
    triggerRipple, clearTrail,
  ]);

  // ── Keyboard navigation ────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;

    const onKey = (e: KeyboardEvent) => {
      const sectors = config.sectors;
      if (sectors.length === 0) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const curIdx = sectors.findIndex((s) => s.id === useRadialMenuStore.getState().highlightedSectorId);
        const next = sectors[(curIdx + 1 + sectors.length) % sectors.length]!;
        // Seed cursor angle so deformation follows
        cursorAngleRef.current = next.centerAngleRad;
        cursorDistRef.current = (config.innerRadiusPx + config.outerRadiusPx) / 2;
        setHighlighted(next.id);
        radialAudio.hoverLock();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const curIdx = sectors.findIndex((s) => s.id === useRadialMenuStore.getState().highlightedSectorId);
        const prev = sectors[(curIdx - 1 + sectors.length) % sectors.length]!;
        cursorAngleRef.current = prev.centerAngleRad;
        cursorDistRef.current = (config.innerRadiusPx + config.outerRadiusPx) / 2;
        setHighlighted(prev.id);
        radialAudio.hoverLock();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const current = useRadialMenuStore.getState().highlightedSectorId;
        if (!current) return;
        const sector = sectors.find((s) => s.id === current);
        if (!sector?.subtypes?.length) return;
        const dir: 1 | -1 = e.shiftKey ? -1 : 1;
        cycleSubtype(dir, sector.subtypes.length);
        const newIdx = getSubtypeIndex(config.id, current);
        radialAudio.subtypeCycle(newIdx, sector.subtypes.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const current = useRadialMenuStore.getState().highlightedSectorId;
        if (!current) return;
        const sector = sectors.find((s) => s.id === current);
        if (!sector) return;
        const subtypeIdx = getSubtypeIndex(config.id, current);
        selectSector(current, sector.label);
        triggerRipple();
        radialAudio.confirm();
        sector.onSelect?.(subtypeIdx);
        if (config.tapToSelect) setTimeout(() => closeWheel(), 80);
      } else if (e.key === 'Escape') {
        // Phase 5 — Escape closes the wheel cleanly, matching the
        // universal Escape contract from the enterprise hardening pass.
        // The global Escape handler (App.tsx KeyboardHandler) will ALSO
        // see this event, but radialMenuStore.activeWheelId === config.id
        // short-circuits its priority chain at the "wheel open" step,
        // so we close here first to avoid a double-close.
        e.preventDefault();
        radialAudio.cancel();
        closeWheel();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, config, setHighlighted, cycleSubtype, getSubtypeIndex, selectSector, triggerRipple, closeWheel]);

  if (!isActive) return null;

  const recentSectorIds = config.showRecents !== false
    ? getRecents(config.id, 5).map((r) => r.sectorId)
    : [];

  // Compute hover angle for holographics
  const hoverSector = config.sectors.find((s) => s.id === highlightedId);
  const hoverAngle = hoverSector?.centerAngleRad ?? null;

  return (
    <>
      {/* Backdrop */}
      <div style={{
        ...styles.backdrop,
        opacity: entryProgress,
        // Backdrop blur REMOVED — was the primary GPU cost while the
        // wheel was open. A solid darker background is enough contrast
        // and doesn't re-composite the whole scene every frame.
      }} />

      {/* Particles / holographics / trail overlay all disabled —
          they were the cause of the wheel's heavy feel and glitches. */}

      {/* Wheel — spring-easing with slight overshoot.
          Phase 5: prefers-reduced-motion disables the entry-spring — wheel
          pops in at its final scale with only an opacity fade. */}
      <div style={{
        ...styles.wheelContainer,
        transform: prefersReducedMotion
          ? 'translate(-50%, -50%)'
          : `translate(-50%, -50%) scale(${springScale(entryProgress)})`,
        opacity: entryProgress,
        transition: prefersReducedMotion
          ? 'opacity 50ms ease-out'
          : 'transform 70ms cubic-bezier(0.2, 1.8, 0.3, 1), opacity 50ms ease-out',
        willChange: 'transform, opacity',
      }}>
        <WheelSVG
          config={config}
          deformedSectors={deformed}
          highlightedId={highlightedId}
          recentSectorIds={recentSectorIds}
          entryProgress={entryProgress}
          prefersReducedMotion={prefersReducedMotion}
        />

        {/* Ripple on commit */}
        <RippleOverlay config={config} />

        {/* Dead-zone pulse when idle */}
        {highlightedId === null && <DeadZoneHint config={config} />}

        {/* Center hub */}
        <CenterHub config={config} highlightedId={highlightedId} />
      </div>
    </>
  );
}

// ── SVG wheel (now takes deformed sectors) ──────────────────────

interface WheelSVGProps {
  config: WheelConfig;
  deformedSectors: DeformedSector[];
  highlightedId: string | null;
  recentSectorIds: string[];
  entryProgress: number;
  prefersReducedMotion: boolean;
}

const WheelSVG = forwardRef<SVGSVGElement, WheelSVGProps>(function WheelSVG(
  { config, deformedSectors, highlightedId, recentSectorIds, entryProgress, prefersReducedMotion }, ref,
) {
  // Phase 5 — the single cubic-bezier that gives every hover transition
  // its "micro-pop". 1.4 in the first pair is the overshoot that makes
  // the icon land with a tiny bounce; 0.3,1.0 is the settle curve.
  // Rejected alternatives: framer-motion (+60KB), react-spring (+40KB) —
  // a native CSS transition reaches the same perceived quality for 0 deps.
  const popTransition = prefersReducedMotion
    ? 'none'
    : 'transform 90ms cubic-bezier(0.2, 1.4, 0.3, 1), font-size 90ms cubic-bezier(0.2, 1.4, 0.3, 1), fill 70ms linear, opacity 70ms linear';
  const size = config.outerRadiusPx * 2 + 80;
  const cx = size / 2;
  const cy = size / 2;

  // One-shot pulse when the accent color flips mid-session (e.g. user
  // hits Shift+M while the wheel is open). Returns 1 normally, 1.08
  // briefly on an accent change, then snaps back to 1. Reinforces the
  // mode flip at the point of interaction. No-op under
  // prefers-reduced-motion. Scoped to WheelSVG so the hook remounts
  // with the wheel; menus opened AFTER a mode change start at 1 with
  // no pulse (entry spring covers that beat).
  const accentPulseScale = useAccentPulse(config.accentColor, prefersReducedMotion);

  // Build lookup for original sector config by id
  const configById = useMemo(() => {
    const m = new Map<string, WheelSector>();
    for (const s of config.sectors) m.set(s.id, s);
    return m;
  }, [config.sectors]);

  return (
    <svg ref={ref} width={size} height={size}
      style={{ position: 'absolute', top: -size / 2, left: -size / 2, overflow: 'visible' }}>

      <defs>
        {/* Radial gradient for hovered sector glow */}
        <radialGradient id={`wheel-glow-${config.id}`}>
          <stop offset="0%"  stopColor={config.accentColor} stopOpacity="0.5" />
          <stop offset="70%" stopColor={config.accentColor} stopOpacity="0.15" />
          <stop offset="100%" stopColor={config.accentColor} stopOpacity="0" />
        </radialGradient>

        {/* Iridescent gradient for ring */}
        <linearGradient id={`wheel-ring-${config.id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={config.accentColor} stopOpacity="0.8" />
          <stop offset="100%" stopColor={config.accentColor} stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* Accent-bearing rings, grouped so a single `transform` scales
          them together from (cx, cy). `useAccentPulse` drives the
          scale value — 1 normally, briefly 1.08 when the workspace
          accent flips, then back to 1. CSS transition smooths both
          directions. Transform-origin via the explicit
          `translate/scale/translate` chain because SVG 1.1
          `transform-origin` support was historically patchy — the
          matrix form works everywhere. */}
      <g
        data-testid="radial-accent-rings"
        transform={`translate(${cx} ${cy}) scale(${accentPulseScale}) translate(${-cx} ${-cy})`}
        style={{
          transition: prefersReducedMotion
            ? 'none'
            : 'transform 150ms ease-out',
          // Transform origin is baked into the matrix above, but set
          // the CSS property too for browsers that honour SVG 2.
          transformOrigin: `${cx}px ${cy}px`,
        }}
      >
        {/* Outer halo — single subtle ring */}
        <circle cx={cx} cy={cy} r={config.outerRadiusPx + 4} fill="none"
          stroke={config.accentColor} strokeWidth={0.5} opacity={0.3} />

        {/* Outer ring — solid background for clarity, crisper border */}
        <circle cx={cx} cy={cy} r={config.outerRadiusPx} fill="rgba(10,12,18,0.92)"
          stroke={config.accentColor} strokeWidth={1.5} strokeOpacity={0.75} />

        {/* Inner dead zone — darker so center hub reads clearly */}
        <circle cx={cx} cy={cy} r={config.innerRadiusPx} fill="rgba(6,8,12,0.98)"
          stroke={config.accentColor} strokeWidth={1} strokeOpacity={0.4} />
      </g>

      {/* Sector dividers (based on DEFORMED boundaries) */}
      {deformedSectors.map((sector, i) => {
        const next = deformedSectors[(i + 1) % deformedSectors.length]!;
        // Boundary at the midpoint of adjacent sectors' edges
        const edgeA = sector.centerAngleRad + sector.halfWidthRad;
        const edgeB = next.centerAngleRad - next.halfWidthRad;
        let boundary = (edgeA + edgeB) / 2;
        // Handle wrap-around
        if (Math.abs(edgeB - edgeA) > Math.PI) {
          boundary = (edgeA + edgeB + Math.PI * 2) / 2;
        }
        const x1 = cx + Math.cos(boundary) * config.innerRadiusPx;
        const y1 = cy - Math.sin(boundary) * config.innerRadiusPx;
        const x2 = cx + Math.cos(boundary) * config.outerRadiusPx;
        const y2 = cy - Math.sin(boundary) * config.outerRadiusPx;
        return <line key={`div-${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
          stroke="#3a3d4a" strokeWidth={1} opacity={0.85} />;
      })}

      {/* Hover wedge — static, no bulge, appears instantly on hover */}
      {highlightedId && (() => {
        const sector = deformedSectors.find((s) => s.id === highlightedId);
        const cfg = configById.get(highlightedId);
        if (!sector || !cfg) return null;

        const rOut = config.outerRadiusPx;
        const rIn = config.innerRadiusPx;
        const a1 = sector.centerAngleRad - sector.halfWidthRad;
        const a2 = sector.centerAngleRad + sector.halfWidthRad;
        const p1x = cx + Math.cos(a1) * rIn;
        const p1y = cy - Math.sin(a1) * rIn;
        const p2x = cx + Math.cos(a1) * rOut;
        const p2y = cy - Math.sin(a1) * rOut;
        const p3x = cx + Math.cos(a2) * rOut;
        const p3y = cy - Math.sin(a2) * rOut;
        const p4x = cx + Math.cos(a2) * rIn;
        const p4y = cy - Math.sin(a2) * rIn;
        const large = sector.halfWidthRad > Math.PI / 2 ? 1 : 0;
        const wedgePath = `M${p1x},${p1y} L${p2x},${p2y} A${rOut},${rOut} 0 ${large} 0 ${p3x},${p3y} L${p4x},${p4y} A${rIn},${rIn} 0 ${large} 1 ${p1x},${p1y} Z`;

        return (
          // Phase 5 — the micro-pop. SVG <g> scales from the wedge's
          // geometric center (the arc midpoint on the mean radius),
          // so the wedge appears to pulse outward ~4% without the
          // sector sliding around. `transform-box: fill-box` anchors
          // the scale to the shape's own bounds so the transform
          // doesn't need manually-computed origin coords.
          <g
            style={{
              transformOrigin: `${cx}px ${cy}px`,
              transform: 'scale(1.04)',
              transition: popTransition,
            }}
          >
            {/* Solid color fill — brighter for clear hover state */}
            <path d={wedgePath} fill={cfg.color} opacity={0.48} />
            {/* Accent edge */}
            <path d={wedgePath} fill="none" stroke={cfg.color}
              strokeWidth={2} opacity={0.95} />
          </g>
        );
      })()}

      {/* Sectors — label/icon using deformed positions */}
      {deformedSectors.map((sector, i) => {
        const cfg = configById.get(sector.id);
        if (!cfg) return null;

        const isHot = highlightedId === sector.id;
        const isRecent = recentSectorIds.includes(sector.id);
        const isDim = highlightedId !== null && !isHot;

        // No stagger — all sectors appear simultaneously for a snappy feel.
        const individualProgress = entryProgress;

        // Static radial position — hover no longer shifts sectors, just
        // changes their size/opacity so you never lose aim on click.
        const baseR = (config.innerRadiusPx + config.outerRadiusPx) / 2;
        const x = cx + Math.cos(sector.centerAngleRad) * baseR;
        const y = cy - Math.sin(sector.centerAngleRad) * baseR;

        const iconSize = isHot ? 38 : isDim ? 24 : 30;
        const labelSize = isHot ? 12 : 10;
        const iconOpacity = (isDim ? 0.55 : 1) * individualProgress;
        const labelOpacity = (isDim ? 0.55 : 1) * individualProgress;

        return (
          <g key={sector.id}>
            {/* Recent dot indicator */}
            {isRecent && !isHot && (
              <circle
                cx={cx + Math.cos(sector.centerAngleRad) * (config.outerRadiusPx - 9)}
                cy={cy - Math.sin(sector.centerAngleRad) * (config.outerRadiusPx - 9)}
                r={3} fill={config.accentColor}
                opacity={0.9 * individualProgress}
              />
            )}

            {/* Icon with drop-shadow when hot.
                Phase 5 — popTransition gives the icon a subtle 1.4-overshoot
                scale on hover-enter so the target confirmation is felt
                before it's cognitively parsed. */}
            <text x={x} y={y} fontSize={iconSize}
              textAnchor="middle" dominantBaseline="middle"
              opacity={iconOpacity}
              style={{
                userSelect: 'none',
                filter: isHot ? `drop-shadow(0 0 8px ${cfg.color})` : 'none',
                transition: popTransition,
              }}>
              {cfg.icon}
            </text>

            {/* Label */}
            <text x={x} y={y + iconSize / 2 + 14}
              fontSize={labelSize} fontWeight={700}
              textAnchor="middle" fill={isHot ? cfg.color : '#a0a0a8'}
              opacity={labelOpacity}
              style={{
                userSelect: 'none', letterSpacing: 1.5, textTransform: 'uppercase',
                transition: popTransition,
              }}>
              {cfg.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
});

// ── Cursor trail ────────────────────────────────────────────────

function TrailOverlay({ centerPos }: { centerPos: { x: number; y: number } }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const tick = () => {
      const trail = useRadialMenuStore.getState().cursorTrail;
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (trail.length >= 2) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1]!;
          const b = trail[i]!;
          const age = now - b.t;
          const alpha = Math.max(0, 1 - age / 400);
          if (alpha < 0.05) continue;
          ctx.strokeStyle = `rgba(0, 229, 255, ${alpha * 0.5})`;
          ctx.lineWidth = 1.5 + alpha * 3;
          ctx.beginPath();
          ctx.moveTo(a.x + centerPos.x, a.y + centerPos.y);
          ctx.lineTo(b.x + centerPos.x, b.y + centerPos.y);
          ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const onResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', onResize);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', onResize);
    };
  }, [centerPos]);

  return <canvas ref={canvasRef} style={styles.trailCanvas} />;
}

// ── Ripple ──────────────────────────────────────────────────────

function RippleOverlay({ config }: { config: WheelConfig }) {
  const [ripples, setRipples] = useState<{ t: number; id: number }[]>([]);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    return useRadialMenuStore.subscribe((state) => {
      if (state.lastRippleTs && state.lastRippleTs !== lastTsRef.current) {
        lastTsRef.current = state.lastRippleTs;
        const id = Math.random();
        setRipples((r) => [...r, { t: state.lastRippleTs!, id }]);
        setTimeout(() => setRipples((r) => r.filter((x) => x.id !== id)), 700);
      }
    });
  }, []);

  const [, force] = useState(0);
  useEffect(() => {
    if (ripples.length === 0) return;
    let raf: number;
    const loop = () => { force((x) => x + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ripples.length]);

  if (ripples.length === 0) return null;

  return (
    <svg style={styles.rippleSvg} width={config.outerRadiusPx * 4} height={config.outerRadiusPx * 4}>
      {ripples.map((rip) => {
        const age = (performance.now() - rip.t) / 700;
        const radius = config.outerRadiusPx * 0.2 + age * config.outerRadiusPx * 1.8;
        const opacity = Math.max(0, 1 - age);
        return (
          <circle key={rip.id}
            cx={config.outerRadiusPx * 2} cy={config.outerRadiusPx * 2} r={radius}
            fill="none" stroke={config.accentColor} strokeWidth={3} opacity={opacity * 0.6}
          />
        );
      })}
    </svg>
  );
}

// ── Dead-zone pulse ─────────────────────────────────────────────

function DeadZoneHint({ config }: { config: WheelConfig }) {
  return (
    <div style={{
      position: 'absolute',
      top: -config.innerRadiusPx, left: -config.innerRadiusPx,
      width: config.innerRadiusPx * 2, height: config.innerRadiusPx * 2,
      borderRadius: '50%',
      border: `1px dashed ${config.accentColor}`,
      opacity: 0.3,
      pointerEvents: 'none',
      animation: 'elbow-radial-pulse 1.8s ease-in-out infinite',
    }} />
  );
}

// ── Center hub ──────────────────────────────────────────────────

function CenterHub({ config, highlightedId }: { config: WheelConfig; highlightedId: string | null }) {
  const getSubtypeIndex = useRadialMenuStore((s) => s.getSubtypeIndex);
  const isFavorite = useRadialMenuStore((s) => s.isFavorite);
  const sector = config.sectors.find((s) => s.id === highlightedId);

  const subtypeIdx = sector ? getSubtypeIndex(config.id, sector.id) : 0;
  const subtype = sector?.subtypes?.[subtypeIdx];
  const fav = sector ? isFavorite(sector.id) : false;
  const isEditWheel = config.id === 'customer_edit';
  const isPlaceWheel = config.id === 'fixture';
  const verb = isEditWheel ? 'EDIT' : isPlaceWheel ? 'PLACE' : 'PICK';

  return (
    <div style={styles.centerHub}>
      <div style={{ ...styles.centerTitle, color: config.accentColor }}>{config.title}</div>
      {sector ? (
        <>
          <div style={{ ...styles.centerSector, color: sector.color }}>
            <span>{sector.icon}</span>
            <span>{sector.label}</span>
            {fav && <span style={{ color: '#ffc107', fontSize: 11 }}>★</span>}
          </div>
          {subtype && (
            <div style={styles.centerSubtype}>
              {subtype.icon ?? ''} {subtype.label}
            </div>
          )}
          {sector.subtypes && sector.subtypes.length > 1 && (
            <div style={styles.scrollHint}>Scroll ⇅ · {sector.subtypes.length} options</div>
          )}
          {sector.description && (
            <div style={styles.centerDesc}>{sector.description}</div>
          )}
          {/* The call-to-action: explicit verb tells the user what click does */}
          <div style={{
            ...styles.centerCTA,
            color: config.accentColor,
            borderTop: `1px solid ${config.accentColor}55`,
          }}>
            ▶ CLICK TO {verb}
          </div>
          <div style={styles.rightClickHint}>
            Right-click: {fav ? 'unpin' : 'pin ★'}
          </div>
        </>
      ) : (
        <>
          <div style={styles.centerHint}>
            {isEditWheel
              ? 'Point to a fixture to edit its template'
              : isPlaceWheel
                ? 'Point to a fixture to place it'
                : 'Point to a sector'}
          </div>
          <div style={styles.centerSubHint}>
            Arrow keys · Scroll = cycle · Enter = commit · Esc = cancel
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(8,8,12,0.72)',
    zIndex: 900,
    pointerEvents: 'none',
    transition: 'opacity 0.12s ease-out',
  },
  wheelContainer: {
    position: 'fixed', top: '50%', left: '50%',
    width: 0, height: 0,
    zIndex: 1000,
    pointerEvents: 'none',
    transition: 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.22s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  centerHub: {
    position: 'absolute', top: -70, left: -95, width: 190, height: 145,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', gap: 4, textAlign: 'center',
    userSelect: 'none', pointerEvents: 'none',
  },
  centerTitle: {
    fontSize: 9, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase',
  },
  centerSector: {
    fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6,
  },
  centerSubtype: {
    fontSize: 11, color: '#ccc', fontWeight: 500,
    padding: '3px 10px', border: '1px solid #333', borderRadius: 4,
    marginTop: 2, background: 'rgba(255,255,255,0.04)',
  },
  centerDesc: {
    fontSize: 9, color: '#888', maxWidth: 160, lineHeight: 1.3, marginTop: 2,
  },
  centerHint: {
    fontSize: 12, color: '#666', fontStyle: 'italic',
  },
  centerSubHint: {
    fontSize: 8, color: '#444', marginTop: 4, maxWidth: 170, lineHeight: 1.3,
  },
  scrollHint: {
    fontSize: 8, color: '#666', letterSpacing: 1, marginTop: 2,
  },
  rightClickHint: {
    fontSize: 7, color: '#444', marginTop: 4,
  },
  centerCTA: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 2,
    marginTop: 6,
    paddingTop: 6,
    textShadow: '0 0 6px currentColor',
    animation: 'elbow-radial-pulse 1.8s ease-in-out infinite',
  },
  trailCanvas: {
    position: 'fixed', inset: 0, zIndex: 998,
    pointerEvents: 'none',
  },
  rippleSvg: {
    position: 'absolute', left: '-200%', top: '-200%', zIndex: 999,
    pointerEvents: 'none', overflow: 'visible',
  },
};
