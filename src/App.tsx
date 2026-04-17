/**
 * ELBOW GREASE — Plumbing CAD
 *
 * Game-loop architecture:
 *   useFrame runs at 60fps for cursor tracking + visual updates
 *   React re-renders ONLY on point add/remove/mode change
 *   All transient visuals (cursor ring, ghost line) update via refs
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, Line } from '@react-three/drei';
import * as THREE from 'three';

import { bootFeedbackLoop } from '@core/CueRoutineReward';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3 } from '@core/events';
import { bootPipeStore, usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { FixtureLayerFromStore } from '@ui/fixtures/FixtureModels';
import { FixtureParamWindow } from '@ui/fixtures/FixtureParamWindow';
import { FixtureVisualEditor } from '@ui/fixtures/FixtureVisualEditor';
import { FixturePlacementPreview } from '@ui/fixtures/FixturePlacementPreview';
import { AdaptiveQuality } from '@ui/perf/AdaptiveQuality';
import { NavStatusChip } from '@ui/NavStatusChip';
import { UpdateManager } from '@ui/UpdateManager';
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
import { useLayerStore } from '@store/layerStore';
import { useInteractionStore } from '@store/interactionStore';

import { GlowRing, CollisionFlash, SnapBurst, CompletePulse } from '@ui/SensoryFeedback';
import { PipeRenderer } from '@ui/PipeRenderer';
import { PipeHitboxes } from '@ui/pipe/PipeHitboxes';
import { PivotPreview } from '@ui/pipe/PivotPreview';
import { FittingRenderer } from '@ui/pipe/FittingMeshes';
import { DimensionHelpers } from '@ui/pipe/DimensionHelpers';
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
import { exportToSVG, openPrintableSVG } from './engine/export/SVGExporter';

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
  // Controls are always enabled (unless pivoting) — what changes is
  // WHICH interactions are allowed:
  //   Perspective view   → rotate + pan + zoom (full orbit)
  //   Top/Front/Side/Iso → pan + zoom only (rotate locked so the
  //                        plan/elevation view stays aligned)
  const enabled = !pivoting;
  const allowRotate = perspective;
  const allowPan = true;
  const allowZoom = true;
  void mode;
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
      dampingFactor={0.07}
      rotateSpeed={0.9}
      panSpeed={0.95}
      zoomSpeed={1.0}
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

  // React state (only changes on point add/remove/mode)
  const mode = useInteractionStore((s) => s.mode);
  const drawPlane = useInteractionStore((s) => s.drawPlane);
  const drawPoints = useInteractionStore((s) => s.drawPoints);
  const gridSnap = useInteractionStore((s) => s.gridSnap);
  const diameter = useInteractionStore((s) => s.drawDiameter);

  // Raycast hit
  const getHit = useCallback((): Vec3 => {
    raycaster.setFromCamera(pointer, camera);
    const gs = gridSnap;

    if (drawPlane === 'vertical') {
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const n = new THREE.Vector3(camDir.x, 0, camDir.z);
      if (n.lengthSq() < 0.001) n.set(0, 0, 1);
      n.normalize();
      const vp = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3());
      const h = raycaster.ray.intersectPlane(vp, hitV.current);
      if (!h) return cursorPos.current;
      return [snapVal(h.x, gs), Math.max(0, snapVal(h.y, gs)), snapVal(h.z, gs)];
    }

    const h = raycaster.ray.intersectPlane(groundPlane.current, hitV.current);
    if (!h) return cursorPos.current;
    return [snapVal(h.x, gs), 0, snapVal(h.z, gs)];
  }, [raycaster, camera, pointer, drawPlane, gridSnap]);

  // Game loop: update cursor mesh position every frame via ref (no re-render)
  useFrame(({ clock }) => {
    if (mode !== 'draw') return;
    const pos = getHit();
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
      const pos = getHit();
      useInteractionStore.getState().addDrawPoint(pos);
      lastSnapTime.current = performance.now() / 1000; // for snap flash

      // Emit snap event for sensory feedback (sound + visual)
      eventBus.emit(EV.PIPE_SNAP, { position: pos, snapType: 'grid' as const });
    };

    const onDblClick = () => {
      const pts = useInteractionStore.getState().finishDraw();
      if (pts && pts.length >= 2) {
        const s = useInteractionStore.getState();
        eventBus.emit(EV.PIPE_COMPLETE, {
          id: `pipe-${Date.now()}`, points: pts,
          diameter: s.drawDiameter, material: s.drawMaterial,
        });
      }
      // Auto-return to Navigate after finishing a pipe. Feels natural
      // — you're done drawing, you want to orbit to review. Ctrl+Space
      // re-enters draw mode in one shortcut when you want to draw again.
      useInteractionStore.getState().setMode('navigate');
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
    return () => {
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('contextmenu', onCtx);
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

      {/* Snap flash ring (animated via useFrame) */}
      <mesh ref={snapFlashRef} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[r * 2, r * 3, 24]} />
        <meshBasicMaterial color="#00e676" transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Grid cell highlight under cursor */}
      {!isVert && (
        <mesh position={[0, 0.002, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[gridSnap, gridSnap]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.05} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

// ── Keyboard ────────────────────────────────────────────────────

function KeyboardHandler() {
  const mode = useInteractionStore((s) => s.mode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); usePipeStore.getState().undo(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault(); usePipeStore.getState().redo(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const st = useInteractionStore.getState();
      switch (e.key) {
        case 'n': st.setMode('navigate'); break;
        case 'd': if (st.mode !== 'draw') st.setMode('draw'); break;
        case 's': if (st.mode !== 'draw') st.setMode('select'); break;
        case 'q': st.togglePipeQuality(); break;
        case 'v': if (st.mode === 'draw') st.setDrawPlane('vertical'); break;
        case 'h': if (st.mode === 'draw') st.setDrawPlane('horizontal'); break;
        case 'Escape': {
          // Universal cancel chain — ONE key users can hit reflexively
          // when something feels wrong, with a predictable order:
          //
          //   1. Radial wheel open?       → close it
          //   2. Pending fixture placement? → cancel it
          //   3. Mid-draw with points?    → clear points, STAY in Draw
          //      (so the user can immediately re-draw without hitting D)
          //   4. A pipe or fixture selected? → deselect (dismiss inspector)
          //   5. Otherwise                 → drop back to Navigate mode
          //
          // Each branch short-circuits so one Escape never performs more
          // than one step. Hit Escape again to continue up the chain.
          const wheelOpen = useRadialMenuStore.getState().activeWheelId !== null;
          if (wheelOpen) {
            useRadialMenuStore.getState().closeWheel();
            break;
          }
          const pending = useCustomerStore.getState().pendingFixture;
          if (pending) {
            useCustomerStore.getState().setPendingFixture(null);
            break;
          }
          if (st.mode === 'draw' && st.isDrawing) {
            useInteractionStore.setState({ drawPoints: [], isDrawing: false });
            break;
          }
          if (usePipeStore.getState().selectedId) {
            usePipeStore.getState().selectPipe(null);
            break;
          }
          if (useFixtureStore.getState().selectedFixtureId) {
            useFixtureStore.getState().selectFixture(null);
            break;
          }
          st.setMode('navigate');
          break;
        }
        case 'Enter':
          if (st.mode === 'draw') {
            const pts = st.finishDraw();
            if (pts && pts.length >= 2) {
              eventBus.emit(EV.PIPE_COMPLETE, {
                id: `pipe-${Date.now()}`, points: pts,
                diameter: st.drawDiameter, material: st.drawMaterial,
              });
            }
          }
          break;
        case 'Delete': case 'Backspace': {
          const sel = usePipeStore.getState().selectedId;
          if (sel) usePipeStore.getState().removePipe(sel);
          break;
        }
        case '1': if (st.mode === 'draw') st.setDrawDiameter(0.5); break;
        case '2': if (st.mode === 'draw') st.setDrawDiameter(1); break;
        case '3': if (st.mode === 'draw') st.setDrawDiameter(1.5); break;
        case '4': if (st.mode === 'draw') st.setDrawDiameter(2); break;
        case '5': if (st.mode === 'draw') st.setDrawDiameter(3); break;
        case '6': if (st.mode === 'draw') st.setDrawDiameter(4); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

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
  const mode = useInteractionStore((s) => s.mode);
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
  const mode = useInteractionStore((s) => s.mode);
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
  const mode = useInteractionStore((s) => s.mode);
  const pivoting = usePipeStore((s) => s.pivotSession !== null);
  const orbitRef = useRef<any>(null);
  // Orbit enable/disable is handled by <OrbitControlsGate/> below — no
  // imperative useEffect fighting the prop.

  return (
    <>
      {/* Studio 3-point lighting — makes pipes read clearly under any camera angle */}
      <ambientLight intensity={0.42} color="#eef4ff" />

      {/* KEY light (upper-right, warm) — primary shadow caster.
          4K shadow map for buttery-soft penumbras on modern GPUs;
          cascaded frustum bounds tuned so nothing gets cut off. */}
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.05}
        color="#fff4dc"
        castShadow
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-far={60}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.025}
        shadow-radius={6}
      />

      {/* FILL light (opposite side, cool) — softens the shadow side */}
      <directionalLight position={[-6, 8, -4]} intensity={0.35} color="#b8d4ff" />

      {/* RIM light (behind, cool cyan) — halo edges for readability */}
      <directionalLight position={[0, 5, -10]} intensity={0.28} color="#76cfff" />

      {/* Gentle ground bounce — simulates light reflecting off the floor */}
      <hemisphereLight args={['#3a4560', '#0a0a0f', 0.22]} />

      <Environment preset="warehouse" background={false} />

      {/* Shadow-receiving ground plane — subtle and only visible where
          an object is casting a shadow, so the grid still reads cleanly. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={0.22} />
      </mesh>

      {/* Refined grid — finer minor, brighter section lines, fade-out at distance */}
      <Grid
        args={[40, 40]}
        cellSize={1 / 12}             /* 1" cells */
        cellThickness={0.35}
        cellColor="#131a26"
        sectionSize={1}               /* 1 ft major */
        sectionThickness={1}
        sectionColor="#2a3a54"
        fadeDistance={45}
        fadeStrength={1.2}
        followCamera={false}
        infiniteGrid
      />

      <FixtureLayerFromStore />

      <DrawInteraction />
      {/* Empty-space click in Select mode → deselect. Mounted here (behind
          visible geometry) so R3F propagation reaches it only when no
          pipe/fixture in front consumed the click. */}
      <SelectBackgroundCatcher />
      <PipeRenderer />
      <FittingRenderer />
      <DimensionHelpers />
      <FloorPlaneOutlines />

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

      <OrbitControlsGate orbitRef={orbitRef} mode={mode} pivoting={pivoting} />

      <KeyboardHandler />
    </>
  );
}

// ── App ─────────────────────────────────────────────────────────

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      bootFeedbackLoop();
      bootPipeStore();
      loadCustomersFromStorage();

      // Force-clear any state that would block orbit on fresh launch:
      // pendingFixture persists to localStorage and can make clicks
      // place fixtures instead of rotating the camera.
      useCustomerStore.getState().setPendingFixture(null);
      useCustomerStore.getState().endEditFixture();
      useInteractionStore.getState().setMode('navigate');

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
      chordDetector.registerTap({
        id: 'export-svg',
        keys: ['control', 'shift', 'e'],
        description: 'Export SVG / Print PDF',
        requireShift: true,
        preventDefault: true,
        action: () => {
          const pipes = Object.values(usePipeStore.getState().pipes);
          const svg = exportToSVG(pipes, { projection: 'iso_true' });
          openPrintableSVG(svg, 'ELBOW GREASE - Isometric Plan');
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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [8, 10, 8], fov: 45 }}
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          // Higher precision across the shader pipeline
          powerPreference: 'high-performance',
          stencil: false,
          logarithmicDepthBuffer: false,
        }}
        onCreated={({ gl, scene }) => {
          gl.setClearColor('#060710');
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.25;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          // Faint blue-black fog adds depth cues without obscuring pipes
          scene.fog = new THREE.Fog('#060710', 35, 80);
        }}
      >
        <Scene />
      </Canvas>
      <Toolbar />
      <StatusBar />
      <FeedbackOverlay />
      <PerformanceMonitor />
      <LayerPanel />
      <PipeInspector />
      <ExportPanel />

      {/* Phase 2.F: Multi-floor ghosting + floor selector */}
      <FloorVisibilityControls />
      <FloorSelectorRail />
      <ActiveFloorAutoInfer />
      <FloorShortcutsBinder />

      {/* Phase 2.B: Fixture parameter window */}
      <FixtureParamWindow />

      {/* Phase 2.C: Fixture visual editor (split top + 3D) */}
      <FixtureVisualEditor />

      {/* Navigation status — shows why orbit is on/off */}
      <NavStatusChip />

      {/* Mode-aware cursor — the FIRST thing the user reads before clicking */}
      <CursorStyler />

      {/* Silent self-updater. Checks GitHub Releases on boot + every 6h,
          shows a bottom-right toast when a new signed release exists,
          downloads + verifies + relaunches on confirm. No-op in dev. */}
      <UpdateManager />

      {/* Phase 2.E: Construction phase selector + BOM */}
      <PhaseSelectorBar />
      <PhaseBOMPanel />
      <PhaseShortcutsBinder />

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

      {/* Phase 1: Radial menus — only one visible at a time based on store */}
      <DrawingWheel />
      <FixtureWheel />
      <CustomerEditWheel />

      {/* Phase 2.H: corner access points for weapon wheels */}
      <WheelCornerIcons />

      {/* Phase 1: Chord hint overlay */}
      <ChordHint />

      {/* Phase 2: live simulation + neuro HUD */}
      <SolvePipelineHUD />
      <HydraulicInspector />
      <NeuroStatusOrb />
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
