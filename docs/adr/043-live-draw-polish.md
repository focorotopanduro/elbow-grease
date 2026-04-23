# ADR 043 — Live Draw Polish (Phase 14.Q)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Q
- **Depends on:** 7.B (Fitting Generator), 14-bug-fix (angleSnap), ADR 024 (Rendering Foundation).

## Context

Before this pass the live draw preview had three specific faults the
user called out as "not smooth / not dialed in":

1. **Splined tube.** `LiveRoutePreview` used `CatmullRomCurve3` to
   stitch a single smooth tube through every waypoint. Real
   plumbing is never splined — a 47° bend is two straight pipes
   meeting at an elbow, not a smooth curve. The splined preview
   misled the user about what the committed geometry would actually
   look like. First time hitting commit on a mid-draw "soft curve"
   was a surprise every time.

2. **Fixed 2" diameter.** Preview radius hardcoded to 2", regardless
   of the actual `drawDiameter` selected in the toolbar. A plumber
   dragging a 4" main saw a 2" ghost. Post-commit the pipe jumped to
   its correct size — another "huh, that's not what I drew" moment.

3. **No junction preview.** Fittings only rendered after commit
   (via `FittingRenderer`). So the user draws three segments, sees a
   smooth splined noodle, hits commit, and THEN finds out the 47°
   was "illegal" or that the 93° got snapped to 90°. Preview had
   zero signal about the real fitting outcomes.

Also on the list but less visually obvious:

4. **Single length sphere** at the midpoint — a 3 mm dot, not a
   label, so users couldn't read pipe length during draw.

5. **No pitch reading.** `PitchIndicators` runs on committed pipes
   only. A plumber drawing a waste run had no visibility into the
   ¼"/ft slope until after commit.

6. **Full pulse on opacity + emissiveIntensity** — flickery, made
   small diameter ghosts hard to read at certain camera angles.

## Decision

Ship three pieces + reuse two existing systems:

### 1. `liveRouteBuild.ts` — pure math (`src/core/pipe/`)

One module owns the "turn polyline → render-ready geometry data"
math. Zero Three, zero React, zero Zustand. 32 unit tests lock the
behavior.

**Public surface:**

```ts
function buildRouteSegments(points): RouteSegment[]
interface RouteSegment {
  a, b: Vec3; length, slopeInchesPerFoot: number;
  mid: Vec3; isVertical: boolean; direction: Vec3;
}

function bendAnglesDeg(points): number[]     // for every internal vertex
function totalLength(points): number
function requiredSlopeForDiameter(d): number  // IPC 704.1
function classifySlope(slope, d): 'compliant'|'marginal'|'undershot'|'flat'
```

Zero-length segments (user double-clicks the same spot) are
silently dropped — the old splined renderer would silently produce
degenerate curves here; the segmented renderer would produce a
zero-height cylinder that lit as a dark disc artifact.

**Why duplicate the IPC slope table** — `DimensionHelpers.tsx`
hand-inlined the same thresholds. Phase 14.Q factors them into a
reusable pure function; a follow-up pass can swap the inline
version in DimensionHelpers for an import without touching
behavior (tests lock the outputs).

### 2. `LiveRoutePreview.tsx` — rewritten

Segment-based cylinder rendering, one mesh per polyline edge. Each
cylinder is sized with the **current** `drawDiameter` +
`drawMaterial` read live from `interactionStore`, so the preview
always matches the pending commit.

Every segment gets a Billboard label showing:
- Length in ft (always)
- Slope in inches per foot (only for DWV-relevant materials where
  code minimums apply — `pvc_sch40`, `pvc_sch80`, `abs`,
  `cast_iron`). Color-coded to the same
  compliant/marginal/undershot palette the committed
  `PitchIndicators` uses, so visual language is identical pre- and
  post-commit.
- "VERT" on pure vertical segments (slope undefined).

A running total-length badge (`Σ 17.65 ft`) floats at the drawing
head so the plumber knows exactly how much footage they've laid.

The pulse animation is softened: opacity oscillates ±0.07 at 2.5 Hz
(down from ±0.1 at 3 Hz + emissive ±0.2 at 4 Hz). Reduces the
"flickering" read in small-diameter previews.

### 3. `LiveFittings.tsx` — new

Synthesizes a fake `CommittedPipe` from the draw points + current
material + diameter, runs the production `generateAllFittings` on
it, and renders each resulting `FittingInstance` as a ghost mesh
with a floating label.

Geometry is reused from `FittingMeshes.tsx`'s type caches
(`getElbow90Geo`, `getElbow45Geo`, `getBend22_5Geo`,
`getBend90LongSweepGeo` — previously module-private, now exported
for cross-component reuse). Same cache → same geometry identity →
no extra GPU memory, and the caches stay warm for when the pipe
actually commits.

Ghost material is amber (`#ffd54f`) so it reads distinct from both
the cyan drawing tube and the cool-blue committed pipe colors.
Fittings with `illegalAngle: true` flash red (`#ff1744`) with a
"47° · ILLEGAL" label so the user can correct before commit rather
than get a compliance warning after.

### 4. App wiring

`LiveRoutePreview` + `LiveFittings` are mounted once each in
`App.tsx`'s Scene. Both self-gate on EV.PIPE_DRAG_START /
PIPE_CANCEL / HILO_EV.ROUTES_GENERATED, so when no draw session is
active they return `null` — zero render cost when idle.

### 5. Pulse softening

All three components read `useReducedMotion` and freeze their
oscillations at mid-range values when reduced motion is on —
matches the accessibility contract ADR 016 established.

## Trade-offs

- **One cylinder per segment, not one merged tube.** A 20-point
  route produces 19 draw calls. For interactive feedback on what's
  usually a ≤ 10-segment single pipe, this is fine; production
  merged-tube rendering lives in `PipeRenderer` (committed pipes
  only). Merging the live preview would mean rebuilding the merged
  buffer every pointer tick (60+ Hz) — strictly worse for the
  draw-hot path.
- **Fake `CommittedPipe` for fitting generation.** LiveFittings
  allocates a throwaway CommittedPipe-shaped object every time the
  points change. Same JS engine GCs will collect it in milliseconds;
  stringent perf review later can swap to a reusable singleton if
  the allocation shows up in a flamechart. For now, clarity of
  intent wins over micro-optimization.
- **No fixture-to-pipe junction preview yet.** When the user is
  drawing INTO an existing fixture's snap point, we could show the
  closet flange (or sink trap) preview too. That requires live
  connectivity inference and belongs to a later phase.

## Verification

- `npx vitest run` — 1011 tests pass (979 pre-phase + 32 new for
  `liveRouteBuild`).
- `npx tsc -b --noEmit` — clean.
- Manual (post-rebuild): start a draw session, lay 3 points with a
  ≤ 45° turn at the middle vertex → yellow ghost elbow appears +
  labelled "45° bend"; every segment labelled with length + slope
  (DWV context). Bump the middle point so the angle becomes 47° →
  ghost fitting turns red + label reads "47° · ILLEGAL". Drop the
  segment into a sloped one (drag in Y) → slope label reads
  "0.25"/ft" in green when ≥ code min.

## Files

- `src/core/pipe/liveRouteBuild.ts` — pure module, 170 LOC
- `src/core/pipe/__tests__/liveRouteBuild.spec.ts` — 32 tests
- `src/ui/pipe/LiveRoutePreview.tsx` — rewritten, 270 LOC
- `src/ui/pipe/LiveFittings.tsx` — new, 180 LOC
- `src/ui/pipe/FittingMeshes.tsx` — four geo accessors exported
- `src/App.tsx` — two mounts + one import group
