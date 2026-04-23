# ADR 053 — Fixture Auto-Route (Phase 14.Y.3)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.Y.3 (third of four in 14.Y rollout)
- **Depends on:** 14.Y.1 (FixtureSpec registry + connection points),
  14.Y.2 (3D geometry + wheel entries for equipment).

## Context

With 9 new fixtures placeable + every subtype carrying typed
connection points, the pathfinder can finally consume the data:
"pick fixture, press Ctrl+R, get cold + hot + drain + vent
committed." Eliminates the 30-click manual flow for every bathroom.

## Decision

### Pure pathfinder: `src/core/fixtures/autoRouteFixture.ts`

Input shape:

```ts
AutoRouteInput {
  fixture: FixtureInstance;
  otherFixtures: readonly FixtureInstance[];  // for water-heater lookup
  pipes: readonly CommittedPipe[];             // for nearest-main lookup
  floorY: number;
  ceilingY: number;
}
```

Output:

```ts
AutoRouteResult {
  proposed: ProposedPipe[];   // one pipe per connection point
  warnings: string[];         // "no target for X" etc.
}
```

### Target resolution priority (per role)

| Role | 1st choice | 2nd | 3rd (stub) |
|---|---|---|---|
| `cold` | nearest cold_supply pipe endpoint | water heater cold INLET | +2 ft to ceiling |
| `hot` | **water heater HOT outlet** (key — 14.Y.4 propagation) | nearest hot_supply pipe endpoint | −2 ft to ceiling |
| `drain` | nearest waste/storm pipe endpoint | — | straight drop to slab |
| `vent` | nearest vent pipe endpoint | — | straight rise to ceiling |
| `overflow` (T&P) | nearest waste pipe | — | drop to slab |
| `ref` | skipped (not routeable) | — | — |

The hot-supply preference is deliberate — the path ends at the
water heater so 14.Y.4's flood-fill can classify the route + every
downstream junction as `hot_supply`.

### Route shape: Manhattan L / Z

From fixture port → rise to `runY` (midway between floor and
ceiling) → horizontal to target XZ → drop/rise to target Y.
Produces 2 × 90° bends which `generateBendFittings` renders as
proper elbows. Legal angles by construction.

### Sizing (material + diameter)

| Role | Material | Diameter |
|---|---|---|
| cold / hot | PEX | `SUPPLY_TABLE[subtype].minBranchSize` (fallback 1/2") |
| drain | PVC Schedule 40 | DFU-derived: ≤3 → 1.5", ≤6 → 2", ≤20 → 3", else 4" |
| overflow | PVC Schedule 40 | 1.5" |
| vent | PVC Schedule 40 | 1.5" |

### Fixture rotation honored

`fixtureLocalToWorld(fixture, localPoint)` applies the fixture's
`rotationDeg` param to the connection point's local position
before routing. A lavatory rotated 90° gets its drain on the
originally-Z-positive side; routes start from the correct world
position. Locked by test.

### UI entry: `useAutoRouteShortcut`

- **Ctrl + R** (or Cmd + R) with a fixture selected → run
  `autoRouteSelectedFixture()` → commit all proposed pipes.
- Skipped when typing in an input, when no fixture is selected.
  That last guard is important: Ctrl+R is the webview's hard-
  reload, so we only preventDefault when we're actually
  committing work.
- `autoRouteSelectedFixture()` is exported so a right-click menu
  / palette command can trigger auto-route without the keyboard.

### Commit path

Pipes are added directly via `usePipeStore.setState` (not the
public `addPipe` action) because the pathfinder has already
picked the correct `system` per role — whereas `addPipe` infers
system from material (PEX → cold_supply, everything else →
waste). Going through `setState` preserves the right hot vs
cold classification on the generated pipes.

## Trade-offs

- **No collision avoidance.** The Manhattan L can cut through
  walls or other pipes. The existing `PipeCollisionMarkers`
  (14.X) will flash red at any overlap so the user can re-route
  manually. Full obstacle-aware pathfinding belongs to a
  separate pass (14.Y.5?) once we have a stable representation
  of structural elements.
- **No ghost preview.** The routes commit immediately on Ctrl+R
  with no "accept / reject" step. Ctrl+Z undoes each added pipe
  separately (not grouped). Could add a confirm-dialog UI later.
- **Single-fixture scope.** `autoRouteSelectedFixture` routes ONE
  fixture per invocation. Mass auto-route ("route all unconnected
  fixtures") is queued for 14.Y.5.
- **runY is half-depth.** The chosen run height is midway
  between floor and ceiling. Real plumbing typically runs along
  ceiling joists (top plate or ceiling space). The current
  heuristic produces visible routes that the user can see +
  tweak; BIM-level routing strategies belong later.
- **Gas routes skipped.** No `gas` role handler yet — the
  tankless water heater's gas stub won't auto-route. Gas
  plumbing is a separate sub-system + we haven't modeled gas
  mains; leaving it for a future phase.

## Verification

- `npx vitest run` — 1192 tests pass (1177 prior + 15 new in
  `autoRouteFixture.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Place a water heater (Ctrl+F → WH → Tank 50gal).
  2. Place a lavatory (Ctrl+F → Lavatory → pick a variant).
  3. Click the lavatory to select it.
  4. Press **Ctrl + R** → three pipes commit automatically:
     - **Cold** (blue PEX) rising from the lavatory and stubbing
       out to the ceiling (no cold main exists yet).
     - **Hot** (will be blue until 14.Y.4, but classified
       `hot_supply`) terminating at the water heater's hot
       outlet.
     - **Drain** (orange PVC 1.5") dropping from the lavatory
       down to the slab.

## Files

- `src/core/fixtures/autoRouteFixture.ts` — pure pathfinder,
  285 LOC.
- `src/core/fixtures/__tests__/autoRouteFixture.spec.ts` —
  15 tests covering rotation, target resolution, route shape,
  sizing, water-heater preference.
- `src/ui/fixtures/useAutoRouteShortcut.ts` — keyboard hook +
  imperative `autoRouteSelectedFixture` export.
- `src/App.tsx` — `<AutoRouteShortcutBinder />` mount + import.
- `docs/adr/053-fixture-autoroute.md` — this document.

## What 14.Y.4 picks up

Hot-supply propagation. Now that hot routes always terminate at
a water heater's hot outlet, 14.Y.4 can flood-fill classify every
pipe reachable from that outlet as `hot_supply` → they render red.
The cold/drain routes stay as they are. That's the last piece
needed to make the blue/red distinction "just work" when the user
auto-routes a scene.
