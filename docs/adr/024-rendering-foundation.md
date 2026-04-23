# ADR 024 — Rendering Foundation: Depth + Cutaway (Phase 12.A)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 12.A
- **Scope note:** This ADR tackles the two items from the "Architectural Synthesis" design doc that ship concretely in one phase — depth-buffer precision and Sims-style wall cutaway. Deferred-rendering path, multi-raycast spring arm, draw-call batching audits, texture atlasing, and procedural-chunk LOD are called out in **Future Work** below; each deserves its own ADR when it lands.

## Context

The design synthesis document ("Architectural Synthesis and Rendering Paradigms in Hybrid CAD-Simulation Environments") identified a stack of rendering and UX deficiencies. Two are both (a) directly traceable to specific code in this repo and (b) addressable without a major refactor:

1. **Z-fighting at depth.** The default Three.js `near=0.1`, linear depth buffer starves distant geometry of float precision. Synthesis §"Depth Buffer Mathematics and the Resolution of Z-Fighting" — pipes, walls, and floor planes at any meaningful building-scale distance flicker against each other during orbit.

2. **Camera trapped by walls.** Plumbing CAD scenes are primarily interior — walls surround the fixtures the user is trying to inspect. Synthesis §"Algorithmic Wall Culling and Architectural Transparency" points at The Sims' "Walls Up / Walls Down / Cutaway" cycle as the standard pattern for this class of software.

Both had visible symptoms:
- Existing `Canvas` gl config explicitly set `logarithmicDepthBuffer: false` with no comment — a prior deliberate disable. Distant floors and walls Z-fought during rotation.
- WallRenderer drew every wall at a single global opacity with no mode switch.

## Decision

Ship two tightly-scoped, testable primitives.

### 1. Depth-buffer correctness

In `App.tsx`'s `Canvas` config:

```ts
camera={{
  position: [8, 10, 8],
  fov: 45,
  near: 0.1,   // was default (0.1 too, but now pinned + documented)
  far: 1000,
}}
gl={{
  ...
  logarithmicDepthBuffer: true,   // was false
}}
```

**Rationale:**
- `logarithmicDepthBuffer: true` asks Three.js to use log-depth in the fragment shader. This isn't identical to the "Reversed-Z D32F" the synthesis recommends (Three.js doesn't expose reversed-Z directly), but it achieves the same goal: precision distributed far more evenly across depth, so floors at 30 ft and walls at 35 ft no longer share Z bits.
- `near: 0.1` is pinned with a comment explaining why it's NOT 0.01 — preventing a future "tighten near plane for closer zoom" well-meaning regression.
- Fragment-shader cost is real but small; PerfHUD (Phase 10.D) will catch it if it ever becomes a regression.

### 2. Wall render-mode (Sims cycle)

Three modes, cycled by `Shift+W`:

| Mode | Behavior |
|------|----------|
| `walls-up` | Default. All walls rendered at configured opacity. |
| `walls-down` | Global dim to ~8%. Footprint still readable, interior fully visible. |
| `cutaway` | Per-wall dim based on a geometric "is this wall between camera and focus?" test. |

New files:

```
src/store/renderModeStore.ts                  state + cycle() + localStorage persistence
src/store/__tests__/renderModeStore.spec.ts   8 tests: default, cycle, persist, opacity map

src/core/walls/cutawayAlgorithm.ts            PURE geometric predicate (no R3F, no three.js)
src/core/walls/__tests__/cutawayAlgorithm.spec.ts  12 tests covering the XZ segment-segment
                                              intersection, degenerate cases, collinear walls

src/ui/walls/useCutawaySet.ts                 hook bridging camera pose → algorithm → wall ids
```

Modified:
- `src/ui/walls/WallRenderer.tsx` — consumes `RENDER_MODE_OPACITY[mode]` as a multiplier, and dims individual walls present in `useCutawaySet()`.
- `src/App.tsx` — `KeyboardHandler` adds Shift+W (guarded against input focus); Canvas gets the depth-buffer config.
- `src/core/input/ShortcutRegistry.ts` — registers `view.walls.cycle` so `?` docs it automatically.

### Why "segment-segment intersection" and not "dot product of normal"?

The synthesis doc sketches the dot-product approach. That works for a single exterior-vs-interior test, but it needs the camera-side classification to be robust across arbitrary wall orientations. Segment-segment intersection is simpler, O(N) per frame with N ≤ ~200 walls in realistic scenes, and has no edge case for walls orthogonal to the camera. For a 2D top-down cull test it's the right shape.

### Why 10 Hz update instead of per-frame?

The cutaway set only needs to track orbital motion. 10 Hz (setInterval 100 ms) is visually indistinguishable from 60 Hz for a dim/undim decision — the delay is shorter than a human's change-blindness window for opacity transitions. Computing on every frame would waste useFrame cycles on an operation that doesn't benefit from higher cadence.

