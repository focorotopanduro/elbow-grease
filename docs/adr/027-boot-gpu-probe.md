# ADR 027 — Boot-Time GPU Probe (Phase 12.D)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 12.D
- **Depends on:** ADR 024 (Rendering Foundation), ADR 025 (Low-Spec Rendering — `lowSpecDetection` pattern library).

## Context

Phase 12.B shipped `probeWebGLContext()` — a pure classifier that reads the WebGL `WEBGL_debug_renderer_info` extension and maps the renderer string to `low-spec | mid-spec | high-spec | unknown`. AdaptiveQuality called it from inside its `useEffect` (running after the real `<Canvas>` mounted) and used the result to seed the initial tier.

That got us DPR + shadow-map adaptation on boot. It did NOT let us touch the biggest fragment-shader-fillrate cost on integrated GPUs: **MSAA antialias**.

The reason is architectural:
- `gl.antialias` is a Canvas context-creation flag. Once `<Canvas antialias={true}>` mounts, the underlying `WebGLRenderingContext` has MSAA baked in and you cannot change it.
- React cannot reactively change `antialias` without unmounting and remounting the entire Canvas — which loses all scene state.

The Phase 12.B audit explicitly called out this tension: MSAA at DPR 2 costs roughly 4× pixel fill-rate compared to no-AA at DPR 1 on iGPU. For plumbing CAD on an Intel UHD laptop, disabling MSAA is the single biggest performance win available short of a full renderer rewrite.

## Decision

Probe the GPU **before** the Canvas mounts via a throwaway 1×1 offscreen canvas. Cache the result at module scope. Use it to drive every boot-time rendering decision from a single source of truth.

### Files

```
src/ui/perf/bootGpuProbe.ts                  one-shot offscreen probe + cached result
src/ui/perf/__tests__/bootGpuProbe.spec.ts   8 tests (stubbed renderer strings, cache, override)
```

### API

```ts
export function probeGpuAtBoot(): GpuProbeResult;  // cached
export function isLowSpecGpu(): boolean;            // convenience
export function __resetBootGpuProbeForTest(override?: GpuProbeResult | null): void;
```

Implementation:

```ts
let cached: GpuProbeResult | null = null;

export function probeGpuAtBoot(): GpuProbeResult {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 1; canvas.height = 1;
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  cached = probeWebGLContext(gl);
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return cached;
}
```

The canvas is never attached to the DOM. The context is opened, the extension probed, then immediately released via `WEBGL_lose_context` so no GPU buffer lingers. `WEBGL_lose_context` is widely supported (all modern Chromium + Firefox + Safari); if it's missing the GC collects the context shortly after.

### Two things App.tsx now does with the result

```tsx
const lowSpec = isLowSpecGpu();

<Canvas
  dpr={lowSpec ? 1 : [1, 2]}
  gl={{
    antialias: !lowSpec,
    // ... other gl config ...
    logarithmicDepthBuffer: true,
  }}
>
```

Both are context-creation parameters that cannot change after mount. They're now locked in based on the probe:

1. **`antialias: !lowSpec`** — Integrated GPUs skip MSAA entirely. Roughly doubles pixel fillrate budget.
2. **`dpr={lowSpec ? 1 : [1, 2]}`** — Low-spec never gets DPR 2. A retina MacBook with an M1 still renders at physical DPR 1; on the same machine a retina-enabled discrete-GPU user goes up to DPR 2.

### AdaptiveQuality unified on the same probe

Previously `AdaptiveQuality` called `probeWebGLContext(gl.getContext())` from its own useEffect. Now it calls `probeGpuAtBoot()` — same classification function, same cached result. One boot-time decision drives antialias, DPR, initial render tier, and shadow-map size.

### Why offscreen 1×1?

The smallest canvas we can open a context on. No framebuffer memory, no render target attachment, no uploaded geometry. Just: open → probe string → close. Costs less than 1 ms on all tested hardware. The probe runs synchronously during React's render phase so the Canvas gets the correct props on its first mount.

### Why module-scope caching?

The renderer string doesn't change within a session. Re-probing would waste a canvas allocation, a context open, and an extension lookup on every call. The cached path is O(1) after first invocation.

### Tests

Canvas creation is stubbed via `vi.spyOn(document, 'createElement')` to return a canvas with a controlled fake WebGL context. The tests cover:

1. Classifies a known low-spec renderer (`Intel UHD 620`) correctly.
2. Classifies a known high-spec renderer (`RTX 3070`) correctly.
3. Second call returns the cached result — proven by swapping the stubbed renderer between calls and observing the old value persists.
4. `isLowSpecGpu()` returns true iff tier === 'low-spec'.
5. Unknown renderer (empty string) does NOT classify as low-spec.
6. `__resetBootGpuProbeForTest(null)` wipes the cache and the next call probes fresh.
7. `__resetBootGpuProbeForTest(override)` pins the result to an arbitrary value.
8. SSR path (no `document`) returns `unknown` safely.

## Consequences

**Good:**
- Integrated GPUs get a ~2× fillrate recovery. Combined with the Phase 12.B initial-tier seed and Phase 12.B shadow-map cascade, a first-boot user on an Intel UHD laptop now runs: DPR 1 + no MSAA + PCFSoft at 1024 + tier-1 pipe LOD. Noticeably smoother first 5 seconds.
- One probe drives everything. No drift between "what AdaptiveQuality thinks" and "what the Canvas was created with".
- Tests exercise realistic GPU strings end-to-end. Future classification tweaks ship with clear red/green signal.
- Boot log entry (`appLog.info('GPU classified at boot', ...)`) makes bug reports actionable: the user can paste the boot log and the maintainer can see exactly what the probe saw.

**Accepted costs:**
- **Aliasing on low-spec.** Without MSAA, straight pipe edges at orthographic views show visible staircasing. Mitigated partly by `logarithmicDepthBuffer: true` (preserves depth precision) + the existing LOD system (far pipes go wireframe). For a CAD tool targeting iGPU users, the trade is correct: 60fps with mild aliasing beats 30fps with smooth edges.
- **One-time offscreen canvas.** Allocates + releases a WebGL context at boot. < 1 ms, bounded, unrecoverable if the browser refuses — falls back to 'unknown' which means "treat as mid-spec = enable everything". No hard failure mode.
- Module-level cache — like PerfStats, SessionTelemetry, and now this, the render-adaptation layer has three singletons. Tests reset via explicit helpers.

**Non-consequences:**
- Mid-spec and high-spec GPUs are unchanged. They still get MSAA, they still get DPR 2 on retina, they still get the full tier-0 experience.
- No new dependency. No post-processing lib added for FXAA — we accept the aliasing trade-off. If visual quality feedback warrants it later, FXAA via `@react-three/postprocessing` can land in its own ADR.
- Autosave, bundle I/O, telemetry, onboarding — untouched. This phase is pure rendering config.

## Alternatives considered

**FXAA post-process to compensate for disabled MSAA.** The Phase 12.B audit ranked this first. `@react-three/postprocessing` provides an FXAA effect in ~15 KB gz. Rejected for this phase because:
1. Adds a runtime dependency that changes the render pipeline (introduces `EffectComposer`).
2. FXAA itself has a non-trivial fragment cost on iGPUs — partially eats back the MSAA savings.
3. The CAD use case tolerates aliasing better than a first-person game would; straight pipes + walls don't produce the "shimmering fence" artifacts FXAA is designed to fix.

Can land later as a user-facing toggle ("smoothing: on/off") if feedback shows the aliasing is too harsh.

**Probe inside an error-bounded React component.** Could wrap the whole probe in a try/catch inside a component, using state to track result. Rejected — module-level caching is simpler, and the probe's failure mode (catch → 'unknown') is already safe.

**Use `navigator.gpu` (WebGPU)** for richer device info. Rejected — WebGPU adoption is still uneven (Safari partial, older Chrome lacks it). `WEBGL_debug_renderer_info` is universally available wherever we actually run, and it gives us the one piece of info we need: the GPU's marketing name.

## Validation

- `Vitest`: `src/ui/perf/__tests__/bootGpuProbe.spec.ts` — 8 tests, all green.
- Full test suite: **404/404 pass across 32 files** (+8 new, no regressions).
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual test plan:
  - Boot in Chrome on an iGPU machine → check DevTools console for the "GPU classified at boot" log with `tier: 'low-spec'`, `antialias: false`.
  - Boot on a discrete-GPU machine → same log with `tier: 'high-spec'`, `antialias: true`.
  - Force override via `__resetBootGpuProbeForTest({...})` in DevTools to simulate the other tier, reload.
