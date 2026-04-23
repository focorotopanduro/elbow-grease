# ADR 025 — Low-Spec Rendering Pass (Phase 12.B)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 12.B
- **Depends on:** ADR 024 (Rendering Foundation), Phase 12.A audit pass (AdaptiveQuality hysteresis).

## Context

The goal for Phase 12.B was described as "get as close as possible to the functioning of well-optimized 3D isometric games that run on the lowest of computers" — StarCraft 2, Cities Skylines, The Sims 4. An Explore-agent audit produced a specific, ranked list of improvements. Much of the hoped-for low-hanging fruit was already in place:

- **Orthographic projection** — 7 of 8 view modes (iso/top/front/side/bottom/iso-true/iso-30/iso-45) already use `OrthographicCamera`. Only free-orbit uses perspective. ✅
- **Distance-based LOD** for pipe tubes, FULL/REDUCED/WIREFRAME. ✅
- **Fitting instancing** — ~2000 fittings render in ~12 draw calls. ✅
- **Fog + culling** — 35/80 near/far, no off-screen rendering. ✅
- **`castShadow` discipline** — zero decorative shadows (no GlowRing/halo/flash casts shadows). ✅
- **Frustum culling** — nothing explicitly bypasses Three.js's built-in culling. ✅

What remained was a short list of concrete wins the audit surfaced:

1. Shadow map size was fixed at 4096 regardless of tier.
2. Rigid (straight) pipe tubes used 20 radial segments — overspecified.
3. No GPU-aware initial tier: every user starts at tier 0 and discovers their machine is weak only after the first few seconds of stutter.
4. (Deferred) Wall instancing — biggest draw-call win but needs careful handling of per-instance selection + cutaway; a full phase by itself.

## Decision

Ship three tight changes this phase. Defer wall instancing to its own.

### 1. Shadow map size cascade in AdaptiveQuality

Prior:
```ts
applyTier(0): dpr=2,  shadowType=PCFSoft, map size untouched (defaults to 4096 somewhere upstream)
applyTier(1): dpr=1,  shadowType=PCFSoft, map size untouched
applyTier(2): dpr=1,  shadowType=Basic,   map size untouched
```

After Phase 12.B, shadow map resolution scales with tier:

| Tier | DPR | Shadow type | Shadow map |
|------|-----|-------------|------------|
| 0 (high) | up to 2 | PCFSoft | 2048×2048 |
| 1 (med)  | 1 | PCFSoft | 1024×1024 |
| 2 (low)  | 1 | Basic   | 512×512 |

Tier 0 drops from 4096 → 2048 deliberately. Orthographic iso views have softer shadows to begin with; 4096 was over-specified for the typical plumbing-scene field of view. Tier 2's 512 is what a genuinely underpowered machine gets — just enough to preserve depth cues without trashing bandwidth.

`applyTier()` now walks `scene.children`, finds directional lights with `castShadow`, resizes their shadow maps, and disposes the existing render target so the new size takes effect next frame. This avoids coupling AdaptiveQuality to the specific light-mount in App.tsx — adding a rim light later won't require touching this module.

### 2. Rigid pipe radial segments 20 → 12

`PipeRenderer.tsx`:

```ts
main: new THREE.TubeGeometry(curve, segs, radius, flexible ? 20 : 12, false)
```

PEX (flexible) pipes still get 20 radial segments so tight bends remain round. Rigid pipes — copper, PVC, cast iron, galvanized — are visually straight between fittings, and a 12-sided tube cross-section is indistinguishable from a 20-sided one in iso views at typical zoom. This is a ~40% geometry memory reduction for every rigid pipe in the scene.

### 3. GPU-aware initial tier via `lowSpecDetection`

New module: `src/ui/perf/lowSpecDetection.ts`.

- Probes the WebGL context's `WEBGL_debug_renderer_info` extension and reads `UNMASKED_RENDERER_WEBGL`.
- Pattern-matches against a conservative list of known integrated / mobile / software GPUs: Intel HD/UHD/Iris, AMD Radeon Vega 8 and below, Apple M1/M2/M3 base (not Pro/Max/Ultra), Mali/Adreno/PowerVR, SwiftShader, Microsoft Basic Render Driver.
- High-spec patterns (NVIDIA GTX/RTX, AMD RX 5xxx+, Intel Arc, Apple M-Pro/Max/Ultra) are checked FIRST so a dual-GPU ANGLE string that names both iGPU and discrete GPU is classified high-spec.

