# ELBOW GREASE — Codebase Reference

> **Auto-generated** from `src/` after every edit. Do not hand-edit.
> Last regenerated: 2026-04-17T23:31:43.886Z

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

Total TypeScript/TSX files: **164**

### `src/`

| File | Purpose | Exports |
|------|---------|---------|
| `App.tsx` | ELBOW GREASE — Plumbing CAD | App |
| `main.tsx` | — | — |

### `src/core/`

| File | Purpose | Exports |
|------|---------|---------|
| `CueRoutineReward.ts` | Cue → Routine → Reward feedback loop manager. | bootFeedbackLoop |
| `EventBus.ts` | Decoupled Observer / Pub-Sub event system. | eventBus |
| `events.ts` | Canonical event names and their payload shapes. | Vec3, EV, EventName, PipeDragStartPayload, +10 |
| `FSM.ts` | Generic Finite State Machine. | TransitionTarget, TransitionMap, StateNode, FSMConfig, +1 |
| `UserProgressFSM.ts` | User Progress FSM — models the user's real-time interaction state. | UserState, UserEvent, userFSM |

### `src/core/customers/`

| File | Purpose | Exports |
|------|---------|---------|
| `CustomerTypes.ts` | CustomerTypes — contractor client-management taxonomy. | ClientContact, SiteAddress, ProjectType, PROJECT_TYPE_META, +8 |

### `src/core/fixtures/`

| File | Purpose | Exports |
|------|---------|---------|
| `ConnectionPoints.ts` | ConnectionPoints — per-subtype drain/supply anchor geometry. | ConnectionPoint, FixtureFootprint, FixtureGeometry, getFixtureGeometry, +2 |
| `FixtureDiagnostics.ts` | FixtureDiagnostics — live rule checks on staged fixture params. | Severity, Diagnostic, diagnoseFixture, highestSeverity |
| `FixtureParams.ts` | FixtureParams — per-fixture parameter schemas, defaults, and validation. | NumberField, SelectField, ToggleField, RangeField, +9 |
| `FixturePresets.ts` | FixturePresets — named parameter bundles users can apply with one click. | Preset, PRESETS, getPresetsFor |

### `src/core/floor/`

| File | Purpose | Exports |
|------|---------|---------|
| `FloorResolver.ts` | FloorResolver — pure helpers for mapping geometry to floors. | resolveFloorForPoint, rangeOverlapsFloor, pointOverlapsFloor, segmentOverlapsFloor, +11 |

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

### `src/core/input/`

| File | Purpose | Exports |
|------|---------|---------|
| `ChordDetector.ts` | ChordDetector — multi-key chord detection with hold durations and partial-chord visualization. | ChordAction, HoldChord, SequenceChord, TapChord, +4 |

### `src/core/interference/`

| File | Purpose | Exports |
|------|---------|---------|
| `ClearanceEnforcer.ts` | Clearance Enforcer — validates minimum separation between pipes and structural elements, and between… | ClearanceViolation, enforceClearances |
| `CollisionPredictor.ts` | Collision Predictor — real-time sweep test on route preview. | SegmentStatus, SegmentCollision, CollisionPrediction, predictCollisions |
| `StructuralElements.ts` | Structural Elements — typed obstacle catalog for the building. | StructuralType, ClearanceRule, CLEARANCE_RULES, StructuralElement, +7 |

### `src/core/neuro/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveRenderProfile.ts` | Adaptive Render Profile — dynamic visual intensity scaling. | RenderProfile, PROFILE_EV, AdaptiveRenderProfileManager, renderProfile |
| `EngagementMetrics.ts` | Engagement Metrics — perceptual engagement tracker inspired by EEG beta/theta rhythm research. | ENGAGE_EV, EngagementZone, EngagementState, EngagementTracker, +1 |
| `SessionHealthMonitor.ts` | Session Health Monitor — aggregates engagement, fatigue, and cognitive load into a single session he… | HEALTH_EV, PerformanceTrend, SessionHealth, SessionHealthMonitor, +1 |
| `VisualFatigueGuard.ts` | Visual Fatigue Guard — prevents overstimulation during long sessions. | FATIGUE_EV, FatigueLevel, FatigueState, VisualFatigueGuard, +1 |

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

### `src/core/phases/`

