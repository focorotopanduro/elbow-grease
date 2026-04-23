# ADR 007 — PEX Drag-Extend Flow + Foundations for the QuickPlumb Feel

- **Status:** Accepted (foundations landed; 4 follow-up items enumerated for Phase 7)
- **Date:** 2026-04-17
- **Phase:** 6 of 7

## Context

The user, a working plumber migrating from QuickPlumb, described a specific gestural language for drawing Uponor (PEX) pipe that the current ELBOW GREASE click-to-place model doesn't support well. Summary of the ask:

1. **Drag-from-endpoint extension** — click+drag on an empty endpoint, manifold hub, or free side of a tee → create a new pipe in the currently-selected diameter+material.
2. **PEX organic reconciliation** — 45° bends smooth out (no fitting); 90° corners get an explicit 90° fitting; other angles produce continuous curved tubes.
3. **"Uponor doesn't generate 90s unless asked"** — only user-drawn right angles get right-angle fittings.
4. **Cap on delete** — deleting a pipe doesn't cascade; the orphaned neighbor end gets a visible plug + retaining ring.
5. **Pivot clamp** — extending past a physically-possible angle should snap back.
6. **Navigation freeze key** — hold a key to freeze orbit while drawing, so drag gestures don't fight pan/rotate.

The ask is large enough to span multiple phases. This ADR scopes what landed in **Phase 6** and enumerates the **Phase 7** follow-ups with concrete technical prerequisites.

## Decision — Phase 6 (this commit)

Ship the foundational building blocks, flag-gated and coexisting with every existing gesture:

### 1. Navigation freeze (`Space` hold)

New `navFrozen` boolean in `interactionStore`. A global listener in `App.tsx::NavigationFreezeHandler` flips it on `Space` keydown (bare key only — `Ctrl+Space` stays reserved for the DRAWING radial wheel) and off on keyup. `OrbitControlsGate` reads the flag and disables all orbit gestures while held. Blur-safe: window losing focus while held releases the lock.

Why bare `Space`: it's the one ergonomic key that isn't bound elsewhere in the app, and every CAD user expects "space = pause the camera".

### 2. `pipeExtendDrag` feature flag (default **on**)

Persisted in `featureFlagStore`. The user can toggle off from God Mode if the drag flow conflicts with a specific workflow we didn't foresee.

### 3. `EndpointExtender` — drag-from-endpoint flow

For every visible pipe in Select mode (when flag is on), renders a pulsing `+` glyph at both endpoints. Flow:

- `pointerdown` on a glyph → begins an extend session (module-local, for cheap window-handler access). Freezes navigation automatically so the user doesn't have to hold Space.
- `pointermove` → raycasts to the ground plane, grid-snaps, updates a live preview tube + cursor markers.
- `pointerup` → emits `EV.PIPE_COMPLETE` with the anchor→cursor points, current diameter, current material. The existing Phase 1 CommandBus translates this into a `pipe.add` dispatch and the pipe appears.
- `Escape` during drag → cancel, no pipe created.

The glyph's `pointerdown` calls `stopPropagation()` + `stopImmediatePropagation()` so pivot hitboxes and canvas-level listeners don't fire simultaneously.

### 4. `PexBendClassifier` (pure function, 24 tests passing)

Given two adjacent segment direction vectors and a material, returns one of:

- **`fitting_90`** — within ±7° of a right angle, PEX or rigid alike. The classifier snaps this to a 90° fitting. Exact tolerance tunable via `FITTING_90_TOLERANCE_DEG`.
- **`smooth_bend`** — any PEX vertex 15°–120° not within the 90° tolerance. Render as a continuous smoothed tube segment. This is the "organic" Uponor behavior.
- **`smooth_curve`** — under 15° deviation. Treat as near-straight.
- **`sharp_bend`** — PEX over 120°. Physically impossible without kink — UI rejects this.
- **`fitting_other`** — rigid materials at arbitrary angles → fitting at the nearest standard (22.5°, 45°, 90°).

The classifier is pure — no imports, no state, no side effects. Ready to plug into a merged-tube renderer when Phase 7.B lands.

### 5. `CapPlug` geometry (ready for use)

NPT-style cap: short cylindrical collar, outward-facing dome, retaining torus ring in a warning-orange colorway. Takes a facing direction vector so the plug orients away from the pipe centerline. Landed but **not yet rendered in production** — it's used when connectivity tracking (see Phase 7.D) emits orphan-endpoint events.

