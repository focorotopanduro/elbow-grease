# ADR 069 — Fixture Graph Default On (Phase 14.AC.9)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AC.9
- **Depends on:** ADR 066 (scaffold), ADR 067 (proximity
  connection), ADR 068 (rehydration).

## Context

14.AC.6–AC.8 built the fixture → worker graph wiring behind a
`fixtureGraph` feature flag defaulting to `false`. The flag-off
default preserved a pre-existing correctness bug: fixtures never
reached the solver, every DFU propagation pass ran against a
graph of zero-load junction nodes, and compliance checks silently
passed on undersized stacks because there was no downstream load
to violate limits.

The three preceding phases covered the shipping surface:

- **AC.6** — fixture events → bridge → isolated fixture nodes.
- **AC.7** — proximity substitution spliced fixtures onto pipe
  endpoints so DFU actually propagates.
- **AC.8** — bundle-load rehydration + flag-flip replay so
  existing scenes catch up.

All three shipped with tests. Nothing observable changed for
default-flag-off users; everything observable was testable for
flag-on paths. The only thing left was the switch.

This ADR flips it.

## Decision

One-line change in `src/store/featureFlagStore.ts`:

```diff
- fixtureGraph: false,
+ fixtureGraph: true,
```

Plus documentation updates in the flag's JSDoc explaining the
new default and why. Plus a golden-scene integration spec so
reverting the default (or regressing any of AC.6–AC.8) trips a
named test.

### Golden scene

`src/__tests__/scenarios/fixtureGraphDefaultOn.spec.ts` — 4
tests exercising a realistic bathroom:

| Test | What it locks in |
|---|---|
| default is ON | one-liner checking `useFeatureFlagStore.getState().fixtureGraph === true` |
| bathroom: 4 fixtures + 4 waste runs | exact graph shape — 4 fixture nodes with IPC-table DFU values, 3 fixture-to-fixture edges (0 junctions), 1 fixture-to-waypoint edge |
| removing a pipe | only the edge goes; fixture nodes survive |
| removing a fixture | only `fx-{id}` goes; pipe edges survive (orphaned edge, solver ignores) |

The bathroom test validates the full AC.6+AC.7 integration
against a realistic workflow: draw three waste runs from the
three wet fixtures to a shared floor drain, plus one stack
extension. Result: 4 fixture nodes with catalogued DFU (4/1/2/2
for toilet/lav/tub/drain), 4 edges correctly spliced. Exactly
one `BATCH_MUTATE` for the entire burst.

### What users will observe

| Subsystem | Pre-14.AC.9 (flag off) | Post-14.AC.9 (flag on) |
|---|---|---|
| Pipe drawing UX | unchanged | unchanged |
| Autosave / .elbow open | unchanged | unchanged |
| Solver DFU propagation | all zeros | real IPC-table DFU per fixture |
| Compliance flagging | passed silently on undersized stacks | now flags undersized stacks (correctness improvement) |
| BOM pricing | edges only, no fixture rollup | edges only, no fixture rollup (unchanged — that's 14.AC.10) |
| Session telemetry | no fixture batch ops counted | fixture batch ops counted in PerfHUD |

**The user-visible change is compliance output on existing
projects.** A user opens a project built under the previous
flag-off state, the bundle path runs through `applyBundle` →
`rehydrateWorkerGraph` (from AC.8), the solver sees the real
fixture DFU for the first time, and compliance warnings that
were silently suppressed now appear. That's the point.

### Kill switch remains

If a regression surfaces in the wild, users (or devs) flip the
flag off in the God Mode console and continue working with the
legacy zero-DFU behavior. The flag isn't removed until ~14.AD
when we've got production telemetry confirming no correctness
issues.

## Trade-offs

- **No BOM change yet.** BOM reads edges only, so fixtures in
  the DAG don't produce priced line items. 14.AC.10's scope.
  Means: this phase changes compliance output without changing
  BOM totals, which is a legible tradeoff (users see "new
  warnings" but "same price") rather than a confusing everything-
  moves-at-once.
- **Existing autosaves produce new warnings on open.** Projects
  that were "passing" under the flag-off world will show
  violations that were always real but hidden. The user's next
  step is to fix the pipe sizing — which is what compliance is
  for. No data loss, no project corruption; just a correctness
  signal the user was being denied.
- **No new defaults migration step.** Zustand's persisted flag
  store uses merge-on-load, so an existing user's localStorage
  entry retains their explicit flag choice. If they'd manually
  set `fixtureGraph: false` earlier, their setting survives
  the update — we change the default for new-install users,
  not the explicit-override users. This is by design, and also
  the reason this ADR doesn't claim "every user sees the new
  behavior" — *every fresh install* does.
- **Regression discovery burden on maintainers.** The golden
  spec doesn't simulate every possible scene topology. If a
  future bridge refactor breaks the AC.6–AC.8 wiring in a
  non-bathroom-shaped way, the spec won't catch it. Mitigation:
  AC.6–AC.8 each had their own comprehensive spec, and the
  flag remains a kill switch.

## Verification

- `npx vitest run` — 1516 tests pass (1512 prior + 4 new).
- `npx tsc -b --noEmit` — clean.
- Pre-existing flag-sensitive tests all use
  `useFeatureFlagStore.setState({ fixtureGraph: X })` in their
  `beforeEach`, so flipping the default doesn't affect them —
  they still assert what they assert about each explicit state.

## Files

- `src/store/featureFlagStore.ts` — `fixtureGraph` default
  flipped from `false` to `true`; JSDoc updated.
- `src/__tests__/scenarios/fixtureGraphDefaultOn.spec.ts` — 4
  golden-scene tests.
- `docs/adr/069-fixture-graph-default-on.md` — this document.

## What's queued

- **14.AC.10** — BOM fixture rollup. `BOMExporter` reads
  `type: 'fixture'` nodes from the DAG, groups by subtype,
  prices via a new `FIXTURE_COSTS` table (currently absent;
  would be a Ferguson / HomeDepot catalog lookup). Until this
  lands, a 3-bathroom-house BOM shows pipe + fittings + labor
  but no fixture line items.
- **14.AC.11** — `fixtureStore.setPosition` emits
  `FIXTURE_MOVED`; bridge handles remove + re-add. Currently
  moving a placed fixture doesn't update its graph node
  position.
- **14.AC.12** — post-bake telemetry: after 2-4 weeks of
  shipping AC.9, review session telemetry for any
  unexplainable cache invalidations, batch-size anomalies,
  or compliance-violation bursts indicating a regression we
  missed.
