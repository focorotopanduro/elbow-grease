# ADR 078 — Endpoint-to-Endpoint Junction Retraction (Phase 14.AD.7)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phase:** 14.AD.7

## Context

AD.5 fixed fitting emission for 2-pipe endpoint-to-endpoint
junctions (the user's exact screenshot scenario: two PVC pipes
meeting at a 45° corner). AD.6 retracted pipe segments at
**internal** bend vertices so the fitting's hub shoulder wouldn't
overlap the pipe body.

The remaining case: when **two separate pipes' endpoints** meet
at a shared vertex, AD.6's retraction doesn't apply because
`buildPipeGeometry` only sees ONE pipe at a time and never
retracts the endpoints of segment 1's start or the last
segment's end. The pipes continued to extend all the way to the
shared vertex — and AD.5's elbow fitting sits at that vertex
with its own hub shoulders extending back into the pipes.
Result: visible overlap where pipe geometry punches through
fitting hub geometry.

For a 1:1-scale simulation, this is the last major visual
artifact blocking "real plumbing looks like this."

## Decision

Lift the retraction decision up to `PipeRenderer`, which has
visibility of the entire pipe set, and pass per-pipe flags down
to `buildPipeGeometry`.

### 1. `BuildPipeGeometryInput` gains `retractStart` / `retractEnd`

Both optional booleans, default `false`. When true,
`buildPipeGeometry` applies socket-depth retraction at that
endpoint in addition to the always-on internal-vertex
retraction from AD.6.

```ts
export interface BuildPipeGeometryInput {
  points, diameter, material,
  retractStart?: boolean;  // NEW
  retractEnd?: boolean;    // NEW
}
```

### 2. `PipeRenderer` precomputes a `junctionMap`

One-pass O(N²) scan over the visible pipe list: for each pipe,
record whether its start and end meet another pipe's endpoint
within `JUNCTION_TOLERANCE` (0.1 ft, matching the tolerance
`FittingGenerator` uses for junction detection).

```ts
const junctionMap = useMemo(() => {
  const result = new Map<string, { retractStart, retractEnd }>();
  for (const p of visible) {
    // ... O(N) comparison against other pipes' endpoints
  }
  return result;
}, [visible]);
```

Memoized on `visible` so it only recomputes when the visible set
changes (not on unrelated UI state). For typical scenes (tens to
hundreds of pipes) this is sub-millisecond.

### 3. `FullPipe` receives the flags from the parent's map lookup

```tsx
<FullPipe
  pipe={pipe}
  retractStart={junctionMap.get(pipe.id)?.retractStart ?? false}
  retractEnd={junctionMap.get(pipe.id)?.retractEnd ?? false}
  ...
/>
```

Fallback to `false` if a pipe somehow isn't in the map (empty
scene after a quick edit, etc.) — same behaviour as the old
always-false default.

### Symmetry with AD.5 fitting generation

The junction-detection tolerance (0.1 ft) matches
`FittingGenerator.JUNCTION_TOLERANCE` exactly. That's
deliberate — both systems use the same threshold to decide "are
these two endpoints at the same vertex?" So whenever AD.5 emits
an elbow fitting at a junction, AD.7 retracts the pipe ends
that connect to it. One consistent vertex classification across
emission and rendering.

## What users will see now

- Two PVC pipes meeting at a 45° corner (the screenshot
  scenario): pipe A terminates at `socketDepth` from the corner.
  Pipe B terminates at `socketDepth` from the corner on the
  other side. The `bend_45` elbow fitting (emitted by AD.5,
  sized per-spec by AD.6) fills the gap cleanly with its hub
  shoulders extending back along each pipe axis.
- A single pipe with an internal 90° bend (unchanged from AD.6):
  internal vertex retracts as before.
- A pipe terminating at a fixture or open stub (no junction):
  endpoint keeps its full extent. Unchanged.
- PEX pipes meeting: flags still passed but PEX takes the smooth
  Catmull-Rom path which ignores the flags. No change for PEX.

## Trade-offs

- **O(N²) endpoint comparison.** Worst-case cost scales
  quadratically with visible pipe count. On a 500-pipe
  commercial scene that's 250k distance computations at render
  time — a few hundred microseconds, not a problem. If it ever
  becomes hot, a spatial hash on endpoint coords makes it O(N).
- **Junction detection tolerance duplicated.** Defined in both
  `FittingGenerator.JUNCTION_TOLERANCE` and `PipeRenderer`
  (inline `TOL = 0.1`). A shared constant would be slightly
  cleaner but they're both in the UI layer and the duplication
  is small. Could merge later.
- **Endpoint at fixture vs endpoint at junction.** Currently any
  endpoint within tolerance of another pipe's endpoint triggers
  retraction. If a pipe's endpoint happens to coincide
  accidentally with a fixture's connection point AND another
  pipe's endpoint, we retract — which is correct because the
  elbow fitting IS there per AD.5.
- **Retraction ONLY in 3D quality mode.** The `PipeInstanceRenderer`
  path (used in non-3d quality mode) is independent of
  `buildPipeGeometry` and doesn't honor the flags. That renderer
  is already crisp straight cylinders per AC.2, so overlap isn't
  as visually obvious — but for full 1:1 accuracy a later phase
  could apply the same retraction to instance matrix scaling.

## Verification

- `npx vitest run` — 1626 tests pass (1620 prior + 6 new).
  - 4 flag-behaviour tests: default off, start-only, end-only,
    both.
  - 1 regression: AD.6 internal-vertex retraction still runs
    regardless of the new flags.
  - 1 flexible guard: PEX ignores the flags.
- `npx tsc -b --noEmit` — clean.

## Files

- `src/ui/pipe/buildPipeGeometry.ts` — `retractStart` /
  `retractEnd` added to `BuildPipeGeometryInput`; pullback logic
  gated on the flags at segment boundaries (i===1 and
  i===lastIdx respectively).
- `src/ui/PipeRenderer.tsx` — `dist2` helper added;
  `junctionMap` useMemo computed from the visible pipe list;
  `FullPipe` signature extended with the two flags; both call
  sites (3D-quality render loop + selected-pipe overlay) pass
  the looked-up flags from `junctionMap`.
- `src/ui/pipe/__tests__/buildPipeGeometry.spec.ts` — 6 new
  tests covering the flag-retraction contract.
- `docs/adr/078-endpoint-junction-retraction.md` — this
  document.

## What's queued

- **14.AD.8** — apply the same retraction in
  `PipeInstanceRenderer` (instance matrix scaling) so non-3D
  quality mode also renders junctions cleanly. Currently that
  renderer is independent of `buildPipeGeometry`.
- **14.AD.9** — coupling axis alignment (AD.5 backlog). A 0°
  inline coupling emits but renders with identity rotation
  instead of aligning to the pipe axis.
- **14.AD.10** — pipe-mid-through-fitting (rare scenario:
  pipe passes through an existing fitting's body). Cosmetic.
- **14.AD.11** — sweep test confirming the end-to-end visual
  (screenshot → rendered correct) using a headless canvas. The
  unit tests cover the GEOMETRY contract but not the final
  pixel comparison; a future phase could add a visual-diff
  regression.
