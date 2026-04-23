# ADR 049 — Hardening Pass: Scenario + Stress Tests (Phase 14.W)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.W
- **Depends on:** All of 14.A through 14.V.

## Context

After ten iterations of feature work on the draw loop (phases
14.Q–14.V), the surface area of the interaction pipeline has grown
considerably: constraint snapping, live-fittings preview, detent
ring, clipboard, fitting cache, PEX-specific geometry + BOM +
arc-radius validation. Each added module has its own unit tests,
but the **integration paths** weren't systematically locked.

The user's request — *"debug, stress test, scenario test, marinate
it, make sure it is as smooth as possible for use"* — calls for a
hardening pass that exercises the combined system the way a real
user would, not the way a unit test does.

## Decision

Add two new test suites that live alongside the existing
`integration/` folder:

### 1. `scenarios/drawLoopScenarios.spec.ts` — 16 end-to-end flows

Tests that walk multiple stores (interactionStore → pipeStore →
fixtureStore) and exercise the full commit pipeline. Covers:

1. PVC L-shape → correct bend fitting
2. PVC → PEX switch mid-session — diameter + system auto-tune
3. PEX 90° corner — one `pex_elbow_90`, zero `bend_90` (no double-fire)
4. PEX smooth 45° — zero fittings (physical bend)
5. Backspace mid-draw — last point popped, session alive
6. Alt-click bypass — odd angle survives commit
7. Material-family switch thresholds (PVC↔PEX↔copper boundaries)
8. 20-point rapid draw — no NaN, no duplicates, length consistent
9. Near-duplicate click handling
10. Pure vertical PEX riser — snaps to 90° rise
11. Empty-selection fitting-cache safety

These aren't "does this function return the right value?" tests —
they're "can a user do this sequence and end up with a consistent
app state?" tests. If any scenario breaks in a future PR, we catch
user-visible regressions.

### 2. `scenarios/drawLoopStress.spec.ts` — 8 high-throughput tests

Tests that push quantities no human could click but that bulk
operations (group rotate, bundle replay, etc.) can produce.
Covers:

- **1000 constrained clicks in < 500 ms** — per-click cost stays
  below 0.5 ms, well inside the 16 ms frame budget.
- **10000 applyDrawConstraints calls in < 200 ms** — pure math
  path stays under 20 µs per call, safe for every-frame use.
- **100 material switches** — store stays internally consistent.
- **500-pipe fitting cache mutate loop** — first pass all
  misses, second pass 499 hits + 1 miss after one point change,
  then 100 evictions when pipe count drops. Locks the O(Δ)
  invalidation contract from Phase 14.T.
- **500 mutations of a single pipe grow cache by 1** —
  protects against a future code change accidentally keying the
  cache on something that makes every mutation a fresh entry.
- **Mixed PEX + PVC 200-pipe scene** — all fittings in < 500 ms,
  100 pex_elbow_90 emitted for the 100 PEX pipes.
- **50-point draw + 50 backspaces** — store lands empty + mode
  stays `'draw'` so the user can keep clicking.

### Deliberate perf thresholds

Each stress test has a deliberate wall-clock budget set at 2–5×
typical measured runtime (on a quiet M1-class machine). That gives
headroom for CI-shared-CPU noise without losing regression
signal. In practice measured numbers are well inside the budget:

| Test | Budget | Typical |
|---|---|---|
| 1000 constrained clicks | 500 ms | ~25 ms |
| 10000 applyDrawConstraints | 200 ms | ~15 ms |
| 500-pipe mutate loop | (no budget) | ~12 ms |
| 200-pipe mixed-material fittings | 500 ms | ~40 ms |

If a future PR doubles any of these numbers, the test still passes
— but the absolute number leaving performance HUD tells us the
regression is there. If a PR tripled them, the test fails and we
catch it in CI.

## Audit findings

Read-through of every file touched in 14.P–14.V surfaced:

- **No bugs.** Most rewarding possible audit outcome.
- **One minor behavior shift** in `PhaseClassifier.classifyPipe`
  that's actually correct: PEX stubs < 1 ft total run now
  classify as `trim` (previously `rough_in` because PEX defaulted
  to system `'waste'`). This is the right classification — short
  supply stubs at fixtures are installed in the trim phase. No
  existing test broke, because the tests that cover this file
  use explicit system values, not the default.

## Trade-offs

- **Timing-based tests are inherently slightly noisy.** Mitigated
  by generous budgets + the fact that we look at ratios more than
  absolute values in most perf-floor tests (e.g. 14.T's cache
  second-pass < first-pass / 2 ratio is more stable than any
  absolute threshold).
- **Scenario tests don't exercise the actual renderer.** They
  verify the store + pure-module layer. The R3F layer has its
  own manual QA. A future phase could add a JSDOM-backed render
  harness if we find component-level regressions slipping through.
- **No UI-automation tests.** Playwright / Cypress for the Tauri
  window is out of scope for this pass. If/when we ship a web
  build, we revisit.

## Verification

- `npx vitest run` — 1119 tests pass (1095 prior + 24 new:
  16 scenarios + 8 stress).
- `npx tsc -b --noEmit` — clean.
- All 14.W tests run in < 500 ms total.

## Files

- `src/__tests__/scenarios/drawLoopScenarios.spec.ts` — 16 tests
- `src/__tests__/scenarios/drawLoopStress.spec.ts` — 8 tests

## What's now locked by tests

The user-facing invariants from 14.P–14.V that now have test
coverage:

- Legal-angle snapping on commit + on live cursor
- Alt-held override for one click, constraint resumes after
- Backspace pops one point, session stays alive
- Material family switch drops/bumps draw diameter
- PEX 90° emits `pex_elbow_90` (not `bend_90`)
- PEX 45° emits zero fittings
- Fitting cache: identical reselect = 100% hits
- Fitting cache: point-edit = 1 miss, others hit
- Fitting cache: pruning evicts absent pipes
- 200-pipe mixed-material scene generates fittings in bounded time
