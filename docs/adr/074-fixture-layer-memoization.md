# ADR 074 — FixtureWithSelection React.memo (Phase 14.AD.3)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AD.3

## Context

`FixtureLayerFromStore` subscribes to `fixtureStore.fixtures` (among
other things). Any mutation to the fixture map — placing a new
fixture, moving an existing one, selection change, or any
param-change — produces a new `fixtureMap` reference and triggers
a full re-render of the layer. The layer's JSX maps over
`Object.values(fixtureMap)` and renders one `FixtureWithSelection`
per fixture.

Without memoization, every fixture in the list re-renders on every
mutation, even if only ONE fixture changed. On a realistic
commercial scene (20-50+ fixtures), that's 20-50× the React work
per mutation:

- Component function invocation
- JSX creation for each fixture's model, hitbox, halo, and gizmo
- Props comparison through the Model dispatcher down to every
  `<mesh>` inside each parametric model (ToiletModel alone has
  ~15 sub-meshes)

The earlier survey flagged this as "geometry rebuilds on every
render." That's partly a mischaracterization — R3F reconciles
JSX-declared `args` arrays element-wise, so THREE.js geometry
instances persist across unchanged renders. The real cost is the
**React-layer work** upstream of reconciliation. Which is exactly
what `React.memo` skips.

## Decision

Wrap `FixtureWithSelection` in `React.memo`. Default shallow
compare is correct: every prop is either a primitive, a string,
or an object whose reference is stable under Zustand's
immutable-update convention.

```ts
export const FixtureWithSelection = memo(function FixtureWithSelection({
  fixture, dim, ghostOpacity, interactive, selected, phaseColor, selectFixture,
}: FixtureWithSelectionProps) {
  // ...
});
```

Prop-stability breakdown:

| Prop | Type | Stable? |
|---|---|---|
| `fixture` | `FixtureInstance` | ✓ same ref for unchanged fixture (Zustand) |
| `selectFixture` | `(id: string) => void` | ✓ Zustand action ref |
| `dim` | `boolean` | ✓ primitive |
| `ghostOpacity` | `number` | ✓ primitive |
| `interactive` | `boolean` | ✓ primitive |
| `selected` | `boolean` | ✓ primitive |
| `phaseColor` | `string \| undefined` | ✓ value-equal |

Result: a 50-fixture scene where fixture 12 moves re-renders
exactly ONE `FixtureWithSelection` subtree. The other 49 hit
memo's shallow compare and short-circuit.

### Deliberate non-scope

**FixtureModel dispatcher (the inner component) is NOT memoized.**
It accepts `position` as an inline array literal (`[0, 0, 0]`)
from FixtureWithSelection — a new array identity per render.
Default shallow compare would fail. Memoizing it would require
a custom compare or a stable-ref helper for every call site.
Not worth the complexity when the outer `FixtureWithSelection`
memo already gates invocation.

**Individual model components (ToiletModel, ShowerModel, etc.)
are NOT memoized.** Same reason: they receive the inline
`position={[0,0,0]}` pattern. And because `FixtureWithSelection`
already skips their render work via the outer memo, further
memoization is redundant.

## Trade-offs

- **Prop stability is invariant-dependent.** If any consumer of
  `FixtureWithSelection` starts passing, e.g., `selectFixture={() => selectFixture(id)}`
  (a new fn each render), every memo hit turns into a miss and
  the phase regresses silently. Mitigation: the current caller
  passes the raw Zustand action ref; future callers should be
  audited. A guardrail lint rule could be added if this pattern
  proves fragile.
- **No render-count regression test.** Writing one requires
  either a real R3F renderer (heavy) or a structural mock that
  substitutes the rendering pathway (fragile). The structural
  `$$typeof === Symbol.for('react.memo')` test catches the
  specific "someone dropped the memo" failure mode. A genuine
  render-count test could be added in a later perf phase if
  the invariant is broken in practice.
- **Export surface grows by one.** `FixtureWithSelection` is
  now exported for the test to grab. Test-only export marked
  with a comment; not intended for external rendering use.
- **No measured profile.** This is a structural optimization;
  actual frame-time impact scales with scene size and the
  frequency of fixture mutations. The expected impact on a
  50-fixture scene with hot-tool use (drag + rotate + param
  edits) is visible frame headroom during interaction. No
  telemetry to confirm yet — 14.AD.5 (post-bake review) is the
  place to measure.

## Verification

- `npx vitest run` — 1562 tests pass (1560 prior + 2 new).
- `npx tsc -b --noEmit` — clean.
- Existing fixture rendering tests (`newFixtureModels.spec.ts`,
  `useFixtureRotationShortcuts.spec.ts`) still pass — the memo
  wrapper is transparent to consumers.

## Files

- `src/ui/fixtures/FixtureModels.tsx` — `memo` import,
  `FixtureWithSelection` wrapped + exported for testability.
- `src/ui/fixtures/__tests__/fixtureModelMemo.spec.ts` — 2
  structural guard tests.
- `docs/adr/074-fixture-layer-memoization.md` — this document.

## What's queued

- **14.AD.4** — `FittingRenderer` filter pre-gate cache. The
  outer filter walks every pipe's points array for y-bounds on
  every useMemo invocation; same per-pipe identity pattern.
- **14.AD.5** — post-bake measurement on a realistic scene to
  confirm the AD.1–AD.3 wins actually show up in frame-time
  profiles. Today's delivery is structural; the measurement is
  intentionally decoupled.
