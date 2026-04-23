# ELBOW GREASE — Codebase Reference

> **Auto-generated** from `src/` after every edit. Do not hand-edit.
> Last regenerated: 2026-04-23T12:19:22.769Z

A videogame-styled plumbing CAD application built with React, Three.js,
and React Three Fiber. Provides realistic 3D pipe drawing, auto-routing,
hydraulic simulation, code compliance checking, BIM export, and more.


## Quickstart

**Run dev server:**
```bash
cd "C:/Program Files/ELBOW GREASE"
npm install
npx vite --host --port 5173
```

Open http://localhost:5173 in Edge.

**Build production:**
```bash
npx vite build
```
Output in `dist/`. Served by `server.cjs` when packaged as .exe.

**Standalone executable:**
Built at `C:/Users/Owner/OneDrive/Desktop/ElbowGrease/`. Contains
`ElbowGrease.exe` (Node.js embedded) and `dist/`. Portable.


## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + TypeScript (strict mode) |
| 3D Rendering | Three.js + React Three Fiber + drei |
| State | Zustand (stores in `src/store/`) |
| Bundler | Vite 6 |
| Path aliases | `@core`, `@ui`, `@hooks`, `@store` |
| Simulation | Web Worker (`src/engine/worker/simulation.worker.ts`) |
| Standalone | pkg (compiles server to single .exe) |


## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `N` | Navigate mode (orbit camera) |
| `D` | Draw mode (click to place waypoints) |
| `S` | Select mode |
| `Q` | Toggle 3D / Fast pipe rendering |
| `H` | Horizontal draw plane (in draw mode) |
| `V` | Vertical draw plane (in draw mode) |
| `1-6` | Quick diameter (0.5" → 4") while drawing |
| `Enter` | Finish current pipe |
| `Escape` | Cancel draw / return to Navigate |
| `Delete` / `Backspace` | Remove selected pipe |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save project to .elbow file |
| `Ctrl+O` | Open .elbow project file |

**Mouse:**
- Left-click: context-dependent (orbit in Navigate, place point in Draw, select in Select)
- Right-click: cancel draw / pan camera
- Double-click: finish pipe in draw mode


## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI Layer  (src/ui/ — React components, R3F scene)           │
│    • Mode-based interaction (Navigate / Draw / Select)        │
│    • Toolbar, PipeInspector, LayerPanel, ExportPanel          │
│    • Canvas with GlowRings, PipeRenderer, FittingRenderer     │
└────────────┬─────────────────────────────────────────────────┘
             │ EventBus (pub/sub, src/core/EventBus.ts)
             ▼
┌──────────────────────────────────────────────────────────────┐
│  State  (src/store/ — Zustand stores)                        │
│    • pipeStore    — committed pipes + undo/redo               │
│    • layerStore   — system visibility toggles                 │
│    • interactionStore — mode, draw plane, diameter            │
└────────────┬─────────────────────────────────────────────────┘
             │ SimulationBridge (src/engine/worker/)
             ▼
┌──────────────────────────────────────────────────────────────┐
│  Engine  (src/engine/ — Web Worker, headless)                │
│    • PlumbingDAG — directed acyclic graph of nodes/edges      │
│    • PropagationSolver — 5-pass pipeline:                     │
│        1. DFU accumulation (IPC Table 709.1)                  │
│        2. Auto pipe sizing (IPC Tables 710.1 / 604.4)         │
│        3. Darcy-Weisbach pressure drop (Colebrook-White)      │
│        4. ACC compliance (Knowledge Graph + PCSP)             │
│        5. BOM aggregation + cut-length optimization           │
│    • ZTPBD demand model (UPC 2024 Appendix M)                 │
│    • Auto-router (SDF + gravity-aware A*)                     │
│    • IFC export (ISO 16739)                                   │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow: User draws a pipe

```
1. User presses D → Navigate mode → Draw mode
2. User clicks twice to place waypoints
3. User presses Enter → finishDraw() → EV.PIPE_COMPLETE
4. pipeStore.addPipe() ← subscribed to PIPE_COMPLETE
5. PipeRenderer re-renders with new pipe (TubeGeometry)
6. SimulationBridge intercepts PIPE_COMPLETE → creates graph nodes/edges
7. Web Worker runs 5-pass solver (~10ms)
8. Results bounce back via SimulationMessageBus
9. pipeStore updates diameter if solver resized
10. Compliance violations emit EV.CODE_VIOLATION → red highlights
```


## Source File Index

Total TypeScript/TSX files: **496**

### `src/`

| File | Purpose | Exports |
|------|---------|---------|
| `App.tsx` | ELBOW GREASE — Plumbing CAD | App |
| `main.tsx` | — | — |

### `src/__tests__/integration/`

| File | Purpose | Exports |
|------|---------|---------|
| `autosaveDirtyFlow.spec.ts` | Integration: autosave dirty tracking via CommandBus. | — |
| `bundleRoundtrip.spec.ts` | Integration: bundle save → clear → load roundtrip. | — |
| `domainPresenceProposals.spec.tsx` | Integration: domain-presence gating of the Printable* components. | — |
| `harness.ts` | Integration-test harness — shared setup for cross-module flow tests. | resetAllStores, bootEventWiring, emit, seedCustomer |
| `onboardingFlow.spec.ts` | Integration: onboarding walkthrough progression via EventBus. | — |
| `pipeFlow.spec.ts` | Integration: pipe drawing flow. | — |
| `roofingBundleRoundtrip.spec.ts` | Integration: roofing bundle save → clear → load roundtrip. | — |

### `src/__tests__/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `pipeLoopGuardrails.spec.ts` | Pipe Loop Guardrails — Phase 14.AC.5. | — |

### `src/__tests__/scenarios/`

| File | Purpose | Exports |
|------|---------|---------|
| `autoRouteHotSupplyIntegration.spec.ts` | autoRoute + hot-supply integration scenario — Phase 14.Y.3 + 14.Y.4. | — |
| `drawLoopScenarios.spec.ts` | drawLoopScenarios — Phase 14.W hardening pass. | — |
| `drawLoopStress.spec.ts` | drawLoopStress — Phase 14.W stress tests. | — |
| `fixtureGraphDefaultOn.spec.ts` | Fixture Graph Default-On — Phase 14.AC.9 golden scene. | — |
| `pipeCollisionScenarios.spec.ts` | pipeCollisionScenarios — Phase 14.X | — |

### `src/core/`

| File | Purpose | Exports |
|------|---------|---------|
| `CueRoutineReward.ts` | Cue → Routine → Reward feedback loop manager. | bootFeedbackLoop |
| `EventBus.ts` | Decoupled Observer / Pub-Sub event system. | eventBus |
| `events.ts` | Canonical event names and their payload shapes. | Vec3, EV, EventName, PipeDragStartPayload, +10 |
| `FSM.ts` | Generic Finite State Machine. | TransitionTarget, TransitionMap, StateNode, FSMConfig, +1 |
| `UserProgressFSM.ts` | User Progress FSM — models the user's real-time interaction state. | UserState, UserEvent, userFSM |

### `src/core/a11y/`

| File | Purpose | Exports |
|------|---------|---------|
| `useFocusTrap.ts` | useFocusTrap — contain Tab/Shift+Tab focus cycling inside a container while active, and restore focu… | useFocusTrap |
| `useReducedMotion.ts` | useReducedMotion — reactive reader of the `prefers-reduced-motion` user preference. | useReducedMotion, isReducedMotionPreferred |

### `src/core/a11y/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `a11yHooks.spec.ts` | a11y hooks — Phase 10.C tests. | — |

### `src/core/bundle/`

| File | Purpose | Exports |
|------|---------|---------|
| `autosave.ts` | Autosave — crash-recovery persistence for the active document. | bootAutosave, stopAutosave, isDirty, markClean, +5 |
| `Bundle.ts` | Bundle — .elbow project file format. | CURRENT_BUNDLE_VERSION, BUNDLE_EXTENSION, BUNDLE_MIME, BundleMeta, +20 |
| `currentFileStore.ts` | currentFileStore — tracks the path of the current project and a bounded list of recent files. | RecentFile, useCurrentFileStore, __testables |
| `fsAdapter.ts` | fsAdapter — environment-aware save/open for .elbow bundles. | isTauri, __setTauriProbeForTest, SavePathRequest, WriteOptions, +5 |
| `openRecentFile.ts` | openRecentFile — open a bundle directly from a stored path. | OpenRecentResult |
| `useBundleHotkeys.ts` | useBundleHotkeys — global save / save-as / open keybindings. | useBundleHotkeys |

### `src/core/bundle/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `autosaveIdleDeferral.spec.ts` | Autosave Idle Deferral + Serialize Fast Path — Phase 14.AD.1. | — |
| `Bundle.spec.ts` | Bundle — Phase 11.A + 11.B tests. | — |
| `currentFileStore.spec.ts` | currentFileStore — Phase 11.D tests. | — |
| `fsAdapter.spec.ts` | fsAdapter — Phase 11.D tests. | — |
| `openRecentFile.spec.ts` | openRecentFile — Phase 11.E tests. | — |

### `src/core/camera/`

| File | Purpose | Exports |
|------|---------|---------|
| `springArm.ts` | springArm — pure multi-raycast collision clamp for a camera boom. | Vec3, SpringArmInput, SpringArmResult, RaycastFn, +4 |

### `src/core/camera/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `springArm.spec.ts` | springArm — Phase 12.E tests. | — |

### `src/core/commands/`

| File | Purpose | Exports |
|------|---------|---------|
| `boot.ts` | Boot — single entry point to bring up the CommandBus subsystem. | bootCommandBus |
| `CommandBus.ts` | CommandBus — synchronous command dispatcher with a 500-entry ring buffer log for the God Mode consol… | commandBus, registerHandler |
| `correlationId.ts` | correlationId — tiny, dependency-free ID generator for command chains. | newCorrelationId, childCorrelationId |
| `EventToCommand.ts` | EventToCommand — bridge from the legacy pub/sub EventBus to the new CommandBus dispatcher. | installEventToCommand, uninstallEventToCommand |
| `types.ts` | Command pattern — contracts. | CommandOrigin, CommandMode, Command, DispatchOk, +5 |
| `UndoManager.ts` | UndoManager — walks the CommandBus log and reverses commands. | canUndo, canRedo, undo, redo, +5 |

### `src/core/commands/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `CommandBus.spec.ts` | CommandBus — Phase 1 acceptance tests. | — |
| `UndoManager.spec.ts` | UndoManager — Phase 8.B tests. | — |

### `src/core/commands/handlers/`

