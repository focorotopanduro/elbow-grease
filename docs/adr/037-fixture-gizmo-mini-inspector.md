# ADR 037 — Fixture Rotation Gizmo + Mini Inspector (Phase 14.F)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.F
- **Depends on:** Phase 2.B (FixtureParamWindow), Phase 14.E (rotation keyboard shortcuts), Phase 14.D (compliance planner).

## Context

Phase 14.E added keyboard rotation for fixtures, but left two friction points from the user's blueprint-tracing workflow unaddressed:

1. **No in-scene rotation handle.** Rotating a fixture required either (a) selecting it then pressing brackets (keyboard-only, no visual feedback during rotation), (b) opening the top-view editor for the ring, or (c) typing into the FixtureParamWindow's `Rotation` field. None of those let the user grab the fixture in the main 3D view and spin it.

2. **The detail editor dominates the screen even when you only want to peek.** `FixtureParamWindow` is 380 px wide with a blurred dark panel. Technically non-modal (no backdrop div), but visually it occupies enough of the canvas that users feel it's blocking their pipe-drawing. Every fixture selection yanks the user's attention out of "design" mode and into "edit fixture" mode, even when they just want to see the tag or confirm the DFU.

Both block the 80% workflow: *trace a blueprint, place fixtures quickly, occasionally check a spec, rarely need to edit parameters*.

## Decision

Ship three pieces:

### 1. `FixtureRotationGizmo` — in-scene 3D draggable ring

A torus mesh rendered as a **sibling** of the rotated fixture group (not a child). Stays world-axis-aligned so "0° is always +X" is always true; only the handle nub rotates with the fixture to indicate current orientation.

```
Scene root
├── <group position={fixture.pos} rotation={[0, rotY, 0]}>
│     fixture geometry + hitbox (inherits rotation)
│   </group>
└── FixtureRotationGizmo (sibling; does NOT inherit rotation)
      ├── torus ring       (world XZ plane, draggable)
      ├── handle nub       (offset by cos/sin of rotationDeg)
      └── 0° reference tick (stays at world +X to anchor the user)
```

`onPointerDown` captures the pointer and records a `GizmoDragSession` (start fixture rotation + start cursor world angle). `onPointerMove` computes the new rotation relative to the start — so grabbing the ring at 40° from 0° doesn't cause a jump; only delta motion counts.

Snap modes via modifier keys (matches the 14.E keyboard convention):
- Default (no modifier) → **5° snap**
- Shift → **1° snap** (fine)
- Ctrl → **90° snap** (cardinal)

Pure math lives in `@core/fixtures/rotationGizmoMath.ts`:

```ts
xzAngleDeg(origin, point)                              // world-space angle
beginDrag(origin, startPoint, currentRot) → session   // capture start state
dragToRotation(session, origin, currentPoint, step)   // delta + snap → new deg
snapDeg(raw, step)
normalizeDeg(x)
```

**24 unit tests** pin every branch: angle from each axis, cursor-jump prevention, delta accumulation from non-zero start rotations, snap at 5°/90°, wrap past 360°, off-origin fixtures.

The R3F component is a thin adapter (~160 lines) around the pure math. All it does is R3F pointer events + material state for hover/active, then hands world points into the pure functions.

### 2. Mini vs detail inspector mode

New `fixtureInspectorStore` with a single piece of state:

```ts
mode: 'mini' | 'detail'
```

Two render paths:
- **`FixtureMiniCard`** (NEW) — compact 260-px HUD in bottom-right. Renders when a fixture is selected AND `mode === 'mini'`. Shows:
  - Subtype name + last-4 of ID
  - Rotation readout + inline ±15° / ±90° buttons (for mouse-first users)
  - Three-row spec grid: DFU, WSFU (cold · hot), trap size
  - "Open full editor →" button
  - Close (×) button (deselects the fixture)
- **`FixtureParamWindow`** (existing, gated) — renders only when `mode === 'detail'`. Added a new "⇲ collapse" button next to the existing close button; it switches mode back to `'mini'` without deselecting.

`mode` persists to localStorage (`elbow-grease-fixture-inspector-mode`) so a user's preferred default carries across sessions.

Default mode is `'mini'`. The blunt, heavy detail window is now opt-in; the lightweight peek is what happens on every selection.

### 3. PDF blueprint workflow — already shipped

Phase 14.E (ADR 036) shipped native PDF import via the lazy-loaded pdfjs-dist chunk. The `+` button in MeasureToolbar accepts `.pdf`, renders the chosen page(s) via `renderPdfPage`, and drops the rasterized image(s) onto the floor as backdrops. This phase doesn't change that flow — the user's request was satisfied by 14.E.

### Files

```
src/core/fixtures/rotationGizmoMath.ts                       Pure math (24 tests)
src/core/fixtures/__tests__/rotationGizmoMath.spec.ts
src/ui/fixtures/FixtureRotationGizmo.tsx                      R3F adapter
src/ui/fixtures/FixtureMiniCard.tsx                           Compact bottom-right HUD
src/store/fixtureInspectorStore.ts                            Mode toggle + localStorage
docs/adr/037-fixture-gizmo-mini-inspector.md

src/ui/fixtures/FixtureParamWindow.tsx   (mod) gates on detail mode; + collapse button
src/ui/fixtures/FixtureModels.tsx        (mod) mounts gizmo on selected fixture
src/App.tsx                              (mod) mounts FixtureMiniCard at scene root
```

