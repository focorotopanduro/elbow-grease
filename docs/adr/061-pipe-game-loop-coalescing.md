# ADR 061 — Pipe Game-Loop Coalescing (Phase 14.AC.1)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.1
- **Depends on:** ADR 024 (rendering foundation), Phase 14.Q live-preview
  rewrite, Phase 14.X collision detection.

## Context

An audit of the pipe drawing loop — pointer input → ghost preview →
route commit → solver → pipe render — found the **preview layer** was
running far harder than it needed to.

Every emission of `EV.PIPE_ROUTE_UPDATE` woke three subscribers:

| Subscriber | Per-event cost |
|---|---|
| `LiveRoutePreview` | `setState` + `useMemo` segment rebuild |
| `LiveFittings` | `setState` + `generateAllFittings` angle math on every point triple |
| `InterferenceVisualizer` | `setState` + `predictCollisions` — **O(elements × points)** |

`SpatialPipeInteraction` fires `PIPE_ROUTE_UPDATE` on every pinch-move
that clears the 0.3-unit snap threshold — there is no debounce. On a
120 Hz high-refresh display during a fast drag that's 120+ events per
second, all three subscribers paying full cost on each.

Display refresh is a hard ceiling — humans can't perceive updates
faster than the screen paints — so computing collision predictions
120× per second while the screen draws 60 or 120 frames is pure waste.

A second, separate issue: `PivotPreview`'s `GhostPipe` rebuilds
`CatmullRomCurve3 + TubeGeometry` in a `useMemo([points, radius])`.
The pivot controller regenerates `points` every frame from fresh
math, so the array IDENTITY changes even when its VALUES are
identical — cue geometry rebuild 60× per second during a stationary
grip.

## Decision

Two small, targeted primitives. No architectural change; no
subscriber behaviour change for anyone but the preview hot path.

### 1. `src/hooks/useRafEvent.ts`

```ts
useRafEvent<T>(event: string, handler: Handler<T>): void;
```

Drop-in replacement for `useEvent`. Coalesces all emissions arriving
within one animation frame into a **single** handler call with the
**latest** payload.

Mechanism:

- Each emission stores payload on a ref and schedules one `rAF` if
  none is pending.
- The rAF callback reads the latest payload, clears it, and invokes
  the handler.
- Unmount cancels any pending frame → no trailing calls after tear-
  down.
- Handler identity is tracked via ref so React re-renders don't
  re-subscribe to the bus.

Wired into three subscribers:

- `src/ui/InterferenceVisualizer.tsx` — the biggest win. Collision
  prediction is O(elements × points) and was running on every
  pointer event.
- `src/ui/pipe/LiveFittings.tsx` — `generateAllFittings` does trig
  per point triple.
- `src/ui/pipe/LiveRoutePreview.tsx` — cheaper (just React state +
  segment memo) but same principle: no point churning the fiber
  tree past display refresh.

`SpatialAudio` and `SpatialPipeInteraction` itself keep the
non-coalesced `useEvent` because they need to react to every state
transition (audio phase, FSM dispatch) — opt-in at the call site is
the right granularity.

**Why not bus-level throttle?** Some subscribers (audio engine,
FSM, analytics) need every event. Blanket-throttling the bus would
break correctness. Keeping the coalescer in the hook lets us opt
in per hot-path.

### 2. `src/ui/pipe/perf/pointsKey.ts`

```ts
pointsKey(points: readonly Vec3Tuple[]): string;
```

Returns a compact value-hash string (`"3:0,0,0|5,0,0|5,0,5"`) that
is byte-equal for structurally-equal polylines and differs when any
coord moves by > 1e-4 (≈ 0.03 mm in plumbing units — well below
the routing grid's 0.3-unit snap).

Wired into `PivotPreview.GhostPipe`:

```ts
const key = pointsKey(points);
const geometry = useMemo(buildTube, [key, radius]);
```

So identical-content arrays across frames produce identical keys,
and `useMemo` skips the rebuild. Only a real user nudge crosses the
precision threshold and forces a new geometry.

### Coverage

| File | New tests |
|---|---|
| `useRafEvent.spec.ts` | 6 (burst coalesce, per-frame invocation, silence, unmount safety, handler ref swap, 10-event storm) |
| `pointsKey.spec.ts` | 10 (stability, sub-precision tolerance, count change, prefix aliasing, degenerate inputs, NaN guard, real pivot simulation) |

## Trade-offs

- **Latency floor ≈ 1 frame (≈ 16.7 ms @ 60 Hz).** The hot subscribers
  now respond one frame later than before in the worst case. This is
  imperceptible — it's exactly the cadence the display updates at.
- **Per-frame call is guaranteed when events arrive.** We do NOT
  skip frames to target 30 Hz. A 30 Hz cap was considered but rejected
  because occasional single-event frames (e.g. the final point before
  commit) must paint immediately — halving feedback responsiveness
  across the board to save a few more milliseconds would be penny-
  wise.
- **rAF fallback.** Non-browser environments (vitest without jsdom's
  rAF polyfill) fall back to `setTimeout(0)`. Test suite fakes both
  timer paths so assertions work either way.
- **pointsKey precision fixed at 1e-4.** Configurable would add API
  surface for no real use case. If callers need a different
  precision they can wrap a custom hash — this one is calibrated for
  the plumbing-units + 0.3-unit-snap reality.
- **Not applied to committed-pipe renderer.** `PipeInstanceRenderer`'s
  `extractSegments` walk is a separate (real, medium-severity) hotspot
  tracked for future work — it fires on layer-toggle + pipe-mutation,
  not at pointer rate, so it's a different latency profile.

## Verification

- `npx vitest run` — 1389 tests pass (1373 prior + 16 new: 6
  useRafEvent + 10 pointsKey).
- `npx tsc -b --noEmit` — clean.
- Manual: during a fast mouse drag with ~30 structural elements in
  scene, prior CPU usage in the preview hot path showed
  `predictCollisions` dominating the frame. After this change it
  drops to once-per-frame regardless of pointer rate.

## Files

- `src/hooks/useRafEvent.ts` — 88 LOC new.
- `src/ui/pipe/perf/pointsKey.ts` — 58 LOC new.
- `src/hooks/__tests__/useRafEvent.spec.ts` — 6 tests new.
- `src/ui/pipe/perf/__tests__/pointsKey.spec.ts` — 10 tests new.
- `src/ui/InterferenceVisualizer.tsx` — `useEvent` → `useRafEvent`
  on `PIPE_ROUTE_UPDATE`.
- `src/ui/pipe/LiveFittings.tsx` — `useEvent` → `useRafEvent` on
  `PIPE_ROUTE_UPDATE`.
- `src/ui/pipe/LiveRoutePreview.tsx` — `useEvent` → `useRafEvent`
  on `PIPE_ROUTE_UPDATE`.
- `src/ui/pipe/PivotPreview.tsx` — GhostPipe `useMemo` dep
  `[points, radius]` → `[pointsKey(points), radius]`.
- `docs/adr/061-pipe-game-loop-coalescing.md` — this document.

## What's queued

- **14.AC.2** — `PipeInstanceRenderer.extractSegments` diff cache
  (skip re-bucketing for unchanged pipes). Layer-toggle + single-
  pipe-mutation path.
- **14.AC.3** — Worker-side batch solve: queue multiple
  `PIPE_COMPLETE`s into one `SOLVE_REQUEST` rather than N per the
  current 50ms debounce. Measurable on multi-pipe paste + riser
  templates.
