# ADR 076 — 2-Endpoint Junction Emits Elbow, Not Tee (Phase 14.AD.5)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phase:** 14.AD.5

## Context

User-reported bug surfaced directly after shipping AD.4 (rigid
pipe straight-segment rendering). Screenshot showed two PVC pipe
segments meeting at a 45° corner with NO FITTING at the junction.

### Root cause

`generateJunctionFittings` in `FittingGenerator.ts` classified
every two-pipe endpoint-to-endpoint cluster by running through
`defaultTeeFor(material, branchAngleDeg, isDWV)`, which returns
one of:

- `'tee'` (supply)
- `'sanitary_tee'` (DWV, ~90° branch)
- `'combo_wye_eighth'` (DWV, other angles)

All three are **three-pipe fittings** — they model a main run
with a branch off it. At a 2-endpoint junction there IS no third
pipe. The emitted tee/wye was positioned at the vertex with a
`teeQuaternion` rotation assuming a branch relationship that
didn't exist. The geometry builder rendered the fitting at an
orientation where the branch pointed into empty space or back
inside the pipe body, making it either invisible or visually
nonsensical at the user's camera angle.

AD.4 made rigid pipes render as straight cylinders meeting at
crisp corners. Before that fix, TubeGeometry Frenet smoothing
visually blurred the vertex into a rounded curve, which masked
the broken fitting orientation. With the corner now crisp, the
broken tee position became visible as "no fitting at all."

**This is a classification bug, not a geometry bug.** Every
fitting type was already implemented with proper hub shoulders
(verified against `FittingMeshes.tsx` line-by-line in the
14.AD.4/5 investigation). The emitter was just picking the
wrong type.

## Decision

Add a dedicated `endpointCount === 2` branch in
`generateJunctionFittings` ahead of the tee-defaulting else
branch. The new branch:

1. Computes the TRUE bend angle. The junction code's `dirA` and
   `dirB` give outward-pointing axes from the junction, so the
   bend angle is `angleBetween(dirA, -dirB)`, not the previously-
   used `branchAngleDeg` which was the supplementary angle.
2. If bend < 5° (noise floor, same as `generateBendFittings`):
   emit `coupling` — an inline joint, no turn.
3. Otherwise run `classifyBendAngle` to snap to a detent
   (22.5° / 45° / 90° / long-sweep) and emit the matching
   `bend_*` fitting.
4. For copper / CPVC / galvanized, remap snapped detents to the
   legacy `elbow_*` name convention (matches how
   `generateBendFittings` handles the single-pipe-with-internal-
   vertex case).
5. Propagate `illegalAngle` + `measuredAngleDeg` for off-detent
   bends so the BOM surface and compliance checks continue to
   see the deviation.

### Pipeline after the fix

```
2 pipes meeting at endpoints:
  Step 1: countEndpointsNear() returns 2 at the shared point
  Step 2: is4WayCross (requires >=4) → false
  Step 3: isReducer (diameter mismatch >0.1) → false for matching diameters
  Step 4: NEW — 2-endpoint branch → classifyBendAngle(true bend) → bend_{22.5|45|90}
          (or coupling at <5°, or elbow_* for legacy copper/CPVC naming)
  Step 5: else branch (tee/wye/combo) now only runs for 3+ endpoint clusters
```

### Test coverage

`src/ui/pipe/__tests__/junctionElbow.spec.ts` — 11 tests.

- PVC 45° / 90° / 22.5° bends emit the correct `bend_*` type.
- Copper 45° / 90° emit legacy `elbow_*` names.
- Straight (0°) emits `coupling`.
- 3-pipe tee still emits tee/sanitary_tee (regression guard for
  the 3+ endpoint path being unaffected).
- 4-pipe cross still emits `cross`.
- Reducer still emits on diameter mismatch.
- Quaternion components are finite.
- 45° vs 90° produce different quaternions (orientation follows
  the bend).

One existing test was updated: `FittingGenerator.spec.ts` had a
case "2-way junction at 90° → sanitary_tee" that was enforcing
the bug. Updated to assert the corrected elbow emission, with a
comment explaining the AD.5 change.

## Trade-offs

- **Behavior change on scenes built before AD.5.** Any saved
  project that had 2-pipe endpoint junctions will now show an
  elbow where it previously showed a nothing-or-broken tee.
  That's the fix — users who saw missing fittings now see them
  correctly. Compliance + BOM output also changes: the
  unit-price and labor-hours for `bend_45` differ from
  `combo_wye_eighth`. Reviewed the BOM rows: elbow pricing is
  strictly lower than combo wye pricing at all diameters, so
  historical bids printed before AD.5 were technically over-
  priced — the fix brings numbers into alignment with real
  take-off.
- **No extension of 3-endpoint tee logic.** The existing
  `defaultTeeFor` still runs for 3+ endpoint clusters — covered
  by the "tee / cross / reducer" regression tests that still
  pass. This phase only fixes the specific 2-endpoint case.
- **Coupling quaternion uses `bendQuaternion`.** For a 0° bend,
  `bendQuaternion` falls through to identity rotation (line 102
  of FittingGenerator.ts). The coupling renders along the world
  Y axis rather than along the pipe axis. Cosmetic for inline
  joints; not critical for correctness. Deferred to a polish
  phase.
- **Endpoint-to-midpoint junctions (one pipe T'ing into another
  midway along)** still route through the existing tee branch
  because `endpointCount === 2` requires both pipes' endpoints
  at the shared point. A pipe that T's into a midpoint has
  endpoint+midpoint, not 2-endpoints. That's the correct
  real-world behavior — the T'ing pipe genuinely is a branch
  into the main, so a tee/san-tee/combo is appropriate.

## Verification

- `npx vitest run` — 1593 tests pass (1582 prior + 11 new).
  One pre-existing test was updated to reflect the fix;
  diffed against the old assertion in-place.
- `npx tsc -b --noEmit` — clean.

## Files

- `src/ui/pipe/FittingGenerator.ts` — new `endpointCount === 2`
  branch before the tee fallback.
- `src/ui/pipe/__tests__/junctionElbow.spec.ts` — 11 regression
  tests locking the new emission contract.
- `src/ui/pipe/__tests__/FittingGenerator.spec.ts` — one
  existing test updated from "expect tee" to "expect elbow" with
  a comment referencing this ADR.
- `docs/adr/076-two-endpoint-elbow-emission.md` — this document.

## What's queued

- **14.AD.6** — dimensional fidelity pass. User asked for "1:1
  scale simulation." Audit `PipeStandards.ts` against ASTM /
  ANSI actuals for: pipe OD by schedule, fitting socket depth,
  hub outer diameter, bend centerline radius by fitting class
  (DWV short-sweep vs long-sweep vs supply elbow). Retract pipe
  segments by socket depth at each bend vertex so the pipe-end
  meets the fitting hub shoulder cleanly rather than overlapping
  inside the hub geometry.
- **14.AD.7** — coupling orientation (inline-joint axis
  alignment).
