/**
 * ELBOW GREASE — Plumbing CAD
 *
 * Game-loop architecture:
 *   useFrame runs at 60fps for cursor tracking + visual updates
 *   React re-renders ONLY on point add/remove/mode change
 *   All transient visuals (cursor ring, ghost line) update via refs
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Line, Text } from '@react-three/drei';
import * as THREE from 'three';

import { bootFeedbackLoop } from '@core/CueRoutineReward';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3 } from '@core/events';
import { bootPipeStore, usePipeStore } from '@store/pipeStore';
import { useFloorStore } from '@store/floorStore';
// Phase 2a — undo/redo now live inside @ui/KeyboardHandler (extracted).
// Phase 9 — unified pipe drawing feedback
import { useDrawFeedbackStore } from '@store/drawFeedbackStore';
import { nearestPipeSnap } from '@core/pipe/nearestPipeSnap';
import {
  applyDrawConstraints,
  LEGAL_RELATIVE_ANGLES_DEG,
  materialRequiresLegalAngles,
} from '@core/pipe/angleSnap';
// Phase 10.A — Logger
import { logger } from '@core/logger/Logger';
import { bootLogger } from '@core/logger/boot';
const appLog = logger('App');
import { useFixtureStore } from '@store/fixtureStore';
// Phase 14.I — multi-select store moved into @ui/KeyboardHandler
// in Phase 2a; App.tsx no longer imports it directly.
import { FixtureLayerFromStore } from '@ui/fixtures/FixtureModels';
import { FixtureParamWindow } from '@ui/fixtures/FixtureParamWindow';
// Phase 14.F — compact fixture inspector; default surface when a
// fixture is selected so pipe-drawing isn't blocked by the full editor.
import { FixtureMiniCard } from '@ui/fixtures/FixtureMiniCard';
import { FixtureVisualEditor } from '@ui/fixtures/FixtureVisualEditor';
import { FixturePlacementPreview } from '@ui/fixtures/FixturePlacementPreview';
import { AdaptiveQuality } from '@ui/perf/AdaptiveQuality';
// Phase 12.D — one-shot GPU probe that runs BEFORE <Canvas> mounts,
// so we can pass the `antialias` flag (a context-creation parameter)
// conditionally. See ADR 027.
import { probeGpuAtBoot, isLowSpecGpu } from '@ui/perf/bootGpuProbe';
// Phase 10.D — PerfSampler is an R3F sibling to AdaptiveQuality; it
// reads gl.info once per frame and forwards to PerfStats. PerfHUD is
// a 2D overlay outside the Canvas. Both are gated by featureFlag.perfHud.
import { PerfSampler } from '@ui/perf/PerfSampler';
// Phase 12.E — spring-arm camera (opt-in).
import { SpringArmController } from '@ui/cameras/SpringArmController';
import { PerfHUD } from '@ui/debug/PerfHUD';
import { NavStatusChip } from '@ui/NavStatusChip';
// Phase 2a — extracted window-level keyboard dispatcher with the
// ARCHITECTURE.md §4.1 plumbing-mode guard.
import { KeyboardHandler } from '@ui/KeyboardHandler';
// UI polish — mode accent stripe at the very top of the viewport
// + a workspace-specific status bar peer for the roofing mode.
// Gives users running both trades in the same session an instant
// "which trade is armed" signal without having to read text.
import { ModeAccentStripe } from '@ui/ModeAccentStripe';
import { RoofingStatusBar } from '@ui/roofing/RoofingStatusBar';
import { UpdateManager } from '@ui/UpdateManager';
import { ErrorBoundary } from '@ui/ErrorBoundary';
import { HelpOverlay } from '@ui/HelpOverlay';
// Phase 10.F — first-run coach-mark walkthrough.
import { OnboardingOverlay } from '@ui/onboarding/OnboardingOverlay';
// Phase 11.E — recent-projects panel (Ctrl+Shift+R).
import { RecentFilesPanel } from '@ui/file/RecentFilesPanel';
// Phase 14.A — pricing profile editor (Ctrl+Shift+B).
import { PricingProfilePanel } from '@ui/pricing/PricingProfilePanel';
// Phase 14.B — PDF proposal: hidden printable layout + contractor
// profile editor (Ctrl+Shift+I). The print is triggered from
// ExportPanel via `printProposal()`.
import { PrintableProposal } from '@ui/print/PrintableProposal';
import { PrintableBidPackage } from '@ui/print/PrintableBidPackage';
import { ContractorProfilePanel } from '@ui/print/ContractorProfilePanel';
// Phase 14.G — proposal revisions + change order printing.
import { PrintableChangeOrder } from '@ui/print/PrintableChangeOrder';
import { RevisionComparePanel } from '@ui/print/RevisionComparePanel';
// Phase 14.J — shareable library (contractor profile + pricing +
// templates + revisions) export/import. Ctrl+Shift+Y.
import { LibraryExportImportPanel } from '@ui/sync/LibraryExportImportPanel';
// Phase 14.C — Assembly Templates library (Ctrl+Shift+T).
import { AssemblyTemplatesPanel } from '@ui/templates/AssemblyTemplatesPanel';
// Phase 14.D — Auto p-trap + cleanout compliance preview (Ctrl+Shift+L).
import { TrapCleanoutPanel } from '@ui/compliance/TrapCleanoutPanel';
// Phase 14.E — Quick-rotate selected fixture with [ / ] / Shift / Ctrl.
import { FixtureRotationShortcutsBinder } from '@ui/fixtures/useFixtureRotationShortcuts';
// Phase 14.M — lasso / box-select + group rotation.
import { BoxSelectOverlay, CameraMatrixSnooper } from '@ui/selection/BoxSelectOverlay';
import { GroupRotationGizmo } from '@ui/selection/GroupRotationGizmo';
import { SelectionCountBadge } from '@ui/selection/SelectionCountBadge';
// Phase 14.N — mass edit panel (Ctrl+Shift+M).
import { MassEditPanel } from '@ui/selection/MassEditPanel';
// Phase 14.O — group translate gizmo + arrow-key translation.
import { GroupTranslateGizmo } from '@ui/selection/GroupTranslateGizmo';
import { GroupTranslateShortcutsBinder } from '@ui/selection/useGroupTranslateShortcuts';
import { SelectionClipboardShortcutsBinder } from '@ui/selection/useSelectionClipboardShortcuts';
import { AutoRouteShortcutBinder } from '@ui/fixtures/useAutoRouteShortcut';
import { RiserPlacementPanel } from '@ui/fixtures/RiserPlacementPanel';
import { DrawingHintBar } from '@ui/draw/DrawingHintBar';
import { CursorBadge } from '@ui/draw/CursorBadge';
import { CursorTracker } from '@ui/draw/CursorTracker';
import { GodModeConsole } from '@ui/debug/GodModeConsole';
import { ComplianceDebugger } from '@ui/debug/ComplianceDebugger';
import { bootCommandBus } from '@core/commands/boot';
import { bootPlumbingComplianceStore } from '@store/plumbingComplianceStore';
// Phase 10.E — local-only session telemetry, flag-gated + opt-in.
import { bootSessionTelemetry } from '@core/telemetry/boot';
// Phase 11.A — project bundle save/load + autosave.
import { bootAutosave, recoverFromAutosave, clearAutosave } from '@core/bundle/autosave';
import { useBundleHotkeys } from '@core/bundle/useBundleHotkeys';
import { PhaseSelectorBar } from '@ui/phases/PhaseSelectorBar';
import { PhaseBOMPanel } from '@ui/phases/PhaseBOMPanel';
import { usePhaseShortcuts } from '@ui/phases/usePhaseShortcuts';
import { CustomerBadge } from '@ui/customers/CustomerBadge';
import { useCustomerShortcuts } from '@ui/customers/useCustomerShortcuts';
import { FixtureTemplateEditor } from '@ui/customers/FixtureTemplateEditor';
import { WallRenderer } from '@ui/walls/WallRenderer';
import { RulerCatcher, MeasurementLines, ScaleCalibratorDialog } from '@ui/measure/RulerTool';
import { BackdropLayer } from '@ui/backdrop/BackdropPlane';
import { MeasureToolbar } from '@ui/measure/MeasureToolbar';
import { useMeasureShortcuts } from '@ui/measure/useMeasureShortcuts';
import { usePlumbingLayerStore } from '@store/plumbingLayerStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';

import { GlowRing, CollisionFlash, SnapBurst, CompletePulse } from '@ui/SensoryFeedback';
import { PipeRenderer } from '@ui/PipeRenderer';
import { OrthoPipeInteraction } from '@ui/draw/OrthoPipeInteraction';
import { OrthoDragModeBadge } from '@ui/draw/OrthoDragModeBadge';
import { LiveRoutePreview } from '@ui/pipe/LiveRoutePreview';
import { LiveFittings } from '@ui/pipe/LiveFittings';
import { PipeCollisionMarkers } from '@ui/pipe/PipeCollisionMarkers';
import { PipeHitboxes } from '@ui/pipe/PipeHitboxes';
import { PivotPreview } from '@ui/pipe/PivotPreview';
import { FittingRenderer } from '@ui/pipe/FittingMeshes';
import { DimensionHelpers, PitchIndicators } from '@ui/pipe/DimensionHelpers';
import { EndpointExtender } from '@ui/pipe/EndpointExtender';
import { ManifoldRenderer } from '@ui/manifold/ManifoldRenderer';
import {
  ManifoldPlacement,
  // Phase 2a — `beginManifoldPlacement` / `isManifoldPlacementActive`
  // moved into @ui/KeyboardHandler along with the extracted keydown
  // switch; App.tsx only needs the placement component now.
} from '@ui/manifold/ManifoldPlacement';
import { CappedEndpoints } from '@ui/pipe/CappedEndpoints';
import { bootConnectivityManager } from '@core/pipe/ConnectivityManager';
import { bootHotSupplyPropagation } from '@core/fixtures/bootHotSupplyPropagation';
import { bootSpatialAudio } from '@core/spatial/SpatialAudio';
import { useFeatureFlagStore } from '@store/featureFlagStore';
// Phase 12.A — Sims-style wall visibility cycle.
// Phase 2a — `useRenderModeStore` moved into @ui/KeyboardHandler
// with the Shift+W cycle. App.tsx no longer imports it.
// Phase 14.R.3 — Plumbing ⇄ Roofing workspace switch. The mode store
// is a peer of plumbingDrawStore; it controls WHICH workspace is active
// (plumbing vs roofing) while plumbingDrawStore continues to drive the
// draw / select / navigate tool state WITHIN plumbing.
import { useAppModeStore } from '@store/appModeStore';
import { ModeTabs } from '@ui/ModeTabs';
import { RoofingInspector } from '@ui/roofing/RoofingInspector';
// Phase 14.R.4 — roofing canvas drawing tools. Mounted inside <Scene>
// (RoofSectionsLayer + RoofingDrawInteraction + DraftRectanglePreview)
// and as a DOM overlay (RoofingToolbar) only in roofing mode.
import { RoofSectionsLayer } from '@ui/roofing/RoofSectionsLayer';
import { RoofingDrawInteraction } from '@ui/roofing/RoofingDrawInteraction';
import { DraftRectanglePreview } from '@ui/roofing/DraftRectanglePreview';
// Phase 14.R.9 — polygon draft preview (rubber-band, numbered vertices,
// closing-edge highlight, live area/perim readout).
import { DraftPolygonPreview } from '@ui/roofing/DraftPolygonPreview';
import { RoofingToolbar } from '@ui/roofing/RoofingToolbar';
// Phase 14.R.5 — PDF blueprint underlay. 3D textured ground plane
// + click-catcher for 2-click calibration + DOM panel for load /
// opacity / offset / rotate / scale.
import { RoofingPDFPlane } from '@ui/roofing/RoofingPDFPlane';
import { PDFCalibrationInteraction } from '@ui/roofing/PDFCalibrationInteraction';
import { RoofingPDFPanel } from '@ui/roofing/RoofingPDFPanel';
// Phase 14.R.8 — drag-to-move for committed roof sections.
import { SectionDragInteraction } from '@ui/roofing/SectionDragInteraction';
// Phase 14.R.18 — polygon vertex editing (per-vertex drag handles).
import { PolygonVertexHandles } from '@ui/roofing/PolygonVertexHandles';
import { VertexDragInteraction } from '@ui/roofing/VertexDragInteraction';
// Phase 14.R.27 — spatial roof penetrations (chimney / skylight / vent
// markers placed by click, auto-drive the FL estimator's counts).
import { RoofPenetrations3D } from '@ui/roofing/RoofPenetrations3D';
// Phase 14.R.19 — section rotation (ring gizmo + keyboard [/] shortcuts).
import { RotationGizmo } from '@ui/roofing/RotationGizmo';
import { RoofingRotationKeyHandler } from '@ui/roofing/RoofingRotationKeyHandler';
// Phase 14.R.23 — visual axis-rotation handle for polygon gable/shed.
import { AxisRotationGizmo } from '@ui/roofing/AxisRotationGizmo';
// Removed: PipeDecals, FittingStamps, PostEffects — caused perf issues + glitching.
// They can be re-enabled by reimporting and remounting; files remain on disk.
import { FeedbackOverlay } from '@ui/FeedbackOverlay';
import { PipeInspector } from '@ui/PipeInspector';
import { LayerPanel } from '@ui/LayerPanel';
import { ExportPanel } from '@ui/ExportPanel';
import { PerformanceMonitor } from '@ui/pipe/perf/PerformanceMonitor';
import { Toolbar } from '@ui/Toolbar';
import { StatusBar } from '@ui/StatusBar';
import { FloorSelectorRail } from '@ui/floors/FloorSelectorRail';
import { FloorVisibilityControls } from '@ui/floors/FloorVisibilityControls';
import { FloorPlaneOutlines } from '@ui/floors/FloorPlaneOutlines';
import { ActiveFloorAutoInfer } from '@ui/floors/ActiveFloorAutoInfer';
import { useFloorShortcuts } from '@ui/floors/useFloorShortcuts';
import type { FixtureSubtype } from './engine/graph/GraphNode';

// Phase 1: Radial menus + chord + iso camera
import { DrawingWheel } from '@ui/radial/wheels/DrawingWheel';
import { FixtureWheel, CustomerEditWheel } from '@ui/radial/wheels/FixtureWheel';
import { WheelCornerIcons } from '@ui/radial/WheelCornerIcons';
import { IsoCameraHUD, IsoCameraController, useIsoCameraStore } from '@ui/cameras/IsoCamera';
import { chordDetector } from '@core/input/ChordDetector';
import { useRadialMenuStore } from '@store/radialMenuStore';
import { loadCustomersFromStorage, useCustomerStore } from '@store/customerStore';
// Phase 10.B — SVGExporter is loaded lazily via `loadSvgExporter`.
// Keeping a TYPE-only import here so call sites have type-safety without
// forcing the runtime module into the main bundle.
import type { exportToSVG as ExportToSVGFn, openPrintableSVG as OpenPrintableSVGFn } from './engine/export/SVGExporter';
import { loadSvgExporter } from '@core/lazy/loaders';

// Phase 2: simulation visualizations + neuro wiring
import { SolvePipelineHUD } from '@ui/phase2/SolvePipelineHUD';
import { ComplianceOverlay3D } from '@ui/phase2/ComplianceOverlay3D';
import { HydraulicInspector } from '@ui/phase2/HydraulicInspector';
import { NeuroStatusOrb } from '@ui/phase2/NeuroStatusOrb';
import { AutoRouteTrigger } from '@ui/phase2/AutoRouteTrigger';
import { AdaptiveRenderBridge } from '@ui/phase2/AdaptiveRenderBridge';
import { engagementTracker } from '@core/neuro/EngagementMetrics';
import { cognitiveMonitor } from '@core/spatial/CognitiveLoadMonitor';
import { fatigueGuard } from '@core/neuro/VisualFatigueGuard';
import { getSimulationBridge } from './engine/worker/SimulationBridge';

// ── Demo fixtures ───────────────────────────────────────────────

const DEMO_FIXTURES: { position: [number, number, number]; subtype: FixtureSubtype }[] = [
  { position: [-2, 0, -1], subtype: 'water_closet' },
  { position: [2, 0, -1],  subtype: 'lavatory' },
  { position: [0, 0, 2],   subtype: 'shower' },
  { position: [-3, 0, 3],  subtype: 'kitchen_sink' },
  { position: [3, 0, 3],   subtype: 'bathtub' },
];

function snapVal(v: number, g: number): number { return Math.round(v / g) * g; }

// Phase 2.F: tiny component that installs floor keyboard shortcuts
function FloorShortcutsBinder() {
  useFloorShortcuts();
  return null;
}

// Phase 2.E: tiny component that installs phase keyboard shortcuts
function PhaseShortcutsBinder() {
  usePhaseShortcuts();
  return null;
}

// Phase 2.D: customer keyboard shortcuts
function CustomerShortcutsBinder() {
  useCustomerShortcuts();
  return null;
}

// Phase 2.G: measure-tool keyboard shortcuts
function MeasureShortcutsBinder() {
  useMeasureShortcuts();
  return null;
}

// OrbitControls + IsoCameraController both want to drive the camera.
// Gate orbit so it only runs when a Perspective view is selected. In
// Top/Front/Side/Iso modes, the iso controller takes over.
function OrbitControlsGate({
  orbitRef, mode, pivoting,
}: {
  orbitRef: React.MutableRefObject<any>;
  mode: string;
  pivoting: boolean;
}) {
  const cameraMode = useIsoCameraStore((s) => s.mode);
  const perspective = cameraMode === 'perspective';
  // Track the iso-camera transition so OrbitControls stands down while
  // the controller programmatically drives the camera. Without this,
  // OrbitControls' damping fights the preset transition and the
  // camera visibly drifts back to perspective. (Bug fix — top/side/
  // front views were dead because of this race.)
  const isoTransitioning = useIsoCameraStore((s) => s.transitionT < 1);
  // Phase 6: hold-to-freeze navigation. When the user holds the freeze
  // key (Space), all orbit gestures stop — so a click-drag to extend a
  // pipe can't accidentally pan the camera. Released → orbit resumes.
  const navFrozen = usePlumbingDrawStore((s) => s.navFrozen);
  // Controls are enabled unless pivoting OR nav is frozen OR the user
  // is in Select mode (where left-drag becomes a box-select lasso,
  // not an orbit — Phase 14.M) OR an iso transition is currently
  // playing.
  const enabled = !pivoting && !navFrozen && mode !== 'select' && !isoTransitioning;
  const allowRotate = perspective;
  const allowPan = true;
  const allowZoom = true;
  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enabled={enabled}
      enableRotate={allowRotate}
      enablePan={allowPan}
      enableZoom={allowZoom}
      minPolarAngle={perspective ? 0.05 : 0}
      maxPolarAngle={perspective ? Math.PI / 2.05 : Math.PI}
      minDistance={1}
      maxDistance={100}
      enableDamping
      dampingFactor={0.18}
      rotateSpeed={1.2}
      panSpeed={1.2}
      zoomSpeed={1.2}
      // Explicit CAD-style bindings:
      //   LEFT   = rotate (orbit around target)
      //   MIDDLE = dolly (zoom)
      //   RIGHT  = pan
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      // Touch bindings for tablet/stylus work:
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
      // Pan in screen space (feels more natural than world-space pan)
      screenSpacePanning
      // Zoom to where the cursor is pointing, not center of screen
      zoomToCursor
    />
  );
}

// ── Draw interaction (game-loop optimized) ──────────────────────

function DrawInteraction() {
  const { raycaster, camera, pointer } = useThree();
  const groundPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hitV = useRef(new THREE.Vector3());

  // Refs for game-loop (no React re-render)
  const cursorMeshRef = useRef<THREE.Group>(null!);
  const ghostLineRef = useRef<THREE.Group>(null!);
  const snapFlashRef = useRef<THREE.Mesh>(null!);
  const cursorPos = useRef<Vec3>([0, 0, 0]);
  const lastSnapTime = useRef(0);

  // Scratch objects for the vertical-plane raycast path in getHit().
  // Pre-Phase-12.A audit this block allocated 3 Vector3s + 1 Plane on
  // every pointer-move tick while in draw mode — ~300 allocs/s of GC
  // pressure during the app's most-used interaction. Now reused.
  const scratchCamDir = useRef(new THREE.Vector3());
  const scratchPlaneNormal = useRef(new THREE.Vector3());
  const scratchPlane = useRef(new THREE.Plane());
  const scratchOrigin = useRef(new THREE.Vector3(0, 0, 0));

  // React state (only changes on point add/remove/mode)
  const mode = usePlumbingDrawStore((s) => s.mode);
  const drawPlane = usePlumbingDrawStore((s) => s.drawPlane);
  const drawPoints = usePlumbingDrawStore((s) => s.drawPoints);
  const material = usePlumbingDrawStore((s) => s.drawMaterial);
  const gridSnap = usePlumbingDrawStore((s) => s.gridSnap);
  const diameter = usePlumbingDrawStore((s) => s.drawDiameter);

  // Raycast hit
  const getHit = useCallback((): Vec3 => {
    raycaster.setFromCamera(pointer, camera);
    const gs = gridSnap;

    if (drawPlane === 'vertical') {
      // Reuse pre-allocated scratch objects — see refs above.
      const camDir = scratchCamDir.current;
      camera.getWorldDirection(camDir);
      const n = scratchPlaneNormal.current.set(camDir.x, 0, camDir.z);
      if (n.lengthSq() < 0.001) n.set(0, 0, 1);
      n.normalize();
      const vp = scratchPlane.current.setFromNormalAndCoplanarPoint(n, scratchOrigin.current);
      const h = raycaster.ray.intersectPlane(vp, hitV.current);
      if (!h) return cursorPos.current;
      return [snapVal(h.x, gs), Math.max(0, snapVal(h.y, gs)), snapVal(h.z, gs)];
    }

    const h = raycaster.ray.intersectPlane(groundPlane.current, hitV.current);
    if (!h) return cursorPos.current;
    return [snapVal(h.x, gs), 0, snapVal(h.z, gs)];
  }, [raycaster, camera, pointer, drawPlane, gridSnap]);

  // Game loop: update cursor mesh position every frame via ref (no re-render).
  //
  // Phase 9 additions:
  //   • Run nearestPipeSnap against visible pipes. If the cursor is
  //     within endpoint/body snap threshold, override the grid-snap
  //     cursor position to the snap target + populate
  //     drawFeedbackStore so the hint bar + snap indicator can react.
  //   • Compute `nextAction` so DrawingHintBar always shows a
  //     contextually correct tip.
  useFrame(({ clock }) => {
    if (mode !== 'draw') return;
    let pos = getHit();

    // Phase 9.B — try to snap to pipes.
    const pipes = Object.values(usePipeStore.getState().pipes);
    const snap = nearestPipeSnap(pos, pipes);
    const feedback = useDrawFeedbackStore.getState();
    if (snap) {
      pos = snap.position; // lock cursor to the snap target
      feedback.setSnapTarget({
        kind: snap.kind,
        position: snap.position,
        label: formatSnapLabel(snap, pipes),
        pipeId: snap.pipeId,
        segmentIdx: snap.segmentIdx,
        segmentT: snap.segmentT,
      });
    } else {
      feedback.setSnapTarget(null);

      // Phase 14.R — apply the same legal-angle + rise + length-
      // quantize constraints to the live cursor that the commit
      // path (addDrawPoint) will apply. Skipped when the cursor is
      // locked to a pipe-snap target (that takes priority — the
      // user's deliberately snapping to an existing endpoint).
      const iState = usePlumbingDrawStore.getState();
      if (iState.drawPoints.length > 0) {
        pos = applyDrawConstraints(pos, {
          points: iState.drawPoints,
          material: iState.drawMaterial,
          drawPlane: iState.drawPlane,
          gridStep: iState.gridSnap,
        });
      }
    }

    // Update next-action based on state + snap.
    const drawPointsLen = usePlumbingDrawStore.getState().drawPoints.length;
    const nextAction = computeNextAction({
      mode: 'draw',
      drawPointsLen,
      snapKind: snap?.kind ?? null,
    });
    feedback.setNextAction(nextAction);

    cursorPos.current = pos;

    // Move cursor ring directly
    if (cursorMeshRef.current) {
      cursorMeshRef.current.position.set(pos[0], pos[1] + 0.01, pos[2]);
    }

    // Snap flash fade
    if (snapFlashRef.current) {
      const age = clock.elapsedTime - lastSnapTime.current;
      const scale = age < 0.3 ? 1 + age * 4 : 0;
      snapFlashRef.current.scale.setScalar(scale);
      (snapFlashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - age * 2);
      snapFlashRef.current.visible = age < 0.3;
    }
  });

  // Click handlers
  useEffect(() => {
    if (mode !== 'draw') return;
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Phase 9 — use the cursor position computed in useFrame, which
      // already has the pipe-snap override applied if applicable.
      // Falling back to getHit() for the very first frame (cursorPos
      // may still be at origin if the mouse hasn't moved yet).
      const pos = cursorPos.current[0] === 0 &&
                  cursorPos.current[1] === 0 &&
                  cursorPos.current[2] === 0
        ? getHit()
        : cursorPos.current;

      // Phase 14.S — Alt held = free-angle override for a single
      // click. Commits the raw grid-snapped position, bypassing the
      // legal-angle + rise + length-quantize pipeline. Lets users
      // drop odd-angle adapters / field-fit situations without
      // switching to PEX just for one segment. The next click
      // (Alt released) snaps normally.
      if (e.altKey) {
        // Use raw hit (ignore the constraint-snapped cursorPos) so
        // the override actually escapes the constraint.
        const rawHit = getHit();
        usePlumbingDrawStore.getState().addDrawPointRaw(rawHit);
      } else {
        usePlumbingDrawStore.getState().addDrawPoint(pos);
      }
      lastSnapTime.current = performance.now() / 1000; // for snap flash

      // Richer snap-type for the feedback loop: if the cursor was
      // locked to a pipe endpoint/body, note it so audio cues differ.
      const snapKind = useDrawFeedbackStore.getState().snapTarget?.kind;
      const feedbackKind: 'grid' | 'pipe' | 'fixture' =
        snapKind === 'endpoint' || snapKind === 'body' ? 'pipe' :
        snapKind === 'fixture' || snapKind === 'manifold-port' ? 'fixture' :
        'grid';
      eventBus.emit(EV.PIPE_SNAP, { position: pos, snapType: feedbackKind });
    };

    const onDblClick = () => {
      const pts = usePlumbingDrawStore.getState().finishDraw();
      if (pts && pts.length >= 2) {
        const s = usePlumbingDrawStore.getState();
        eventBus.emit(EV.PIPE_COMPLETE, {
          id: `pipe-${Date.now()}`, points: pts,
          diameter: s.drawDiameter, material: s.drawMaterial,
        });
      }
      // Auto-return to Navigate after finishing a pipe. Feels natural
      // — you're done drawing, you want to orbit to review. Ctrl+Space
      // re-enters draw mode in one shortcut when you want to draw again.
      usePlumbingDrawStore.getState().setMode('navigate');
    };

    // Phase 14.S — Backspace removes the most recent in-progress
    // draw point. Keeps the session alive (mode stays 'draw') so
    // the user can keep clicking after the undo. Skipped when focus
    // is inside an input — otherwise typing a number in the
    // diameter field would eat characters mid-edit.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      const pts = usePlumbingDrawStore.getState().drawPoints;
      if (pts.length === 0) return;
      e.preventDefault();
      usePlumbingDrawStore.getState().popDrawPoint();
    };

    // Suppress the browser context menu so it doesn't pop up over the
    // scene when the user right-drags to pan (CAD convention).
    //
    // We do NOT clear the draw here: right-click is reserved for pan,
    // and a lost-work bug used to happen whenever you tried to reframe
    // mid-draw. Use Escape to cancel.
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener('click', onClick);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('contextmenu', onCtx);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('keydown', onKey);
    };
  }, [mode, getHit]);

  if (mode !== 'draw') return null;

  const isVert = drawPlane === 'vertical';
  const r = diameter / 24;
  const accentColor = isVert ? '#ff7043' : '#00e5ff';

  return (
    <group>
      {/* Committed points line */}
      {drawPoints.length >= 2 && (
        <Line points={drawPoints} color={accentColor} lineWidth={5} />
      )}

      {/* Each placed point + segment length label */}
      {drawPoints.map((pt, i) => {
        const isFirst = i === 0;
        const isLast = i === drawPoints.length - 1;
        const isBend = !isFirst && !isLast;

        // Segment length
        let segLen = 0;
        if (i > 0) {
          const prev = drawPoints[i - 1]!;
          const dx = pt[0] - prev[0], dy = pt[1] - prev[1], dz = pt[2] - prev[2];
          segLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
        }

        return (
          <group key={i}>
            {/* Point marker */}
            <mesh position={pt}>
              {isBend
                ? <torusGeometry args={[r * 2, r * 0.8, 8, 16, Math.PI / 2]} />
                : <sphereGeometry args={[r * 2, 12, 12]} />
              }
              <meshStandardMaterial
                color={isFirst ? '#00e676' : isBend ? '#ffa726' : accentColor}
                emissive={isFirst ? '#00e676' : isBend ? '#ffa726' : accentColor}
                emissiveIntensity={1.5} toneMapped={false}
              />
            </mesh>

            {/* Segment length readout */}
            {segLen > 0.01 && (
              <group position={[
                (pt[0] + drawPoints[i - 1]![0]) / 2,
                (pt[1] + drawPoints[i - 1]![1]) / 2 + 0.3,
                (pt[2] + drawPoints[i - 1]![2]) / 2,
              ]}>
                <mesh>
                  <planeGeometry args={[0.6, 0.18]} />
                  <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} side={THREE.DoubleSide} />
                </mesh>
              </group>
            )}
          </group>
        );
      })}

      {/* Cursor ring — position updated via useFrame ref, not React state */}
      <group ref={cursorMeshRef}>
        <mesh rotation-x={isVert ? 0 : -Math.PI / 2}>
          <ringGeometry args={[r * 2.2, r * 3, 32]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.5} side={THREE.DoubleSide} />
        </mesh>
        {/* Inner dot */}
        <mesh rotation-x={isVert ? 0 : -Math.PI / 2}>
          <circleGeometry args={[r * 0.5, 12]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        {/* Crosshair lines */}
        <Line points={[[-r * 4, 0, 0], [r * 4, 0, 0]]} color={accentColor} lineWidth={1} transparent opacity={0.2} />
        <Line points={[[0, 0, -r * 4], [0, 0, r * 4]]} color={accentColor} lineWidth={1} transparent opacity={0.2} />
        {/* Vertical axis line when in vertical mode */}
        {isVert && <Line points={[[0, -1, 0], [0, 1, 0]]} color="#ff7043" lineWidth={1} transparent opacity={0.3} />}
      </group>

      {/* Phase 14.R — rubber-band preview line from the last committed
          point to the (constraint-snapped) cursor. Shows the user
          EXACTLY where their next click will land, honoring the legal-
          angle + rise + length-quantize constraints. */}
      {drawPoints.length >= 1 && (
        <RubberBand
          last={drawPoints[drawPoints.length - 1]!}
          cursorRef={cursorMeshRef}
          color={accentColor}
        />
      )}

      {/* Phase 14.S — detent ring: 8 faint rays from the last
          committed point showing the legal relative directions. Gives
          the user a visible map of where the snap targets are so
          they can aim their next click. Dims when Alt is held (the
          user is intentionally bypassing the constraint). */}
      {drawPoints.length >= 1 && (
        <DetentRing
          last={drawPoints[drawPoints.length - 1]!}
          prev={drawPoints.length >= 2 ? drawPoints[drawPoints.length - 2]! : null}
          material={material}
          cursorRef={cursorMeshRef}
        />
      )}

      {/* Snap flash ring (animated via useFrame) */}
      <mesh ref={snapFlashRef} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[r * 2, r * 3, 24]} />
        <meshBasicMaterial color="#00e676" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Grid cell highlight under cursor. Raised to Y=0.04 + renderOrder=3
          so it sits clearly above the Grid shader (Y=0) and shadow plane
          (Y=-0.02) without Z-fighting. depthWrite=false so it never
          occludes real geometry behind it. */}
      {!isVert && (
        <mesh
          position={[0, 0.04, 0]}
          rotation-x={-Math.PI / 2}
          renderOrder={3}
        >
          <planeGeometry args={[gridSnap, gridSnap]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.12}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Phase 9.B — snap indicator. Renders a bright green ring at
          the snap target position when the cursor is locked to a pipe
          endpoint or body. Drives home "I'm about to drop a point
          HERE exactly" affordance. */}
      <SnapIndicator />
    </group>
  );
}

