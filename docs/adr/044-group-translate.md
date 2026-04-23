# ADR 044 — Group Translate Gizmo + Arrow-Key Translation (Phase 14.O)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.O
- **Depends on:** Phase 14.I (Multi-Select), Phase 14.M (Lasso + Group Rotate), Phase 14.F (Rotation Gizmo Math).

## Context

Phase 14.M gave the selection a rotate verb. The natural pair — **translate** — was left open:

- A contractor who lassos a kitchen assembly and wants to shift it 3 ft north has no direct move tool. Their choices today: select-one-at-a-time + move via param window, or export to JSON and hand-edit. Neither is realistic during a live design session.
- The rotation gizmo (14.M) ships a group anchor at the centroid. A translate gizmo on the same anchor is the obvious visual extension.

Phase 14.O closes that gap with both a drag gizmo and arrow-key keyboard bindings, with the same fractal depth treatment as 14.M.

## Decision

### 1. `groupTranslate.ts` — pure math (22 tests)

```ts
translateVec(v, delta)                                      → new Vec3
translateGroup({ pipes, fixtures }, delta)                  → transformed result
constrainToDominantAxis(delta)                              → delta projected to larger of X / Z
snapDeltaToGrid(delta, step)                                → delta rounded to step in X + Z, Y preserved
beginTranslateDrag(startHit, startCentroid)                 → session
dragToTranslation(session, currentHit, { constrainToAxis?, snapStep? }) → { delta, newCentroid }
computeCentroid(pipes, fixtures)                            → mean position
```

Pure functions, JSON-in / JSON-out. No React / Zustand / Three. Reuses the centroid math from `groupRotation.ts` (sharing the implementation; both compute arithmetic mean across pipe points + fixture positions).

### 2. `GroupTranslateGizmo` — in-scene cross handle

Rendered at `centroid + [0, 0.12, 0]` (slightly above the rotation ring so both are visible). Shape: two perpendicular boxes forming a cyan/yellow cross — distinctly different from the rotation torus so the user reads "move" vs "rotate" at a glance.

Drag mechanics:
1. `onPointerDown`: raycast the pointer through a plane at the centroid's Y. Record the hit + current centroid as the `TranslateDragSession`. Call `setPointerCapture` so subsequent events route to the handle even if the cursor leaves it.
2. `onPointerMove`: raycast again; compute `dragToTranslation` with modifier flags. Apply the **frame delta** (not start-delta) to every selected pipe + fixture via `pipeStore.setPoints` + `fixtureStore.setPosition`. Mutate cached selection refs in place so subsequent frames' centroids stay coherent.
3. `onPointerUp`: release pointer capture, zero out live delta.

Fractals baked in:
- **Axis-constrain on Shift** — drag snaps to whichever of X / Z had more motion; an elongated cyan bar renders along the locked axis for visual reinforcement.
- **Grid-snap on Ctrl** — delta rounds to 1 ft steps in X + Z (matches the world grid); Y is preserved (vertical moves belong to floor elevation, not 2D snap).
- **Live delta readout** — `Billboard` + `drei/Text` showing `"+3.50 ft · −0.25 ft"` directly above the handle while dragging. Disappears at rest.
- **Plane-anchored raycast** — uses the centroid's Y for the drag plane so motion reads the same regardless of camera tilt. A user orbiting steeply doesn't get a warped drag response.
- **Frame-delta math** — each move applies `delta − liveDelta` (not the total delta) so grid-snap produces zero-delta frames cleanly (no jitter when cursor is between cells).

### 3. `useGroupTranslateShortcuts` — arrow keys

```
ArrowLeft  → [-1, 0, 0]
ArrowRight → [+1, 0, 0]
ArrowUp    → [0, 0, -1]
ArrowDown  → [0, 0, +1]

Shift  → step = 0.1 ft (fine)
Ctrl   → step = 5 ft (coarse)
Meta   → bypass (don't steal browser cmd+arrow)
```

Routing:
- **Multi-select ≥ 2** → translate the entire group via `translateGroup`.
- **Single pipe selected** (via `pipeStore.selectedId`) → translate just that pipe's points.
- **Single fixture selected** (via `fixtureStore.selectedFixtureId`) → translate just that fixture's position.
- Nothing selected → arrow key is a no-op (falls through to camera controls if applicable).

Typing guard: skip when focus is inside input / textarea / contenteditable.

### 4. `pipeStore` — no new actions needed

`setPoints` from 14.M already covers the pipe-update path. This phase reuses it.

### Files

```
src/core/selection/groupTranslate.ts                        Pure translate math (22 tests)
src/core/selection/__tests__/groupTranslate.spec.ts
src/ui/selection/GroupTranslateGizmo.tsx                    In-scene cross handle + readout
src/ui/selection/useGroupTranslateShortcuts.ts              Arrow-key binder
docs/adr/044-group-translate.md

src/App.tsx                               (mod) mounts GroupTranslateGizmo (Canvas)
                                                 + GroupTranslateShortcutsBinder (root)
src/core/input/ShortcutRegistry.ts        (mod) 2 new selection entries
```

## Consequences