| File | Purpose | Exports |
|------|---------|---------|
| `fixtureHandlers.ts` | Fixture command handlers — analogous to pipeHandlers, one per mutation. | FixturePlacePayload, FixtureRemovePayload, FixtureSelectPayload, FixtureUpdateParamPayload, +9 |
| `index.ts` | Handler registry — registers every CommandHandler with the bus at boot. | registerAllHandlers, pipeHandlers, fixtureHandlers, interactionHandlers, +2 |
| `interactionHandlers.ts` | Interaction command handlers — mode changes, draw-point accumulation, diameter/material/plane settin… | InteractionSetModePayload, InteractionAddDrawPointPayload, InteractionClearDrawPayload, InteractionFinishDrawPayload, +11 |
| `manifoldHandlers.ts` | Manifold command handlers — Phase 7.C. | ManifoldAddPayload, ManifoldRemovePayload, ManifoldMovePayload, ManifoldSelectPayload, +7 |
| `pipeHandlers.ts` | Pipe command handlers. | PipeAddPayload, PipeRemovePayload, PipeSelectPayload, PipeUpdateDiameterPayload, +13 |
| `systemHandlers.ts` | System command handlers — meta-level markers that don't mutate any store but show up in the log for … | SystemBootPayload, systemBootHandler, systemHandlers |

### `src/core/compliance/`

| File | Purpose | Exports |
|------|---------|---------|
| `hangerPlanner.ts` | hangerPlanner — Phase 14.H | HangerReason, HangerKind, HangerRequirement, HangerPlan, +7 |
| `pTrapCleanoutPlanner.ts` | pTrapCleanoutPlanner — Phase 14.D | CleanoutReason, PTrapRequirement, CleanoutRequirement, TrapCleanoutPlan, +6 |

### `src/core/compliance/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `hangerPlanner.spec.ts` | hangerPlanner — Phase 14.H tests. | — |
| `pTrapCleanoutPlanner.spec.ts` | pTrapCleanoutPlanner — Phase 14.D tests. | — |

### `src/core/customers/`

| File | Purpose | Exports |
|------|---------|---------|
| `CustomerTypes.ts` | CustomerTypes — contractor client-management taxonomy. | ClientContact, SiteAddress, ProjectType, PROJECT_TYPE_META, +8 |

### `src/core/fixtures/`

| File | Purpose | Exports |
|------|---------|---------|
| `autoRouteFixture.ts` | autoRouteFixture — Phase 14.Y.3 | ProposedPipe, AutoRouteInput, AutoRouteResult, fixtureLocalToWorld, +1 |
| `bootHotSupplyPropagation.ts` | bootHotSupplyPropagation — Phase 14.Y.4 | bootHotSupplyPropagation, __stopHotSupplyPropagation, __flushHotSupplyPropagation |
| `ConnectionPoints.ts` | ConnectionPoints — per-subtype drain/supply anchor geometry. | ConnectionPoint, FixtureFootprint, FixtureGeometry, getFixtureGeometry, +2 |
| `FixtureDiagnostics.ts` | FixtureDiagnostics — live rule checks on staged fixture params. | Severity, Diagnostic, diagnoseFixture, highestSeverity |
| `FixtureParams.ts` | FixtureParams — per-fixture parameter schemas, defaults, and validation. | NumberField, SelectField, ToggleField, RangeField, +9 |
| `FixturePresets.ts` | FixturePresets — named parameter bundles users can apply with one click. | Preset, PRESETS, getPresetsFor |
| `hotSupplyPropagation.ts` | hotSupplyPropagation — Phase 14.Y.4 | hotOutletSeeds, computeHotSupplyReachable, ClassificationChange, applyHotSupplyClassification, +3 |
| `riserTemplates.ts` | riserTemplates — Phase 14.Z | RiserId, RiserTemplate, RISER_CATALOG, listRiserTemplates, +4 |
| `rotationGizmoMath.ts` | rotationGizmoMath — Phase 14.F | normalizeDeg, xzAngleDeg, snapDeg, RotationSnapMode, +4 |

### `src/core/fixtures/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `autoRouteFixture.spec.ts` | autoRouteFixture — Phase 14.Y.3 tests. | — |
| `fixtureRegistry.spec.ts` | fixtureRegistry — Phase 14.Y.1 tests. | — |
| `hotSupplyPropagation.spec.ts` | hotSupplyPropagation — Phase 14.Y.4 tests. | — |
| `riserTemplates.spec.ts` | riserTemplates — Phase 14.Z tests. | — |
| `rotationGizmoMath.spec.ts` | rotationGizmoMath — Phase 14.F tests. | — |

### `src/core/floor/`

| File | Purpose | Exports |
|------|---------|---------|
| `FloorResolver.ts` | FloorResolver — pure helpers for mapping geometry to floors. | resolveFloorForPoint, rangeOverlapsFloor, pointOverlapsFloor, segmentOverlapsFloor, +11 |

### `src/core/formula/`

| File | Purpose | Exports |
|------|---------|---------|
| `formulaEngine.ts` | formulaEngine — Phase 14.AB.1 | FormulaResult, FormulaVariables, evaluateFormula, parseCurrencyNumber, +2 |

### `src/core/formula/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `formulaEngine.spec.ts` | formulaEngine — Phase 14.AB.1 tests. | — |

### `src/core/geometry/`

| File | Purpose | Exports |
|------|---------|---------|
| `AngleSnap.ts` | AngleSnap — constraint solver for plumbing geometry. | SnapMode, SnapConfig, DEFAULT_SNAP_CONFIG, SnapResult, +4 |
| `PivotController.ts` | PivotController — mathematical engine for constrained pipe pivoting. | LEGAL_PIVOT_DELTAS_RAD, DEFAULT_SNAP_TOL_RAD, PivotPlane, PivotDelta, +4 |

### `src/core/hilo/`

| File | Purpose | Exports |
|------|---------|---------|
| `HILOCoordinator.ts` | HILO Coordinator — Mixed-Initiative bridge. | HILO_EV, RoutesGeneratedPayload, RouteSelectedPayload, HILOCoordinator, +1 |
| `PreferenceModel.ts` | Preference Model — learns objective weights from user choices. | PreferenceModel |

### `src/core/import/`

| File | Purpose | Exports |
|------|---------|---------|
| `csvParser.ts` | csvParser — Phase 14.AB.2 | CsvParseOptions, parseCsv, CsvObjectResult, parseCsvAsObjects |
| `priceListMapper.ts` | priceListMapper — Phase 14.AB.2 | PriceListMapping, PriceListImportRow, PriceListImportWarning, PriceListImportResult, +6 |

### `src/core/import/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `csvParser.spec.ts` | csvParser — Phase 14.AB.2 tests. | — |
| `priceListMapper.spec.ts` | priceListMapper — Phase 14.AB.2 tests. | — |

### `src/core/input/`

| File | Purpose | Exports |
|------|---------|---------|
| `ChordDetector.ts` | ChordDetector — multi-key chord detection with hold durations and partial-chord visualization. | ChordAction, HoldChord, SequenceChord, TapChord, +4 |
| `ShortcutRegistry.ts` | ShortcutRegistry — single source of truth for every keyboard shortcut in the app. | ShortcutCategory, ShortcutMode, Shortcut, SHORTCUTS, +3 |

### `src/core/input/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `shortcutMode.spec.ts` | ShortcutRegistry — Phase 2a (ARCHITECTURE.md §4.1) tests. | — |

### `src/core/interference/`

| File | Purpose | Exports |
|------|---------|---------|
| `ClearanceEnforcer.ts` | Clearance Enforcer — validates minimum separation between pipes and structural elements, and between… | ClearanceViolation, enforceClearances |
| `CollisionPredictor.ts` | Collision Predictor — real-time sweep test on route preview. | SegmentStatus, SegmentCollision, CollisionPrediction, predictCollisions |
| `pipeCollision.ts` | pipeCollision — Phase 14.X | PipeCollisionSeverity, PipeCollision, closestPointsOnSegments, DetectOptions, +3 |
| `StructuralElements.ts` | Structural Elements — typed obstacle catalog for the building. | StructuralType, ClearanceRule, CLEARANCE_RULES, StructuralElement, +7 |

### `src/core/interference/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `pipeCollision.spec.ts` | pipeCollision — Phase 14.X tests. | — |

### `src/core/lazy/`