// Phase 14.R — rubber-band preview line.
//
// Drawn as a dashed Line in three.js. The two endpoints are the last
// committed draw point (stable, React-state) and the live cursor mesh
// position (updated per-frame via ref, no React rerender). We update
// the line's positions buffer each tick so the preview tracks the
// cursor without any React churn.
function RubberBand({
  last,
  cursorRef,
  color,
}: {
  last: Vec3;
  cursorRef: React.RefObject<THREE.Group | null>;
  color: string;
}) {
  const lineRef = useRef<THREE.Line>(null!);
  const labelRef = useRef<THREE.Group>(null!);
  const textRef = useRef<any>(null);
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([
        last[0], last[1], last[2],
        last[0], last[1], last[2],
      ]), 3),
    );
    return g;
  }, [last[0], last[1], last[2]]);

  useFrame(() => {
    const cursor = cursorRef.current;
    if (!cursor || !lineRef.current) return;
    const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
    // Refresh endpoint A in case `last` changed underneath (React
    // rerender can lag a frame).
    posAttr.setXYZ(0, last[0], last[1], last[2]);
    // Endpoint B = the live cursor position.
    posAttr.setXYZ(1, cursor.position.x, cursor.position.y, cursor.position.z);
    posAttr.needsUpdate = true;

    // Update the angle/length label at the segment midpoint.
    if (labelRef.current && textRef.current) {
      const dx = cursor.position.x - last[0];
      const dy = cursor.position.y - last[1];
      const dz = cursor.position.z - last[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 0.05) {
        labelRef.current.position.set(
          (last[0] + cursor.position.x) / 2,
          (last[1] + cursor.position.y) / 2 + 0.25,
          (last[2] + cursor.position.z) / 2,
        );
        labelRef.current.visible = true;
        // Angle off horizontal (rise indicator)
        const horiz = Math.sqrt(dx * dx + dz * dz);
        const riseDeg = horiz < 1e-3 ? (dy > 0 ? 90 : -90)
          : (Math.atan2(dy, horiz) * 180) / Math.PI;
        const riseTag = Math.abs(riseDeg) < 0.5 ? '' : ` · ${riseDeg.toFixed(0)}°`;
        // `Text` is imperatively mutable via `text` prop on Drei ≥ 9.
        (textRef.current as { text?: string }).text = `${len.toFixed(2)} ft${riseTag}`;
      } else {
        labelRef.current.visible = false;
      }
    }
  });

  return (
    <>
      <primitive
        object={(() => {
          // Build a THREE.Line once; React never re-renders the
          // underlying mesh type, only the positions attribute above.
          if (lineRef.current) return lineRef.current;
          const mat = new THREE.LineDashedMaterial({
            color,
            dashSize: 0.25,
            gapSize: 0.15,
            transparent: true,
            opacity: 0.85,
            linewidth: 2,
          });
          const line = new THREE.Line(geom, mat);
          line.computeLineDistances();
          lineRef.current = line;
          return line;
        })()}
      />
      <group ref={labelRef} visible={false}>
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[0.95, 0.22]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} />
        </mesh>
        <Text
          ref={textRef}
          fontSize={0.12}
          color={color}
          outlineWidth={0.006}
          outlineColor="#000"
          anchorX="center"
          anchorY="middle"
        >
          0 ft
        </Text>
      </group>
    </>
  );
}

