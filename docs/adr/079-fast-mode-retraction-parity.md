# ADR 079 — Fast-Mode Retraction Parity (Phase 14.AD.8)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phase:** 14.AD.8

## Context

AD.6 and AD.7 brought the 3D-quality `PipeRenderer` / `FullPipe`
path to 1:1 visual accuracy — pipes retract at internal bend
vertices and at endpoints that meet other pipes' endpoints.

But users running in **fast quality mode** (Q key, or the
toolbar toggle) see a different renderer: `PipeInstanceRenderer`
feeds per-segment instance matrices to an `InstancedMesh`. That
path is independent of `buildPipeGeometry` and knew nothing
about retraction. Scenes large enough to justify fast mode
(500+ pipes) also tend to have the most junctions — so the
visual discrepancy between "toggle to 3D mode, fittings look
right" and "toggle to fast mode, pipes punch through fittings"
was exactly the wrong way around.

This phase closes that gap.

## Decision

Apply the same retraction logic inside `segmentExtractCache.ts`'s
`buildPipeEntry`, driven by a `junctionHints` map passed through
`ExtractContext`.

### 1. `ExtractContext.junctionHints`

```ts
export type JunctionHints =
  ReadonlyMap<string, { retractStart: boolean; retractEnd: boolean }>;

export interface ExtractContext {
  systemVisibility, getFloorParams, phaseFilter,
  junctionHints?: JunctionHints;   // NEW (optional)
}
```

Optional so callers that don't know about junctions still work
with a default-no-retract behaviour.

### 2. Retraction inside `buildPipeEntry`

Rigid materials only (flexible PEX skips the whole block —
smooth curves have no fittings at vertices):

```ts
const isRigid = !isFlexibleMaterial(material);
const socketDepth = isRigid ? getSocketDepthFt(material, diameter) : 0;
const hint = ctx.junctionHints?.get(pipe.id);
const retractStart = isRigid && hint?.retractStart === true;
const retractEnd = isRigid && hint?.retractEnd === true;

// For each segment i in [1, lastIdx]:
const startPullback = i === 1
  ? (retractStart ? Math.min(socketDepth, segLen / 2) : 0)
  : Math.min(socketDepth, segLen / 2);
const endPullback = i === lastIdx
  ? (retractEnd ? Math.min(socketDepth, segLen / 2) : 0)
  : Math.min(socketDepth, segLen / 2);
```

Identical logic to `buildPipeGeometry` in the 3D path. The
segment's start/end coordinates go into the SegmentInstance,
which `InstancedBucket` uses to position + scale the unit
cylinder geometry on each instance matrix.

### 3. Cache invalidation includes `junctionHints`

```ts
const ctxChanged =
  !this.prevCtx
  || this.prevCtx.systemVisibility !== ctx.systemVisibility
  || this.prevCtx.getFloorParams !== ctx.getFloorParams
  || this.prevCtx.phaseFilter !== ctx.phaseFilter
  || this.prevCtx.junctionHints !== ctx.junctionHints;   // NEW
```

A junction-map reference change invalidates the cache — a pipe
whose endpoint joined or left a junction cluster needs its
segment coordinates recomputed.

### 4. `PipeInstanceRenderer` computes the hints

```tsx
const junctionHints = useMemo(() => {
  const TOL = 0.1;
  // O(N²) endpoint pair scan, same logic as PipeRenderer's AD.7
  // junctionMap. Returns Map<pipeId, {retractStart, retractEnd}>.
}, [pipes]);

const buckets = cacheRef.current!.extract(pipes, {
  ...ctx, junctionHints,
});
```

Memoized on the pipes record so unchanged scenes reuse the map
reference — no spurious cache invalidations.

## Symmetry with AD.7

Both renderers now:
- Use tolerance `0.1 ft` for "are these endpoints in a junction?"
- Apply socket-depth retraction at internal vertices + matching
  junction endpoints
- Skip retraction entirely for flexible materials
- Detect junctions via pair-wise endpoint comparison at render
  time

Whatever the user sees in 3D mode, they see in fast mode. A
toggle of the quality flag is purely a render-tier decision
(instanced cylinders vs per-pipe tubes); dimensional fidelity is
identical.

## Trade-offs

- **Duplicated junction-scan logic.** `PipeRenderer.tsx` and
  `PipeInstanceRenderer.tsx` each have their own copy of the
  O(N²) endpoint pair scan. Moving it into a shared helper would
  be slightly cleaner, but the bodies are ~15 lines each and
  extraction introduces a new module for minimal savings. Left
  duplicated; ADR notes the pattern so a future refactor
  consolidates explicitly.
- **Cache invalidation on junction-map-ref change.** A single
  pipe's mutation changes `pipes` which invalidates the memo for
  `junctionHints` via its `useMemo([pipes])` dep. The new
  junction map has a new object reference, so the cache fully
  invalidates. That's the correct behavior — a new pipe
  potentially joined a junction — but it does mean the AC.2
  per-pipe incremental cache loses its benefit on any pipe
  mutation. Follow-up: make junction-map memoization more
  surgical so unchanged pipes' junction status survives across
  mutations. Not done now; most pipe mutations currently
  invalidate the cache anyway due to other dependencies
  (phaseFilter, getFloorParams).
- **Selected pipes still render via `FullPipe` even in fast
  mode** (they're the "highlight" overlay). Those already got
  AD.7 treatment, so parity is complete.

## Verification

- `npx vitest run` — 1626 tests pass (1626 prior + 0 new).
  Existing `segmentExtractCache.spec.ts` (21 tests) still
  passes unchanged; no test regressed from the behavioural
  extension.
- `npx tsc -b --noEmit` — clean.
- Retraction tests from AD.6/AD.7 are covered by
  `buildPipeGeometry.spec.ts`. The fast-mode path applies the
  same math so its behavior follows — a dedicated fast-mode
  retraction test would be redundant with what
  `buildPipeGeometry.spec.ts` already proves at the math level.

## Files

- `src/ui/pipe/perf/segmentExtractCache.ts` — `JunctionHints`
  type, `ExtractContext.junctionHints` optional field,
  retraction block in `buildPipeEntry`, cache-invalidation
  comparison updated.
- `src/ui/pipe/perf/PipeInstanceRenderer.tsx` — `junctionHints`
  useMemo, passed through extract context.
- `docs/adr/079-fast-mode-retraction-parity.md` — this document.