| File | Purpose | Exports |
|------|---------|---------|
| `PhaseClassifier.ts` | PhaseClassifier — determines which construction phase a given object belongs to, using geometry + sy… | classifyPipe, classifyFixture |
| `PhaseTypes.ts` | PhaseTypes — construction-phase taxonomy for plumbing work. | ConstructionPhase, PHASE_ORDER, PhaseMeta, PHASE_META, +3 |

### `src/core/pipe/`

| File | Purpose | Exports |
|------|---------|---------|
| `FittingCatalog.ts` | FittingCatalog — what fittings are legal per material, at what sizes, and what they cost. | FittingDef, FITTING_CATALOG, FITTING_PRICE_USD, getFittingPrice, +7 |
| `PipeSizeSpec.ts` | PipeSizeSpec — real-world outer/inner diameter tables per material. | isFlexibleMaterial, getOuterDiameterIn, getOuterDiameterFt, getOuterRadiusFt, +5 |
| `PipeStandards.ts` | PipeStandards — supplementary dimensional data for fittings, socket depths, and bend radii per indus… | getSocketDepthIn, getSocketDepthFt, getHubOuterRadiusFt, getBendCenterlineRadiusFt, +5 |

### `src/core/project/`

| File | Purpose | Exports |
|------|---------|---------|
| `AutoSave.ts` | AutoSave — localStorage auto-save with debounced writes. | AutoSaveManager, autoSave |
| `ProjectFileIO.ts` | Project File I/O — export .elbow files and import via file picker. | exportProjectFile, importProjectFile |
| `ProjectSerializer.ts` | Project Serializer — serialize/deserialize entire design state to JSON. | PROJECT_VERSION, FILE_EXTENSION, MIME_TYPE, ProjectFile, +12 |

### `src/core/spatial/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveCamera.ts` | Adaptive Camera — intelligent desktop 3D camera that reduces the cognitive tax of visuospatial trans… | CameraPreset, CAMERA_PRESETS, CameraState, CAMERA_EV, +2 |
| `CognitiveLoadMonitor.ts` | Cognitive Load Monitor — tracks real-time interaction metrics to detect when the user is overwhelmed… | LOAD_EV, LoadLevel, LoadState, LoadAdaptation, +2 |
| `DepthCueRenderer.ts` | Depth Cue Configuration — visual parameters that enhance spatial comprehension and reduce visuospati… | DepthCueConfig, defaultDepthCues, vrDepthCues, arDepthCues |
| `SpatialAudio.ts` | Spatial Audio Feedback — 3D positional audio for pipe events. | updateListenerPosition, setMasterVolume, bootSpatialAudio |
| `SpatialPipeInteraction.ts` | Spatial Pipe Interaction — bridges gesture input to pipe routing. | SPATIAL_EV, FixtureHitPayload, SpatialPipeInteraction, spatialInteraction |

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
| `ComplianceEngine.ts` | Compliance Engine — bridges the KnowledgeGraph rules to PCSP constraints instantiated over the live … | ComplianceViolation, ComplianceReport, ComplianceEngine, getComplianceEngine |
| `IPCOntology.ts` | IPC Ontology — semantic type system for the International Plumbing Code. | NS, EntityClass, PropertyClass, RelationshipClass, +6 |
| `IPCRuleParser.ts` | IPC Rule Parser — encodes IPC 2021 chapters 6–9 as machine-readable knowledge graph triples and PCSP… | loadIPCKnowledgeBase |
| `KnowledgeGraph.ts` | Knowledge Graph — RDF-inspired triple store for IPC rules. | Triple, TriplePattern, RuleTemplate, RuleCondition, +2 |
| `PCSPSolver.ts` | PCSP Solver — Partial Constraint Satisfaction Problem engine. | PCSPVariable, PCSPDomain, PCSPConstraint, PCSPSolution, +3 |

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
| `BOMExporter.ts` | BOM Exporter — generates procurement-ready Bill of Materials. | BOMItem, BOMReport, generateBOM, bomToCSV, +2 |
| `CutLengthOptimizer.ts` | Cut Length Optimizer — breaks pipe routes into standard stock lengths with minimal material waste. | STOCK_LENGTHS_FT, CutParams, CutPiece, StockPiece, +3 |
| `IFCSchema.ts` | IFC Schema — entity type mappings for plumbing BIM export. | NODE_TO_IFC, FIXTURE_TO_IFC, FITTING_TO_IFC, SYSTEM_TO_IFC, +6 |
| `IFCSerializer.ts` | IFC Serializer — converts the PlumbingDAG + committed pipes to IFC-SPF (STEP Physical File) format p… | IFCExportOptions, IFCExportResult, exportToIFC |
| `SVGExporter.ts` | SVGExporter — vectorized 2D export for print-ready PDFs. | ProjectionMode, SVGExportOptions, DEFAULT_EXPORT_OPTIONS, exportToSVG, +2 |

