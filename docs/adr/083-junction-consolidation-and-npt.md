# ADR 083 — JUNCTION_TOLERANCE Consolidation + NPT Engagement (Phases 14.AD.14 + 14.AD.15)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phases:** 14.AD.14, 14.AD.15

## Context

Two pending cleanup items from the AD backlog, shipped together
because they're orthogonal fixes that both surfaced via code-
audit rather than user reports.

### AD.14 — JUNCTION_TOLERANCE copy-pasted six times

The constant "what distance means these two pipe endpoints meet
at the same vertex" was defined six times across the codebase:

| File | Value |
|---|---|
| `FittingGenerator.ts` (authoritative) | 0.15 |
| `pipeCollision.ts` | 0.15 (comment references FittingGenerator) |
| `hotSupplyPropagation.ts` | 0.15 |
| `condensateValidation.ts` | 0.15 |
| **`PipeRenderer.tsx` (AD.7)** | **0.1** ← inconsistent |
| **`PipeInstanceRenderer.tsx` (AD.8)** | **0.1** ← inconsistent |

The last two — which I wrote during AD.7 and AD.8 — picked 0.1
without checking the other call sites. Each ADR comment even
claimed "matches FittingGenerator.JUNCTION_TOLERANCE exactly,"
which was wrong. Not just duplication: an actual bug. A fitting
could emit at an endpoint gap up to 0.15 ft (FittingGenerator's
threshold), but the renderer only retracted pipe ends at gaps
under 0.1. At gaps in (0.1, 0.15], the fitting appeared
correctly positioned and the pipes extended past it, overlapping
the hub.

### AD.15 — Galvanized steel socket depth used a flat 0.9× multiplier

`getSocketDepthIn` for `galvanized_steel` returned `nominalIn * 0.9`.
That's within ~30% of real NPT L2 engagement at 1" (0.9 vs
0.6828"), but diverges badly at larger sizes (at 4" the old value
was 3.6" vs real L2 = 1.3"). The discrepancy made galvanized
steel fittings render visibly stretched along the pipe axis.

ASME B1.20.1 specifies L2 (effective thread length required for
a pressure seal) for every standard NPT size. Using L2 as the
"socket depth" equivalent for galvanized threaded fittings gives
real 1:1 geometry.

## Decision

### AD.14 — Single canonical constant module

```ts
// src/core/pipe/junctionConstants.ts
export const JUNCTION_TOLERANCE_FT = 0.15;
export const JUNCTION_TOLERANCE_FT_SQ = 0.15 * 0.15;
```

All six consumers import from here. The two stale-0.1 renderers
now correctly match 0.15. A single spec
(`junctionConstants.spec.ts`) locks the value + sanity-checks
that it stays below the 0.5 ft draw snap grid and above typical
click-noise.

### AD.15 — NPT L2 engagement table per ASME B1.20.1

```ts
const GALV_NPT_ENGAGEMENT: Record<number, number> = {
  0.125: 0.2611, 0.25: 0.4018, 0.375: 0.4078,
  0.5:   0.5337, 0.75: 0.5457, 1:     0.6828,
  1.25:  0.7068, 1.5:  0.7235, 2:     0.7565,
  2.5:   1.1375, 3:    1.2000, 4:     1.3000,
  5:     1.4063, 6:    1.5125,
};
```

`getSocketDepthIn('galvanized_steel', n)` now returns
`GALV_NPT_ENGAGEMENT[n] ?? n * 0.9`. In-table sizes get the real
L2 value; out-of-table sizes fall through to the old flat
multiplier (defensive fallback — preserves behavior for unusual
sizes not in the standard NPT range).

7 new tests in `pipeStandardsAccuracy.spec.ts`:

- Each representative size's exact L2 value
- 4" is 1.3", NOT 3.6" (the old buggy value) — named regression
  guard
