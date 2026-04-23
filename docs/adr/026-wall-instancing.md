# ADR 026 — Wall Instancing (Phase 12.C)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 12.C
- **Depends on:** ADR 024 (Rendering Foundation — cutaway mode), Phase 12.A audit pass (Object.values selector hygiene), Phase 12.B (AdaptiveQuality + LOD).

## Context

The Phase 12.B audit identified wall rendering as the biggest remaining draw-call offender once pipes and fittings were already instanced. Each wall rendered as one `<mesh>` + one `<lineSegments>` — two draw calls per wall. For a typical residential basement with 15 walls that's 30 draw calls for a feature that has far less on-screen density than pipes.

But wall instancing is trickier than fitting instancing because walls carry more per-instance visual state:

1. **Per-type accent color** — exterior brown, interior grey, plumbing cyan, partition light grey, knee orange.
2. **Floor-ghost fade** when a wall lives on a floor other than the active one (driven by `floorStore.getPipeFloorParams`).
3. **Cutaway dim** (ADR 024) when the wall is between camera and focus in cutaway mode.
4. **Render-mode opacity** (ADR 024) — walls-up = full, walls-down = global ~8% global multiplier.
5. **Selection highlight** — the user can click a wall, and the selected wall gets a bright gold edge outline.
6. **Click-to-select** — each wall is a pointer-event target.
7. **Edge outlines** — every wall has a 12-edge line overlay so transparent walls are still visually readable.

The existing `WallMesh` component encoded all of these per-mesh via React state + material overrides. Collapsing to `InstancedMesh` required finding a clean way to preserve every one.

## Decision

Split wall rendering into a pure bucketing pass + a small set of instanced render slots.

### Architecture

```
src/core/walls/wallInstanceBuckets.ts   PURE bucketing + edge-vertex writer
src/core/walls/__tests__/               15 tests covering bucket routing + geometry
src/ui/walls/InstancedWallMeshes.tsx    R3F renderer: 2 InstancedMesh + 2 LineSegments + 1 selected mesh
src/ui/walls/WallRenderer.tsx           refactored: 60 lines removed; delegates to <InstancedWallMeshes/>
```

### Bucket function (`bucketWalls`)

Pure TypeScript — no React, no Three.js, no Zustand. Accepts walls + selection + cutaway-set + render-mode + floor-params function. Returns:

```ts
{
  full:     WallInstance[]    // bright, interactive
  dim:      WallInstance[]    // ghost / cutaway-hit / walls-down
  selected: WallInstance | null
}
```

Routing order:
1. `wall.hidden` or `!floorParams.visible` → excluded entirely.
2. `wall.id === selectedId` → selected (regardless of cutaway / floor state).
3. `floorParams.opacity < 1` (off-floor ghost) → dim bucket, non-interactive.
4. `renderMode === 'walls-down'` → dim bucket.
5. `renderMode === 'cutaway'` and in the cutaway set → dim bucket.
6. Otherwise → full bucket.

Each `WallInstance` carries pre-computed position / quaternion / scale / color / interactive — ready for the renderer to upload to an `InstancedMesh`. The R3F component does no per-wall math.

### Renderer (`InstancedWallMeshes`)

Three rendering slots, Three.js skips any that are empty so the worst case of 5 draw calls only appears when all three are non-empty plus a selection:

| Slot | Draw calls | Purpose |
|------|-----------|---------|
| Full InstancedMesh | 1 | All bright walls, per-instance color + click |
| Full BucketEdges (LineSegments) | 1 | Merged 12-edge outlines for all full walls |
| Dim InstancedMesh | 1 | Ghost / cutaway / walls-down walls, non-interactive |
| Dim BucketEdges | 1 | Merged outlines for dim walls |
| Selected wall (mesh + edges) | 2 | Non-instanced for gold highlight + deselect click |

Typical walls-up scene with 15 walls and no selection → **2 draw calls** (full IM + full edges). Full cutaway scene with 8 walls dimmed → **4 draw calls**. Full cutaway with selection → **6 draw calls**.

Compared to **2N = 30 draw calls** before, for the same 15-wall basement.

### Per-instance color via `setColorAt`

Material `color` is pinned to white on each bucket. `setColorAt(i, new Color(wall.color))` sets the per-instance `instanceColor` attribute, which multiplies with white → yields the wall-type accent color. No custom shader, no vertex-color wiring — Three.js handles it automatically since r155.

### Merged edge geometry

Each wall contributes 12 edges × 2 endpoints = 24 vertices (72 floats) to a single `BufferGeometry` per bucket. `writeWallEdges()` transforms the unit-cube edge vertices by the wall's own scale + Y-rotation + translate inline — pure math, no Three.js objects allocated per wall. For 50 walls that's 3600 floats of edge data, computed once per bucket rebuild.

Single `LineSegments` draw call for the whole bucket. Geometry disposed on rebuild to prevent GPU buffer leaks.

### Why not share one InstancedMesh across buckets with per-instance opacity?

