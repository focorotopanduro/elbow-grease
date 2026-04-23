# ADR 054 — Hot-Supply Propagation (Phase 14.Y.4)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Y.4 (final of four in 14.Y rollout)
- **Depends on:** 14.Y.1 (registry), 14.Y.2 (models), 14.Y.3 (auto-route).

## Context

User contract, condensed:

> *"make it look blue and when connecting to the water heater IN A
> REALISTIC WAY, MAKE IT turn red as to represent hot water"*
> *"hot water start at wh"*

14.Y.3's auto-router correctly anchors hot routes at the water
heater's hot outlet, but the PEX color system already in place
(`PEX_SYSTEM_COLOR`) maps `hot_supply` → red and `cold_supply` →
blue. The missing piece was a **classifier** that keeps every
downstream pipe of a water heater's hot outlet set to `hot_supply`
as the network changes.

## Decision

Two pieces: a **pure classifier** + a **store-subscription boot
layer**.

### 1. `hotSupplyPropagation.ts` — pure classifier

```ts
hotOutletSeeds(fixtures)          → Vec3[]
computeHotSupplyReachable(pipes, fixtures) → Set<pipeId>
applyHotSupplyClassification(pipes, fixtures) → ClassificationChange[]
computeHotSupplyReport(pipes, fixtures) → HotSupplyReport
```

**Algorithm:**

1. Find every water heater (tank + tankless). Read its local `hot`
   connection-point, transform to world space via rotation + the
   fixture's position (reuses `fixtureLocalToWorld` from 14.Y.3).
2. Build a pipe-node adjacency graph:
   - Include only **supply** pipes (`cold_supply` or `hot_supply`).
     Waste / vent / storm can't carry hot-water propagation even
     if they happen to touch an outlet.
   - Two pipe-nodes are adjacent when any of their four endpoints
     (two endpoints per pipe) are within `JUNCTION_TOL = 0.15 ft`.
   - Same tolerance as `FittingGenerator` + `pipeCollision` so
     "shared endpoint" is defined consistently across the codebase.
3. BFS from each seed — mark every pipe whose endpoint touches a
   hot outlet, plus every pipe reachable through endpoint
   adjacency.
4. **Classification diff**:
   - Reached + currently `cold_supply` → change to `hot_supply`
   - NOT reached + currently `hot_supply` → revert to `cold_supply`
     (symmetric — removing the water heater walks the network back)
   - Drain / vent / storm pipes never touched.

Pure. 19 unit tests lock the contract (seeds, adjacency,
propagation, boundary cases, reversal).

### 2. `bootHotSupplyPropagation.ts` — live subscription

Debounced (100 ms) subscriptions to `usePipeStore.pipes` +
`useFixtureStore.fixtures`. On any change, re-run the classifier
and call `pipeStore.setSystem(pipeId, newSystem)` for each
change.

**Feedback-loop defense:**

- A reentrance counter guards `runPropagation` from calling
  itself while inside the `setSystem` loop.
- Classifier is idempotent — if the scene is already correctly
  classified, `changes` is empty and no `setSystem` calls fire.
  The second wake (triggered by our own writes) returns empty
  and the cycle terminates.

Boot called once from `App.tsx`'s init effect right after
`bootPipeStore()`. Self-registers subscriptions; test helper
`__stopHotSupplyPropagation` unsubscribes + resets for isolated
tests.

### What renders

Once a pipe is classified `hot_supply`, the existing
`PEX_SYSTEM_COLOR` map (`'#d13e3e'`) kicks in via `getPipeMaterial`
in `PipeMaterial.ts`. No rendering changes needed — hot pipes
simply appear red because their `system` field is now correct.

## Why the store is the source of truth

Considered an alternative: "derive effective hot/cold at render
time from a virtual network walk, don't mutate the store." Rejected
because:

- BOM, PDF export, compliance engine, print proposal, and the
  fitting cache all read `pipe.system`. Making that a virtual
  field would require every consumer to also know about
  propagation. Touching the real field keeps the source of truth
  in one place.
- The reversal path (delete water heater → revert pipes) is
  clean at the store level. Virtual would need to invalidate
  downstream caches manually.

## Trade-offs

- **Debounce window of 100 ms.** Fast enough that a single
  auto-route (3–4 pipes) feels instant, slow enough that a bulk
  50-pipe paste only fires one propagation pass. If the user
  perceives a lag on hot-color flip, we can drop to 50 ms; any
  lower starts to chatter.
- **Interior-vertex adjacency not modeled.** A supply pipe that
  T's into the MIDDLE of another (rather than end-to-end) isn't
  considered adjacent for propagation. This mirrors
  `pipeCollision.ts`'s shared-endpoint convention + real plumbing
  practice (split the main pipe into two + drop a tee). If a
  user draws a mid-pipe T that SHOULD propagate, it won't — but
  in that case `pipeCollision` will also flag the geometry as
  clipping, which tells the user to fix the routing.
- **Disconnection triggers revert.** A user who manually set a
  pipe's system to `hot_supply` but whose pipe isn't connected to
  any WH will see it revert to `cold_supply`. That's the
  intended contract — the propagator is authoritative over
  supply classification. If the user really wants a standalone
  "hot" pipe, they can delete the classifier boot call (God Mode
  flag, future).
- **Watch cost.** `pipeStore.pipes` + `fixtureStore.fixtures` fire
  a subscription on every mutation. The debounce + reference
  equality check in the subscription handler keeps the propagation
  itself cheap (< 1 ms on 100-pipe scenes per measurement).

## Verification

- `npx vitest run` — 1213 tests pass (1192 prior + 21 new: 19
  unit + 2 integration).
- `npx tsc -b --noEmit` — clean.
- Integration test locks the user's specific contract:
  - Place WH + lavatory + autoroute → at least 1 pipe is
    `hot_supply` in the store after propagation flush.
  - Remove WH → every previously-hot pipe reverts to `cold_supply`.
- Manual (post-rebuild):
  1. Ctrl+F → WH → Tank 50gal → click to place.
  2. Ctrl+F → Lavatory → pick → click to place.
  3. Click the lavatory → Ctrl+R → auto-route fires.
  4. Watch the hot pipe turn **red** as the propagation kicks in
     (< 100 ms after commit).
  5. Delete the WH → the pipe turns **blue** again.

## Files

- `src/core/fixtures/hotSupplyPropagation.ts` — 185 LOC pure
  module.
- `src/core/fixtures/__tests__/hotSupplyPropagation.spec.ts` —
  19 unit tests.
- `src/core/fixtures/bootHotSupplyPropagation.ts` — 98 LOC boot
  subscription + debounce.
- `src/__tests__/scenarios/autoRouteHotSupplyIntegration.spec.ts`
  — 2 integration scenarios.
- `src/App.tsx` — `bootHotSupplyPropagation()` call inserted
  right after `bootPipeStore()`.
- `docs/adr/054-hot-supply-propagation.md` — this document.

## Phase 14.Y roadmap: complete

| Sub | Scope | Status |
|---|---|---|
| 14.Y.1 | FixtureSpec registry + 9 new subtypes | **shipped** (ADR 051) |
| 14.Y.2 | 3D geometries + wheel entries | **shipped** (ADR 052) |
| 14.Y.3 | autoRouteFixture pathfinder + UI | **shipped** (ADR 053) |
| 14.Y.4 | Hot-supply propagation | **shipped** (this ADR) |

The four sub-phases together give the user: place a water heater,
place a fixture, Ctrl+R → cold/hot/drain/vent pipes land with the
right material, diameter, system, and rendering color — hot water
genuinely starts at the water heater and flows red downstream.