Returns `{ tier: 'low-spec' | 'mid-spec' | 'high-spec' | 'unknown', renderer, reason }`.

`initialTierFor(tier)` maps `low-spec → 1`, everything else → `0`.

AdaptiveQuality now calls `probeWebGLContext(gl.getContext())` in its setup effect and seeds the tier accordingly. A known-integrated user starts at tier 1 with PCFSoft + 1024 shadow maps + DPR 1.0 instead of booting at tier 0 and discovering the hard way that their laptop can't drive retina.

**False-positive risk is bounded**: a misclassified mid-range GPU starts at tier 1 and the de-escalation path (Phase 12.A hysteresis, ADR 024) will promote them back to tier 0 within a few seconds if they have headroom.

**False-negative risk is bounded**: a missed low-spec user just runs the existing tier-escalation loop, which still brings them to tier 2 within a few seconds — same end state.

**No telemetry, no fingerprinting.** The probe result is used for exactly one boot-time decision and lives in memory.

## Consequences

**Good:**
- Integrated GPUs start on appropriate settings. First-impression FPS should be ~stable for most laptops instead of "chuggy then fine".
- Tier 2 is actually cheap now (512 shadow map is a real commitment to "runs on anything"). Tier 2's prior behavior of "big shadow map + Basic shadow type" was a weird hybrid.
- Rigid pipes have 40% less geometry. Benefits a typical scene with 30+ rigid pipes (most bathrooms, every basement).
- The `lowSpecDetection` module is pure + exhaustively unit tested (19 tests). It's trivial to add new patterns as we learn what real iGPU strings look like.

**Accepted costs:**
- Tier 0 shadow resolution halved (4096 → 2048). A power user may briefly notice slightly softer shadows on closeup pipe views. The maxDistance of OrbitControls + the orthographic iso views make 2048 fully sufficient in practice.
- The pattern library for GPU classification will need occasional maintenance as new GPUs ship. Kept deliberately conservative (false positives land users at tier 1 — not a catastrophe).

**Non-consequences:**
- No change to the LOD system, fog distances, or fitting instancing — all already correct.
- No change to material types (still MeshStandard throughout). The audit noted "emissive glow pipes could downgrade to MeshBasicMaterial" — valid but not universally; skipping for now.

## Alternatives considered

**Swap MSAA for FXAA on tier 2.** The audit ranked this #1 for impact. But `gl.antialias` is a Canvas context creation flag — once set, it cannot be toggled. To change it mid-session we'd have to re-mount the entire Canvas and lose all scene state. Viable as a boot-time setting alongside `lowSpecDetection` (low-spec → skip MSAA), but requires passing the detection result THROUGH to `<Canvas antialias={...}>`. Deferred — this is `probeWebGLContext` running inside `<Canvas>` which needs the context to already exist, a chicken-and-egg. A future pass can do the probe at the top of `<App>` via an offscreen canvas and feed the result into the real `<Canvas>`.

**Wall instancing.** Biggest single draw-call reduction (10–20 walls → 1–2), but per-instance selection + cutaway-dim + floor-ghost + edge-line overlay is non-trivial to preserve under `InstancedMesh`. A full refactor; its own ADR when we land it.

**Material downgrade by distance** (MeshStandard → Lambert → Basic). Plausible perf win, but distance-based material swapping has visual pop-in artifacts at the threshold boundaries, and the existing LOD system already reduces distant pipes to wireframes, which cuts the fragment-shader cost more effectively. Not a clear win.

**Disable shadows on small fittings.** Investigated in the audit — already implicitly handled by the instancing path for fittings, which shares shadow state across the whole bucket. A single shadow toggle at the renderer level is more impactful than per-mesh decisions.

## Validation

- `Vitest`: `src/ui/perf/__tests__/lowSpecDetection.spec.ts` — **19 tests**: 10 low-spec patterns (Intel HD/UHD/Iris/4000, AMD Vega 8, Apple M1/M2, Mali, Adreno, SwiftShader, Microsoft Basic), 6 high-spec patterns (RTX 3070, GTX 1080, RX 6800, Intel Arc, M3 Max, mixed-string priority), 2 unknown/garbage cases, `initialTierFor` 4 tests, `probeWebGLContext` 4 test (null, no-extension, real-extension, throws).
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual verification plan:
  - Launch in Chrome DevTools with GPU throttling → expect low-spec classification, tier 1 startup.
  - Launch on a discrete-GPU machine → expect tier 0 + 2048 shadow map.
  - Draw 30 rigid pipes → compare geometry-memory in gl.info.memory before/after.