| File | Purpose | Exports |
|------|---------|---------|
| `lazyImport.ts` | lazyImport — cached dynamic-import utility for heavy, one-shot modules (exporters, serializers, anal… | LazyLoader, makeLazyLoader, HoverPrewarm, hoverPrewarm |
| `loaders.ts` | Declared lazy loaders for every one-shot heavy module the user touches at click-time — NOT at app bo… | loadSvgExporter, loadIfcSerializer, loadDxfExporter, loadPdfRenderer |

### `src/core/lazy/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `bundleRegression.spec.ts` | — | — |
| `lazyImport.spec.ts` | lazyImport — Phase 10.B tests. | — |

### `src/core/logger/`

| File | Purpose | Exports |
|------|---------|---------|
| `boot.ts` | Logger boot — mirrors `featureFlagStore.logLevel` into the logger module's internal threshold, both … | bootLogger |
| `Logger.ts` | Logger — structured, leveled, observable logging subsystem. | LogLevel, LogEntry, LogSubscriber, LeveledLogger, +9 |

### `src/core/logger/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `Logger.spec.ts` | Logger — Phase 10.A tests. | — |

### `src/core/manifold/`

| File | Purpose | Exports |
|------|---------|---------|
| `ManifoldGeometry.ts` | ManifoldGeometry — pure math for PEX manifold entities. | PORT_SPACING_FT, TRUNK_DIAMETER_FT, MAX_PORT_COUNT, PORT_EXTENSION_FT, +11 |

### `src/core/manifold/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `ManifoldGeometry.spec.ts` | ManifoldGeometry — Phase 7.C acceptance tests. | — |

### `src/core/neuro/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveRenderProfile.ts` | Adaptive Render Profile — dynamic visual intensity scaling. | RenderProfile, PROFILE_EV, AdaptiveRenderProfileManager, renderProfile |
| `EngagementMetrics.ts` | Engagement Metrics — perceptual engagement tracker inspired by EEG beta/theta rhythm research. | ENGAGE_EV, EngagementZone, EngagementState, EngagementTracker, +1 |
| `SessionHealthMonitor.ts` | Session Health Monitor — aggregates engagement, fatigue, and cognitive load into a single session he… | HEALTH_EV, PerformanceTrend, SessionHealth, SessionHealthMonitor, +1 |
| `VisualFatigueGuard.ts` | Visual Fatigue Guard — prevents overstimulation during long sessions. | FATIGUE_EV, FatigueLevel, FatigueState, VisualFatigueGuard, +1 |

### `src/core/onboarding/`

| File | Purpose | Exports |
|------|---------|---------|
| `steps.ts` | Onboarding steps — content + advancement triggers. | StepPlacement, OnboardingStep, ONBOARDING_STEPS |

### `src/core/optimizer/`

| File | Purpose | Exports |
|------|---------|---------|
| `BayesianOptimizer.ts` | Bayesian Optimizer — multi-objective surrogate model. | RouteFeatureExtractor, BayesianOptimizer, defaultFeatureExtractor |
| `ParetoFrontier.ts` | Pareto Frontier — non-dominated solution set manager. | ObjectiveVector, RouteCandidate, ParetoFrontier |

### `src/core/pathfinding/`

| File | Purpose | Exports |
|------|---------|---------|
| `AutoRouter.ts` | AutoRouter — user-facing API for automatic pipe routing. | AUTOROUTE_EV, RoutingMode, AutoRouteRequest, AutoRouteResult, +4 |
| `ECBSRouter.ts` | Enhanced Conflict-Based Search (ECBS) Router. | GridConfig, ObstacleMap, generateDiverseRoutes |
| `GravityAwareAStar.ts` | Gravity-Aware A* — pathfinder that auto-computes vertical drops for drainage slope requirements. | RouteConstraints, DEFAULT_CONSTRAINTS, SearchResult, gravityAwareAStar |
| `PathSmoother.ts` | Path Smoother — reduces redundant waypoints from grid-based A*. | removeCollinear, lineOfSightSmooth, roundCorners, smoothPath |
| `SignedDistanceField.ts` | Signed Distance Field (SDF) — continuous obstacle weighting for intelligent pipe routing. | SDFConfig, DEFAULT_SDF_CONFIG, SignedDistanceField |

### `src/core/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `PerfStats.ts` | PerfStats — singleton performance telemetry collector. | PerfSample, PipeLoopMetrics, recordFrame, recordWorkerRoundTrip, +9 |

### `src/core/perf/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `PerfStats.pipeLoop.spec.ts` | PerfStats — Phase 14.AC.4 pipe-loop telemetry tests. | — |
| `PerfStats.spec.ts` | PerfStats — Phase 10.D tests. | — |

### `src/core/phases/`

| File | Purpose | Exports |
|------|---------|---------|
| `PhaseClassifier.ts` | PhaseClassifier — determines which construction phase a given object belongs to, using geometry + sy… | classifyPipe, classifyFixture |
| `PhaseTypes.ts` | PhaseTypes — construction-phase taxonomy for plumbing work. | ConstructionPhase, PHASE_ORDER, PhaseMeta, PHASE_META, +3 |

### `src/core/pipe/`

| File | Purpose | Exports |
|------|---------|---------|
| `angleSnap.ts` | angleSnap — Phase 14-bug-fix pass | LEGAL_RELATIVE_ANGLES_DEG, snapDirectionXZ, constrainCandidateToLegalBend, materialRequiresLegalAngles, +5 |
| `arcRadiusValidator.ts` | arcRadiusValidator — Phase 14.V | deflectionDegAt, localBendRadiusFt, ArcViolation, validateArcRadii, +1 |
| `ConnectivityManager.ts` | ConnectivityManager — keeps pipeConnectivityStore in sync with pipeStore, and auto-pushes/removes ca… | bootConnectivityManager, shutdownConnectivityManager, __resetConnectivityManagerForTests |
| `fittingCache.ts` | fittingCache — Phase 14.T | pipeFittingHash, FittingCacheStats, FittingCache, getFittingCache, +1 |
| `FittingCatalog.ts` | FittingCatalog — what fittings are legal per material, at what sizes, and what they cost. | FittingDef, FITTING_CATALOG, FITTING_PRICE_USD, getFittingPrice, +8 |
| `junctionConstants.ts` | Junction tolerance constants — Phase 14.AD.14. | JUNCTION_TOLERANCE_FT, JUNCTION_TOLERANCE_FT_SQ |
| `liveRouteBuild.ts` | liveRouteBuild — Phase 14.Q | distance, horizontalDistance, RouteSegment, buildRouteSegments, +5 |
| `mergePexRuns.ts` | mergePexRuns — group adjacent PEX pipes that should render as one continuous organic tube. | PipeRunGroup, MergeResult, mergedVertexKey, mergePexRuns |
| `nearestPipeSnap.ts` | nearestPipeSnap — given a cursor world position and the current pipe set, return the nearest "snap t… | ENDPOINT_SNAP_EPS_FT, BODY_SNAP_EPS_FT, PipeSnapResult, nearestPipeSnap |
| `PexBendClassifier.ts` | PexBendClassifier — decides how a corner in a PEX (or generally flexible) pipe route should be rende… | FITTING_90_TOLERANCE_DEG, SMOOTH_CURVE_THRESHOLD_DEG, SHARP_BEND_DEFLECTION_DEG, BendKind, +5 |
| `pipeDirections.ts` | pipeDirections — Phase 14.AD.30. | ZERO_DIR, WORLD_UP, vec3, length, +21 |
| `pipeInvariants.ts` | pipeInvariants — Phase 14.AD.30. | Violation, validatePipe, validateFitting, validateScene, +2 |
| `PipeSizeSpec.ts` | PipeSizeSpec — real-world outer/inner diameter tables per material. | isFlexibleMaterial, getOuterDiameterIn, getOuterDiameterFt, getOuterRadiusFt, +5 |
| `PipeStandards.ts` | PipeStandards — supplementary dimensional data for fittings, socket depths, and bend radii per indus… | getSocketDepthIn, getSocketDepthFt, getHubOuterRadiusFt, getBendCenterlineRadiusFt, +5 |
| `polylineMath.ts` | polylineMath — cheap 3D polyline geometry helpers. | NearestOnPolyline, nearestSegmentOnPolyline |

### `src/core/pipe/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `angleSnap.spec.ts` | angleSnap — bug-fix pass tests. | — |
| `arcRadiusValidator.spec.ts` | arcRadiusValidator — Phase 14.V tests. | — |
| `ConnectivityManager.spec.ts` | ConnectivityManager — Phase 7.D acceptance tests. | — |
| `defaultTeeForOrientation.spec.ts` | defaultTeeFor orientation rules — Phase 14.AD.22. | — |
| `fittingCache.spec.ts` | fittingCache — Phase 14.T tests. | — |
| `fittingCacheFastPath.spec.ts` | FittingCache fast-path — Phase 14.AD.2 tests. | — |
| `fittingCachePerf.spec.ts` | fittingCache — Phase 14.T perf regression guard. | — |
| `junctionConstants.spec.ts` | junctionConstants — Phase 14.AD.14 consolidation regression tests. | — |
| `liveRouteBuild.spec.ts` | liveRouteBuild — Phase 14.Q tests. | — |
| `mergePexRuns.spec.ts` | mergePexRuns — Phase 7.B acceptance tests. | — |
| `nearestPipeSnap.spec.ts` | nearestPipeSnap — Phase 9 tests. | — |
| `PexBendClassifier.spec.ts` | PexBendClassifier — Phase 6 tests. | — |
| `pipeDirections.spec.ts` | pipeDirections — Phase 14.AD.30. | — |
| `pipeInvariants.spec.ts` | pipeInvariants — Phase 14.AD.30. | — |
| `pipeStandardsAccuracy.spec.ts` | PipeStandards dimensional accuracy — Phase 14.AD.6. | — |
| `polylineMath.spec.ts` | polylineMath.nearestSegmentOnPolyline — Phase 7.A unit tests. | — |

### `src/core/print/`

| File | Purpose | Exports |
|------|---------|---------|
| `bidPackageData.ts` | bidPackageData — Phase 14.AA.2 | BidPackageComplianceSummary, BidComplianceRow, BidPackageData, ComposeBidPackageInput, +1 |
| `printBidPackage.ts` | printBidPackage — Phase 14.AA.2 | usePrintBidPackageStore, PrintBidPackageOptions, printBidPackage |
| `printChangeOrder.ts` | printChangeOrder — Phase 14.G | ChangeOrderPrintData, PrintChangeOrderOptions |
| `printProposal.ts` | printProposal — orchestrates the "show hidden layout → print" flow. | usePrintStore, PrintProposalOptions, __testables |
| `proposalData.ts` | proposalData — pure composition of the proposal payload. | ContractorProfile, ProposalVariant, ProposalData, ProposalLineItem, +4 |
| `proposalRevision.ts` | proposalRevision — Phase 14.G | SavedRevision, LineItemDelta, LineItemIdentity, TotalsDelta, +7 |

### `src/core/print/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `bidPackageData.spec.ts` | bidPackageData — Phase 14.AA.2 tests. | — |
| `proposalData.spec.ts` | proposalData — Phase 14.B tests. | — |
| `proposalRevision.spec.ts` | proposalRevision — Phase 14.G tests. | — |

### `src/core/project/`

| File | Purpose | Exports |
|------|---------|---------|
| `AutoSave.ts` | AutoSave — localStorage auto-save with debounced writes. | AutoSaveManager, autoSave |
| `ProjectBundle.ts` | ProjectBundle — crash-safe `.elbow` project directory. | BundleHeader, BundleLoadResult, OpenOptions, ProjectBundle |
| `ProjectEvents.ts` | ProjectEvent — the typed mutations that ProjectBundle logs. | PROJECT_EVENT_SCHEMA_VERSION, ProjectEvent, PipeAddEvent, PipeRemoveEvent, +11 |
| `ProjectFileIO.ts` | Project File I/O — export .elbow files and import via file picker. | exportProjectFile, importProjectFile |
| `ProjectSerializer.ts` | Project Serializer — serialize/deserialize entire design state to JSON. | PROJECT_VERSION, FILE_EXTENSION, MIME_TYPE, ProjectFile, +12 |

### `src/core/project/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `ProjectBundle.spec.ts` | ProjectBundle — Phase 4 acceptance tests. | — |

### `src/core/project/fs/`

| File | Purpose | Exports |
|------|---------|---------|
| `FsAdapter.ts` | FsAdapter — abstraction over the filesystem primitives ProjectBundle needs, so the same bundle code … | FsStat, FsAdapter, joinPath, dirname, +1 |
| `index.ts` | Factory that picks the right FsAdapter based on runtime. | MemoryFsAdapter |
| `MemoryFsAdapter.ts` | MemoryFsAdapter — synchronous, in-memory implementation of FsAdapter. | WriteFailure, MemoryFsAdapter |
| `TauriFsAdapter.ts` | TauriFsAdapter — FsAdapter backed by @tauri-apps/plugin-fs. | TauriFsAdapter |

### `src/core/proposal/`

| File | Purpose | Exports |
|------|---------|---------|
| `domainPresence.ts` | domainPresence — Phase 5 (ARCHITECTURE.md §4.8). | DomainPresence, getDomainPresence, computeDomainPresence |

### `src/core/proposal/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `domainPresence.spec.ts` | domainPresence — Phase 5 (ARCHITECTURE.md §4.8) tests. | — |

### `src/core/selection/`

| File | Purpose | Exports |
|------|---------|---------|
| `boxSelectMath.ts` | boxSelectMath — Phase 14.M | Mat4, ScreenRect, Viewport, BoxSelectInput, +8 |
| `groupRotation.ts` | groupRotation — Phase 14.M | RotatablePipe, RotatableFixture, GroupRotationInput, GroupRotationResult, +4 |
| `groupTranslate.ts` | groupTranslate — Phase 14.O | TranslatablePipe, TranslatableFixture, GroupTranslateInput, GroupTranslateResult, +9 |
| `massEdit.ts` | massEdit — Phase 14.N | EditablePipe, EditableFixture, VisibilityOp, PipeChangeSet, +12 |
| `selectionClipboard.ts` | selectionClipboard — Phase 14.P | CLIPBOARD_SCHEMA_VERSION, ClipboardPipe, ClipboardFixture, ClipboardPayload, +6 |

### `src/core/selection/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `boxSelectMath.spec.ts` | boxSelectMath — Phase 14.M tests. | — |
| `groupRotation.spec.ts` | groupRotation — Phase 14.M tests. | — |
| `groupTranslate.spec.ts` | groupTranslate — Phase 14.O tests. | — |
| `massEdit.spec.ts` | massEdit — Phase 14.N tests. | — |
| `selectionClipboard.spec.ts` | selectionClipboard — Phase 14.P tests. | — |

### `src/core/selectors/`

| File | Purpose | Exports |
|------|---------|---------|
| `isAnyDrawActive.ts` | isAnyDrawActive — cross-store selector (ARCHITECTURE.md §4.2). | isAnyDrawActive |

### `src/core/selectors/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `isAnyDrawActive.spec.ts` | isAnyDrawActive — Phase 2b (ARCHITECTURE.md §4.2) tests. | — |

### `src/core/spatial/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveCamera.ts` | Adaptive Camera — intelligent desktop 3D camera that reduces the cognitive tax of visuospatial trans… | CameraPreset, CAMERA_PRESETS, CameraState, CAMERA_EV, +2 |
| `CognitiveLoadMonitor.ts` | Cognitive Load Monitor — tracks real-time interaction metrics to detect when the user is overwhelmed… | LOAD_EV, LoadLevel, LoadState, LoadAdaptation, +2 |
| `DepthCueRenderer.ts` | Depth Cue Configuration — visual parameters that enhance spatial comprehension and reduce visuospati… | DepthCueConfig, defaultDepthCues, vrDepthCues, arDepthCues |
| `SpatialAudio.ts` | Spatial Audio Feedback — 3D positional audio for pipe events. | updateListenerPosition, setMasterVolume, bootSpatialAudio |
| `SpatialPipeInteraction.ts` | Spatial Pipe Interaction — bridges gesture input to pipe routing. | SPATIAL_EV, FixtureHitPayload, SpatialPipeInteraction, spatialInteraction |

### `src/core/sync/`

| File | Purpose | Exports |
|------|---------|---------|
| `contractorLibrary.ts` | contractorLibrary — Phase 14.J | LIBRARY_SCHEMA_VERSION, LIBRARY_FILE_MAGIC, ContractorLibrary, LibrarySection, +14 |

### `src/core/sync/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `contractorLibrary.spec.ts` | contractorLibrary — Phase 14.J tests. | — |

### `src/core/telemetry/`

| File | Purpose | Exports |
|------|---------|---------|
| `boot.ts` | Telemetry boot — wires SessionTelemetry to the featureFlagStore. | bootSessionTelemetry |
| `SessionTelemetry.ts` | SessionTelemetry — local-only, opt-in usage + performance metrics. | TelemetryBucket, TelemetrySession, SceneCountReader, StartOptions, +9 |

### `src/core/telemetry/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `SessionTelemetry.spec.ts` | SessionTelemetry — Phase 10.E tests. | — |

### `src/core/templates/`

| File | Purpose | Exports |
|------|---------|---------|
| `assemblyTemplate.ts` | assemblyTemplate — Phase 14.C | TemplatePipe, TemplateFixture, AssemblyTemplate, ComposeTemplateInput, +7 |

### `src/core/templates/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `assemblyTemplate.spec.ts` | assemblyTemplate — Phase 14.C tests. | — |

### `src/core/walls/`

| File | Purpose | Exports |
|------|---------|---------|
| `cutawayAlgorithm.ts` | cutawayAlgorithm — pure geometry for Sims-style wall cutaway. | XZ, CutawayWall, CutawayInput, computeCutawaySet, +1 |
| `wallInstanceBuckets.ts` | wallInstanceBuckets — pure bucketing for instanced wall rendering. | FloorParams, GetFloorParams, RenderMode, WallInstance, +7 |

### `src/core/walls/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `cutawayAlgorithm.spec.ts` | cutawayAlgorithm — Phase 12.A tests. | — |
| `wallInstanceBuckets.spec.ts` | wallInstanceBuckets — Phase 12.C tests. | — |

### `src/core/xr/`

| File | Purpose | Exports |
|------|---------|---------|
| `XRHandTracking.ts` | XR Hand Tracking — maps hand joints and gestures to pipe interactions. | GESTURE_EV, Handedness, PinchPayload, PointRayPayload, +3 |
| `XRSessionManager.ts` | XR Session Manager — WebXR lifecycle and capability detection. | XR_EV, XRTier, XRCapabilities, XRSessionManager, +1 |

### `src/engine/assembly/`

| File | Purpose | Exports |
|------|---------|---------|
| `SnapPopulate.ts` | SnapPopulate — auto-populate fittings and stub-outs at fixture connection points. | PopulatedItem, FixtureInstance, ConnectionMatch, detectConnection, +3 |
| `TalonGenerator.ts` | TalonGenerator — procedural pipe support placement. | SupportType, SeismicZone, TalonInstance, TalonGenConfig, +4 |

### `src/engine/catalog/`

| File | Purpose | Exports |
|------|---------|---------|
| `FittingCatalog.ts` | FittingCatalog — IPC-accurate library of plumbing fittings. | BendFraction, BEND_ANGLE_RAD, BEND_ANGLE_DEG, ConnectionPattern, +7 |

### `src/engine/compliance/`

| File | Purpose | Exports |
|------|---------|---------|
| `ComplianceEngine.ts` | Compliance Engine — bridges the KnowledgeGraph rules to PCSP constraints instantiated over the live … | setComplianceTraceEnabled, __getComplianceTraceEnabled, ComplianceViolation, ComplianceReport, +2 |
| `condensateValidation.ts` | condensateValidation — Phase 14.AA.3 | CondensateViolationKind, CondensateViolation, validateCondensateDischarge, CondensateReport, +1 |
| `IPCOntology.ts` | IPC Ontology — semantic type system for the International Plumbing Code. | NS, EntityClass, PropertyClass, RelationshipClass, +6 |
| `IPCRuleParser.ts` | IPC Rule Parser — encodes IPC 2021 chapters 6–9 as machine-readable knowledge graph triples and PCSP… | loadIPCKnowledgeBase |
| `KnowledgeGraph.ts` | Knowledge Graph — RDF-inspired triple store for IPC rules. | Triple, TriplePattern, RuleTemplate, RuleCondition, +2 |
| `PCSPSolver.ts` | PCSP Solver — Partial Constraint Satisfaction Problem engine. | PCSPVariable, PCSPDomain, PCSPConstraint, PCSPSolution, +3 |
| `ViolationTrace.ts` | ViolationTrace — inference chain behind a ComplianceViolation. | TracedRuleCondition, TracedConstraint, SolverPhase, TracedCodeReference, +1 |

### `src/engine/compliance/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `condensateValidation.spec.ts` | condensateValidation — Phase 14.AA.3 tests. | — |
| `ViolationTrace.spec.ts` | Phase 2 — ViolationTrace acceptance test. | — |

### `src/engine/demand/`

| File | Purpose | Exports |
|------|---------|---------|
| `FixtureFlowProfile.ts` | Fixture Flow Profiles — modern low-flow fixture database. | FlowProfile, PEAK_INTERVAL_SEC, FLOW_PROFILES, getFlowProfile, +1 |
| `ModifiedWistortMethod.ts` | Modified Wistort Method (MWM) — 2024 UPC Appendix M implementation. | DemandGroup, FixtureEntry, MWMResult, GroupResult, +4 |
| `PoissonBinomial.ts` | Poisson Binomial Distribution — exact PMF/CDF computation. | poissonBinomialPMF, pmfToCDF, quantile, poissonBinomialPMF_DFT, +2 |
| `ZeroTruncation.ts` | Zero-Truncated Poisson Binomial Distribution (ZTPBD). | ZTPBDResult, ZTPBDStats, computeZTPBD, ztpbdQuantile, +1 |

### `src/engine/export/`

| File | Purpose | Exports |
|------|---------|---------|
| `BOMExporter.ts` | BOM Exporter — generates procurement-ready Bill of Materials. | DATA_LAST_REVIEWED, DATA_SOURCES, DATA_REGION, fittingCostWithOverride, +8 |
| `computeBid.ts` | computeBid — pure bid math on top of a BOMReport. | PricingProfile, BidResult, computeBid, FL_RESIDENTIAL_DEFAULT, +1 |
| `CutLengthOptimizer.ts` | Cut Length Optimizer — breaks pipe routes into standard stock lengths with minimal material waste. | STOCK_LENGTHS_FT, CutParams, CutPiece, StockPiece, +3 |
| `DXFExporter.ts` | DXFExporter — Phase 14.AA.1 | DxfProjection, DxfExportOptions, DxfScene, DxfExportResult, +1 |
| `IFCSchema.ts` | IFC Schema — entity type mappings for plumbing BIM export. | NODE_TO_IFC, FIXTURE_TO_IFC, FITTING_TO_IFC, SYSTEM_TO_IFC, +6 |
| `IFCSerializer.ts` | IFC Serializer — converts the PlumbingDAG + committed pipes to IFC-SPF (STEP Physical File) format p… | IFCExportOptions, IFCExportResult, exportToIFC |
| `SVGExporter.ts` | SVGExporter — vectorized 2D export for print-ready PDFs. | ProjectionMode, SVGExportOptions, DEFAULT_EXPORT_OPTIONS, exportToSVG, +2 |

### `src/engine/export/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `BOMDataCoverage.spec.ts` | BOM Data Coverage — Phase 13.B tests. | — |
| `BOMExporter.spec.ts` | BOMExporter — Phase 13.A audit tests. | — |
| `computeBid.spec.ts` | computeBid — Phase 14.A tests. | — |
| `DXFExporter.spec.ts` | DXFExporter — Phase 14.AA.1 tests. | — |
| `fittingCostWithOverride.spec.ts` | fittingCostWithOverride — Phase 14.AB.1 integration test. | — |
| `fittingPricePriority.spec.ts` | fittingCostWithOverride priority — Phase 14.AB.2. | — |
| `fixtureBOMRollup.spec.ts` | Fixture BOM Rollup — Phase 14.AC.10 tests. | — |

### `src/engine/graph/`

| File | Purpose | Exports |
|------|---------|---------|
| `GraphEdge.ts` | Graph Edge — directed pipe segment connecting two nodes. | PIPE_MATERIALS, PipeMaterial, ROUGHNESS_FT, HAZEN_WILLIAMS_C, +6 |
| `GraphNode.ts` | Graph Node — atomic functional unit in the plumbing network DAG. | NodeType, SystemType, FixtureSubtype, DFU_TABLE, +8 |
| `MessageBus.ts` | Simulation MessageBus — typed message-passing interface between the headless engine and the visual f… | SIM_MSG, SimMessageType, NodeComputedPayload, EdgeComputedPayload, +7 |
| `PlumbingDAG.ts` | Plumbing DAG — directed acyclic graph of the plumbing network. | PlumbingDAG |

### `src/engine/hydraulics/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveSolverSelector.ts` | Adaptive Solver Selector — auto-picks the friction solver based on Reynolds number range, accuracy r… | SolverMode, SolverBudget, AdaptiveSolverSelector, solverSelector |
| `FrictionSolvers.ts` | Friction Factor Solvers — multiple methods ranked by speed and accuracy. | FrictionMethod, FrictionResult, swameeJain, haaland, +4 |
| `HydraulicBenchmark.ts` | Hydraulic Benchmark — measures solve time and accuracy for each friction method against the Colebroo… | BenchmarkResult, runFrictionBenchmark, validateSwameeJain |
| `ManningFlow.ts` | Manning's Equation — open-channel gravity drainage flow. | MANNING_N, PartialFillGeometry, partialFillGeometry, ManningResult, +3 |
| `SaintVenantSolver.ts` | 1D Saint-Venant Solver — transient shallow-water equations for drainage and stormwater simulation. | SVCell, SVPipe, LateralInflow, SaintVenantSolver |

### `src/engine/pdf/`

| File | Purpose | Exports |
|------|---------|---------|
| `PDFRenderer.ts` | PDFRenderer — Phase 14.E | PdfPageImage, PdfPageInfo, PdfMetadata, dpiToScale, +3 |

### `src/engine/pdf/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `PDFRenderer.spec.ts` | PDFRenderer — Phase 14.E tests. | — |

### `src/engine/roofing/`

| File | Purpose | Exports |
|------|---------|---------|
| `calcEngine.ts` | Roofing Calculation Engine — Phase 14.R.0. | RoofSectionLike, slopeFactor, hipValleyFactor, hipValleyPlanFactor, +29 |
| `materialCatalog.ts` | Material Catalog — Phase 14.R.2. | MaterialUnit, MaterialEntry, parseCsv, buildCatalog, +10 |
| `RoofGraph.ts` | Roof Graph Model — Phase 14.R.1. | RoofType, SectionType, RoofView, EdgeType, +76 |

### `src/engine/roofing/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `calcEngine.spec.ts` | Roofing calc engine — Phase 14.R.0. | — |
| `materialCatalog.spec.ts` | Material Catalog — Phase 14.R.2. | — |
| `RoofGraph.spec.ts` | RoofGraph — Phase 14.R.1. | — |

### `src/engine/roofing/fl/`

| File | Purpose | Exports |
|------|---------|---------|
| `aggregate.ts` | Aggregate Estimator — Phase 14.R.6. | sectionMeanHeightFt, equivalentRectangle, roofHeightOffsetAboveEave, projectForSection, +8 |
| `core.ts` | fl_roofing.core — Phase 14.R.F.1. | Confidence, worstConfidence, RoofTypeFL, RoofComplexity, +34 |
| `data.ts` | fl_roofing.data — Phase 14.R.F.2. | WindZoneRow, loadWindZones, allWindZones, SheathingSourceConfidence, +12 |
| `estimator.ts` | fl_roofing.estimator — Phase 14.R.F.3. | resolveWind, computeZones, resolveSheathing, estimate |
| `integrity.ts` | fl_roofing.integrity — Phase 14.R.F.4. | CheckResult, IntegrityReport, checkCountyCount, checkUniqueCountyNames, +8 |

### `src/engine/roofing/fl/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `aggregate.spec.ts` | aggregate.ts — Phase 14.R.6 tests. | — |
| `flRoofing.spec.ts` | fl_roofing — Phase 14.R.F. | — |

### `src/engine/solver/`

| File | Purpose | Exports |
|------|---------|---------|
| `DFUAccumulator.ts` | DFU Accumulator — drainage fixture unit summation per IPC. | DFUResult, accumulateDFU, WSFUResult, accumulateWSFU |
| `PipeSizer.ts` | Pipe Sizer — auto-sizes pipe diameters from accumulated DFU/WSFU. | SizingResult, sizeAllPipes |
| `PressureDropCalculator.ts` | Pressure Drop Calculator — Darcy-Weisbach per-edge pressure loss. | wsfuToGPM, dfuToGPM, PressureResult, calculateEdgePressureDrop, +2 |
| `PropagationSolver.ts` | Propagation Solver — multi-pass orchestrator. | SolveResult, solve |

### `src/engine/underlay/`

| File | Purpose | Exports |
|------|---------|---------|
| `dxfLoader.ts` | dxfLoader — Phase 14.R.25. | DxfEntity, ParsedDxf, isDxfFile, parseDxf, +5 |
| `imageLoader.ts` | imageLoader — Phase 14.R.24. | isImageFile, LoadedImage, loadImageFile |

### `src/engine/underlay/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `dxfLoader.spec.ts` | dxfLoader — Phase 14.R.25 tests. | — |
| `imageLoader.spec.ts` | imageLoader — Phase 14.R.24 tests. | — |

### `src/engine/worker/`

| File | Purpose | Exports |
|------|---------|---------|
| `mutationBatching.ts` | Mutation Batching — Phase 14.AC.3 | Vec3, PipeCommit, FixtureCommit, GraphMutationBatch, +9 |
| `rehydrateWorkerGraph.ts` | rehydrateWorkerGraph — Phase 14.AC.8 | rehydrateWorkerGraph |
| `SharedDagBuffer.ts` | SharedDagBuffer — zero-copy main↔worker DAG transport via SharedArrayBuffer. | NODE_TYPE, NodeTypeStr, SYSTEM_TYPE, SystemTypeStr, +18 |
| `simulation.worker.ts` | Simulation Web Worker — runs the headless solver off the main thread. | — |
| `SimulationBridge.ts` | Simulation Bridge — relays messages between the main-thread EventBus / SimulationMessageBus and the … | SimulationBridge, getSimulationBridge |

### `src/engine/worker/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `fixtureGraphWiring.spec.ts` | Fixture Graph Wiring — Phase 14.AC.6 tests. | — |
| `fixtureMove.spec.ts` | Fixture Move — Phase 14.AC.11 tests. | — |
| `fixtureProximityConnection.spec.ts` | Fixture → Pipe Proximity Connection — Phase 14.AC.7 tests. | — |
| `mutationBatching.spec.ts` | mutationBatching — Phase 14.AC.3 tests. | — |
| `rehydrateWorkerGraph.spec.ts` | Rehydrate Worker Graph — Phase 14.AC.8 tests. | — |
| `SharedDagBuffer.spec.ts` | SharedDagBuffer — Phase 3 acceptance + benchmark. | — |
| `simulationBridge.batch.spec.ts` | SimulationBridge — Phase 14.AC.3 batching behaviour. | — |

### `src/hooks/`

| File | Purpose | Exports |
|------|---------|---------|
| `useEventBus.ts` | React hook for subscribing to EventBus channels. | useEvent, useEventState, useEmit |
| `useFSM.ts` | React hook that binds a FSM instance to component state. | useFSM |
| `useRafEvent.ts` | useRafEvent — requestAnimationFrame-coalesced event subscription. | useRafEvent |

### `src/hooks/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `useRafEvent.spec.ts` | useRafEvent — Phase 14.AC.1 tests. | — |

### `src/store/`

| File | Purpose | Exports |
|------|---------|---------|
| `appModeStore.ts` | appModeStore — Phase 14.R.3. | AppMode, AppModeState, useAppModeStore, APP_MODE_LABELS, +3 |
| `backdropStore.ts` | BackdropStore — raster blueprints pinned into the 3D scene as reference images for tracing. | Backdrop, useBackdropStore, uploadBackdropFile, rotateActiveFloorBackdropsToLevel, +1 |
| `cappedEndpointStore.ts` | cappedEndpointStore — orphaned pipe endpoints that should render a visible cap + retaining ring (Cap… | CappedEndpoint, useCappedEndpointStore |
| `contractorProfileStore.ts` | contractorProfileStore — the contractor's own identity info for proposal title blocks. | PLACEHOLDER_COMPANY, DEFAULT_CONTRACTOR_PROFILE, useContractorProfileStore, getActiveContractorProfile |
| `customerStore.ts` | CustomerStore — high-level assembly profiles. | ConstructionPhase, PHASE_LABELS, PHASE_COLORS, PHASE_ORDER, +8 |
| `drawFeedbackStore.ts` | drawFeedbackStore — single source of truth for the state the drawing/editing feedback layer reads. | SnapKind, SnapTarget, NextAction, useDrawFeedbackStore |
| `featureFlagStore.ts` | Feature Flag Store — one place for kill-switches and graduating features. | FeatureFlags, useFeatureFlagStore, getFlag |
| `fixtureEditorStore.ts` | FixtureEditorStore — transient workbench state for the visual editor. | EditorView, useFixtureEditorStore |
| `fixtureInspectorStore.ts` | fixtureInspectorStore — Phase 14.F | InspectorMode, useFixtureInspectorStore |
| `fixtureStore.ts` | FixtureStore — single source of truth for placed fixtures + their parameters. | FixtureInstance, useFixtureStore, getSchema |
| `floorStore.ts` | FloorStore — multi-story building state. | FloorVisibilityMode, Floor, useFloorStore, FloorRenderParams, +3 |
| `manifoldStore.ts` | manifoldStore — Zustand store for PEX manifold entities. | useManifoldStore |
| `measureStore.ts` | MeasureStore — ruler measurements + scale calibration. | Vec3, Measurement, MeasureMode, useMeasureStore |
| `onboardingStore.ts` | onboardingStore — first-run coach-mark walkthrough state. | OnboardingState, useOnboardingStore, shouldShowOnFirstLaunch, currentStep |
| `pipeConnectivityStore.ts` | pipeConnectivityStore — which pipe endpoints touch which. | JOIN_EPSILON_FT, POS_DECIMALS, EndpointSide, IncidenceSource, +3 |
| `pipeStore.ts` | Pipe Store — Zustand single source of truth for committed pipes. | DIAMETER_COLORS, getColorForDiameter, CommittedPipe, PivotSession, +2 |
| `plumbingAssemblyTemplateStore.ts` | plumbingAssemblyTemplateStore — Phase 14.C | usePlumbingAssemblyTemplateStore, getActiveTemplates |
| `plumbingClipboardStore.ts` | plumbingClipboardStore — Phase 14.P | usePlumbingClipboardStore |
| `plumbingComplianceStore.ts` | plumbingComplianceStore — holds the most recent plumbing compliance traces keyed by the entity (pipe… | TracedViolation, usePlumbingComplianceStore, bootPlumbingComplianceStore |
| `plumbingDrawStore.ts` | Plumbing Draw Store — mode system + draw state + settings for the plumbing viewport. | InteractionMode, DrawPlane, PipeRenderQuality, usePlumbingDrawStore |
| `plumbingLayerStore.ts` | plumbingLayerStore — Zustand store for plumbing-system visibility toggles. | LayerState, SYSTEM_COLORS, SYSTEM_LABELS, SYSTEM_KEYS, +2 |
| `plumbingMultiSelectStore.ts` | plumbingMultiSelectStore — Phase 14.I | usePlumbingMultiSelectStore |
| `plumbingPhaseStore.ts` | plumbingPhaseStore — plumbing construction phase filter and per-item overrides. | usePlumbingPhaseStore, usePhaseFilter |
| `pricingStore.ts` | pricingStore — active pricing profile for bid generation. | usePricingStore, getActivePricingProfile, __testables |
| `proposalRevisionStore.ts` | proposalRevisionStore — Phase 14.G | useProposalRevisionStore, getActiveRevisions |
| `radialMenuStore.ts` | RadialMenuStore — Zustand store governing all radial wheel state. | WheelId, SectorSelection, WheelMemory, TrailSample, +3 |
| `renderModeStore.ts` | renderModeStore — Sims-style wall-visibility mode. | RenderMode, RenderModeState, useRenderModeStore, RENDER_MODE_LABELS, +2 |
| `roofingAxisDragStore.ts` | roofingAxisDragStore — Phase 14.R.23. | GroundPoint, AxisDragMode, AxisDragState, useRoofingAxisDragStore |
| `roofingCalibrationStore.ts` | roofingCalibrationStore — Phase 14.R.5. | GroundPoint, PdfCalibMode, PdfCalibState, useRoofingCalibrationStore |
| `roofingDragStore.ts` | roofingDragStore — Phase 14.R.8. | GroundPoint, SectionDragMode, SectionDragState, useRoofingDragStore, +1 |
| `roofingDrawStore.ts` | roofingDrawStore — Phase 14.R.4. | GroundPoint, RoofingDrawMode, RoofingDrawState, useRoofingDrawStore, +3 |
| `roofingProjectStore.ts` | roofingProjectStore — Phase 14.R.3. | RoofingProjectInput, RoofingProjectState, useRoofingProjectStore, selectProject, +2 |
| `roofingRotationDragStore.ts` | roofingRotationDragStore — Phase 14.R.19. | GroundPoint, RotationDragMode, RotationDragState, useRoofingRotationDragStore, +2 |
| `roofingScopeStore.ts` | roofingScopeStore — Phase 14.R.6. | EstimateScope, EstimateScopeState, useRoofingScopeStore, __testables |
| `roofingVertexDragStore.ts` | roofingVertexDragStore — Phase 14.R.18. | GroundPoint, VertexDragMode, VertexDragState, useRoofingVertexDragStore |
| `roofStore.ts` | Roof Store — Phase 14.R.1. | useRoofStore, selectSectionsArray, selectTotalAreaNet, selectTotalAreaPlan, +3 |
| `wallStore.ts` | WallStore — structural wall segments acting as spatial constraints. | WallType, Wall, WALL_TYPE_META, WallDrawSession, +2 |

### `src/store/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `appModeStore.spec.ts` | appModeStore — Phase 14.R.3 tests. | — |
| `drawInput.spec.ts` | drawInput — Phase 14.S tests for the draw-point store actions. | — |
| `insertAnchor.spec.ts` | pipeStore.insertAnchor + pipe.insertAnchor command — Phase 7.A tests. | — |
| `onboardingStore.spec.ts` | onboardingStore — Phase 10.F tests. | — |
| `plumbingMultiSelectStore.spec.ts` | plumbingMultiSelectStore — Phase 14.I tests. | — |
| `renderModeStore.spec.ts` | renderModeStore — Phase 12.A tests. | — |
| `roofingAxisDragStore.spec.ts` | roofingAxisDragStore — Phase 14.R.23 tests. | — |
| `roofingCalibrationStore.spec.ts` | roofingCalibrationStore — Phase 14.R.5 tests. | — |
| `roofingDragStore.spec.ts` | roofingDragStore — Phase 14.R.8 tests. | — |
| `roofingDrawStore.spec.ts` | roofingDrawStore — Phase 14.R.4 tests. | — |
| `roofingProjectStore.spec.ts` | roofingProjectStore — Phase 14.R.3 tests. | — |
| `roofingRotationDragStore.spec.ts` | roofingRotationDragStore — Phase 14.R.19 tests. | — |
| `roofingScopeStore.spec.ts` | roofingScopeStore — Phase 14.R.6 tests. | — |
| `roofingVertexDragStore.spec.ts` | roofingVertexDragStore — Phase 14.R.18 tests. | — |
| `roofStore.spec.ts` | roofStore — Phase 14.R.1. | — |

### `src/ui/`

| File | Purpose | Exports |
|------|---------|---------|
| `AutoRouteUI.tsx` | AutoRouteUI — click-two-fixtures interaction for automatic routing. | AutoRoutePhase, AutoRouteGuide, AutoRouteHUD, useAutoRoute |
| `ErrorBoundary.tsx` | ErrorBoundary — catches render-time exceptions in a React subtree and shows a compact recovery UI in… | ErrorBoundaryProps, ErrorBoundary |
| `ExportPanel.tsx` | Export Panel — HUD with IFC, BOM, and CSV export buttons. | ExportPanel |
| `FeedbackOverlay.tsx` | FeedbackOverlay — 2D HUD layer rendered on top of the 3D canvas. | FeedbackOverlay |
| `HelpOverlay.tsx` | HelpOverlay — keyboard shortcut reference. | HelpOverlay |
| `InterferenceVisualizer.tsx` | Interference Visualizer — R3F component showing collision feedback. | InterferenceVisualizer |
| `KeyboardHandler.tsx` | KeyboardHandler — window-level keyboard dispatcher for the shared app shell. | handleKeyboardEvent, KeyboardHandler |
| `LayerPanel.tsx` | LayerPanel — HUD with toggle buttons per plumbing system. | LayerPanel |
| `ModeTabs.tsx` | ModeTabs — Phase 14.R.3. | ModeTabs |
| `NavStatusChip.tsx` | NavStatusChip — compact top-center status indicator. | NavStatusChip |
| `PerceptualBalanceLayer.tsx` | Perceptual Balance Layer — R3F component that applies the adaptive render profile to the Three.js sc… | PerceptualBalanceLayer, AmbientParticles |
| `PipeInspector.tsx` | PipeInspector — 2D HUD panel showing properties of the selected pipe. | PipeInspector |
| `PipeRenderer.tsx` | PipeRenderer — two quality modes:   3D   → full TubeGeometry for every pipe (thick, smooth, realisti… | PipeRenderer |
| `ProjectPanel.tsx` | Project Panel — HUD with save/load/new/export controls. | ProjectPanel |
| `RouteGhostPreview.tsx` | RouteGhostPreview — 3D translucent pipe previews for HILO candidates. | RouteGhostPreview |
| `RouteSuggestionPanel.tsx` | RouteSuggestionPanel — 2D HUD panel showing HILO route options. | RouteSuggestionPanel |
| `SensoryFeedback.tsx` | Sensory Feedback — R3F components that react to EventBus signals. | GlowRing, CollisionFlash, SnapBurst, CompletePulse |
| `SessionHealthOverlay.tsx` | Session Health Overlay — compact HUD showing engagement zone, fatigue level, session health score, a… | SessionHealthOverlay |
| `StatusBar.tsx` | StatusBar — bottom-of-screen bar showing current mode, shortcuts, and draw state. | StatusBar |
| `Toolbar.tsx` | Toolbar — polished left-side panel with:   Mode switcher (Navigate / Draw / Select)   Draw plane tog… | Toolbar |
| `UpdateManager.tsx` | UpdateManager — in-app auto-update UI. | UpdateManager |
| `XROverlay.tsx` | XR Overlay — world-space HUD panels for immersive mode. | WorldPanel, CognitiveLoadBar, VRToggleButton, AdaptiveHints |

### `src/ui/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `HelpOverlay.spec.tsx` | HelpOverlay — Phase 9 (ARCHITECTURE.md §6) mode-filter tests. | — |
| `KeyboardHandler.spec.tsx` | KeyboardHandler — Phase 2a (ARCHITECTURE.md §4.1) tests. | — |

### `src/ui/backdrop/`

| File | Purpose | Exports |
|------|---------|---------|
| `BackdropPlane.tsx` | BackdropPlane — renders each uploaded blueprint image as a textured plane slightly below the active … | BackdropLayer |
| `PdfPagePicker.tsx` | PdfPagePicker — Phase 14.E | PdfPickChoice, PdfPagePickerProps, PdfPagePicker |

### `src/ui/cameras/`

| File | Purpose | Exports |
|------|---------|---------|
| `IsoCamera.tsx` | IsoCamera — mathematically-exact isometric orthographic projection with smooth perspective↔orthograp… | CameraViewMode, ISO_TILT_EXACT, ISO_TILT_DEG, useIsoCameraStore, +2 |
| `SpringArmController.tsx` | SpringArmController — runtime spring-arm camera boom. | SpringArmController |

### `src/ui/compliance/`

| File | Purpose | Exports |
|------|---------|---------|
| `TrapCleanoutPanel.tsx` | TrapCleanoutPanel — Phase 14.D Extended in Phase 14.H to also show hanger/support compliance. | TrapCleanoutPanel |

### `src/ui/customers/`

| File | Purpose | Exports |
|------|---------|---------|
| `CustomerBadge.tsx` | CustomerBadge — persistent HUD chip showing the active customer, project status, and one-click acces… | CustomerBadge |
| `CustomerManager.tsx` | CustomerManager — full-screen modal for managing customer records. | CustomerManager |
| `CustomerPhaseSchedule.tsx` | CustomerPhaseSchedule — per-phase schedule widget for a customer. | CustomerPhaseSchedule |
| `FixtureTemplateEditor.tsx` | FixtureTemplateEditor — per-customer fixture template editor. | FixtureTemplateEditor |
| `useCustomerShortcuts.ts` | useCustomerShortcuts — keyboard bindings for customer management. | CUSTOMER_MANAGER_EVENT, useCustomerShortcuts |

### `src/ui/debug/`

| File | Purpose | Exports |
|------|---------|---------|
| `ComplianceDebugger.tsx` | ComplianceDebugger — inference-chain panel for compliance violations. | ComplianceDebugger |
| `GodModeConsole.tsx` | GodModeConsole — slide-up developer panel driven by the CommandBus. | GodModeConsole |
| `PerfHUD.tsx` | PerfHUD — live performance overlay. | PerfHUD |

### `src/ui/draw/`

| File | Purpose | Exports |
|------|---------|---------|
| `CursorBadge.tsx` | CursorBadge — DOM overlay near the cursor showing the current drawing loadout: diameter (color-coded… | CursorBadge |
| `CursorTracker.tsx` | CursorTracker — global pointermove listener that keeps `drawFeedbackStore.cursorClient` in sync with… | CursorTracker |
| `DrawingHintBar.tsx` | DrawingHintBar — bottom-center contextual hint that tells the user what the next click will do. | DrawingHintBar, composeHint |
| `OrthoDragModeBadge.tsx` | OrthoDragModeBadge — Phase 14.AD.27. | OrthoDragModeBadge |
| `OrthoPipeInteraction.tsx` | OrthoPipeInteraction — Phase 14.AD.23. | AnchorKind, classifyAnchorKind, snapToGrid, dist, +5 |

### `src/ui/draw/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `OrthoPipeInteraction.spec.ts` | OrthoPipeInteraction pure helpers — Phase 14.AD.23. | — |

### `src/ui/file/`

| File | Purpose | Exports |
|------|---------|---------|
| `RecentFilesPanel.tsx` | RecentFilesPanel — modal listing recently-saved project bundles, grouped by customer where one is kn… | RecentFilesPanel |

### `src/ui/fixtures/`

| File | Purpose | Exports |
|------|---------|---------|
| `Editor3DView.tsx` | Editor3DView — perspective 3D view with orbit controls showing the fixture model + connection-point … | Editor3DView |
| `EditorElevationView.tsx` | EditorElevationView — side-elevation SVG view of the fixture. | EditorElevationView |
| `EditorTopView.tsx` | EditorTopView — 2D plan view rendered as a single responsive SVG. | EditorTopView |
| `FixtureMiniCard.tsx` | FixtureMiniCard — Phase 14.F | FixtureMiniCard |
| `FixtureModels.tsx` | Fixture Models — parametric 3D shapes replacing the placeholder GlowRings. | FixtureModel, FixtureLayer, FixtureLayerFromStore, FixtureWithSelection |
| `FixtureParamWindow.tsx` | FixtureParamWindow — floating parameter panel for the selected fixture. | FixtureParamWindow |
| `FixturePlacementPreview.tsx` | FixturePlacementPreview — translucent "ghost" model attached to the cursor while a fixture is pendin… | FixturePlacementPreview |
| `FixtureRotationGizmo.tsx` | FixtureRotationGizmo — Phase 14.F | FixtureRotationGizmoProps, FixtureRotationGizmo |
| `FixtureVisualEditor.tsx` | FixtureVisualEditor — full-screen workbench for a fixture's geometry and parameters. See individual … | FixtureVisualEditor |
| `RiserPlacementPanel.tsx` | RiserPlacementPanel — Phase 14.Z | RiserPlacementPanel |
| `useAutoRouteShortcut.ts` | useAutoRouteShortcut — Phase 14.Y.3 | autoRouteSelectedFixture, useAutoRouteShortcut, AutoRouteShortcutBinder |
| `useFixtureRotationShortcuts.ts` | useFixtureRotationShortcuts — Phase 14.E | normalizeDeg, RotationKeyEvent, rotationKeyToDeg, useFixtureRotationShortcuts, +1 |

### `src/ui/fixtures/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `fixtureModelMemo.spec.ts` | FixtureWithSelection memo guard — Phase 14.AD.3. | — |
| `newFixtureModels.spec.ts` | newFixtureModels — Phase 14.Y.2 smoke tests. | — |
| `useFixtureRotationShortcuts.spec.ts` | useFixtureRotationShortcuts — Phase 14.E tests. | — |

### `src/ui/floors/`

| File | Purpose | Exports |
|------|---------|---------|
| `ActiveFloorAutoInfer.tsx` | ActiveFloorAutoInfer — headless component that switches the active floor to match newly-committed pi… | ActiveFloorAutoInfer |
| `FloorPlaneOutlines.tsx` | FloorPlaneOutlines — thin horizontal reference planes at each floor's base elevation. Provides spati… | FloorPlaneOutlines |
| `FloorSelectorRail.tsx` | FloorSelectorRail — vertical right-edge UI for floor switching. | FloorSelectorRail |
| `FloorVisibilityControls.tsx` | FloorVisibilityControls — global floor visibility HUD. | FloorVisibilityControls |
| `useFloorShortcuts.ts` | useFloorShortcuts — keyboard integration for floor switching. | useFloorShortcuts |

### `src/ui/manifold/`

| File | Purpose | Exports |
|------|---------|---------|
| `ManifoldPlacement.tsx` | ManifoldPlacement — Phase 7.C.ii. | beginManifoldPlacement, cancelManifoldPlacement, isManifoldPlacementActive, ManifoldPlacement |
| `ManifoldRenderer.tsx` | ManifoldRenderer — 3D renderer + drag handler for PEX manifolds. | ManifoldRenderer |

### `src/ui/measure/`

| File | Purpose | Exports |
|------|---------|---------|
| `MeasureToolbar.tsx` | MeasureToolbar — horizontal HUD with all Phase 2.G tools: | MeasureToolbar |
| `RulerTool.tsx` | RulerTool — in-scene click-click measurement tool. | RulerCatcher, MeasurementLines, ScaleCalibratorDialog |
| `useMeasureShortcuts.ts` | useMeasureShortcuts — keyboard bindings for Phase 2.G tools. | useMeasureShortcuts |

### `src/ui/onboarding/`

| File | Purpose | Exports |
|------|---------|---------|
| `CoachMark.tsx` | CoachMark — the floating instructional card. | CoachMark |
| `OnboardingOverlay.tsx` | OnboardingOverlay — orchestrates the first-run walkthrough. | OnboardingOverlay |

### `src/ui/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveQuality.tsx` | AdaptiveQuality — monitors render FPS and adapts expensive settings. | AdaptiveQuality, __testables |
| `bootGpuProbe.ts` | bootGpuProbe — one-shot GPU classification at App boot. | probeGpuAtBoot, isLowSpecGpu, __resetBootGpuProbeForTest |
| `lowSpecDetection.ts` | lowSpecDetection — classify the host GPU from the WebGL renderer string. | GpuTier, GpuProbeResult, probeWebGLContext, classifyRenderer, +2 |
| `PerfSampler.tsx` | PerfSampler — samples `gl.info` every frame and forwards to PerfStats. | PerfSampler |

### `src/ui/perf/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `bootGpuProbe.spec.ts` | bootGpuProbe — Phase 12.D tests. | — |
| `lowSpecDetection.spec.ts` | lowSpecDetection — Phase 12.B tests. | — |

### `src/ui/phase2/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveRenderBridge.tsx` | AdaptiveRenderBridge — wires AdaptiveRenderProfile output into the actual R3F scene parameters in re… | AdaptiveRenderBridge |
| `AutoRouteTrigger.tsx` | AutoRouteTrigger — auto-routes a newly-placed fixture to the nearest existing pipe of matching syste… | AutoRouteTrigger |
| `ComplianceOverlay3D.tsx` | ComplianceOverlay3D — real-time 3D code violation markers. | ComplianceOverlay3D |
| `HydraulicInspector.tsx` | HydraulicInspector — extended pipe inspector showing solver output. | HydraulicInspector |
| `NeuroStatusOrb.tsx` | NeuroStatusOrb — live neuro-adaptive status indicator. | NeuroStatusOrb |
| `SolvePipelineHUD.tsx` | SolvePipelineHUD — live 5-pass simulation pipeline indicator. | SolvePipelineHUD |

### `src/ui/phases/`

| File | Purpose | Exports |
|------|---------|---------|
| `PhaseBOMPanel.tsx` | PhaseBOMPanel — per-phase bill of materials. | PhaseBOMPanel |
| `PhaseSelectorBar.tsx` | PhaseSelectorBar — top-center horizontal HUD for choosing the active construction phase and visibili… | PhaseSelectorBar |
| `usePhaseShortcuts.ts` | usePhaseShortcuts — keyboard bindings for construction-phase navigation. | usePhaseShortcuts |

### `src/ui/pipe/`

| File | Purpose | Exports |
|------|---------|---------|
| `buildPipeGeometry.ts` | buildPipeGeometry — Phase 14.AD.4 | PipeGeometryBundle, BuildPipeGeometryInput, buildPipeGeometry |
| `CappedEndpoints.tsx` | CappedEndpoints — renders a `CapPlug` for every record in the `cappedEndpointStore`. | CappedEndpoints |
| `CapPlug.tsx` | CapPlug — NPT-style pipe cap with the characteristic outer retaining ring. Used to mark an endpoint … | CapPlugProps, CapPlug |
| `DimensionHelpers.tsx` | DimensionHelpers — 3D text annotations on selected pipes. | DimensionHelpers, PitchIndicators |
| `EndpointExtender.tsx` | EndpointExtender — QuickPlumb-style drag-from-endpoint extension. | EndpointExtender |
| `ExtendSession.ts` | ExtendSession — module-local singleton tracking an in-flight pipe extension drag. | ExtendOrigin, ExtendSession, MIN_EXTEND_LENGTH_FT, getActiveExtendSession, +6 |
| `FittingGenerator.ts` | FittingGenerator — analyzes the committed pipe network and emits a list of fittings to render + pric… | FittingInstance, generateBendFittings, generateJunctionFittings, generateFlexibleBendWarnings, +1 |
| `FittingMeshes.tsx` | FittingMeshes — renders auto-generated fittings using InstancedMesh. | getElbow90Geo, getPexElbow90Geo, getElbow45Geo, getBend22_5Geo, +3 |
| `geometryHash.ts` | Geometry Hash — Phase 14.AD.13.a | hashBufferGeometry, DimensionalFingerprint, fingerprintBufferGeometry, hashSegmentInstances, +5 |
| `junctionRetraction.ts` | Junction retraction — Phase 14.AD.21. | RetractionHint, JUNCTION_RETRACTION_TOL_FT, computeJunctionHints |
| `LiveFittings.tsx` | LiveFittings — Phase 14.Q | LiveFittings |
| `LiveRoutePreview.tsx` | LiveRoutePreview — shows a solid pipe growing in real-time as the user drags to create a route. | LiveRoutePreview |
| `PipeCollisionMarkers.tsx` | PipeCollisionMarkers — Phase 14.X | PipeCollisionMarkers |
| `PipeHitboxes.tsx` | PipeHitboxes — dual-zone click detection per pipe. | PipeHitboxes |
| `PipeMaterial.ts` | Pipe Material Factory — cached MeshStandardMaterial per (material × system × diameter × variant). | getPipeMaterial, getSelectedPipeMaterial, getWallShellMaterial, getPreviewMaterial, +2 |
| `PivotPreview.tsx` | PivotPreview — live visual feedback during pipe pivot. | PivotPreview |

### `src/ui/pipe/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `buildPipeGeometry.spec.ts` | buildPipeGeometry — Phase 14.AD.4 regression tests. | — |
| `couplingAndBushing.spec.ts` | Coupling orientation + bushing catalog + bushing auto-emitter — Phases 14.AD.11, 14.AD.12, 14.AD.16. | — |
| `FittingGenerator.spec.ts` | FittingGenerator — Phase 13.A audit tests. | — |
| `fittingGeometrySnapshot.spec.ts` | Fitting geometry snapshot harness — Phase 14.AD.13.c | — |
| `geometryHash.spec.ts` | geometryHash primitive — Phase 14.AD.13.a tests. | — |
| `junctionElbow.spec.ts` | Junction elbow emission — Phase 14.AD.5. | — |
| `materialSnapshot.spec.ts` | Material property snapshot — Phase 14.AD.18. | — |
| `pipeGeometrySnapshot.spec.ts` | Pipe geometry snapshot harness — Phase 14.AD.13.b | — |

### `src/ui/pipe/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `GeometryBatcher.ts` | Geometry Batcher — merges pipe geometries per diameter bucket per spatial cell to minimize draw call… | spatialCellKey, BatchGroup, GeometryBatcher, mergeGeometries |
| `LODController.ts` | LOD Controller — distance-based level-of-detail for pipes. | LODLevel, LODThresholds, LODGeometryParams, LODController |
| `PerformanceMonitor.tsx` | Performance Monitor — FPS counter + pipe count HUD overlay. | PerformanceMonitor |
| `PipeInstanceRenderer.tsx` | Pipe Instance Renderer — InstancedMesh for straight pipe segments. | PipeInstanceRenderer |
| `pointsKey.ts` | pointsKey — stable value hash for a Vec3-like polyline. | Vec3Tuple, pointsKey |
| `segmentExtractCache.ts` | Segment Extract Cache — Phase 14.AC.2 | SegmentInstance, JunctionHints, ExtractContext, PipeEntry, +2 |
| `StagedGeometryQueue.ts` | Staged Geometry Queue — spreads geometry rebuilds across frames to prevent frame spikes. | RebuildRequest, StagedGeometryQueue, computePriority |

### `src/ui/pipe/perf/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `pointsKey.spec.ts` | pointsKey — Phase 14.AC.1 tests. | — |
| `segmentExtractCache.spec.ts` | segmentExtractCache — Phase 14.AC.2 tests. | — |
| `segmentInstanceSnapshot.spec.ts` | segmentInstance snapshot — Phase 14.AD.17. | — |

### `src/ui/pricing/`

| File | Purpose | Exports |
|------|---------|---------|
| `PricingProfilePanel.tsx` | PricingProfilePanel — editor for the active pricing profile. | PricingProfilePanel |

### `src/ui/print/`

| File | Purpose | Exports |
|------|---------|---------|
| `ContractorProfilePanel.tsx` | ContractorProfilePanel — editor for the contractor's identity info that appears in proposal title bl… | ContractorProfilePanel |
| `PrintableBidPackage.tsx` | PrintableBidPackage — Phase 14.AA.2 | PrintableBidPackage |
| `PrintableChangeOrder.tsx` | PrintableChangeOrder — Phase 14.G | PrintableChangeOrder |
| `PrintableProposal.tsx` | PrintableProposal — the DOM the browser prints to PDF. | PrintableProposal |
| `RevisionComparePanel.tsx` | RevisionComparePanel — Phase 14.G | RevisionComparePanel |

### `src/ui/radial/`

| File | Purpose | Exports |
|------|---------|---------|
| `FisheyeDeformer.ts` | FisheyeDeformer — angular deformation of radial menu sectors. | BaseSector, DeformedSector, FisheyeConfig, DEFAULT_FISHEYE_CONFIG, +4 |
| `RadialMenu.tsx` | RadialMenu — futuristic radial menu with mouse-following sector expansion. | WheelSector, SectorSubtype, WheelConfig, RadialMenu |
| `RadialMenuAudio.ts` | Radial menu audio feedback — synthesized tones via Web Audio API. | radialAudio |
| `SectorPredictor.ts` | SectorPredictor — "where is the cursor headed?" heuristic for the radial menu. | Sample, BaseSector, PredictArgs, SectorPredictor, +1 |
| `usePrefersReducedMotion.ts` | usePrefersReducedMotion — kept as a thin re-export during the Phase 10.C rollout so RadialMenu (Phas… | usePrefersReducedMotion |
| `WheelCornerIcons.tsx` | WheelCornerIcons — persistent corner-anchored access points for the three weapon wheels. | WheelCornerIcons |
| `WheelHolographics.tsx` | WheelHolographics — sci-fi SVG overlay effects for the radial menu. | HolographicsProps, WheelHolographics |
| `WheelParticles.tsx` | WheelParticles — canvas-based particle emitter for radial menus. | WheelParticlesHandle, WheelParticles |

### `src/ui/radial/__tests__/`

| File | Purpose | Exports |
|------|---------|---------|
| `SectorPredictor.spec.ts` | SectorPredictor — Phase 5 acceptance tests. | — |

### `src/ui/radial/wheels/`

| File | Purpose | Exports |
|------|---------|---------|
| `DrawingWheel.tsx` | DRAWING Wheel — CTRL+SPACE activates this wheel. | getDrawingWheelConfig, DrawingWheel |
| `FixtureWheel.tsx` | FIXTURE Wheel — CTRL+F activates this wheel. | getFixtureWheelConfig, FixtureWheel, CustomerEditWheel |

### `src/ui/roofing/`

| File | Purpose | Exports |
|------|---------|---------|
| `AxisRotationGizmo.tsx` | AxisRotationGizmo — Phase 14.R.23. | AxisRotationGizmo |
| `DraftPolygonPreview.tsx` | DraftPolygonPreview — Phase 14.R.9. | DraftPolygonPreview |
| `DraftRectanglePreview.tsx` | DraftRectanglePreview — Phase 14.R.4. | DraftRectanglePreview |
| `EstimateScopeToggle.tsx` | EstimateScopeToggle — Phase 14.R.6. | EstimateScopeToggle |
| `PDFCalibrationInteraction.tsx` | PDFCalibrationInteraction — Phase 14.R.5. | PDFCalibrationInteraction |
| `PolygonVertexHandles.tsx` | PolygonVertexHandles — Phase 14.R.18. | PolygonVertexHandles |
| `RoofAxisOverrideControl.tsx` | RoofAxisOverrideControl — Phase 14.R.20. | RoofAxisOverrideControl |
| `RoofingDrawInteraction.tsx` | RoofingDrawInteraction — Phase 14.R.4 / R.9. | RoofingDrawInteraction |
| `RoofingInspector.tsx` | RoofingInspector — Phase 14.R.3. | RoofingInspector |
| `RoofingPdfPagePicker.tsx` | RoofingPdfPagePicker — Phase 14.R.24. | RoofingPdfPickChoice, RoofingPdfPagePickerProps, RoofingPdfPagePicker |
| `RoofingPDFPanel.tsx` | RoofingPDFPanel — Phase 14.R.5 / R.24. | RoofingPDFPanel |
| `RoofingPDFPlane.tsx` | RoofingPDFPlane — Phase 14.R.5. | RoofingPDFPlane |
| `RoofingRotationKeyHandler.tsx` | RoofingRotationKeyHandler — Phase 14.R.19. | RoofingRotationKeyHandler |
| `RoofingToolbar.tsx` | RoofingToolbar — Phase 14.R.4. | RoofingToolbar |
| `RoofPenetrations3D.tsx` | RoofPenetrations3D — Phase 14.R.27. | RoofPenetrations3D |
| `RoofSection3D.tsx` | RoofSection3D — Phase 14.R.4. | SECTION_PALETTE, EDGE_COLORS, RoofSection3D |
| `RoofSectionsLayer.tsx` | RoofSectionsLayer — Phase 14.R.4. | RoofSectionsLayer |
| `RotationGizmo.tsx` | RotationGizmo — Phase 14.R.19. | RotationGizmo |
| `SectionDragInteraction.tsx` | SectionDragInteraction — Phase 14.R.8. | SectionDragInteraction |
| `SectionsPanel.tsx` | SectionsPanel — Phase 14.R.4. | SectionsPanel |
| `VertexDragInteraction.tsx` | VertexDragInteraction — Phase 14.R.18. | VertexDragInteraction |

### `src/ui/selection/`

| File | Purpose | Exports |
|------|---------|---------|
| `BoxSelectOverlay.tsx` | BoxSelectOverlay — Phase 14.M | CameraMatrixSnooper, BoxSelectOverlay |
| `GroupRotationGizmo.tsx` | GroupRotationGizmo — Phase 14.M | GroupRotationGizmo |
| `GroupTranslateGizmo.tsx` | GroupTranslateGizmo — Phase 14.O | GroupTranslateGizmo |
| `MassEditPanel.tsx` | MassEditPanel — Phase 14.N | MassEditPanel |
| `SelectionCountBadge.tsx` | SelectionCountBadge — Phase 14.M | SelectionCountBadge |
| `useGroupTranslateShortcuts.ts` | useGroupTranslateShortcuts — Phase 14.O | arrowKeyToDelta, useGroupTranslateShortcuts, GroupTranslateShortcutsBinder |
| `useSelectionClipboardShortcuts.ts` | useSelectionClipboardShortcuts — Phase 14.P | copySelectionToClipboard, pasteFromClipboard, duplicateSelection, useSelectionClipboardShortcuts, +1 |

### `src/ui/sync/`

| File | Purpose | Exports |
|------|---------|---------|
| `LibraryExportImportPanel.tsx` | LibraryExportImportPanel — Phase 14.J | LibraryExportImportPanel |

### `src/ui/templates/`

| File | Purpose | Exports |
|------|---------|---------|
| `AssemblyTemplatesPanel.tsx` | AssemblyTemplatesPanel — Phase 14.C | AssemblyTemplatesPanel |

### `src/ui/walls/`

| File | Purpose | Exports |
|------|---------|---------|
| `InstancedWallMeshes.tsx` | InstancedWallMeshes — batched wall rendering. | InstancedWallMeshes, BucketInstancedMesh, BucketEdges, SelectedWallHighlight |
| `useCutawaySet.ts` | useCutawaySet — derive the dim-this-wall set every frame. | useCutawaySet |
| `WallRenderer.tsx` | WallRenderer — batched wall rendering + click-click draw tool. | WallRenderer |


---


_Generated by `tools/generate-reference.cjs` on 2026-04-23T12:19:22.866Z_