Material opacity is NOT a standard instance attribute in Three.js. Supporting per-instance opacity requires either a custom shader (with all the lifecycle + dispose complexity that implies), or abusing the RGBA alpha channel of `instanceColor` (which doesn't work with `MeshStandardMaterial` without additional setup).

Two buckets with different material opacity is the idiomatic solution: no shader code, each bucket's opacity stays material-driven, and the bucket split maps naturally to the "dim these walls" semantics the cutaway algorithm already produces.

### Why `MAX_WALL_INSTANCES = 1024`?

`InstancedMesh` takes a maxCount at construction. Reallocating mid-session means a new `InstancedMesh` instance, which means a new material reference, which re-uploads the shader. 1024 comfortably covers a multi-story commercial site while avoiding the memory overhead of a larger preallocation. Typical scenes use < 100 instances; the extra 924 slots cost nothing beyond a single oversized buffer.

### Selected-wall rendering

The selected wall uses a `<mesh>` + `<lineSegments>` with an `EdgesGeometry` — same as the pre-instancing code path, now applied to exactly one mesh. The gold (#ffd54f) edge highlight at opacity 0.95 makes the selection obvious. Click handler on the selected mesh deselects (sends `selectWall(null)`).

Geometry + edge geometry both `dispose()` on unmount / selection change to prevent leaks.

### Click handler on the full InstancedMesh

R3F's `onClick` event on an `instancedMesh` surfaces `event.instanceId` — the index of the instance that was clicked. The bucket order is preserved as an array parallel to the instance indices, so `buckets.full[instanceId].wall.id` is the id to select.

## Consequences

**Good:**
- Wall draw calls drop from `2N` to a flat `2–5` depending on state. A 50-wall commercial basement goes from 100 draw calls to 2.
- Bucket function is pure + exhaustively unit-tested. If a future refactor breaks cutaway or floor-ghost, the test file reports in detail what changed.
- Selected-wall rendering is isolated. Future highlight changes (hover outline, glowing pulse) don't touch the instanced path.
- Edge vertex computation is inlined math — no Three.js allocations per wall. Rebuilds only when the bucket list changes (wall edits, selection, cutaway set).
- `WallRenderer.tsx` shrinks by ~60 lines. All per-wall rendering state is now in `bucketWalls` (pure) + `InstancedWallMeshes` (isolated).

**Accepted costs:**
- Per-instance **opacity** is now bucketed rather than continuous. A wall can only be "full" or "dim" — not "70% faded to 0.25 opacity through a custom curve". Fine for every current consumer (cutaway, walls-down, floor-ghost), but an edge case like "fade out wall over 300 ms on remove" would need either a custom shader or a temporary non-instanced fallback.
- `MAX_WALL_INSTANCES = 1024` is a soft ceiling. Scenes with more than 1024 walls would silently drop instances past that count. Unrealistic for plumbing CAD, but worth documenting.
- `InstancedMesh.computeBoundingSphere` runs on every bucket update. Fine — it's cheap for a unit box with known extents.
- Click testing now relies on `event.instanceId`. If a future R3F version changes that API, this needs updating. Three.js core semantics are stable so low risk.

**Non-consequences:**
- Cutaway mode still works (`useCutawaySet` unchanged; its output feeds `bucketWalls`).
- Walls-down mode still works (render-mode multiplier absorbed into bucket routing).
- Floor-ghost still works (ghost walls go to the dim bucket; color override is applied in `buildInstance`).
- Edge outlines still appear for every visible wall (merged into the bucket's edge LineSegments).
- Wall-type accent colors still work (per-instance `setColorAt`).

## Alternatives considered

**Single InstancedMesh with custom vertex shader for opacity.** Maximum flexibility, but non-trivial to author + maintain. A future iteration that needs per-wall animated opacity (e.g. fade-in on add) can add it as a shader upgrade without touching the bucketing logic.

**InstancedLineSegments for edges.** Three.js has no first-party instanced line segments. The r3-stdlib `LineSegments2` is viable but adds a dependency. Merged `BufferGeometry` with pre-transformed vertices gives the same net draw call (1 per bucket) with a simpler implementation.

**Drop edge outlines on dim-bucket walls.** Would save one draw call when cutaway or walls-down is active. Kept them for visual consistency — transparent boxes without outlines look like blobs.

**Keep the existing `WallMesh` component for select-mode and use InstancedMesh only for unselected.** Considered. Rejected for complexity: the bucket function becomes one of two paths and the tests fragment. One unified bucket pass is cleaner.

**Use `frustumCulled = false` on the InstancedMesh.** Would skip Three.js's per-mesh frustum check. For a 50-instance mesh with a known-large bounding sphere this doesn't save anything meaningful and loses off-screen culling. Not worth it.

## Validation

- `Vitest`:
  - `src/core/walls/__tests__/wallInstanceBuckets.spec.ts` — **15 tests** covering bucket routing (9: walls-up, hidden, visible=false, ghost, walls-down, cutaway-specific, selected bypass, selected-hidden-excluded, wall-type color), geometry correctness (2: horizontal wall position/scale/quaternion, vertical wall 90° rotation), edge writer (4: vertex count, axis-aligned corners, rotated corners, shared-buffer offset).
  - Existing `cutawayAlgorithm.spec.ts` (13) + `renderModeStore.spec.ts` (10) still pass — the instancing didn't regress the render-mode stack.
- `tsc --noEmit` clean.
- `vitest run` full suite → **396/396 pass across 31 files**.
- `vite build` clean (see below).
- Manual test plan (for user validation):
  - Create 10 walls in walls-up mode → only 2 draw calls in PerfHUD "gpu" row.
  - Switch to walls-down (Shift+W) → still 2 draw calls (all walls shift to dim bucket).
  - Switch to cutaway (Shift+W again) → orbit camera; watch draw count go to 4 when cutaway walls exist.
  - Click a wall → gold edge appears; draw count becomes 6 (2 full + 2 edges + 2 selected).
  - Click elsewhere → selection clears, back to 2 draw calls.

## Future work

- **Animated per-instance opacity** via custom shader if ever needed (fade-in/out on add/remove).
- **Wall hover state** — currently no hover highlight; if we add one, it can go in its own non-instanced slot next to selection.
- **Non-rectangular walls** (curved partitions, angled chases) — would need separate geometry buckets per shape variant. Not currently modeled.