- Out-of-table size (5.5") falls back to 0.9× multiplier
- Monotonic non-decreasing with size (sanity check)

### Snapshot regeneration

AD.15 changed galvanized steel's socket depth, which feeds into
the internal-vertex retraction in `buildPipeGeometry`. Running
`vitest run pipeGeometrySnapshot.spec.ts -u` regenerated
**exactly 9 snapshots** — every galvanized steel bend case in
the matrix. No other snapshots flipped. This is the AD.13
harness working perfectly: blast radius confined to the cases
whose input (socket depth) changed; everything else untouched.

Reviewed the snapshot diff before committing: hashes + dim
fingerprints shifted only on galvanized_steel entries. Nothing
unexpected — the scope of the change matches the scope of the
regeneration.

## What each fix delivers

| Concern | Before | After |
|---|---|---|
| Fitting / renderer tolerance match | 0.15 / 0.1 (mismatch) | 0.15 / 0.15 |
| Constant defined in N places | 6 | 1 (+ 6 importers) |
| 4" galvanized socket depth | 3.6" (stretched) | 1.3" (ASME-accurate) |
| Galvanized fitting dimensional fidelity | ~30-180% error | within table precision |

## Trade-offs

- **Out-of-table NPT sizes still use the old multiplier.** 5.5"
  isn't in ASME B1.20.1's standard table; keeping `n × 0.9` as
  fallback preserves old behavior there while fixing the common
  cases. If real contractor usage surfaces a non-standard size
  (e.g. 3.5"), add an entry and regenerate snapshots.
- **Renderer tolerance bump from 0.1 → 0.15 doesn't break any
  existing snapshot.** The snapshot harness (AD.13) feeds
  explicit `retractStart`/`retractEnd` flags into
  `buildPipeGeometry` — it bypasses the renderer-level
  decision about WHETHER to retract. So the consolidation
  changed real-time runtime behavior without changing what the
  harness locks. That's by design.
- **No rollout-gate for the 0.1 → 0.15 change.** In theory a
  user with saved scenes where endpoints are 0.12 ft apart
  might see their pipes suddenly retract where they didn't
  before. In practice the draw grid snaps to 0.5 ft; any
  endpoint-to-endpoint pair at 0.12 ft would be the result of
  manually-nudged geometry, not common. Accepted without a
  compatibility flag.

## Verification

- `npx vitest run` — 1991 tests pass (1981 prior + 10 new:
  3 junctionConstants + 7 NPT engagement). 9 pipe geometry
  snapshots regenerated intentionally for galvanized_steel
  bends; diff-reviewed before committing.
- `npx tsc -b --noEmit` — clean.

## Files

- `src/core/pipe/junctionConstants.ts` — new; single source of
  truth for `JUNCTION_TOLERANCE_FT` + squared variant.
- `src/ui/pipe/FittingGenerator.ts` — imports constant.
- `src/core/interference/pipeCollision.ts` — imports constant.
- `src/core/fixtures/hotSupplyPropagation.ts` — imports constant.
- `src/engine/compliance/condensateValidation.ts` — imports constant.
- `src/ui/PipeRenderer.tsx` — imports constant; was 0.1, now
  0.15 (bug fix, not just consolidation).
- `src/ui/pipe/perf/PipeInstanceRenderer.tsx` — imports
  constant; was 0.1, now 0.15 (bug fix).
- `src/core/pipe/PipeStandards.ts` — `GALV_NPT_ENGAGEMENT`
  table added; `getSocketDepthIn` for galvanized_steel uses
  the table with 0.9× fallback.
- `src/core/pipe/__tests__/junctionConstants.spec.ts` — 3 tests.
- `src/core/pipe/__tests__/pipeStandardsAccuracy.spec.ts` — 7
  NPT tests added (now 30 total).
- `src/ui/pipe/__tests__/__snapshots__/pipeGeometrySnapshot.spec.ts.snap` —
  9 galvanized_steel snapshots regenerated.
- `docs/adr/083-junction-consolidation-and-npt.md` — this document.

## What's queued

- **AD.16** — bushing auto-emitter (pipe meets fitting outlet
  at mismatched diameter).
- **AD.17** — equivalent snapshot spec for
  `segmentExtractCache.ts` output (fast-mode rendering
  dimensional coverage).
- **AD.18** — optional pixel-diff layer for shader/material.