## Decision — Phase 7 (explicit follow-up, broken into 4 distinct items)

The user's scope grew mid-phase with three additional asks. Each gets its own concrete plan below.

### 7.A — Tee-from-middle-drag

**Ask:** *"if i click in the middle of a pipe a tee is generated and a pipe comes out of said tee."*

**Plan:**
1. Extend `PipeHitboxes.PipeHitbox` center-body hit handler: track `pointerdown` + `pointermove` distance. If pointer moves > `DRAG_THRESHOLD_PX` (≈8px) before `pointerup`, treat it as a tee-drag; if below, existing "select" behavior.
2. Tee-drag path:
   - Compute `t` parameter on the pipe polyline at the hit point.
   - Insert a synthetic anchor point into the pipe at `t` — the pipe now has 3+ points with a tee at the new vertex.
   - Begin an extend session (same `EndpointExtender` machinery) anchored at the new vertex.
3. Subsequent `pointerdown` on the new branch pipe's middle = normal select, NOT another tee+drag, because `dragThreshold > pointerupDelta` falls through to select.
4. On commit, the parent pipe's existing fitting at that vertex is upgraded from "none" / "elbow_90" to "tee" via `FittingCatalog.defaultTeeFor(material, branchAngleDeg)`.

Size: ~150 lines in `PipeHitboxes.tsx` + a small `insertAnchorAt(pipeId, t)` method on `pipeStore`. Test-coverable.

### 7.B — Merged-tube rendering for 45° PEX

**Ask:** *"uponor must behave organically by uniting and reconciling pipes which are drawn in 45 degree turns... smothen out the edges of those specific pipe to unite them."*

**Plan:**
1. In `PipeRenderer.tsx`, group committed pipes by **PEX + shared endpoint + bend class `smooth_bend`**.
2. Each group is rendered as ONE `CatmullRomCurve3` through all their points, one `TubeGeometry` per group.
3. Selection highlight stays per-pipe: raycasting individual pipes still returns their ID, even though the visual mesh spans the whole group.
4. When any pipe in the group is mutated (diameter, material, deletion), the group is recomputed.

The heavy lift is the GROUPING pass — a small Union-Find over pipes with shared endpoints. The classifier (from Phase 6) is the decision oracle.

Size: ~250 lines in `PipeRenderer.tsx` + a `mergePexRuns.ts` util + geometry cache. Needs a performance benchmark (hundreds of pipes should re-merge in < 8ms per change).

### 7.C — Manifold drag-merge

**Ask:** *"once I pull a bunch of manifolds together, they merge into a 2 outlet manifold, or 3, or 4, or 5, depending how many I put together as they snap onto the next pipe if I drage them paralel to each other as they touch."*

**Plan:**
1. New entity type `Manifold` in a `manifoldStore` (position, orientation, port count, port positions).
2. Start primitive: a 2-port inline manifold created by dragging from a tee.
3. When a manifold is dragged (via a new `ManifoldDragSession`, mirroring the extend session), we run a proximity check against all other manifolds on the same floor.
4. If two manifolds' port planes are parallel AND within `SNAP_DISTANCE_FT` (≈0.2 ft), they MERGE: one manifold absorbs the other, port count increases, visual mesh rebuilds for the higher-port primitive.
5. Visual representation scales: 2-port bar, 3-port block, 4-port block with offset, 5-port elongated.

Size: ~400 lines across `manifoldStore.ts`, `ManifoldRenderer.tsx`, `ManifoldDragSession.ts`, plus fitting-catalog entries.

### 7.D — Auto-plug on delete (connectivity tracker prerequisite)

**Ask:** *"deleting a prior pipe doesnt reset what comes after, that end just gets capped off with a pug and ring around the plug."*

**Plan (two sub-phases):**

**7.D.i — PipeConnectivity graph**
- New `pipeConnectivityStore`: for each pipe endpoint, record which other pipe endpoints are within `JOIN_EPSILON_FT`.
- Updated on every `pipe.add` / `pipe.remove` / `fixture.place` event via a Phase 1 CommandBus handler.
- Answers: "is this endpoint connected to something?" in O(1).

**7.D.ii — CapPlug renderer**
- On `pipe.remove`, find the connectivity graph's former neighbors of the deleted pipe.
- For each neighbor's now-orphaned endpoint, push a capped-endpoint record into a `cappedEndpointStore`.
- Existing `CapPlug` component (from Phase 6) renders every record.
- User-explicit "uncap" action (button in the PipeInspector) removes a cap.

