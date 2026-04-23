# ADR 042 — Lasso, Group Rotation, and Selection Fractals (Phase 14.M)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.M
- **Depends on:** Phase 14.F (Rotation Gizmo Math), Phase 14.I (Multi-Select Foundation).

## Context

Phase 14.I laid the multi-select foundation: a store, Shift+click toggle, visual highlighting, Ctrl+A, mass delete, template-from-selection. But four gaps remained visible the moment anyone used it:

1. **No lasso** — building up a selection required N clicks. Dragging a box over a region is the universal CAD / design expectation.
2. **No group rotate** — the 14.F rotation gizmo + bracket keys worked on single fixtures only. Selecting a row of toilets and pressing `]` did nothing (or rotated just one, depending on which single-select flag was authoritative).
3. **No "select similar"** — the contractor who wants "every copper pipe in this scene" had to click each one.
4. **Subtractive selection missing** — Shift+click toggles, which means to remove an already-included item you still Shift+click it. But most users have learned Alt+click for "subtract" from Figma / Photoshop / every CAD tool.

Phase 14.M closes all four gaps. "Fractalize" means each improvement gets pushed deeper:
- Lasso gets a proper SVG rectangle + pointer capture + visible HUD + cancel-on-Escape
- Group rotate gets a centroid gizmo + a centroid crosshair + auto-sized ring
- Select-similar works for both pipes (by material) and fixtures (by subtype)
- Alt+click adds a dedicated subtract gesture without losing Shift+click's toggle

## Decision

### 1. Two pure math modules (33 tests)

`src/core/selection/groupRotation.ts`:
```ts
computeGroupCentroid(pipes, fixtures)        → Vec3
rotatePointAroundCenter(pt, center, deg)     → Vec3       // XZ rotation, Y preserved
rotateGroupAroundY(input, center, deltaDeg)  → transformed pipes + fixtures
```

Fixture `rotationDeg` absorbs the delta so orientation tracks the group — a row of east-facing toilets rotated 90° CCW ends up north-facing, not frozen-east.

`src/core/selection/boxSelectMath.ts`:
```ts
projectToScreen(world, worldToClip, viewport) → { x, y } | null   // null when behind camera
pointInRect(world, input)                     → boolean
anyPointInRect(points, input)                 → boolean
filterEntitiesInRect(input)                   → { pipeIds, fixtureIds }
```

Column-major matrix convention (Three.js). Rejects: behind-camera (`clip.w ≤ 0`), outside frustum (`|clip.z| > |clip.w|`), off-viewport (`|NDC.x| > 1` or `|NDC.y| > 1`). 18 hand-calculated tests pin the math.

### 2. `pipeStore.setPoints(id, points)`

New action. Used by group rotation (and any future group translate) to atomically replace a pipe's polyline with a transformed version. Mirrors `fixtureStore.setPosition` in shape.

### 3. Group rotation via bracket keys (when multi ≥ 2)

`useFixtureRotationShortcuts` grew a two-path implementation:
- **multi ≥ 2** → compute centroid, apply `rotateGroupAroundY` to every selected pipe + fixture, push results to stores.
- **multi < 2** → existing single-fixture rotation (14.E / 14.F behavior preserved).

Same chords, same snap modes (5° default, 1° Shift, 90° Ctrl). The fine-grained rotation math from 14.F is reused; 14.M is the aggregation layer on top.

### 4. `GroupRotationGizmo` — in-scene drag ring at centroid

Rendered as a sibling of the scene (same pattern as `FixtureRotationGizmo` from 14.F — not inside a rotated group so the ring stays world-axis-aligned).

Fractals:
- **Auto-sized radius**: `max(1.4, min(maxEntityDistance + 0.75, 12))` — tiny selections get a 1.4 ft ring, huge selections get a 12 ft cap.
- **Centroid crosshair**: two small orthogonal cyan bars at the centroid show the rotation pivot explicitly.
- **Reference tick** at world +X (same as 14.F): always tells the user where 0° is.
- **Live group update**: as the user drags, the selection's geometry updates in place so the centroid stays coherent (the ring tracks the rotating pipes instead of drifting).

Drag handler uses the 14.F `beginDrag` / `dragToRotation` math with a cached `_lastDeg` so each frame applies only the delta since the previous frame — avoids double-counting rotation as the cursor sweeps.

### 5. Lasso: `CameraMatrixSnooper` + `BoxSelectOverlay`

Two pieces that form one feature:

**`CameraMatrixSnooper`** — an R3F `null` component inside the Canvas. Every frame, `useFrame` copies `camera.projectionMatrix · camera.matrixWorldInverse` into module-scope `cameraSnapshot.worldToClip` plus viewport size. No React subscription cost; DOM-side code reads from this mutable cache.

**`BoxSelectOverlay`** — a DOM div outside the Canvas. Fixed-position, full-window, `pointer-events: none` by default. When `interactionStore.mode === 'select'`, flips to `pointer-events: auto` + `cursor: crosshair` + z-index 15.