### `src/engine/graph/`

| File | Purpose | Exports |
|------|---------|---------|
| `GraphEdge.ts` | Graph Edge — directed pipe segment connecting two nodes. | PipeMaterial, ROUGHNESS_FT, HAZEN_WILLIAMS_C, COST_PER_FT, +4 |
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

### `src/engine/solver/`

| File | Purpose | Exports |
|------|---------|---------|
| `DFUAccumulator.ts` | DFU Accumulator — drainage fixture unit summation per IPC. | DFUResult, accumulateDFU, WSFUResult, accumulateWSFU |
| `PipeSizer.ts` | Pipe Sizer — auto-sizes pipe diameters from accumulated DFU/WSFU. | SizingResult, sizeAllPipes |
| `PressureDropCalculator.ts` | Pressure Drop Calculator — Darcy-Weisbach per-edge pressure loss. | wsfuToGPM, dfuToGPM, PressureResult, calculateEdgePressureDrop, +2 |
| `PropagationSolver.ts` | Propagation Solver — multi-pass orchestrator. | SolveResult, solve |

### `src/engine/worker/`

| File | Purpose | Exports |
|------|---------|---------|
| `simulation.worker.ts` | Simulation Web Worker — runs the headless solver off the main thread. | — |
| `SimulationBridge.ts` | Simulation Bridge — relays messages between the main-thread EventBus / SimulationMessageBus and the … | SimulationBridge, getSimulationBridge |

### `src/hooks/`

| File | Purpose | Exports |
|------|---------|---------|
| `useEventBus.ts` | React hook for subscribing to EventBus channels. | useEvent, useEventState, useEmit |
| `useFSM.ts` | React hook that binds a FSM instance to component state. | useFSM |

### `src/store/`

| File | Purpose | Exports |
|------|---------|---------|
| `backdropStore.ts` | BackdropStore — raster blueprints pinned into the 3D scene as reference images for tracing. | Backdrop, useBackdropStore, uploadBackdropFile |
| `customerStore.ts` | CustomerStore — high-level assembly profiles. | ConstructionPhase, PHASE_LABELS, PHASE_COLORS, PHASE_ORDER, +8 |
| `fixtureEditorStore.ts` | FixtureEditorStore — transient workbench state for the visual editor. | EditorView, useFixtureEditorStore |
| `fixtureStore.ts` | FixtureStore — single source of truth for placed fixtures + their parameters. | FixtureInstance, useFixtureStore, getSchema |
| `floorStore.ts` | FloorStore — multi-story building state. | FloorVisibilityMode, Floor, useFloorStore, FloorRenderParams, +3 |
| `interactionStore.ts` | Interaction Store — mode system + draw state + settings. | InteractionMode, DrawPlane, PipeRenderQuality, useInteractionStore |
| `layerStore.ts` | Layer Store — Zustand store for system-level visibility toggles. | LayerState, SYSTEM_COLORS, SYSTEM_LABELS, SYSTEM_KEYS, +2 |
| `measureStore.ts` | MeasureStore — ruler measurements + scale calibration. | Vec3, Measurement, MeasureMode, useMeasureStore |
| `phaseStore.ts` | PhaseStore — construction phase filter and per-item overrides. | usePhaseStore, usePhaseFilter |
| `pipeStore.ts` | Pipe Store — Zustand single source of truth for committed pipes. | DIAMETER_COLORS, getColorForDiameter, CommittedPipe, PivotSession, +2 |
| `radialMenuStore.ts` | RadialMenuStore — Zustand store governing all radial wheel state. | WheelId, SectorSelection, WheelMemory, TrailSample, +3 |
| `wallStore.ts` | WallStore — structural wall segments acting as spatial constraints. | WallType, Wall, WALL_TYPE_META, WallDrawSession, +2 |

### `src/ui/`