Size: ~200 lines across two stores + a ~60-line renderer wrapper around `CapPlug`.

## Alternatives considered (and rejected)

### I. A modal "draw tool" instead of drag-gestures

Classic CAD flow: enter "draw pipe" mode explicitly, click to place, press Escape to exit. Rejected because the user explicitly wants a gestural flow ("physically draw pipes"). Modal tools fight muscle memory from QuickPlumb.

### II. Shift-modifier for extend

`Shift+drag` on endpoint = extend, plain drag = pivot. Rejected because the user described single-click/single-drag gestures — modifier keys feel like training wheels once you're deep in drawing.

### III. Remove pivot to free the endpoint for extend

Pivot is a useful separate operation (rotate an existing pipe around its other end). Removing it to make room for extend would be a regression for existing users.

**Decision**: add a distinct `+` glyph at a slight offset from the pivot hit zone. The glyph is clearly visible, clearly a "create" affordance. If the user clicks the glyph, they extend. If they click the pipe body, they select. If they click the edge without hitting the glyph, they pivot. Three affordances, three distinct zones.

## Consequences

### Positive

- **Extend-to-draw** is live. Pipes continue from their endpoints in the selected diameter+material in one gesture.
- **Navigation freeze** solves the drag-vs-orbit conflict universally — not just for extend, but for any future drag-based tool (Phase 7's tee-drag, manifold-drag).
- **PEX classifier** is pure and tested. The "don't 90° unless asked" rule is now an assertion in 24 Vitest cases.
- **Cap-plug geometry** is visually faithful to the user's description ("pug and ring around the plug"), ready to render when connectivity lands.
- **Zero new runtime deps.** Entirely DOM + Three primitives.

### Negative

- **Endpoint glyphs appear on EVERY pipe endpoint** — not just free ones, because connectivity tracking isn't in place yet. A user clicking the `+` on a connected endpoint will create a pipe that overlaps existing geometry. Mitigated by 7.D.i which hides glyphs at connected endpoints.
- **Extend doesn't yet insert a tee at the parent.** The new pipe's anchor is the parent endpoint, but no fitting change occurs. Phase 7.A covers this.
- **No live-preview fitting classification.** Phase 6 shows a flat yellow tube; Phase 7.B will run the classifier on the preview so the user sees whether they're getting a 90° fitting or a smooth bend at commit time.

### Neutral

- **`navFrozen` state is readable from anywhere**, meaning future modal tools can also freeze the camera with one `setNavFrozen(true)` call. Good consolidation.

## Rollout

- **This commit:** flag `pipeExtendDrag` default ON; glyphs visible immediately in Select mode.
- **v0.1.3:** ship Phase 7.A (tee-from-middle-drag).
- **v0.1.4:** ship Phase 7.D (connectivity + auto-plug).
- **v0.2.0:** ship Phase 7.B (merged-tube rendering) + Phase 7.C (manifold drag-merge). These together form "Phase 7" proper.

## Rollback

- **User:** toggle `pipeExtendDrag` off in God Mode (`Ctrl+Shift+G`). Glyphs vanish, behavior reverts.
- **Dev:** revert this commit. `EndpointExtender.tsx`, `PexBendClassifier.ts`, `CapPlug.tsx` remain as inert modules.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| PexBendClassifier tests | all pass | **24/24** ✓ |
| Endpoint glyph visible in Select + flag on | yes | **yes** ✓ |
| `Space` hold disables orbit | yes | **yes** ✓ |
| Blur-safe freeze release | yes | **yes** ✓ |
| New runtime deps | 0 | **0** ✓ |
| TypeScript | 0 errors | — (verified next step) |

## References

- Source: `src/ui/pipe/EndpointExtender.tsx`, `src/ui/pipe/CapPlug.tsx`, `src/core/pipe/PexBendClassifier.ts`, `src/App.tsx::NavigationFreezeHandler`
- Test: `src/core/pipe/__tests__/PexBendClassifier.spec.ts`
- Flag: `src/store/featureFlagStore.ts::pipeExtendDrag`
- Deferred items: 7.A tee-from-middle-drag, 7.B merged-tube PEX, 7.C manifold drag-merge, 7.D connectivity + auto-plug