// Phase 14.S — detent ring.
//
// Renders faint rays from the last committed point out along each of
// the legal relative directions. Length ~3 ft so they're visible
// without dominating the scene. For the first committed point (no
// prior direction), rays fall back to the 4 world-aligned cardinals
// so the user still sees "the four main compass directions are legal."
//
// PEX bypasses: when the material bends freely there ARE no detents
// to show, so the ring quietly unmounts.
//
// The ray closest to the cursor's angle brightens — visual
// confirmation of which detent the snap will hit.
function DetentRing({
  last,
  prev,
  material,
  cursorRef,
}: {
  last: Vec3;
  prev: Vec3 | null;
  material: string;
  cursorRef: React.RefObject<THREE.Group | null>;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  // Compute the set of legal absolute angles at this point. When
  // `prev` is null we anchor to +X (world-aligned); when we have a
  // prior direction we rotate the relative legal set by that heading.
  const rayData = useMemo(() => {
    // Null-guard: memo identity changes when `prev` or `last` changes
    // (via the dep array below), so this body is only re-run then.
    let anchorAngle = 0; // Radians, measured around Y axis in XZ plane.
    if (prev) {
      const dx = last[0] - prev[0];
      const dz = last[2] - prev[2];
      if (Math.hypot(dx, dz) > 1e-6) {
        anchorAngle = Math.atan2(dz, dx);
      }
    }
    // With a prior direction: use the 7-angle legal relative set.
    // Without: fall back to the 4 cardinals so the user still sees
    // the compass.
    const relativeDeg = prev
      ? LEGAL_RELATIVE_ANGLES_DEG
      : [0, 90, 180, -90];
    return relativeDeg.map((d) => {
      const abs = anchorAngle + (d * Math.PI) / 180;
      return { deg: d, absRad: abs };
    });
  }, [prev?.[0], prev?.[1], prev?.[2], last[0], last[1], last[2]]);

  // Per-frame: dim every ray, brighten the one closest to the cursor's
  // angle. This is the "hey, your next snap will go there" cue.
  useFrame(() => {
    const cursor = cursorRef.current;
    const ring = groupRef.current;
    if (!cursor || !ring) return;
    const dx = cursor.position.x - last[0];
    const dz = cursor.position.z - last[2];
    const cursorAng = Math.hypot(dx, dz) < 1e-3 ? null : Math.atan2(dz, dx);

    ring.children.forEach((child, i) => {
      const ray = child as THREE.Line;
      const mat = ray.material as THREE.LineBasicMaterial;
      const data = rayData[i];
      if (!data || !mat) return;
      const base = 0.2;
      if (cursorAng === null) {
        mat.opacity = base;
        return;
      }
      // Angular distance wrapped into [0, π]
      let diff = Math.abs(cursorAng - data.absRad);
      diff = Math.min(diff, Math.PI * 2 - diff);
      // Brighten when cursor is within ±15° of this detent
      const bright = diff < 0.26 ? 0.85 : base;
      mat.opacity = bright;
    });
  });

  // Don't bother rendering when the constraint doesn't apply.
  if (!materialRequiresLegalAngles(material)) return null;

  // Ray geometry: simple two-vertex line, 3 ft long, at Y = last[1].
  const RAY_LEN = 3;

  return (
    <group ref={groupRef} position={[last[0], last[1] + 0.02, last[2]]}>
      {rayData.map((d, i) => {
        const x = Math.cos(d.absRad) * RAY_LEN;
        const z = Math.sin(d.absRad) * RAY_LEN;
        return (
          <Line
            key={i}
            points={[[0, 0, 0], [x, 0, z]]}
            color={d.deg === 0 ? '#00e5ff' : '#7fb8d0'}
            lineWidth={d.deg === 0 ? 2 : 1}
            transparent
            opacity={0.25}
          />
        );
      })}
    </group>
  );
}

// Snap indicator — reads drawFeedbackStore and renders at the target.
function SnapIndicator() {
  const target = useDrawFeedbackStore((s) => s.snapTarget);
  if (!target) return null;
  const color = target.kind === 'endpoint' ? '#00ffa6' : '#ffc107';
  const radius = target.kind === 'endpoint' ? 0.25 : 0.18;
  return (
    <group position={target.position}>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius * 0.9, radius * 1.15, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Small dot in the center */}
      <mesh>
        <sphereGeometry args={[radius * 0.35, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ── Phase 9 helpers ─────────────────────────────────────────────

/**
 * Human-readable label for a pipe snap — shown in the hint bar.
 *
 *   "Pipe endpoint · 2\" PVC (waste)"
 *   "Pipe body · 1.25\" PEX (cold) · 40% along"
 */
function formatSnapLabel(
  snap: ReturnType<typeof nearestPipeSnap> & object,
  pipes: readonly import('@store/pipeStore').CommittedPipe[],
): string {
  const pipe = pipes.find((p) => p.id === snap.pipeId);
  if (!pipe) return snap.kind === 'endpoint' ? 'Pipe endpoint' : 'Pipe body';
  const sizeStr = `${pipe.diameter}"`;
  const matStr = pipe.material.replace(/_/g, ' ');
  const sysStr = pipe.system.replace(/_/g, ' ');
  if (snap.kind === 'endpoint') {
    return `Pipe endpoint · ${sizeStr} ${matStr} (${sysStr})`;
  }
  const pct = snap.segmentT !== undefined ? `${Math.round(snap.segmentT * 100)}%` : '';
  return `Pipe body · ${sizeStr} ${matStr} (${sysStr})${pct ? ` · ${pct} along` : ''}`;
}

/**
 * What will the next primary click do? Drives the hint bar.
 */
function computeNextAction(args: {
  mode: 'draw' | 'select' | 'navigate';
  drawPointsLen: number;
  snapKind: string | null;
}): import('@store/drawFeedbackStore').NextAction {
  if (args.mode === 'navigate') return 'pan-only';
  if (args.mode === 'select') return 'select';
  // Draw mode.
  const drawing = args.drawPointsLen > 0;
  if (drawing) {
    if (args.snapKind === 'endpoint') return 'finish-at-endpoint';
    return 'place-next-point';
  }
  if (args.snapKind === 'endpoint') return 'start-from-endpoint';
  if (args.snapKind === 'body') return 'insert-tee';
  return 'place-first-point';
}

// ── Keyboard ────────────────────────────────────────────────────

// KeyboardHandler extracted to `src/ui/KeyboardHandler.tsx` in
// Phase 2a of the hybrid-architecture refactor. That file owns the
// single window-level `keydown` listener for the shared shell,
// plus the mode-guard that short-circuits plumbing-scoped keys in
// roofing mode (ARCHITECTURE.md §4.1). Imported at the top of
// this module and rendered below in <App />.

// currentGroundHit removed — Phase 7.C.ii replaced the M-key "drop at
// origin" flow with the ManifoldPlacement session (cursor ghost).

// ── Navigation freeze (Phase 6) ─────────────────────────────────
//
// Hold SPACE → nav is frozen; OrbitControlsGate disables orbit until
// release. This is the clean solution to the "I'm dragging a pipe
// endpoint but the camera is panning under me" problem: the user
// commits explicit intent to draw, the camera stays put.
//
// We ignore repeats (keydown fires continuously while a key is held);
// only the FIRST keydown flips the state on, and the keyup flips it off.
// Chord combinations (Ctrl+Space for the DRAWING wheel) take priority —
// we don't freeze when any modifier is held.

function NavigationFreezeHandler() {
  const setFrozen = usePlumbingDrawStore((s) => s.setNavFrozen);

  useEffect(() => {
    let held = false;
    const onKeyDown = (e: KeyboardEvent) => {
      // Only bare Space — modifier-combos are reserved for wheels/shortcuts.
      if (e.code !== 'Space' || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      // Don't freeze while a text input is focused.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (held) { e.preventDefault(); return; }
      held = true;
      setFrozen(true);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (!held) return;
      held = false;
      setFrozen(false);
    };
    // blur safety: if the window loses focus while held, release the lock
    const onBlur = () => {
      if (held) {
        held = false;
        setFrozen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [setFrozen]);

  return null;
}

// ── Cursor styling (mode-aware) ─────────────────────────────────
//
// Enterprise detail: the mouse cursor is the first thing a user reads
// to infer "what will happen if I click?". We drive it off the
// interaction mode so every click has a predictable preview:
//
//   Navigate   → grab       (you can drag the world)
//   Draw       → crosshair  (precision point placement)
//   Select     → pointer    (you'll select whatever you click)
//   Pending fx → copy       (click to drop the fixture)
//
// Uses !important so it beats OrbitControls' own cursor writes during
// drags — without this, OrbitControls would flip to 'grabbing' mid-draw.

function CursorStyler() {
  const mode = usePlumbingDrawStore((s) => s.mode);
  const pending = useCustomerStore((s) => s.pendingFixture);

  useEffect(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    let cursor: string = 'grab';
    if (pending) cursor = 'copy';
    else if (mode === 'draw') cursor = 'crosshair';
    else if (mode === 'select') cursor = 'pointer';
    canvas.style.setProperty('cursor', cursor, 'important');
    return () => {
      canvas.style.removeProperty('cursor');
    };
  }, [mode, pending]);

  return null;
}

// ── Select-mode background catcher ──────────────────────────────
//
// In Select mode, a click on empty space = "deselect". Implemented as
// an invisible ground-plane mesh so R3F's natural event bubbling does
// the work: if any pipe/fixture in front caught the click, its
// stopPropagation halts us; otherwise propagation reaches this plane
// and we clear the selection.
//
// Mounted ONLY in select mode so it doesn't intercept anything else.
//
// OrbitControls still pans/rotates freely — R3F's `onClick` fires on
// pointer-up without drag, which doesn't conflict with drag gestures.

function SelectBackgroundCatcher() {
  const mode = usePlumbingDrawStore((s) => s.mode);
  if (mode !== 'select') return null;
  return (
    <mesh
      position={[0, -0.001, 0]}
      rotation-x={-Math.PI / 2}
      onClick={(e) => {
        if (e.button !== 0) return;
        usePipeStore.getState().selectPipe(null);
        useFixtureStore.getState().selectFixture(null);
      }}
    >
      <planeGeometry args={[500, 500]} />
      <meshBasicMaterial
        visible={false}
        transparent
        opacity={0}
        depthWrite={false}
      />
    </mesh>
  );
}

// ── Scene ───────────────────────────────────────────────────────

function Scene() {
  const mode = usePlumbingDrawStore((s) => s.mode);
  const pivoting = usePipeStore((s) => s.pivotSession !== null);
  const orbitRef = useRef<any>(null);
  // Phase 14.R.4 — workspace mode gates the roofing-specific scene layers.
  // The plumbing Canvas stack is always mounted so the lighting + camera
  // infrastructure is shared; roofing only adds its own section meshes +
  // draw-interaction catcher on top.
  const appMode = useAppModeStore((s) => s.mode);
  // Orbit enable/disable is handled by <OrbitControlsGate/> below — no
  // imperative useEffect fighting the prop.

  return (
    <>
      {/* Studio 3-point lighting — makes pipes read clearly under any camera angle */}
      <ambientLight intensity={0.42} color="#eef4ff" />

      {/* KEY light (upper-right, warm) — primary shadow caster.
          Bug-fix pass: shadow frustum enlarged from ±30 → ±120 ft and
          far from 60 → 250 ft so fixtures in full-size houses (60–200 ft
          wide) remain lit correctly at zoom-out. Three.js renders
          out-of-shadow-frustum geometry as "in shadow" with default
          sampler setups — previously, the far fixtures in a big job
          went dark. Shadow map resolution dropped 4K → 2K to keep
          VRAM in check; 2K over 240 ft = 8.5 texels/ft, still sharp. */}
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.05}
        color="#fff4dc"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={250}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={6}
      />

      {/* FILL light (opposite side, cool) — softens the shadow side */}
      <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#b8d4ff" />

      {/* RIM light (behind, cool cyan) — halo edges for readability */}
      <directionalLight position={[0, 5, -10]} intensity={0.28} color="#76cfff" />

      {/* Overhead fill (straight down) — prevents fixtures from
          looking black in top-down view. Low intensity so it doesn't
          wash out the key light's shadows; just enough to give every
          upward-facing surface a baseline reading. */}
      <directionalLight position={[0, 20, 0]} intensity={0.35} color="#ffffff" />

      {/* Gentle ground bounce — simulates light reflecting off the floor */}
      <hemisphereLight args={['#3a4560', '#0a0a0f', 0.22]} />

      <Environment preset="warehouse" background={false} />

      {/* Shadow-receiving ground plane — lives well below the grid +
          floor outlines to avoid Z-fighting. Depth offset ensures it
          always writes deeper than coplanar-ish floor meshes even at
          grazing camera angles. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial
          opacity={0.22}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      {/* Refined grid — finer minor, brighter section lines, fade-out at distance.
          Bug-fix (shallow-angle flicker): raised the grid's render Y from 0 to
          0.001 so it sits cleanly above the shadow plane at Y=-0.02, and the
          fade distance pushed from 45 → 80 ft so big houses stay readable at
          full zoom-out. At grazing angles, drei's Grid shader samples along
          long rays; increasing `followCamera` keeps the tile center near
          the camera's ground projection, which dramatically reduces the
          moire/shimmer that appears at shallow-camera-angle views. */}
      <group position={[0, 0.001, 0]}>
        <Grid
          args={[40, 40]}
          cellSize={1 / 12}             /* 1" cells */
          cellThickness={0.45}
          /* Brighter cell + section colors than before — the old
             #131a26 / #2a3a54 were only a few shades off the #060710
             clear color, so at distance the grid effectively vanished
             (user bug report: "background isn't visible"). These still
             read as a technical-illustration grid, but actually
             contrast. */
          cellColor="#2a3648"
          sectionSize={1}               /* 1 ft major */
          sectionThickness={1.1}
          sectionColor="#4a6688"
          fadeDistance={80}
          fadeStrength={1.5}
          followCamera={true}
          infiniteGrid
        />
      </group>

      <FixtureLayerFromStore />

      <DrawInteraction />
      {/* Empty-space click in Select mode → deselect. Mounted here (behind
          visible geometry) so R3F propagation reaches it only when no
          pipe/fixture in front consumed the click. */}
      <SelectBackgroundCatcher />

      {/* Phase 14.M — camera-matrix snooper feeds the box-select overlay,
          group rotation gizmo renders at centroid when multi-select ≥ 2.
          Phase 14.O — group translate gizmo renders slightly above the
          rotation ring so both are visible + draggable in the same view. */}
      <CameraMatrixSnooper />
      <GroupRotationGizmo />
      <GroupTranslateGizmo />

      <PipeRenderer />
      <FittingRenderer />
      {/* Phase 14.AD.23 — CAD-style click-drag-on-pipe interaction
          for orthographic views (top / front / side). Only active
          when the camera is in one of those presets AND the
          plumbingDrawStore `orthoClickDragMode` flag is on (default).
          Click+drag from midpoint spawns a branch pipe; from an
          endpoint extends the existing pipe; plain click selects. */}
      <OrthoPipeInteraction />
      <DimensionHelpers />
      {/* Always-on pitch indicators — slope labels on every visible
          waste/storm pipe segment, color-coded to IPC 704.1 minimums.
          Toggles with the same Dimensions layer flag. */}
      <PitchIndicators />
      <FloorPlaneOutlines />

      {/* Phase 14.Q — in-progress draw preview. Segment-based tube +
          per-segment pitch labels + ghost fittings at each junction,
          so the user can see the real slope + the real fitting snap
          BEFORE committing. Unmounts itself when no draw session
          is active (internal `active` flag drives return null). */}
      <LiveRoutePreview />
      <LiveFittings />

      {/* Phase 14.X — pipe-pipe collision markers. Red pulsing
          spheres where two committed pipes physically clip each
          other; amber where they're within half the required
          clearance. Self-unmounts when there are no collisions. */}
      <PipeCollisionMarkers />

      {/* Visual effects disabled pending perf rework. */}

      {/* Phase 2.B: ghost fixture preview while pendingFixture is set */}
      <FixturePlacementPreview />

      {/* Phase 2.G: Walls + Ruler + Backdrop */}
      <BackdropLayer />
      <WallRenderer />
      <RulerCatcher />
      <MeasurementLines />

      {/* Phase 2.A: dual-zone pipe hitboxes + pivot preview */}
      <PipeHitboxes />
      <PivotPreview />

      {/* Phase 6: QuickPlumb-style drag-from-endpoint extension.
          Renders a glowing + glyph at each pipe endpoint when in
          Select mode with the pipeExtendDrag flag on. Click-drag
          commits a new pipe in the selected diameter + material. */}
      <EndpointExtender />

      {/* Phase 7.C: PEX manifolds — drag to merge into 2/3/4/5-port bodies.
          Press `M` to drop a 2-port manifold at the cursor; drag one onto
          another along its length axis to auto-merge. */}
      <ManifoldRenderer />

      {/* Phase 7.C.ii: placement ghost (M-session) + drag snap hints. */}
      <ManifoldPlacement />

      {/* Phase 7.D: plugs on orphaned endpoints. Automatically populated
          by ConnectivityManager when a pipe is removed and leaves a
          neighbor's endpoint dangling. Self-healing — re-adding a pipe
          at the capped position removes the cap. */}
      <CappedEndpoints />
      <CollisionFlash />
      <SnapBurst />
      <CompletePulse />

      {/* Phase 2: compliance violations as 3D beacons on violating pipes */}
      <ComplianceOverlay3D />

      {/* Phase 2: auto-route trigger on fixture drop */}
      <AutoRouteTrigger />

      {/* Phase 2: neuro → scene rendering bridge */}
      <AdaptiveRenderBridge />

      {/* Fixed-angle camera controller. Drives the camera when a view
          preset is active (Top / Front / Side / Iso). In Perspective
          mode it stays inert so OrbitControls retains control. */}
      <IsoCameraController target={[0, 0, 0]} distance={20} />

      {/* Adaptive quality: monitors FPS and drops DPR/shadow if slow */}
      <AdaptiveQuality />

      {/* Phase 10.D — renderer.info sampler for PerfHUD. Self-gates on
          the `perfHud` flag so it incurs zero cost when the HUD is off. */}
      <PerfSampler />

      {/* Phase 12.E — spring-arm camera (multi-raycast collision clamp).
          Self-gates on `springArmCamera`. Runs at useFrame priority 1
          so it post-processes after OrbitControls. See ADR 029. */}
      <SpringArmController />

      <OrbitControlsGate orbitRef={orbitRef} mode={mode} pivoting={pivoting} />

      {/* Phase 14.R.4 — roofing workspace 3D layers. Committed sections
          render their faces + classified edges (eave / ridge / rake /
          hip / slope). The draw interaction catcher listens for
          click-click on the ground plane to commit new sections; the
          draft preview floats a translucent rectangle between the two
          points while the user is mid-draw. All three are no-ops when
          the store is idle, so their cost is zero outside roofing mode. */}
      {appMode === 'roofing' && (
        <>
          {/* Phase 14.R.5 — PDF plane renders FIRST so sections + the
              draft preview stack correctly above it. Calibration
              catcher is a separate mesh that only mounts during the
              calibrate-1/2 states. */}
          <RoofingPDFPlane />
          <PDFCalibrationInteraction />
          <RoofSectionsLayer />
          <RoofingDrawInteraction />
          <DraftRectanglePreview />
          {/* Phase 14.R.9 — polygon draft preview. Unmounts itself
              when draw-polygon mode is inactive OR no vertices +
              no cursor — so rect-draw sessions never pay its cost. */}
          <DraftPolygonPreview />
          {/* Phase 14.R.8 — section drag catcher. Self-unmounts when
              the drag store is idle (99.9% of frames), so it has zero
              cost when the user isn't actively moving a section. */}
          <SectionDragInteraction />
          {/* Phase 14.R.18 — polygon vertex edit handles + drag
              catcher. Handles render only when a polygon section is
              selected + unlocked + no competing mode; catcher only
              mounts mid-drag. Handles' stopPropagation on pointer-
              down keeps the R.8 section-drag inert when vertex-edit
              is the intended interaction. */}
          <PolygonVertexHandles />
          <VertexDragInteraction />
          {/* Phase 14.R.19 — magenta rotation ring. Self-gates on the
              same "no competing mode" rules as R.18's vertex handles. */}
          <RotationGizmo />
          {/* Phase 14.R.23 — cyan axis-rotation arrow for polygon
              gable/shed. Self-gates on polygon + convex + gable/shed,
              and stays hidden whenever another interaction owns the
              pointer. */}
          <AxisRotationGizmo />
          {/* Phase 14.R.27 — placed penetration markers. Rendered
              after sections so they composite on top; the layer
              itself is a `<group>` of primitives, so it adds no
              cost when the user has no penetrations placed. */}
          <RoofPenetrations3D />
        </>
      )}

      <KeyboardHandler />
    </>
  );
}

// ── App ─────────────────────────────────────────────────────────

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 14.R.3 — top-level workspace mode. When `roofing` is active
  // the plumbing-specific HUDs (Toolbar, PipeInspector, LayerPanel,
  // ExportPanel, phase panels) step aside so the RoofingInspector
  // can own the right side of the screen uncontested.
  const appMode = useAppModeStore((s) => s.mode);

  // Phase 11.A — Ctrl+S save, Ctrl+O open. Mounted at App level so
  // the listener lives as long as the app window.
  useBundleHotkeys();

  useEffect(() => {
    try {
      bootFeedbackLoop();
      // Phase 10.A — logger boots FIRST so every subsequent boot's
      // logs land in the structured pipeline, not a silent void.
      bootLogger();
      // CommandBus boots next so it can observe every subsequent
      // subsystem's initial events. (Phase 1 — see docs/adr/002-command-bus.md)
      bootCommandBus();
      // Phase 2 — see docs/adr/003-compliance-trace.md.
      // Must boot AFTER the bus so any trace-populate dispatches flow
      // through the command log.
      bootPlumbingComplianceStore();
      // Phase 7.D — connectivity tracker (ADR 011). Must boot AFTER the
      // CommandBus so the pipe.add/remove subscriptions receive every event.
      bootConnectivityManager();
      // Consolidation pass — 3D positional audio, flag-gated.
      if (useFeatureFlagStore.getState().spatialAudio) {
        try { bootSpatialAudio(); } catch (err) {
          appLog.warn('spatialAudio boot failed', err);
        }
      }
      bootPipeStore();
      // Phase 14.Y.4 — subscribe pipe + fixture stores to re-run
      // hot-supply classification whenever either changes. A pipe
      // that ends up reachable from any water heater's hot outlet
      // flips to `hot_supply` (red); if disconnected, it reverts
      // to `cold_supply` (blue). Idempotent + debounced.
      bootHotSupplyPropagation();
      loadCustomersFromStorage();

      // Phase 11.A — recover from autosave BEFORE booting telemetry so
      // the commands we replay on restore don't count as live activity.
      // No-op if there's no autosave or it's stale. Recovery is always
      // attempted — even with autosave disabled — so toggling the flag
      // off doesn't orphan the prior session's recovery data.
      try { recoverFromAutosave(); } catch (err) {
        appLog.warn('autosave recovery failed', err);
      }
      // The interval-based autosave is flag-gated — users who find the
      // localStorage churn annoying can disable via God Mode.
      if (useFeatureFlagStore.getState().projectBundle) {
        bootAutosave();
      }

      // Phase 10.E — telemetry boot LAST among the core subsystems so
      // every other boot's logs + commands are eligible to be counted
      // if the user has the flag on. No-op unless enabled.
      bootSessionTelemetry();

      // Force-clear any state that would block orbit on fresh launch:
      // pendingFixture persists to localStorage and can make clicks
      // place fixtures instead of rotating the camera.
      useCustomerStore.getState().setPendingFixture(null);
      useCustomerStore.getState().endEditFixture();
      usePlumbingDrawStore.getState().setMode('navigate');

      // Phase 2.B: seed demo fixtures into fixtureStore (only on first boot)
      if (Object.keys(useFixtureStore.getState().fixtures).length === 0) {
        useFixtureStore.getState().seedFromList(DEMO_FIXTURES);
      }

      // ── Boot Phase 2 engine subsystems ─────────────────────
      // Web Worker bridge (simulation pipeline)
      getSimulationBridge();

      // Neuro trackers tick periodically (engagement + cognitive + fatigue)
      const neuroTicker = setInterval(() => {
        engagementTracker.tick();
        cognitiveMonitor.tick();
        fatigueGuard.tick();
      }, 1000);

      // ── Register Phase 1 radial menu chords ────────────────
      const { openWheel, closeWheel } = useRadialMenuStore.getState();

      // CTRL+SPACE → DRAWING wheel (hold)
      chordDetector.registerHold({
        id: 'wheel-drawing',
        keys: ['control', ' '],
        description: 'Open DRAWING wheel',
        onStart: () => openWheel('drawing'),
        onEnd: () => closeWheel(),
      });

      // CTRL+F → FIXTURE wheel (hold)
      chordDetector.registerHold({
        id: 'wheel-fixture',
        keys: ['control', 'f'],
        description: 'Open FIXTURE wheel',
        onStart: () => openWheel('fixture'),
        onEnd: () => closeWheel(),
      });

      // CTRL+E, F → CUSTOMER EDIT wheel (sequence)
      chordDetector.registerSequence({
        id: 'wheel-customer-edit',
        steps: [['control', 'e'], ['f']],
        description: 'Open CUSTOMER EDIT wheel',
        action: () => openWheel('customer_edit'),
      });

      // SVG Export shortcut: Ctrl+Shift+E
      // Phase 10.B — loads SVGExporter dynamically. First press pays
      // the chunk fetch (small, ~11KB gzipped); subsequent presses
      // hit the module cache instantly.
      chordDetector.registerTap({
        id: 'export-svg',
        keys: ['control', 'shift', 'e'],
        description: 'Export SVG / Print PDF',
        requireShift: true,
        preventDefault: true,
        action: async () => {
          try {
            const mod = await loadSvgExporter.get();
            const pipes = Object.values(usePipeStore.getState().pipes);
            const svg = (mod.exportToSVG as typeof ExportToSVGFn)(pipes, { projection: 'iso_true' });
            (mod.openPrintableSVG as typeof OpenPrintableSVGFn)(svg, 'ELBOW GREASE - Isometric Plan');
          } catch (err) {
            appLog.error('SVG export failed', err);
          }
        },
      });

      // Emergency recovery: Ctrl+Alt+R → wipe autosave + reset stores
      // to a known-good blank demo state. For when localStorage has
      // accumulated bad data from a prior crash and the scene looks
      // empty / broken. Much faster than explaining to users how to
      // manually clear application storage.
      //
      // Uses Alt instead of Shift to sidestep Ctrl+Shift+R, which is
      // the webview's hard-reload shortcut and can't reliably be
      // preventDefault'd across every Tauri/Chromium build.
      chordDetector.registerTap({
        id: 'emergency-reset',
        keys: ['control', 'alt', 'r'],
        description: 'Emergency reset — reseed demo + clear autosave',
        preventDefault: true,
        action: () => {
          try {
            clearAutosave();
            // Reset floor visibility to full so nothing is ghosted out.
            useFloorStore.setState({
              visibilityMode: 'all',
              ghostOpacity: 0.35,
              activeFloorId: 'floor_1',
              hiddenFloorIds: new Set<string>(),
            });
            // Wipe pipes and reseed demo fixtures.
            usePipeStore.setState({
              pipes: {},
              pipeOrder: [],
              selectedId: null,
              undoStack: [],
              redoStack: [],
              pivotSession: null,
            });
            useFixtureStore.getState().seedFromList(DEMO_FIXTURES);
            usePlumbingDrawStore.getState().setMode('navigate');
            appLog.info('emergency reset complete — demo fixtures reseeded');
          } catch (err) {
            appLog.error('emergency reset failed', err);
          }
        },
      });

      // Camera view shortcuts 0/6/7/8/9 already handled globally below

      const detach = chordDetector.attach();
      setReady(true);
      return () => {
        detach();
        clearInterval(neuroTicker);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  if (error) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#0a0a0f', fontFamily: 'system-ui', gap: 12 }}>
      <div style={{ color: '#ff1744', fontSize: 18 }}>Error: {error}</div>
      <button onClick={() => location.reload()}
        style={{ padding: '8px 20px', background: '#00e5ff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
        Reload</button>
    </div>
  );

  if (!ready) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0f', color: '#00e5ff', fontFamily: 'system-ui', fontSize: 18 }}>
      Loading ELBOW GREASE...
    </div>
  );

  // Phase 12.D — probe GPU ONCE before the Canvas mounts. The result
  // is cached at module scope (see bootGpuProbe) so this call in the
  // render path is effectively free. Drives two context-creation
  // parameters that cannot be toggled after mount: `gl.antialias` and
  // the DPR cap.
  const gpuProbe = probeGpuAtBoot();
  const lowSpec = isLowSpecGpu();

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Phase 8.A — crash boundary around the 3D scene. Any throwing
          component inside <Scene /> (a bad pipe polyline, a fitting
          generator assertion, etc.) lands in the fallback UI instead
          of white-screening the whole app. HUD panels below keep working. */}
      <ErrorBoundary label="3D Scene">
        <Canvas
          camera={{
            position: [8, 10, 8],
            fov: 45,
            // Phase 12.A — depth-buffer correctness (ADR 024).
            // near=0.01 exhausts 1/z precision right in front of the lens;
            // pushing it to 0.1 reallocates precision across the scene and
            // quashes the bulk of distant-geometry Z-fighting. Far stays
            // at 1000 which is well beyond the largest plausible plumbing
            // site bounding box.
            near: 0.1,
            far: 1000,
          }}
          shadows={{ type: THREE.PCFSoftShadowMap }}
          // Phase 12.D — integrated GPUs get DPR 1 always; retina MSAA at
          // DPR 2 is the single biggest fragment-shader cost on iGPUs.
          dpr={lowSpec ? 1 : [1, 2]}
          gl={{
            // Phase 12.D — disable MSAA on integrated / software
            // renderers. MSAA is a Canvas context-creation flag that
            // cannot be toggled later, so this decision is locked in
            // by the pre-Canvas probe. Aliasing is slightly visible on
            // orthographic pipe edges at tier 2, but 60fps on iGPU beats
            // smooth edges at 30fps.
            antialias: !lowSpec,
            alpha: false,
            // Higher precision across the shader pipeline
            powerPreference: 'high-performance',
            stencil: false,
            // Phase 12.A — logarithmic depth buffer distributes depth
            // precision non-linearly so distant walls + floor planes stop
            // fighting. Slight fragment-shader cost, worth it for the
            // visual stability in interior-architecture views.
            logarithmicDepthBuffer: true,
          }}
          onCreated={({ gl, scene }) => {
            gl.setClearColor('#060710');
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.35;
            gl.outputColorSpace = THREE.SRGBColorSpace;
            // Bug-fix pass: previously set `scene.fog = Fog('#060710', 35, 80)`
            // which darkened everything beyond 35 ft to near-black — making
            // top-down views of real-sized houses (60–150 ft) unusable. The
            // fog's "depth cue" value doesn't outweigh hiding the fixtures
            // the contractor is trying to verify. Explicit null in case a
            // future code path re-enables it by default.
            scene.fog = null;
            // Log the probe result for bug reports. Telemetry already
            // captures this separately when enabled (Phase 10.E).
            appLog.info('GPU classified at boot', {
              tier: gpuProbe.tier,
              renderer: gpuProbe.renderer || '(unavailable)',
              antialias: !lowSpec,
              dpr: lowSpec ? 1 : 'auto',
            });
          }}
        >
          <Scene />
        </Canvas>
      </ErrorBoundary>

      {/* Always-visible 3px accent stripe at the very top of the
          viewport. Persistent peripheral-vision cue of which
          workspace is active, so users running mixed plumbing +
          roofing jobs never mistake which tool set is armed. */}
      <ModeAccentStripe />

      {/* Phase 14.R.3 — top-center workspace tab bar. Always visible
          so the user can switch between Plumbing and Roofing at any
          time. Shift+M is the keyboard equivalent. */}
      <ModeTabs />

      {/* Phase 14.R.3 — Roofing Inspector. Mounted only in roofing
          mode; form + live wind/zones/sheathing/BOM readouts driven
          by `roofingProjectStore` + `fl_roofing.estimate()`. */}
      {appMode === 'roofing' && <RoofingInspector />}

      {/* Phase 14.R.4 — left-side drawing toolbar for roofing mode.
          Pairs with the Scene-level <RoofingDrawInteraction /> — this
          owns the tool selection + per-section defaults, that owns
          the ground-plane clicks. */}
      {appMode === 'roofing' && <RoofingToolbar />}

      {/* Phase 14.R.5 — PDF blueprint panel. Sits under the drawing
          toolbar (same left rail). Always visible in roofing mode
          so "Load PDF" is one click away even on an empty scene. */}
      {appMode === 'roofing' && <RoofingPDFPanel />}

      {/* Phase 14.R.19 — roofing rotation keyboard shortcuts.
          [ / ] ± 15°, Shift ± 5°, Ctrl ± 90°. Null component. */}
      {appMode === 'roofing' && <RoofingRotationKeyHandler />}

      {/* Plumbing-specific HUDs — suppressed in roofing mode so the
          RoofingInspector can own the right side of the screen. The
          canvas + camera + keyboard-shortcuts stay live either way. */}
      {appMode === 'plumbing' && <Toolbar />}
      {/* Phase 9.1 mode-gated the plumbing StatusBar; its roofing
          peer lands below. The two carry different accent colors
          on the top border, giving a persistent "which workspace
          am I in" cue even for users who never touch the toolbar. */}
      {appMode === 'plumbing' && <StatusBar />}
      {appMode === 'roofing' && <RoofingStatusBar />}
      <FeedbackOverlay />
      <PerformanceMonitor />
      {appMode === 'plumbing' && <LayerPanel />}
      {appMode === 'plumbing' && <PipeInspector />}
      {appMode === 'plumbing' && <ExportPanel />}

      {/* Phase 2.F: Multi-floor ghosting + floor selector */}
      <FloorVisibilityControls />
      <FloorSelectorRail />
      <ActiveFloorAutoInfer />
      <FloorShortcutsBinder />

      {/* Phase 2.B: Fixture parameter window (detail mode only). */}
      <FixtureParamWindow />

      {/* Phase 14.F: compact fixture inspector (mini mode — default).
          Renders only when a fixture is selected AND inspector mode is
          'mini'. Expand button switches to the detail window above. */}
      <FixtureMiniCard />

      {/* Phase 2.C: Fixture visual editor (split top + 3D) */}
      <FixtureVisualEditor />

      {/* Navigation status — shows why orbit is on/off */}
      <NavStatusChip />

      {/* Mode-aware cursor — the FIRST thing the user reads before clicking */}
      <CursorStyler />

      {/* Phase 6: hold SPACE → orbit freezes until release. Prevents
          the pan/rotate listener from fighting drag-to-extend gestures. */}
      <NavigationFreezeHandler />

      {/* Silent self-updater. Checks GitHub Releases on boot + every 6h,
          shows a bottom-right toast when a new signed release exists,
          downloads + verifies + relaunches on confirm. No-op in dev. */}
      <UpdateManager />

      {/* Phase 1 — God Mode developer console (Ctrl+Shift+G to toggle).
          Slide-up bottom panel showing the command stream, detail,
          and feature flags. Returns null when the godMode flag is off.
          Wrapped in ErrorBoundary (Phase 8.A) so a bad command entry
          doesn't hide the console permanently. */}
      <ErrorBoundary label="God Mode console">
        <GodModeConsole />
      </ErrorBoundary>

      {/* Phase 2 — Compliance trace debugger (Ctrl+Shift+D to toggle).
          Floating right-side panel showing inference chain behind each
          ComplianceViolation. Trace construction is flag-gated in the
          solver, so panel-closed = zero overhead. */}
      <ErrorBoundary label="Compliance debugger">
        <ComplianceDebugger />
      </ErrorBoundary>

      {/* Phase 10.D — live performance HUD (Ctrl+Shift+P to toggle).
          FPS, frame-time sparkline, worker round-trip, draw calls,
          heap. Polls PerfStats at 10 Hz, returns null when closed. */}
      <ErrorBoundary label="Perf HUD">
        <PerfHUD />
      </ErrorBoundary>

      {/* Phase 8.C — keyboard shortcut help overlay. Press `?` to open;
          reads from the central `ShortcutRegistry` so adding a shortcut
          in one place auto-documents it. */}
      <HelpOverlay />

      {/* Phase 10.F — first-run coach-mark walkthrough. Auto-starts on
          first launch (~800ms delay so the app paints first); subsequent
          launches stay inactive until the user replays via HelpOverlay. */}
      <ErrorBoundary label="Onboarding">
        <OnboardingOverlay />
      </ErrorBoundary>

      {/* Phase 11.E — recent projects (Ctrl+Shift+R). Lists paths
          captured by the bundle save/open flows, grouped by customer. */}
      <ErrorBoundary label="Recent files">
        <RecentFilesPanel />
      </ErrorBoundary>

      {/* Phase 14.A — pricing profile editor (Ctrl+Shift+B). Sets the
          contractor's labor rate / overhead / margin / tax. Consumed by
          generateBOM when exporting bid-ready quotes. */}
      <ErrorBoundary label="Pricing profile">
        <PricingProfilePanel />
      </ErrorBoundary>

      {/* Phase 14.B — contractor identity editor (Ctrl+Shift+I). */}
      <ErrorBoundary label="Contractor profile">
        <ContractorProfilePanel />
      </ErrorBoundary>

      {/* Phase 14.B — hidden printable proposal layout. Always mounted;
          normally display:none. Shown when printProposal() flips the
          body class; the browser's print dialog then captures it. */}
      <ErrorBoundary label="Printable proposal">
        <PrintableProposal />
      </ErrorBoundary>

      {/* Phase 14.G — hidden printable change-order layout (same body-class
          trick; subscribes to usePrintStore.changeOrder). */}
      <ErrorBoundary label="Printable change order">
        <PrintableChangeOrder />
      </ErrorBoundary>

      {/* Phase 14.AA.2 — hidden printable bid package (multi-page:
          cover + scope + BOM + compliance + terms). Subscribes to
          usePrintBidPackageStore; revealed when the body has
          class="printing-bid". */}
      <ErrorBoundary label="Printable bid package">
        <PrintableBidPackage />
      </ErrorBoundary>

      {/* Phase 14.G — proposal revision browser (Ctrl+Shift+V). Pick two
          revisions of the same proposal → see the diff → print a signable
          change order. Revisions are auto-saved on every proposal print. */}
      <ErrorBoundary label="Revision compare">
        <RevisionComparePanel />
      </ErrorBoundary>

      {/* Phase 14.J — contractor library export/import (Ctrl+Shift+Y).
          Move settings, templates, and revision history between machines
          or share templates with colleagues without exposing pricing. */}
      <ErrorBoundary label="Library export/import">
        <LibraryExportImportPanel />
      </ErrorBoundary>

      {/* Phase 14.C — Assembly Templates library (Ctrl+Shift+T).
          Save the current scene as a reusable template, drop saved
          templates back into new jobs. Positions are normalized around
          the centroid so a template can be placed at any origin. */}
      <ErrorBoundary label="Assembly templates">
        <AssemblyTemplatesPanel />
      </ErrorBoundary>

      {/* Phase 14.D — P-trap + cleanout compliance preview (Ctrl+Shift+L).
          Read-only review of auto-planned p-traps + cleanouts. These
          items are already folded into the BOM at export time; the
          panel surfaces the plan with IPC code references so the
          contractor can verify the auto-detection before submitting. */}
      <ErrorBoundary label="Trap + cleanout compliance">
        <TrapCleanoutPanel />
      </ErrorBoundary>

      {/* Phase 14.E — Fixture rotation keyboard shortcuts.
          [ / ] = ±15°, Shift = ±5°, Ctrl = ±90°. Binder is a null
          component that installs a window-level keydown handler;
          activates only when a fixture is selected. */}
      <FixtureRotationShortcutsBinder />

      {/* Phase 14.M — lasso overlay (pointer-events gated on Select mode)
          + selection count HUD in top-right. */}
      <BoxSelectOverlay />
      <SelectionCountBadge />

      {/* Phase 14.O — arrow-key translation. Null component that installs
          a window keydown handler; works on group (multi ≥ 2) or single
          selected pipe/fixture; Shift = 0.1 ft, Ctrl = 5 ft. */}
      <GroupTranslateShortcutsBinder />

      {/* Phase 14.P — Ctrl+C / Ctrl+V / Ctrl+D for multi-select.
          Falls through to single-select when multi is empty, so the
          shortcuts work even for users who haven't built a multi-
          select yet. After paste, the pasted items become the new
          multi-select for immediate follow-up edits. */}
      <SelectionClipboardShortcutsBinder />

      {/* Phase 14.Y.3 — Ctrl+R on selected fixture auto-routes all
          its connection points (cold / hot / drain / vent / overflow)
          to the nearest existing main or default stub. Water heater
          hot outlet is the preferred hot source. */}
      <AutoRouteShortcutBinder />

      {/* Phase 14.Z — Alt+Shift+R opens the riser-template picker.
          Ports the pre-built multi-floor stacks from the original
          Python Elbow Grease. Closes on Esc. */}
      <RiserPlacementPanel />

      {/* Phase 14.N — Mass-edit modal (Ctrl+Shift+M). Applies material /
          diameter / system / visibility changes to every selected pipe
          in one commit. Sparse change-set: blank fields leave the
          property untouched; only pipes whose current value differs
          get written. */}
      {appMode === 'plumbing' && (
        <ErrorBoundary label="Mass edit">
          <MassEditPanel />
        </ErrorBoundary>
      )}

      {/* Phase 9 — unified pipe drawing feedback layer.
          • CursorTracker follows client-space pointer for DOM overlays.
          • DrawingHintBar shows contextual "what happens on click" text.
          • CursorBadge shows current diameter/material/plane near the
            cursor so the user always sees what they're about to draw. */}
      <CursorTracker />
      {appMode === 'plumbing' && <DrawingHintBar />}
      {appMode === 'plumbing' && <CursorBadge />}

      {/* Phase 2.E: Construction phase selector + BOM (plumbing-only) */}
      {appMode === 'plumbing' && <PhaseSelectorBar />}
      {appMode === 'plumbing' && <PhaseBOMPanel />}
      {appMode === 'plumbing' && <PhaseShortcutsBinder />}

      {/* Phase 2.D: Customer management */}
      <CustomerBadge />
      <CustomerShortcutsBinder />
      <FixtureTemplateEditor />

      {/* Phase 2.G: Walls / Ruler / Scale / Backdrop */}
      <MeasureToolbar />
      <ScaleCalibratorDialog />
      <MeasureShortcutsBinder />

      {/* Phase 1: Camera view HUD */}
      <IsoCameraHUD />

      {/* Phase 14.AD.27 — ortho-drag mode badge (bottom-right).
          Visible only when camera is in an orthographic view. Click
          toggles the mode, same as Shift+O. */}
      <OrthoDragModeBadge />

      {/* Phase 1: Radial menus — plumbing-only (drawing / fixture / customer-edit wheels) */}
      {appMode === 'plumbing' && (
        <>
          <DrawingWheel />
          <FixtureWheel />
          <CustomerEditWheel />
          <WheelCornerIcons />
        </>
      )}

      {/* Phase 1: Chord hint overlay */}
      <ChordHint />

      {/* Phase 2: live simulation + neuro HUD (plumbing-only) */}
      {appMode === 'plumbing' && (
        <>
          <SolvePipelineHUD />
          <HydraulicInspector />
          <NeuroStatusOrb />
        </>
      )}
    </div>
  );
}

// ── Chord hint display (shows partial chord progress) ───────────

function ChordHint() {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const offPartial = eventBus.on('chord:partial', (payload: any) => {
      if (!payload?.candidates || payload.candidates.length === 0) return;
      const first = payload.candidates[0];
      setHint(`${first.description}... (press ${first.remaining?.[0]?.join('+') ?? '?'})`);
      setTimeout(() => setHint(null), 800);
    });
    const offClear = eventBus.on('chord:clear', () => setHint(null));
    return () => { offPartial(); offClear(); };
  }, []);

  if (!hint) return null;
  return (
    <div style={{
      position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)',
      padding: '6px 14px', borderRadius: 6, border: '1px solid #ffc107',
      background: 'rgba(10,10,15,0.92)', color: '#ffc107',
      fontSize: 12, fontFamily: 'monospace', zIndex: 500, pointerEvents: 'none',
    }}>
      ⌨ {hint}
    </div>
  );
}
