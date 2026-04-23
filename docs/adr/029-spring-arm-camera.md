# ADR 029 — Spring-Arm Camera (Phase 12.E)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 12.E
- **Depends on:** ADR 024 (Rendering Foundation — camera + cutaway context), Phase 12.A audit pass.

## Context

The "Architectural Synthesis" design doc introduced a specific recommendation for camera-in-geometry handling: a **spring-arm boom** with **multi-raycast volumetric collision**. The motivation is the classic "camera clips through wall" problem that plagues interior 3D — especially relevant for a CAD tool where the user is often navigating tight interior spaces (bathroom, mechanical room, basement with a dense pipe run).

Current camera system:
- `IsoCamera.tsx` — fixed-angle controller (perspective + ortho)
- OrbitControls (drei) — standard orbit/pan/zoom, `makeDefault: true`
- No collision handling; `maxDistance: 100` caps dolly-out, nothing caps dolly-in

In iso / top / elevation views this is fine — ortho projection is distance-invariant. In perspective mode, zooming close or panning around fixtures can punch the camera through walls. The user's eye then sits inside geometry and sees unintended back-faces.

## Decision

Ship a **multi-raycast spring-arm post-process** as an optional R3F controller.

### Architecture: pure core + thin R3F shell

Split into two layers:

```
src/core/camera/springArm.ts            pure multi-raycast clamp logic + ease helpers
src/core/camera/__tests__/springArm.spec 20 tests, zero Three.js deps
src/ui/cameras/SpringArmController.tsx   R3F component — reads OrbitControls,
                                         builds the collidable set, applies lerp
```

### Pure module (`computeSpringArm`)

```ts
function computeSpringArm(
  input: { target, cameraPosition, minDistance, padding, perpOffset? },
  raycast: (origin, direction, maxDistance) => number | null,
): { clampedDistance, hit, desiredDistance, rayIndex };
```

Five-ray topology adapted from the synthesis doc's recommendation:

1. **Center ray** — target → camera position. Catches solid walls directly in line.
2. **Four corner rays** — origin offset by ±perpOffset along each of two perpendicular basis vectors, all traveling in the same direction as center. Approximates a rectangular tube around the camera boom.

A single center ray misses thin obstructions that slip between the camera body and a narrow gap (wall edges, pipe elbows viewed at angle). The four corner rays sweep a volume wide enough to catch them, without the combinatorial cost of a full mesh-vs-mesh collision test.

The `raycast` callback is injected, so the module has zero Three.js dependency — the R3F layer provides a `THREE.Raycaster`-backed callback.

### Pullback math

On any ray hitting an obstacle at `hitDistance < desiredDistance`:

```
clampedDistance = hitDistance - padding * desiredDistance
clampedDistance = max(clampedDistance, minDistance)
```

Padding scales with desired distance rather than being an absolute — a far-zoomed camera gets proportionally more breathing room. 5% works well at plumbing-CAD scales (desired 10 ft → pullback 0.5 ft).

`minDistance` (0.5 ft default) is a floor to prevent negative or zero distances even inside walls — keeps the near plane sane.

### Smoothing (exponential ease)

The clamp target changes discontinuously as the camera orbits past an occluder. Snapping to the new distance each frame feels jittery. The controller keeps a per-frame `currentDistance` and eases:

```
alpha = 1 - exp(-dt / TIME_CONSTANT)        // ~150 ms time constant
currentDistance = lerp(currentDistance, clampedDistance, alpha)
```

150 ms feels snappy under normal motion but absorbs single-frame jitter when the spring arm oscillates between "hit at 4 ft" and "clear at 10 ft" during rapid orbits.

### R3F integration — priority 1 `useFrame`

R3F's `useFrame` accepts a priority argument. OrbitControls runs at default priority (0). Running the spring arm at priority **1** guarantees our callback fires AFTER OrbitControls has placed the camera — so we post-process its output.

If we ran at priority 0, the two would fight over `camera.position` with undefined ordering.

### Collidable mesh discovery

The controller scans `scene` once per second for meshes with `userData.cameraCollidable === true`. Fallback: if no meshes opt in, collide against the whole scene (noisy but functional). This is the honest tradeoff:
- Opt-in is cleaner long-term. Walls + large fixtures set the flag; pipes / decorative objects don't.
- Whole-scene fallback means the feature "just works" on first enable, with some false positives against small geometry.

Tagging collidables is a one-line change in each render component and can be done incrementally. Phase 12.E ships the fallback path; a follow-up can add the tags.

### Perspective-only guard

Orthographic projection is distance-invariant — shrinking the camera boom has zero visual effect, just moves the camera world-position inward. Worse: it could park the ortho camera *inside* scene geometry where the near plane clips weird things.

The controller early-returns when `camera.isPerspectiveCamera !== true`. In iso / top / elevation views the spring arm is simply inert.

### Feature flag (default off)

`featureFlagStore.springArmCamera` — off by default.