| File | Purpose | Exports |
|------|---------|---------|
| `AutoRouteUI.tsx` | AutoRouteUI — click-two-fixtures interaction for automatic routing. | AutoRoutePhase, AutoRouteGuide, AutoRouteHUD, useAutoRoute |
| `ExportPanel.tsx` | Export Panel — HUD with IFC, BOM, and CSV export buttons. | ExportPanel |
| `FeedbackOverlay.tsx` | FeedbackOverlay — 2D HUD layer rendered on top of the 3D canvas. | FeedbackOverlay |
| `InterferenceVisualizer.tsx` | Interference Visualizer — R3F component showing collision feedback. | InterferenceVisualizer |
| `LayerPanel.tsx` | LayerPanel — HUD with toggle buttons per plumbing system. | LayerPanel |
| `NavStatusChip.tsx` | NavStatusChip — persistent top-center HUD showing the three things that control whether orbit camera… | NavStatusChip |
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

### `src/ui/backdrop/`

| File | Purpose | Exports |
|------|---------|---------|
| `BackdropPlane.tsx` | BackdropPlane — renders each uploaded blueprint image as a textured plane slightly below the active … | BackdropLayer |

### `src/ui/cameras/`

| File | Purpose | Exports |
|------|---------|---------|
| `IsoCamera.tsx` | IsoCamera — mathematically-exact isometric orthographic projection with smooth perspective↔orthograp… | CameraViewMode, ISO_TILT_EXACT, ISO_TILT_DEG, useIsoCameraStore, +2 |

### `src/ui/customers/`

| File | Purpose | Exports |
|------|---------|---------|
| `CustomerBadge.tsx` | CustomerBadge — persistent HUD chip showing the active customer, project status, and one-click acces… | CustomerBadge |
| `CustomerManager.tsx` | CustomerManager — full-screen modal for managing customer records. | CustomerManager |
| `CustomerPhaseSchedule.tsx` | CustomerPhaseSchedule — per-phase schedule widget for a customer. | CustomerPhaseSchedule |
| `FixtureTemplateEditor.tsx` | FixtureTemplateEditor — per-customer fixture template editor. | FixtureTemplateEditor |
| `useCustomerShortcuts.ts` | useCustomerShortcuts — keyboard bindings for customer management. | CUSTOMER_MANAGER_EVENT, useCustomerShortcuts |

### `src/ui/fixtures/`

| File | Purpose | Exports |
|------|---------|---------|
| `Editor3DView.tsx` | Editor3DView — perspective 3D view with orbit controls showing the fixture model + connection-point … | Editor3DView |
| `EditorElevationView.tsx` | EditorElevationView — side-elevation SVG view of the fixture. | EditorElevationView |
| `EditorTopView.tsx` | EditorTopView — 2D plan view rendered as a single responsive SVG. | EditorTopView |
| `FixtureModels.tsx` | Fixture Models — parametric 3D shapes replacing the placeholder GlowRings. | FixtureModel, FixtureLayer, FixtureLayerFromStore |
| `FixtureParamWindow.tsx` | FixtureParamWindow — floating parameter panel for the selected fixture. | FixtureParamWindow |
| `FixturePlacementPreview.tsx` | FixturePlacementPreview — translucent "ghost" model attached to the cursor while a fixture is pendin… | FixturePlacementPreview |
| `FixtureVisualEditor.tsx` | FixtureVisualEditor — full-screen workbench for a fixture's geometry and parameters. See individual … | FixtureVisualEditor |

### `src/ui/floors/`

| File | Purpose | Exports |
|------|---------|---------|
| `ActiveFloorAutoInfer.tsx` | ActiveFloorAutoInfer — headless component that switches the active floor to match newly-committed pi… | ActiveFloorAutoInfer |
| `FloorPlaneOutlines.tsx` | FloorPlaneOutlines — thin horizontal reference planes at each floor's base elevation. Provides spati… | FloorPlaneOutlines |
| `FloorSelectorRail.tsx` | FloorSelectorRail — vertical right-edge UI for floor switching. | FloorSelectorRail |
| `FloorVisibilityControls.tsx` | FloorVisibilityControls — global floor visibility HUD. | FloorVisibilityControls |
| `useFloorShortcuts.ts` | useFloorShortcuts — keyboard integration for floor switching. | useFloorShortcuts |

### `src/ui/measure/`

| File | Purpose | Exports |
|------|---------|---------|
| `MeasureToolbar.tsx` | MeasureToolbar — horizontal HUD with all Phase 2.G tools: | MeasureToolbar |
| `RulerTool.tsx` | RulerTool — in-scene click-click measurement tool. | RulerCatcher, MeasurementLines, ScaleCalibratorDialog |
| `useMeasureShortcuts.ts` | useMeasureShortcuts — keyboard bindings for Phase 2.G tools. | useMeasureShortcuts |