**Good:**
- The 14.M + 14.O gizmo pair covers the two primary group transforms: rotate + translate. All the selection arc's verbs are now operational.
- Arrow-key translation gives a precise, keyboard-only workflow that scales from fine (0.1 ft) to coarse (5 ft) with modifiers that match 14.M's rotation convention (Shift = finer, Ctrl = coarser/cardinal).
- Axis constraint + grid snap cover the "I want this moved EXACTLY 10 feet east" case in two key combos (Shift + Ctrl held together during drag).
- Live delta readout gives immediate visual feedback — the user doesn't have to guess how far the group moved.
- Pure math module (22 tests) locks the translate + constraint + snap logic.
- Plane-anchored raycast gives predictable drag feel across camera angles — a low-down perspective view doesn't produce runaway drag jumps.

**Accepted costs:**
- Translation is XZ-only from the gizmo. Y moves need the floor selector (via 14.E) — consistent with the "Y = floor change, XZ = position change" model. If a contractor wants "shift this up 1 ft," they can use arrow keys (which Y-preserve via delta=0) or move the selected items to a different floor via drag-to-floor in the floor selector (v2).
- Arrow keys are global. If a user has a modal open that wants arrow keys (e.g., RecentFilesPanel), both handlers fire. Mitigation: existing panels that use arrow keys already gate on `isOpen` or focus, so they receive their events before bubbling. The translate hook checks for editable focus.
- Grid snap hardcoded to 1 ft. No user-visible knob for other grids. Reasonable default; future phase could expose a grid-step setting.
- Frame-delta math relies on cached selection state mutation for continuity. If another actor modifies a pipe's points mid-drag (solver re-sizing, another user in a multiplayer scenario), the centroid could desync. In practice nothing else mutates during a user's drag, so this is a theoretical concern.
- Gizmo renders slightly above rotation gizmo — in very zoomed-out views the 0.12 ft offset is invisible and the two can visually overlap. Real-world camera distance keeps them separable.
- Large selections (500+ pipes) might stutter during drag because every frame calls setPoints on every pipe. 14.M has the same limitation; a v2 batch-update action on pipeStore would help both.

**Non-consequences:**
- No changes to BOM, pricing, proposal, compliance, revisions, templates, library-sync, or mass-edit. Selection-side UX only.
- No new runtime deps. Main bundle grows ~5 KB raw / ~1.5 KB gzip.
- Existing single-fixture rotation gizmo (14.F) + group rotation gizmo (14.M) continue to work unchanged. 14.O's translate gizmo is additive.
- No schema bump. `.elbow` bundles unaffected.

## Alternatives considered

**Three orthogonal arrows (X / Y / Z) for full 3D translation.** Matches CAD convention (red X, green Y, blue Z). Rejected for plumbing because Y moves correspond to floor transitions, not continuous shifts — the contractor shouldn't accidentally drag a pipe network up 2.3 ft into a ceiling space. XZ-only is the safer default.

**Combine rotate + translate into one multi-mode gizmo** (like Blender's "G / R / S" cycle). Cleaner UI but requires a mode-selector and more cognitive load. The current two-gizmo pattern is visually distinct: ring = rotate, cross = translate.

**Only support keyboard, skip the drag gizmo.** Keyboard is precise; drag is tactile. Users expect both. Shipping both takes little extra code beyond the pure math module.

**Snap to 6 inches instead of 1 foot.** Industry practice varies. 1 ft matches the existing measurement ruler convention + makes Ctrl-snap feel like a clean coarse step. 6 in could be a Shift+Ctrl combo in v2.

**Don't mutate cached selection state during drag** — re-read from the stores each frame. Cleaner, but causes drift at the centroid (stores update asynchronously in React's batching; re-reading mid-drag gets stale values). In-place mutation is a pragmatic trade-off.

**Combine all pure selection math (rotate + translate + centroid) into a single `groupTransform.ts`.** Considered. Kept separate because the pure modules serve as single-concern reference. `computeCentroid` is duplicated between the two files — intentional for module independence; trivial maintenance cost.

**Click-to-place mode** ("click where you want the centroid to go"). Different gesture, different muscle memory. Drag-gizmo is the consistent choice for direct manipulation.

## Validation

- `Vitest`:
  - `src/core/selection/__tests__/groupTranslate.spec.ts` — **22 tests**: `translateVec` (delta add, zero, negative), `translateGroup` (pipes + fixtures, round-trip +/−delta, empty input), `constrainToDominantAxis` (X-dominant, Z-dominant, ties, Y preservation, negative axes), `snapDeltaToGrid` (1 ft rounding, fractional steps, Y preservation, step ≤ 0 passthrough), drag-session end-to-end (bare drag, constrained, snap, combo, no-op), `computeCentroid` (empty, populated).
  - All prior tests continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. No runtime deps added.
- Manual plan:
  - Select ≥ 2 items (Shift+click or lasso). Observe both gizmos: ring at centroid (rotate) + cross slightly above it (translate).
  - Drag the cross. Group moves in XZ. Live "+X ft · +Z ft" readout appears above the handle.
  - Hold Shift while dragging. Group snaps to axis (longer bar shows locked axis).
  - Hold Ctrl. Group snaps to 1 ft grid cells.
  - Hold Shift + Ctrl together. Both constraints compose.
  - Release cross. Press → arrow key. Group moves +1 ft X. Shift+→ = 0.1 ft. Ctrl+→ = 5 ft.
  - Verify single-pipe + single-fixture arrow keys too — arrow keys work without a multi-select.
  - Verify no regression on 14.M rotation: grab the ring, it rotates as before. 14.F single-fixture gizmo still works.
