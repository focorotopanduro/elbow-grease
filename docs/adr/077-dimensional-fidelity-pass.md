# ADR 077 — 1:1 Dimensional Fidelity: PVC Socket Depth + Pipe-End Retraction (Phase 14.AD.6)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phase:** 14.AD.6

## Context

User explicitly requested "1:1 to scale as a simulation."
Auditing `PipeStandards.ts` against published ASTM/ANSI specs
surfaced two dimensional issues:

### 1. PVC socket depths ~50% too deep

The pre-AD.6 table was:

```ts
const PVC_SOCKET_DEPTH: Record<number, number> = {
  0.5:  0.875, 0.75: 1.125, 1: 1.375, 1.25: 1.625, 1.5: 1.875,
  2:    2.375, 2.5:  2.875, 3: 3.625, 4: 4.625,    6: 6.625,
};
```

Compare to ASTM D-2665 DWV socket depth (Charlotte Plastics /
Spears / JM Eagle all publish identical values within 1/32"):

| Nominal | Real DWV socket | Code value | Error |
|---|---|---|---|
| 1.5" | 1-1/4" (1.25") | 1.875" | +50% |
| 2" | 1-5/8" (1.625") | 2.375" | +46% |
| 3" | 2-1/4" (2.25") | 3.625" | +61% |
| 4" | 3" | 4.625" | +54% |

The smoking gun: the 2" entry (2.375") equals the 2" PVC pipe's
OUTSIDE DIAMETER (2.375" for Sch 40), and the 3" entry (3.625")
is close to 3" Sch 40 OD (3.500"). The original author almost
certainly pasted OD values by mistake.

**Downstream impact:** every fitting hub-shoulder geometry drew a
socket that was 50% too long along the pipe axis, making every
elbow / tee / wye / coupling visually stretched. BOM friction-
loss calculations (which use `getSocketDepthFt` internally)
slightly over-reported equivalent length.

### 2. Pipe ends overlap fitting hubs at bend vertices

Previously `buildPipeGeometry` rendered each rigid segment's
endpoints at the exact vertex coordinates. The elbow fitting at
the vertex also has hub shoulders extending back along each pipe
axis by `socketDepth`. Both occupy the same space — pipe inside
the hub. Visually: the fitting looks partially buried in the
pipe, or the pipe looks too long and "punctures" through the
fitting. Once AD.4 made rigid segments crisply straight and AD.5
made the elbow actually appear, this overlap became the dominant
remaining artifact.

Real plumbing: pipe terminates at `socketDepth` from the vertex;
the fitting hub covers the gap.

## Decision

### 1. Corrected socket-depth tables

Split the PVC table by schedule:

```ts
PVC_SOCKET_DEPTH_DWV    // ASTM D-2665 values
PVC_SOCKET_DEPTH_SCH40  // ASTM D-1785 Sch 40 pressure values
PVC_SOCKET_DEPTH_SCH80  // same as Sch 40 per Spears catalog
```

`getSocketDepthIn(material, nominalIn)` routes:
- `'pvc_sch40'` → Sch 40 pressure values
- `'pvc_sch80'` → Sch 80 pressure values
- `'abs'` → DWV values (ABS is DWV-only in residential)
- `'cpvc'` → Sch 40 values (close approximation)

Representative numbers:
| Nominal | DWV | Sch 40 | Sch 80 |
|---|---|---|---|
| 1.5" | 1.250 | 1.125 | 1.125 |
| 2" | 1.625 | 1.500 | 1.500 |
| 3" | 2.250 | 2.250 | 2.250 |
| 4" | 3.000 | 3.000 | 3.000 |

Fallback for unknown sizes: `nominalIn × 0.75` (was `× 1.1`).

### 2. Pipe-end retraction in `buildPipeGeometry` (rigid path)

For each internal bend vertex, pull back both adjacent segments'
endpoints by `socketDepth` along the segment direction:

```ts
const startPullback = i === 1 ? 0 : Math.min(socketDepth, segLen / 2);
const endPullback = i === lastIdx ? 0 : Math.min(socketDepth, segLen / 2);
const trimmedStart = rawStart.clone().addScaledVector(dir, startPullback);
const trimmedEnd = rawEnd.clone().addScaledVector(dir, -endPullback);
```

First + last segments keep their TRUE endpoints (no retraction
at pipe termini — those are generally open or hit a fixture, not
a fitting). Middle segments retract at both ends. Degenerate
super-short segments (`< 2 × socketDepth`) are skipped rather than
flipping inside-out.

Flexible (PEX) path is unchanged — smooth Catmull-Rom bends
don't have discrete fittings at vertices.

### Deliberate non-scope

- **Endpoint-to-endpoint junctions across two pipes.**
  AD.5 emits the correct elbow, but since `buildPipeGeometry`
  only sees a single pipe at a time, it can't know whether pipe
  A's endpoint meets pipe B's endpoint at another elbow. That
  retraction requires passing junction info from the scene
  level into the per-pipe geometry builder. Deferred to AD.7.
- **Hub oversize multiplier.** Audited against real-world values
  and is already accurate (PVC 1.16×, copper 1.04×, cast iron
  1.30×). No change.
- **Bend centerline radius.** Audited at 1.5× OD short-sweep,
  3.0× OD long-sweep, 1.0× OD 1/8 bend — all within ±5% of real
  fitting catalog values. No change.
- **PVC schedule visual distinction.** Sch 40 vs Sch 80 currently
  have identical socket depths per Spears (same hub body, thicker
  wall). The wall thickness difference isn't rendered because
  we draw pipes by outside-diameter only. A cross-section view
  would need the distinction; irrelevant here.

## Impact on end-user output

- Elbows, tees, wyes, couplings, reducers visually tighten to
  their real-world length. A 2" PVC 90° elbow's overall length
  shrinks from ~4.75" (2 × 2.375" socket) to ~3.25" (2 × 1.625")
  matching Charlotte PVC CPV-02311.
- Pipes no longer punch through fitting hubs at bend vertices.
  The fitting hub covers the last `socketDepth` of each pipe
  segment cleanly.
- BOM friction-loss calculations use slightly shorter equivalent
  lengths (socket depth feeds into the K-factor × OD formula in
  `getEquivLengthFt`). Effect: pipe sizing math may recommend
  slightly larger diameters in edge cases where the old
  over-reported equivalent length was right at a threshold.
  Cross-checked against BOMExporter test suite — all pass.
- Autosave bundles written before AD.6 load unchanged; the
  new socket depth is applied at render time.

## Verification

- `npx vitest run` — 1620 tests pass (1593 prior + 27 new: 23
  `pipeStandardsAccuracy` + 4 `buildPipeGeometry` retraction).
- `npx tsc -b --noEmit` — clean.
- The socket depth accuracy tests lock each authoritative spec
  value (PVC DWV 2" = 1.625", Sch 40 2" = 1.5", etc.) — any
  future drift from spec trips the test by name.
- A regression test asserts that a 3-point PVC pipe has no
  geometry vertex within `radius + 0.05 ft` of the internal
  bend vertex, confirming retraction actually moved material
  away from the corner.

## Files

- `src/core/pipe/PipeStandards.ts` — PVC socket depth table
  split into DWV / Sch 40 / Sch 80 tables with accurate ASTM
  values. `getSocketDepthIn` routes per material.
- `src/ui/pipe/buildPipeGeometry.ts` — rigid path now retracts
  each segment's endpoints at internal bend vertices by
  `socketDepth` (clamped to segment-length/2). First + last
  segments keep their true pipe-end extremes.
- `src/core/pipe/__tests__/pipeStandardsAccuracy.spec.ts` —
  23 tests locking ASTM/ANSI spec values for all materials.
- `src/ui/pipe/__tests__/buildPipeGeometry.spec.ts` — 4 new
  retraction tests.
- `docs/adr/077-dimensional-fidelity-pass.md` — this document.

## What's queued

- **14.AD.7** — endpoint-to-endpoint junction retraction.
  When pipe A and pipe B meet at their endpoints (AD.5 scenario),
  both pipes' endpoints should retract toward the shared vertex
  by socketDepth so the elbow hub fills cleanly. Requires
  passing scene-level junction info into per-pipe geometry.
- **14.AD.8** — coupling orientation fix (from AD.5 backlog).
- **14.AD.9** — inline pipe-section compatibility: when a pipe is
  drawn THROUGH an existing fitting's socket (e.g. straight pipe
  passing through a wye branch), the pipe should visually
  terminate at the socket entrance rather than extend through the
  fitting body. Rare scenario but breaks walkthroughs.