### `src/ui/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveQuality.tsx` | AdaptiveQuality — monitors render FPS and progressively reduces expensive settings if the frame time… | AdaptiveQuality |

### `src/ui/phase2/`

| File | Purpose | Exports |
|------|---------|---------|
| `AdaptiveRenderBridge.tsx` | AdaptiveRenderBridge — wires AdaptiveRenderProfile output into the actual R3F scene parameters in re… | AdaptiveRenderBridge |
| `AutoRouteTrigger.tsx` | AutoRouteTrigger — when a fixture is dropped from the FIXTURE wheel, this component detects the drop… | AutoRouteTrigger |
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
| `DimensionHelpers.tsx` | DimensionHelpers — 3D text annotations on selected pipes. | DimensionHelpers |
| `FittingGenerator.ts` | FittingGenerator — analyzes the committed pipe network and emits a list of fittings to render + pric… | FittingInstance, generateAllFittings |
| `FittingMeshes.tsx` | FittingMeshes — renders auto-generated fittings using InstancedMesh. | FittingRenderer |
| `LiveRoutePreview.tsx` | LiveRoutePreview — shows a solid pipe growing in real-time as the user drags to create a route. | LiveRoutePreview |
| `PipeHitboxes.tsx` | PipeHitboxes — dual-zone click detection per pipe. | PipeHitboxes |
| `PipeMaterial.ts` | Pipe Material Factory — cached MeshStandardMaterial per (material × system × diameter × variant). | getPipeMaterial, getSelectedPipeMaterial, getWallShellMaterial, getPreviewMaterial, +2 |
| `PivotPreview.tsx` | PivotPreview — live visual feedback during pipe pivot. | PivotPreview |

### `src/ui/pipe/perf/`

| File | Purpose | Exports |
|------|---------|---------|
| `GeometryBatcher.ts` | Geometry Batcher — merges pipe geometries per diameter bucket per spatial cell to minimize draw call… | spatialCellKey, BatchGroup, GeometryBatcher, mergeGeometries |
| `LODController.ts` | LOD Controller — distance-based level-of-detail for pipes. | LODLevel, LODThresholds, LODGeometryParams, LODController |
| `PerformanceMonitor.tsx` | Performance Monitor — FPS counter + pipe count HUD overlay. | PerformanceMonitor |
| `PipeInstanceRenderer.tsx` | Pipe Instance Renderer — InstancedMesh for straight pipe segments. | PipeInstanceRenderer |
| `StagedGeometryQueue.ts` | Staged Geometry Queue — spreads geometry rebuilds across frames to prevent frame spikes. | RebuildRequest, StagedGeometryQueue, computePriority |

### `src/ui/radial/`

| File | Purpose | Exports |
|------|---------|---------|
| `FisheyeDeformer.ts` | FisheyeDeformer — angular deformation of radial menu sectors. | BaseSector, DeformedSector, FisheyeConfig, DEFAULT_FISHEYE_CONFIG, +4 |
| `RadialMenu.tsx` | RadialMenu — futuristic radial menu with mouse-following sector expansion. | WheelSector, SectorSubtype, WheelConfig, RadialMenu |
| `RadialMenuAudio.ts` | Radial menu audio feedback — synthesized tones via Web Audio API. | radialAudio |
| `WheelCornerIcons.tsx` | WheelCornerIcons — persistent corner-anchored access points for the three weapon wheels. | WheelCornerIcons |
| `WheelHolographics.tsx` | WheelHolographics — sci-fi SVG overlay effects for the radial menu. | HolographicsProps, WheelHolographics |
| `WheelParticles.tsx` | WheelParticles — canvas-based particle emitter for radial menus. | WheelParticlesHandle, WheelParticles |

### `src/ui/radial/wheels/`

| File | Purpose | Exports |
|------|---------|---------|
| `DrawingWheel.tsx` | DRAWING Wheel — CTRL+SPACE activates this wheel. | getDrawingWheelConfig, DrawingWheel |
| `FixtureWheel.tsx` | FIXTURE Wheel — CTRL+F activates this wheel. | getFixtureWheelConfig, FixtureWheel, CustomerEditWheel |

### `src/ui/walls/`

| File | Purpose | Exports |
|------|---------|---------|
| `WallRenderer.tsx` | WallRenderer — 3D box per wall segment + click-click draw tool. | WallRenderer |


---


_Generated by `tools/generate-reference.cjs` on 2026-04-17T23:31:43.931Z_
