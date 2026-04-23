# ADR 008 — Tee-from-Middle-Drag (Phase 7.A)

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 7.A of 7
- **Depends on:** ADR 002 (CommandBus), ADR 007 (EndpointExtender + ExtendSession)

## Context

User request, verbatim:

> *"if i click in the middle of a pipe a tee is generated and a pipe comes out of said tee, and then I can click in the middle of the new pipe JUST ONce fast so instead of drawing a new pipe with a tee, it just selects it in order to drag it or extended."*

The QuickPlumb workflow distinguishes **intent** by gesture, not by toggle: a quick tap in the middle of a pipe selects it; a click-drag creates a branch. This keeps the user's hands on the mouse and eyes on the drawing.

Phase 6 shipped drag-extension from pipe endpoints (via `EndpointExtender`'s `+` glyphs) and a shared `ExtendSession` module. Phase 7.A uses the same session machinery, triggered instead from the **pipe body** when the user drags beyond an 8-pixel threshold.

## Decision

Modify `PipeHitboxes.PipeHitbox.onCenterDown` to defer the select-vs-drag decision until `pointerup`:

1. **pointerdown** on pipe body: compute the nearest segment + projection via `nearestSegmentOnPolyline`; record the start client coordinates. Install window-level `pointermove` + `pointerup` listeners. **Do not mutate state yet.**
2. **pointermove** while < 8px from start: noop.
3. **First pointermove** at ≥ 8px from start: grid-snap the projected world point, call `beginExtend({ origin: 'tee', parentPipeId, anchor, teeSegmentIdx })`. The standard session machinery from Phase 6 takes over — live preview follows cursor, `Space` auto-freezes orbit, `Escape` cancels.
4. **pointerup** without ever crossing the threshold: select the pipe (legacy behavior).
5. **pointerup** during an active session: Phase 6's `commitExtendSession` runs:
   a. Dispatches `pipe.insertAnchor` on the parent pipe (parent's polyline gains the new vertex).
   b. Emits `EV.PIPE_COMPLETE` for the new branch pipe.

The new `pipe.insertAnchor` command (Phase 1 compliant) validates preconditions (pipe exists, segmentIdx in range) and captures a deep snapshot of the parent's points for undo.

Feature flag: inherits `pipeExtendDrag` from Phase 6. Off → legacy instant-select on pointerdown.

## Key design choices

### 1. No modifier keys

Considered `Shift+drag` to disambiguate drag-intent from click-intent. Rejected: gesture-only is the user's muscle memory from QuickPlumb; modifier keys feel like training wheels. The 8-pixel threshold is the universal click-vs-drag heuristic (every OS uses approximately this distance).

### 2. Session machinery reuse

One drag flow, two trigger sites (endpoint glyph OR pipe body). `ExtendSession` carries an `origin` discriminant (`'endpoint-start' | 'endpoint-end' | 'tee'`) and, for tees, a `teeSegmentIdx`. The commit path branches on `origin` exactly once, to decide whether to dispatch `pipe.insertAnchor` before the new-pipe emit.

### 3. Anchor insertion happens at COMMIT, not at drag-start

Alternative: insert the tee vertex into the parent pipe the moment the drag threshold is crossed, so the user sees their pipe visibly split. Rejected for two reasons:

- **Cancellation semantics.** If the user presses Escape mid-drag, we'd need to re-splice the pipe back to its original state. The undo machinery from Phase 1 handles this cleanly, but adding the rollback complexity for a visual-only cue isn't worth it.
- **Short-gesture safety.** If the drag is below `MIN_EXTEND_LENGTH_FT`, the whole commit is silently canceled. Deferring the parent mutation until commit means a wobbly mouse never actually touches the parent pipe.

The user sees a yellow preview tube from the hit point to the cursor. On commit, the parent vertex insert + new branch emit happen in the same correlation-id chain so the God Mode console shows both as children of one user action.

### 4. Grid-snap the anchor, not the raw hit point

`nearestSegmentOnPolyline` returns an exact projection; we then grid-snap X/Z (preserving the anchor's Y for horizontal extensions). Users expect tees at grid points like everything else in the drawing flow.

### 5. Drag-vs-click distance is 8 pixels

Standard OS threshold. Below this, a "finger that barely slipped" counts as a click. Above, intentional drag. Tested subjectively: 6px was too trigger-happy, 12px felt laggy. 8 is the goldilocks value most CAD tools use.

### 6. Color-code the preview by origin

Green (`#00ffa6`) for endpoint extends — you're adding to a run. Yellow (`#ffc107`) for tee branches — you're creating a fitting. Sub-conscious signal that a fitting is about to appear. Same cubic-bezier transition from Phase 5 carries it (no new animation infrastructure).

## Alternatives considered

### A. Insert anchor + extend in a single "pipe.branchAt" macro-command

Fewer commands, simpler log. Rejected: composition is cleaner. `pipe.insertAnchor` is independently useful (future: user clicks "add anchor here" from a context menu with no extend). Two small commands beat one opaque macro.

### B. Treat the tee insertion as part of the pipe.add payload

Encode "this new pipe inserts anchor X in pipe P" as metadata on `pipe.add`. Rejected: conflates two mutations under one handler. The parent pipe mutation is legitimate, commits atomically, and belongs at the parent's store, not the new pipe's.

### C. Synthesize the tee fitting explicitly in the command payload

Have the commit path ALSO dispatch `fitting.place(tee)` at the anchor. Rejected: the existing FittingRenderer emits fittings based on pipe topology (pipes sharing an endpoint). As soon as the parent has 3 segments meeting at the anchor AND the branch pipe's endpoint is at that anchor, the render layer produces a tee automatically. No explicit fitting command needed. If that auto-detection breaks at any edge case, it's a PipeRenderer bug, not a Phase 7.A concern.

## Consequences

### Positive

- **The user's gesture works.** Fast click selects; click-drag creates a tee with a branch pipe in the current diameter+material.
- **Undo-safe.** Both the anchor insert and the new branch go through the CommandBus. `Ctrl+Z` reverses them in the standard undo chain.
- **Shared machinery.** Endpoint extend and tee extend use the same preview, same live-update loop, same nav-freeze behavior. One codepath to debug.
- **Scope-safe.** Behind the existing `pipeExtendDrag` flag. Off = today's instant-select.
- **Tested.** 19 new Vitest cases (8 insertAnchor + 11 polylineMath) proving insertion correctness and projection math.

### Negative

- **pointerdown no longer selects instantly when flag is on.** There's a ~100-200ms window (typical pointerup delay) before selection. Imperceptible in practice, but it's a behavioral change from pre-Phase-6.
- **Any pipe click can start a tee.** Clicking a pipe that already has branches can still trigger a tee-drag. This is fine logically (tees can have multiple branches) but may produce unexpected fittings if the user drags by accident. Mitigations: 8-pixel threshold requires commitment; 0.45 ft minimum commit length requires actually drawing something.

### Neutral

- **The new vertex becomes permanent geometry.** If a user inserts a tee then deletes the branch pipe, the parent keeps the extra vertex — an invisible bend. Phase 7.D (auto-plug + connectivity tracking) will add a "simplify polyline" post-delete pass. Documented but not implemented here.

## Rollout

- **This commit:** flag `pipeExtendDrag` already default ON (shared with Phase 6). Tee-drag works immediately.
- **No user-facing toggle added** — it's the same flag.

## Rollback

- **User:** toggle `pipeExtendDrag` off in God Mode. Click returns to instant-select.
- **Dev:** revert the PipeHitboxes delta + this ADR's command registration. `ExtendSession` stays (still used by Phase 6 endpoint extends).

## Metrics

| Metric | Target | Actual |
|---|---|---|
| insertAnchor grows polyline by exactly 1 | yes | **yes** ✓ |
| Out-of-range segmentIdx no-ops | yes | **yes** ✓ |
| Missing pipeId no-ops | yes | **yes** ✓ |
| Command handler undo restores polyline byte-exact | yes | **yes** ✓ |
| nearestSegmentOnPolyline correctness | 11 test cases | **11/11** ✓ |
| Full suite regression | 0 | **0** (94/94 incl Phase 1-6) ✓ |
| New runtime deps | 0 | **0** ✓ |

## References

- Source: `src/ui/pipe/PipeHitboxes.tsx` (drag detector), `src/ui/pipe/ExtendSession.ts` (reused machinery), `src/core/pipe/polylineMath.ts` (projection), `src/store/pipeStore.ts::insertAnchor`, `src/core/commands/handlers/pipeHandlers.ts::pipeInsertAnchorHandler`
- Test: `src/store/__tests__/insertAnchor.spec.ts`, `src/core/pipe/__tests__/polylineMath.spec.ts`
- Flag: `src/store/featureFlagStore.ts::pipeExtendDrag`