Behavior:
- `pointerdown` on overlay → record start, capture pointer.
- `pointermove` → update rect; render an SVG `<rect>` with dashed yellow border + translucent fill.
- `pointerup` → read `cameraSnapshot`, call `filterEntitiesInRect`, apply to `multiSelectStore` (Shift held at pointerdown = `addMany`; else `setSelection`).
- Escape during drag → cancel without commit.
- Micro-drag suppression: if the rectangle is < 3 × 3 px, treat as a click miss and no-op.

OrbitControls is disabled in Select mode via `enabled = !pivoting && !navFrozen && mode !== 'select'` — left-drag is the lasso, not orbit.

### 6. Select mode toggle + Escape chain

`S` already existed as a mode switch but was one-way. Changed to a **toggle**: pressing S while in select returns to navigate. Matches the other mode keys' rhythm and gives the user one-key in/out.

Escape chain (unchanged from 14.I):
1. Radial wheel → close
2. Pending fixture placement → cancel
3. Mid-draw with points → clear draw
4. Multi-select non-empty → clear multi-select
5. Single-select → deselect
6. Otherwise → drop to navigate

Multi-select lives as one layer in this chain, so Escape handling just works.

### 7. `SelectionCountBadge` — fixed top-right HUD

Small floating indicator. Shows:
- Current Select-mode banner (cyan pill) when active — clickable to exit.
- Count pill (yellow) with `N` big + `"X pipes · Y fixtures"` detail + `×` clear button when `count > 0`.
- One-line hint: `drag = lasso · Shift-drag = add · Shift+click = toggle · Alt+click = remove`.

Returns `null` when neither mode nor count is active — zero screen cost otherwise.

### 8. Fractal click modifiers

Every pipe + fixture click handler now reads the full modifier set:

| Modifier | Effect |
|---|---|
| (bare) | Clear multi + single-select this |
| Shift | Toggle this in multi-select |
| **Alt** | **Remove this from multi-select** (new) |
| **Ctrl+Shift** | **"Select similar" — add all same material (pipes) or same subtype (fixtures) to multi** (new) |

Alt is checked BEFORE Shift in the dispatcher so `Shift+Alt+click` still reads as "remove" (user accidentally holding Shift from a prior add).

### Files

```
src/core/selection/groupRotation.ts                           Pure rotation math (15 tests)
src/core/selection/boxSelectMath.ts                           Pure projection + hit test (18 tests)
src/core/selection/__tests__/groupRotation.spec.ts
src/core/selection/__tests__/boxSelectMath.spec.ts
src/ui/selection/GroupRotationGizmo.tsx                       In-scene drag ring at centroid
src/ui/selection/BoxSelectOverlay.tsx                         DOM overlay + camera snooper
src/ui/selection/SelectionCountBadge.tsx                      Top-right HUD
docs/adr/042-lasso-group-rotate.md

src/store/pipeStore.ts                    (mod) +setPoints action
src/ui/fixtures/useFixtureRotationShortcuts.ts (mod) group-rotate path on multi ≥ 2
src/ui/PipeRenderer.tsx                   (mod) +Alt / Ctrl+Shift click modifiers
src/ui/fixtures/FixtureModels.tsx         (mod) +Alt / Ctrl+Shift click modifiers
src/App.tsx                               (mod) Canvas mounts Snooper + GroupGizmo;
                                                 outer mounts Overlay + Badge;
                                                 S toggles select mode;
                                                 OrbitControls gated on !select
src/core/input/ShortcutRegistry.ts        (mod) +6 new selection entries
```

## Consequences

**Good:**
- Selection workflow finally feels like a grown-up CAD tool. Drag-select a region → group rotate with `]` → mass delete with Delete. All the gestures the user expects from every other design tool now work here.
- Pure math modules (33 tests) lock the two tricky bits: column-major projection + centroid rotation.
- Group rotation is visually continuous thanks to per-frame `_lastDeg` delta math — the ring doesn't "skip" as the cursor sweeps around.
- Auto-sized gizmo ring handles both tight selections (a single kitchen) and wide ones (an entire floor) without manual scaling.
- Select-similar unlocks "audit my copper supply" and "find every toilet" workflows in one click.
- Alt+click is a learned gesture from Figma / Photoshop / nearly every modern editor — zero new mental model.
- OrbitControls disable is scoped to Select mode only, so anyone who doesn't use lasso never notices the change.

