# ADR 047 — Uponor / PEX Bend Behavior Wired In (Phase 14.U)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.U
- **Depends on:** ADR 046 (Fitting Cache), `PexBendClassifier`
  (introduced earlier but dormant until now).

## Context

The user's question: *"does uponor bend and have the tees how I
wanted originally?"*

Short answer pre-14.U: the **tees** shipped; the **bends** didn't.

Longer answer:

`PexBendClassifier.ts` has lived in the codebase since earlier work
with the canonical Uponor rule set: smooth the pipe through gentle
bends, emit an elbow at deliberate right angles, warn on kinks.
The top-of-file docblock even quotes the user's original ask:

> "uponor must behave organically by uniting and reconciling pipes
> which are drawn in 45 degree turns. when drawn in 90 degree turns
> then put a 90 degree fitting there instead of a bend, otherwise
> smooth out the edges… uponor doesn't generate 90s unless
> specifically asked for."

But the classifier was **never wired into the live renderer**.
`generateBendFittings(pipe)` short-circuited on every flexible
material with `if (!requiresBendFittings(material)) return []`, so
PEX pipes produced zero bend fittings regardless of geometry.

Meanwhile `generateFlexibleBendWarnings` existed as a backstop —
it emitted a `coupling` fitting flagged `illegalAngle` for every
PEX vertex > 30° deflection. That backstop was too aggressive
(30° is a deliberate route choice, not a kink) and completely
masked the right-angle-gets-an-elbow behavior the classifier was
written for.

Net effect to the user:
- Draw 3 PEX points at a right angle → saw a smooth curve, no elbow.
  The BOM didn't list the elbow either. Under-priced jobs.
- Draw a 45° deflection → got hit with a red `illegalAngle` coupling
  warning when 45° is a completely valid PEX bend.
- Tees at 3-way branches → worked correctly all along.

## Decision

Wire `classifyBend` into the bend-generation path for flexible
materials, and retire the misfiring legacy warning.

### New `generatePexBendFittings` in `FittingGenerator.ts`

```ts
for each internal vertex v:
  class = classifyBend(dirIn, dirOut, material)
  switch class.kind:
    'smooth_curve'  (< 15°)       → emit nothing
    'smooth_bend'   (15°–120°)    → emit nothing
                                    (MergedPexRun handles the tube)
    'fitting_90'    (90° ± 7°)    → emit bend_90 (ProPEX elbow)
    'sharp_bend'    (> 120°)      → emit bend_90 with illegalAngle
```

### `generateBendFittings` dispatch

```ts
function generateBendFittings(pipe):
  if !requiresBendFittings(material):
    return generatePexBendFittings(pipe)   // new 14.U path
  // ... existing rigid pipeline unchanged
```

### `generateFlexibleBendWarnings` emptied

The function becomes a no-op (returns `[]`) with a comment
explaining why. Kept as an export for API compatibility —
ExportPanel, printProposal.ts, and PhaseBOMPanel import it; we
don't want to churn every caller just to delete a function.

Its previous contract (emit coupling at > 30°) is superseded by
the new classifier path. Sharp bends are now reported at > 120°
(actual kink threshold from `SHARP_BEND_DEFLECTION_DEG`), not at
the old over-eager 30°.

### Branch tees untouched

The original ProPEX tee rendering at 3-way junctions was already
correct (`defaultTeeFor('pex', ...) === 'tee'`). No change needed.
The regression test "PEX branch junction emits a plain tee" locks
that behavior.

## Trade-offs

- **No PEX-specific elbow geometry yet.** `bend_90` is the same
  swept-torus geometry used for rigid 90° bends. Visually reads
  as an elbow; no ProPEX-ring distinctive detail. A future pass
  can add a dedicated `pex_elbow` type with a short straight stem
  + the expansion-ring lip. Not worth the geometry work until the
  core behavior ships + users confirm the intent is right.
- **PEX-A vs PEX-B not distinguished.** `'pex'` is one material in
  `PIPE_MATERIALS`. Uponor ships both PEX-A (AquaPEX, 6×OD cold
  bend) and — less commonly — PEX-B (10×OD cold). We model the
  PEX-A bend radius behavior for now. If a user hits a real PEX-B
  scenario we can split the material set + let the classifier
  pick thresholds by subtype.
- **Sharp-bend threshold is 120° of deflection.** At a single
  vertex that's extreme — near-reversal. PEX can also kink from
  too-short a radius across multiple vertices (e.g. a 180° return
  drawn with 10 vertices, each at 18°, each individually "smooth"
  but collectively sub-bend-radius). Not modeled here; the
  `EndpointExtender` UI prevents this in practice by enforcing
  the bend arc across the full run.

## Verification

- `npx vitest run` — 1073 tests pass (1066 prior + 7 new PEX
  cases in `FittingGenerator.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app (PEX material in toolbar):
  1. Draw a straight run → no fittings (✓ pre-existing).
  2. Draw 3 points at a right angle → **amber bend_90 elbow ghost
     appears** at the corner. Commit → real bend_90 lands.
  3. Draw 3 points at a 45° deflection → no fitting emitted
     (smooth tube handles it via MergedPexRun).
  4. Draw a near-reversal bend → red illegal-angle ghost; BOM
     flags the sharp-bend warning.
  5. Draw 3 PEX pipes meeting at a T (endpoint of two meeting
     endpoint of one) → tee fitting at the junction.

## Files

- `src/ui/pipe/FittingGenerator.ts`:
  - New `generatePexBendFittings` (~50 LOC).
  - `generateBendFittings` dispatch branch for flexible materials.
  - `generateFlexibleBendWarnings` emptied with explanatory
    comment, renamed underscore-prefixed pipe param.
  - Import added: `classifyBend` + thresholds from
    `PexBendClassifier`.
- `src/ui/pipe/__tests__/FittingGenerator.spec.ts`: 7 new tests
  locking the 14.U contract (90° elbow, 45° smooth, < 15° smooth,
  sharp-bend illegal, 3-way tee, rigid regression guard,
  multiple bends on one pipe).