### Why project the camera's forward ray onto the ground instead of reading OrbitControls.target?

Two reasons:
1. Decouples WallRenderer from the specific OrbitControls ref in App.tsx scope — the hook works with any camera, including IsoCamera and a future Spring Arm rig.
2. For orbits whose target is high above the ground (e.g. user panned up to look at a ceiling fixture), the ground-intersection focus is a better match for the user's intuitive "what am I looking at" than the actual orbit target.

## Consequences

**Good:**
- Distant Z-fighting should be visibly gone during orbit. First user test after shipping will validate.
- Cutaway mode closes the loop between "accessible like The Sims" and "accurate like enterprise CAD" — a user can inspect interior plumbing without camera-wall collision rage-quits.
- The pure algorithm module is fully testable. If future wall topologies break cutaway, the regression landed first in `cutawayAlgorithm.spec.ts`.
- `Shift+W` is a single learnable gesture with three states — no "walls down" vs "walls up" mode indicator UI to maintain (the behavior itself is the indicator).

**Accepted costs:**
- `logarithmicDepthBuffer: true` adds a few fragment-shader ops per pixel. Negligible on any machine that runs WebGL2 acceptably, but PerfHUD will catch it if a specific GPU hates it.
- The cutaway set recomputes 10×/s. With 200 walls and an O(N) test per wall, that's ~2000 ops/s — comfortably below noise.
- Render-mode state is persisted to localStorage. If a user opens a new project with walls-down still active from a prior session, their first reaction might be "where are my walls?". Mitigated by the status being obvious after one Shift+W press.

**Non-consequences:**
- Camera collision handling (spring arm / multi-raycast) is UNCHANGED. The existing OrbitControls + IsoCamera behavior still applies. Cutaway makes camera-wall conflict less frequent but doesn't eliminate it — that's a separate phase.
- No change to draw-call submission or instancing. Pipe draw count may be fine already; if PerfHUD shows > 500 calls in a realistic scene, a batching ADR follows.

## Alternatives considered

**Fully opaque wall hiding in walls-down/cutaway.** Rejected — the synthesis doc explicitly warns against it: "modern simulation engines do not merely turn the wall invisible" because that breaks footprint readability. A low-baseline opacity (0.08) preserves structural awareness.

**Reversed-Z depth buffer with a custom Three.js build.** Would deliver the best precision, but requires patching WebGLRenderer or using a plugin that overrides the internal depth function. The gain over `logarithmicDepthBuffer: true` is marginal for scene depths < 1000 units. Revisit only if specific Z-fighting regressions reappear on known content.

**Cutaway by swapping wall meshes for baseboard meshes** (the synthesis's literal description of the Sims approach). Rejected for scope — we don't model baseboards as separate meshes today. Dimming the existing mesh achieves the same UX goal without a new asset pipeline.

**Per-wall normal dot-product culling.** Documented above — not robust across orientations without careful sign conventions. Segment intersection has no such ambiguity.

## Future Work (acknowledged from the synthesis doc)

These remain valid recommendations, deliberately deferred:

1. **Deferred rendering path.** Three.js r170 does not ship a first-class deferred pipeline. Would require a `WebGPURenderer` migration or hand-rolled deferred pass. High-value if we hit hard light-count limits, but not yet.
2. **Multi-raycast spring-arm camera.** Current OrbitControls is "good enough" for orbital views. A proper spring arm with frustum-corner raycasts is warranted once we add first-person walk mode or ground-level inspection.
3. **Draw-call instancing audit.** Pipe + fitting + fixture renderers currently draw per-instance. Likely fine at current scene sizes — PerfHUD tells us when it isn't.
4. **Texture atlasing.** Only relevant if we add many distinct PBR materials. We're mostly flat colors today; not a bottleneck.
5. **Procedural chunk streaming.** The scene is small enough to fit comfortably. Becomes relevant at > 10,000-pipe sites.

Each of the above gets its own ADR when it graduates from "nice to have" to "regression evidence demands it".

## Validation

- `Vitest`:
  - `src/core/walls/__tests__/cutawayAlgorithm.spec.ts` — 12 tests: low-level segment intersection (perpendicular cross, parallel-nonoverlap, collinear-no-cull, shared-endpoint, T-junction, near-miss) + scene-level assertions (empty input, degenerate camera===focus, between vs behind, mixed walls, diagonal, stable across re-entry).
  - `src/store/__tests__/renderModeStore.spec.ts` — 8 tests: default mode, setMode persistence, garbage-input rejection, all three cycle transitions, persisted cycle, opacity constants sane.
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual: pressed Shift+W twice — walls dim globally; pressed again — walls front-of-focus dim while walls behind stay opaque; orbit — dimmed set updates live.