Rationale: in top-down CAD views the user WANTS to see through walls and floors; a spring arm would constantly clamp against the floor plane and feel intrusive. The feature is genuinely optional — valuable for close fixture inspection, noisy for standard plan-view work. Opt-in via the God Mode flags panel. Toggling off immediately reverts to standard OrbitControls behavior (the controller early-returns on !enabled).

## Consequences

**Good:**
- When enabled, the camera reliably stays outside walls + fixtures during perspective orbit. No more "I'm looking at the back side of a wall because my view punched through."
- Five-ray volumetric check catches thin occluders (door frames, pipe tees at angle) that a single center raycast would miss.
- Smoothing eliminates jitter; the camera feels like it's on a physical boom, not teleporting.
- Pure core with 20 unit tests — future tuning (different ray topologies, adaptive perpOffset) can land without risking regressions.
- Zero impact on existing orbit/pan/zoom. OrbitControls unchanged.

**Accepted costs:**
- 5 raycasts per frame @ 60 Hz = 300 raycasts/sec when active. For a 50-mesh scene (after collidable filtering) that's a few ms/frame. Acceptable; PerfHUD will surface if it spikes in practice.
- Rescans scene children every 1000 ms for collidables — allocation-free walk, cheap, but it's not zero. Mitigated by `userData.cameraCollidable` tagging which narrows the set to ~dozens rather than hundreds.
- Perpendicular offset is fixed (0.1 ft). Works for typical plumbing-CAD scales; might feel different in a very tight bathroom vs. a large commercial room. Can become a user-tunable setting if needed.
- The feature is useful mostly in perspective mode. Users who always work in iso views never benefit — hence the opt-in default.

**Non-consequences:**
- No change to IsoCamera, OrbitControlsGate, or any existing camera behavior. Spring arm is an additive overlay.
- No change to cutaway mode (ADR 024). Cutaway still dims walls between camera and focus in cutaway render mode; spring arm physically prevents the camera from entering those walls. They're complementary: cutaway is visual transparency, spring arm is physical collision.
- No new dependencies.

## Alternatives considered

**Use OrbitControls' built-in `minDistance` dynamically.** Writing to `controls.minDistance` each frame would clamp only the user-commanded dolly; orbit motion that translates the camera past a wall wouldn't trigger. The spring arm's target-to-camera line check covers all camera motion paths.

**Single center ray only (no corner rays).** 5× cheaper but misses thin obstructions (pipe elbows, door frames at angle). The 5-ray cost is small enough that the robustness wins.

**Full mesh-vs-mesh sweep test.** Catches every obstruction but burns real CPU (O(N) per mesh pair) and scales badly. Overkill for a CAD tool; a AAA game would use BVH tricks, we don't need to go there.

**Cascade of concentric rays (8, 16 rays).** Diminishing returns past 5. The 4 corner rays + center cover the camera volume well; denser sampling would catch rare edge cases at 3× the cost.

**Move the camera instead of orbital clamp.** Some cameras "dolly in on collision" by moving the camera to a safe spot and adjusting FOV. Rejected — feels unpredictable in CAD. Maintaining orbit direction and only shrinking the radius is the more honest behavior.

**Always-on / no feature flag.** Rejected — top-down CAD views collide against the floor plane constantly. The flag respects users who don't want the feature.

## Validation

- `Vitest`: `src/core/camera/__tests__/springArm.spec.ts` — **20 tests** covering:
  - No-collision path (2 tests).
  - Center-ray collision clamp math (1).
  - Corner-ray-only collision (1).
  - Closest-hit-wins across multiple rays (1).
  - `minDistance` floor enforcement (2).
  - Padding proportional to desired distance (2).
  - Degenerate camera-on-target (1).
  - Basis-vector construction for axis-aligned cameras (3).
  - `lerpDistance` helper (3).
  - `easeAlpha` helper (4).
- `tsc --noEmit` — expected clean (verification in progress).
- `vitest run` full suite — expected pass.
- `vite build` — expected pass.
- Manual test plan (requires the flag enabled):
  - In perspective mode, orbit the camera around a fixture until it would pass through a wall → camera distance shrinks smoothly to maintain visibility.
  - Switch to ortho iso view → spring arm no-ops (distance-invariant guard).
  - Disable the flag in God Mode → camera instantly returns to OrbitControls' raw position.

## Future work

- **Tag collidables in WallRenderer + FixtureModels** via `userData.cameraCollidable = true`. Replaces the whole-scene fallback with a surgical set.
- **Adaptive perpOffset** based on camera distance — tight scenes could use smaller offsets, wide scenes larger ones.
- **Expose the result in PerfHUD** as a "camera clamped" indicator for debugging mysterious "why did my view zoom in?" reports.
- **Integration test** that mounts `<SpringArmController>` + a known-position blocking mesh and asserts the camera clamps correctly over several frames. Useful once the feature has real users.