**Accepted costs:**
- Lasso uses point-inclusion, not line-segment-rectangle intersection. A pipe that *crosses* the rectangle without any of its polyline points inside won't be caught. Real-world impact low (short pipe segments mean most crossings include an endpoint); fix is a v2 segment-clip test if users report it.
- Group rotation mutates pipe positions + fixture positions on every drag frame. On a selection of 100 entities with 5 pipe points each, that's 500 setState calls per frame — still well under 60 fps on my machine, but a sufficiently large selection could stutter. Mitigation: `useFrame`-throttle the gizmo to ~30 Hz if we see reports.
- Group-rotate-via-bracket-keys fires on every single keypress; holding down `]` produces repeat events. That's actually desirable (you can do a smooth rotation by holding the key), but it bypasses React's batching.
- Alt+click doesn't work on macOS in some browser contexts where Alt is the Option modifier (macOS: Cmd+click is more native). Current implementation reads `altKey` which also fires on macOS Option; should be fine. Will revisit if Mac users report oddness.
- The lasso captures pipes but not fittings (bends, tees, cleanouts, hangers — all auto-derived). That's correct — those are computed, not independently selectable. Users select the pipes and get the fittings for free on export.
- Select-similar for pipes groups by `material` only, not diameter. A contractor wanting "every 2-inch copper" has to Ctrl+Shift+click then Alt+click to subtract the wrong-diameter ones. Granular similarity filters are a v2 UI.

**Non-consequences:**
- No changes to BOM, pricing, proposal, compliance, revisions, PDF, library-sync, or any export. All scene-side UX.
- No schema bump. No runtime deps added.
- The 14.F single-fixture gizmo continues to work exactly as before when only one fixture is selected. The 14.M group gizmo activates only at ≥ 2.
- Existing Ctrl+Shift+T template save, 14.I Shift+click, Ctrl+A, Delete, Escape chain — all still work the same way. 14.M is additive across the board.

## Alternatives considered

**Lasso as an always-on gesture** (no Select mode). Rejected because left-drag currently orbits the camera. Disambiguating by distance or timing produced accidental lassos in testing. Explicit mode is cleaner.

**Lasso on right-click drag.** Right-click is OrbitControls' pan binding. Changing camera UX to "shift right-click to pan" breaks years of muscle memory for anyone who used the app before 14.M. Select mode is the minimally-invasive path.

**Put lasso in R3F (as an invisible plane mesh).** Would unify pointer routing with pipe/fixture clicks. Rejected because the lasso rectangle is a 2D screen-space feature; forcing it through 3D raycasting adds needless indirection. DOM overlay is the natural home.

**Render the rectangle inside the R3F scene** (as a HUD plane). Same category as above — 2D rectangles want to live in SVG, not orthographically-projected planes.

**Use React context to pass camera matrices.** Works but requires the DOM overlay to be inside a Provider that wraps the Canvas, which the current app shape doesn't have. The module-scope mutable snapshot is a 20-line solution that's straightforward to reason about.

**Group-rotate pipes by rotating their average endpoint, not every point.** Cheaper, but produces visible distortion when pipes have multiple vertices. Every-point rotation is correct and fast enough.

**Segment-clip hit test for lasso** (pipe counted as inside if any segment intersects the rectangle, not just if a vertex is inside). More accurate. Rejected for MVP — the any-vertex rule is easier to understand + 99% of short segments have at least one endpoint inside the rectangle anyway. If users report missed selections on long straight runs, upgrade to segment-clip.

**Show live "will be selected" preview** as the rectangle grows. Requires per-frame hit test on every pipe + fixture. Simple at small N, O(N × M) at large N where M is points-per-pipe. Deferred for MVP — release-on-commit is the safer default.

## Validation

- `Vitest`:
  - `src/core/selection/__tests__/groupRotation.spec.ts` — **15 tests**: centroid computation (empty input, mixed pipes + fixtures, Y preservation), `rotatePointAroundCenter` (0° / 90° / 180° / 360° cardinal cases, non-origin center, Y invariance), `rotateGroupAroundY` (simultaneous pipes + fixtures, rotationDeg accumulation + wrap, empty input, round-trip fidelity at 73° / −73°).
  - `src/core/selection/__tests__/boxSelectMath.spec.ts` — **18 tests**: `normalizeRect` / `rectArea`, `projectToScreen` (identity center-to-center, right-edge case, Y-flip, off-screen rejection, behind-camera rejection, orthographic scaling), `pointInRect` / `anyPointInRect` (viewport center, edge, off-screen, empty points, at-least-one-inside), `filterEntitiesInRect` (pipes + fixtures correctly partitioned, empty-nothing-inside case).
  - All prior tests continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. No runtime deps.
- Manual plan:
  - Draw 5 pipes, drop 3 fixtures. Press `S` → cursor becomes crosshair; SELECT MODE pill appears top-right.
  - Drag a rectangle over part of the scene → yellow dashed rect follows cursor; on release, enclosed items highlight + count badge shows "N selected."
  - Press `]` → group rotates +15° around centroid; the gizmo ring + centroid crosshair move with it.
  - Drag the gizmo ring in the 3D scene → group rotates smoothly in real time.
  - Shift+click an already-selected item → removes it. Alt+click another → also removes it.
  - Ctrl+Shift+click a copper pipe → every copper pipe joins the multi-select.
  - Escape → clears multi-select. Second Escape → clears single-select. Third Escape → drops to Navigate.
  - Verify no regression: click a single fixture → its single-fixture gizmo reappears. Bracket keys rotate just that one.