## Consequences

**Good:**
- Blueprint-tracing is now pointer-first: select a fixture, grab the ring, spin — no keyboard, no panel to close. Keyboard users still have the 14.E bracket chords.
- Default inspector is unobtrusive. Mini card shows enough to answer "what is this?" + "is the rotation right?" in one glance, without covering the scene.
- Full editor is exactly one click away when needed. The collapse button lets the user return to mini without losing selection — nice for "check the tag, tweak the rotation, peek at the rest, collapse."
- Pure gizmo math has 24 tests; delta-tracking + snap correctness is locked in.
- `depthTest: false` on the gizmo materials means the ring stays visible even when the fixture partially occludes it — no "my gizmo disappeared inside the tub" foot-gun.
- Mode preference persists — once a user picks their favorite default, every selection respects it.

**Accepted costs:**
- The gizmo adds three extra meshes per selected fixture. At most one fixture is selected at a time, so the draw-call impact is trivial (<1% frame time) — not worth optimizing away.
- The gizmo ring is a fixed 1.1 ft radius. On very large fixtures (e.g. a 6-ft mop sink) the ring sits inside the body; on tiny fixtures (a wall-mount lavatory) the ring sits notably outside. A future refinement could size the ring to `max(footprint)/2 + padding`, but fixed radius keeps the drag feel consistent.
- The mini card isn't draggable — sits fixed bottom-right. Users with a custom window layout who want it elsewhere have to wait for a "pin anywhere" v2.
- No per-fixture multi-select yet (this is a scope constraint since Phase 14.C). Gizmo + mini card both assume single selection. When multi-select lands, we'll extend the gizmo to rotate the group around its centroid.
- Mini card's spec fields are hardcoded to DFU/WSFU/trap. Customizing "which specs are essential for my workflow" is a v2 preference.

**Non-consequences:**
- No change to fixture data model, simulation, BOM, pricing, compliance, or any export. This phase is pure UX.
- No schema bump on `.elbow` bundles. The `rotationDeg` field already existed; the mode preference is localStorage-only.
- No new dependencies, no bundle growth beyond the ~3–4 KB of new component code.
- Keyboard shortcuts from 14.E continue to work unchanged. They compose with the gizmo: grab the ring for a coarse turn, then `Shift+]` for fine nudging.

## Alternatives considered

**Render the gizmo as a child of the rotated group.** Simpler mounting, but the ring would rotate with the fixture — you'd lose the "0° is always +X" world-frame anchor. Rejected because that anchor is what lets the user understand *absolute* rotation (a toilet pointed at the east wall stays pointed east no matter how the scene is viewed).

**Use `drei/TransformControls` for full-spectrum gizmo.** Rejected because drei's gizmo is more complex than needed (translate + rotate + scale) and would require installing `@react-three/drei`'s transform controls subpackage. A 160-line custom component fits the exact shape of our use case.

**Keep FixtureParamWindow as default; add a separate "peek" surface.** Considered. Rejected because the user's explicit feedback was that the window shouldn't be the first thing they see. Inverting the default (mini first, detail on demand) matches the stated intent and is the "surprise nobody" outcome for users who already used the bracket keys (Phase 14.E).

**Always-visible mini card, even without selection.** Rejected — adds screen noise when no fixture is selected and the inspector has nothing to show. Current flow (card appears on select, disappears on deselect) matches PipeInspector's established pattern (Phase 3.D).

**R key + mouse drag for rotation** (original user ask in phase 14.E). The gizmo subsumes this: grabbing the ring IS the mouse-drag rotation. `R` stays with the ruler; no chord conflict. The gizmo's drag is actually smoother than "hold-R + drag" would have been because the user's hand doesn't have to straddle keyboard + mouse during the drag.

## Validation

- `Vitest`:
  - `src/core/fixtures/__tests__/rotationGizmoMath.spec.ts` — **24 tests** covering `normalizeDeg` (wraparound both directions, exact 360° multiples), `xzAngleDeg` (every cardinal direction + 45° diagonal + Y-independence + origin offset), `snapDeg` (step=0 passthrough, 5° nearest, 90° cardinal, wrap after snap), `snapStepFor` (fine=1, default=5, cardinal=90), `beginDrag`/`dragToRotation` (cursor-jump prevention, delta accumulation from non-zero start, 5°/90° snaps, off-origin fixtures, wrap past 360°).
  - All prior test files (BOM, pricing, proposalData, assemblyTemplate, pTrapCleanoutPlanner, PDFRenderer, fixture rotation shortcuts) continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. No new bundle deps.
- Manual plan:
  - Place a fixture, click it → mini card appears bottom-right, 3D rotation ring appears around the fixture
  - Drag the ring → fixture rotates in real time, snaps to 5°
  - Hold Shift while dragging → fine 1° rotation
  - Hold Ctrl while dragging → cardinal 90° snaps
  - Click the mini card's ±15° buttons → same rotation; readout updates
  - Click "Open full editor →" → detail window replaces the mini (gizmo stays visible)
  - Click the ⇲ button in the detail window header → collapses back to mini
  - Close & reopen the app → previous mode (mini vs detail) persists via localStorage
  - Verify the 14.E bracket keys still work while either card is showing
  - Verify pipe-drawing is unaffected: start drawing a pipe, pass over the mini card region — drawing continues through the card's "outside" area; only the card itself intercepts clicks
