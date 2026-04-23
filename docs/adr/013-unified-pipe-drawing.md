# ADR 013 — Unified Pipe Drawing UX (Phase 9)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 9 of 9
- **Depends on:** ADR 007 (EndpointExtender), ADR 008 (tee-drag), ADR 002 (CommandBus)

## Context

Actual user feedback, verbatim:

> *"the drawing of pipes and all feels somewhat disconnected and hard to figure out"*

By Phase 8 we had three orthogonal pipe-drawing mechanisms, each with its own visual language:

1. **`D` (Draw mode)** — click-click-click-Enter, drops polyline points on the ground plane. No awareness of existing pipes.
2. **`S` (Select mode) + `+` glyph** — click-drag a pulsing + glyph at a pipe endpoint to extend (Phase 6).
3. **`S` (Select mode) + drag pipe body** — click-drag anywhere on a pipe to insert a tee + extend a branch (Phase 7.A).

Each works in isolation. Together they fragment the user's mental model. To continue an existing run, a user must press `S`, find the + glyph (a small cyan marker), drag from it — even though the obvious motion is "press `D`, click at the end of the existing pipe to continue." The snap target the user expects doesn't exist in Draw mode.

Beyond mode fragmentation:

- **No cursor badge** — the user can't see what diameter + material they're drawing without looking at a toolbar far from the cursor.
- **No contextual hint bar** — nothing tells the user what their next click will do.
- **Inconsistent snap feedback** — each system renders (or doesn't) its own indicators.

## Decision

Four consolidations, shipped together as Phase 9:

### 9.A — `drawFeedbackStore` + `nearestPipeSnap`

New Zustand store (`src/store/drawFeedbackStore.ts`) holds the visible-feedback state all drawing UIs need: cursor world + client position, current snap target, and a computed `nextAction` enum. DrawInteraction writes to it in `useFrame`; the hint bar + cursor badge + snap indicator subscribe.

A new pure helper (`src/core/pipe/nearestPipeSnap.ts`) returns the single best snap from a pipe set:
- **Endpoint snap** wins when cursor is within 0.6 ft of any pipe's first/last point.
- **Body snap** (perpendicular projection) returns when no endpoint is in range and cursor is within 0.35 ft of a pipe segment.
- Endpoint threshold is larger than body threshold — the user's intent near an endpoint is almost always "continue this run."

11 unit tests pin the priority rules, threshold behavior, and visibility filtering.

### 9.B — Snap in Draw mode

`DrawInteraction.useFrame` now calls `nearestPipeSnap` on every tick. When a snap target exists, the cursor position is OVERRIDDEN to the snap point — clicking commits exactly there. Also populates `drawFeedbackStore.snapTarget` so the hint bar can describe the target and the 3D `SnapIndicator` (new, in the same file) renders a green or amber ring on the ground at that point.

Practical effect: in Draw mode, the user's first click at the end of an existing pipe CONTINUES that pipe. No mode switch required. The first point of the new run is the old run's endpoint; fittings automatically unify (Phase 7.B's merge pass already handles this for PEX, junction fittings cover rigid materials).

`onClick` was updated to read from `cursorPos.current` (which has snap applied) instead of re-raycasting. Also enriched the `EV.PIPE_SNAP` event's `snapType` — `'grid'` / `'pipe'` / `'fixture'` — so the feedback layer can differentiate sounds + visuals.

### 9.C — `DrawingHintBar`

Bottom-center pill-shaped HUD. Reads `drawFeedbackStore.nextAction` + snap label + interaction state and renders a three-line hint:

- **Primary**: "Click to start a 2" PVC pipe" / "Click to extend from Pipe endpoint · 1" PEX (cold)" / etc.
- **Secondary**: running length + diameter + material summary.
- **Key hint**: modifier keys applicable right now ("Enter to finish · Esc to clear").

Composition is a pure function (`composeHint`) for testability — no DOM, no stores, just input → `{primary, secondary, icon, keyHint}`.

Hides in navigate mode with nothing to report, so it doesn't clutter idle views.

### 9.D — `CursorBadge`

Small DOM chip that follows the cursor (via `CursorTracker`'s global pointermove listener). Shows:
- Colored dot — diameter color (mirrors `DIAMETER_COLORS` from pipeStore)
- Diameter text (e.g. `2"`)
- Material shorthand (`pvc`, `pex`, `copper type l`)
- Plane badge (`H` / `V`)

Visibility: always in Draw mode; in Select mode only when a snap is active (user is about to extend/tee — shows them what material will be used).

### Component topology

```
App.tsx (root)
  ├─ Canvas (R3F)
  │   └─ DrawInteraction
  │       └─ SnapIndicator   ← Phase 9 — reads drawFeedbackStore
  ├─ CursorTracker           ← Phase 9 — global pointermove → store
  ├─ DrawingHintBar          ← Phase 9 — reads store + interactionStore
  ├─ CursorBadge             ← Phase 9 — reads store + interactionStore
  └─ (legacy panels, debug tools, help overlay)
```

No component writes to another component's state. The store is the only shared contract.

## Key design choices

### Single source of truth for visible feedback

Alternative: each UI reads its own bits from existing stores + maintains its own refs. Rejected because:
- The hint bar needs the snap target (managed in DrawInteraction) AND the drawPoints length (in interactionStore) AND the next-action enum (computed). Threading those through props breaks every time we add a new feedback consumer.
- The cursor badge needs client-space pointer position, which isn't anywhere in the stores today. Making each consumer add a global listener duplicates work.

A single read-only feedback store resolves both with one write per tick.

### Snap is Draw-mode-only (for now)

Could extend to Select mode too (hover highlight for the + glyph). Deliberately scoped to Draw mode because Select mode already has per-pipe hitboxes from `PipeHitboxes` with their own hover logic. Two overlapping systems on hover would flicker. A future consolidation can unify them behind the same store, but for this phase the line stays.

### Cursor override instead of "suggested target"

Option A: visualize the snap target but don't move the cursor ring; clicking somewhere else ignores the snap.
Option B: lock cursor to the snap target; clicking commits there regardless of where the physical pointer is.

Chose B. In practice, the visual hint + "snap lock" reinforces each other: the user sees the ring, moves intentionally to commit, clicks. Option A left room for "I moved past the snap but still want to place at the grid" uncertainty — more flexible but less intuitive.

### The hint bar is 100% informational

No interactions. A fallback for users wondering what to do — not a menu. Keyboard discoverability is still the `?` overlay from Phase 8.C.

## Alternatives considered

### A. Modal "Draw tool" with a permanent mode indicator

Explicit "enter draw tool, click to place, Enter to finish, click away to exit" pattern familiar from AutoCAD. Rejected because:
- Our existing Draw mode already IS a modal tool.
- The fragmentation complaint isn't about entry — it's about the SEAMS between modes.
- Unifying seams (via snap in Draw mode) closes the gap; adding more modality wouldn't help.

### B. Context menu on right-click

"Right-click a pipe → Extend / Insert tee / Delete / Properties." Discoverable but another separate surface, and right-click is reserved for pan (ADR 007). Rejected.

### C. Persistent on-canvas controls (rotate handles, extend arrows like Figma)

Would require per-pipe R3F overlays everywhere and break the minimal visual style. Deferred — if user feedback post-9 asks for it, we have a place to add them.

## Consequences

### Positive

- **Draw mode now does ~70% of what Select-mode extend/tee do** — without mode switching.
- **Every click has a visible intent.** The hint bar's primary line is a narration: the user literally sees "Click to extend from Pipe endpoint · 1" PEX (cold)" before committing.
- **The user always knows what they're drawing.** Cursor badge is sticky at the cursor; one glance.
- **Pure-function composeHint + pure snap helper.** Both testable, both deterministic.
- **Zero new runtime deps.**

### Negative

- **Two systems can now place a tee** — Draw-mode click with body snap + Select-mode drag on body. Behavior is nearly identical (both result in tee + branch), so users should land on whichever feels natural. Documented in the hint bar but could confuse users who learn one path and wonder why the other also works.
- **Cursor override can feel "sticky" at small snap thresholds**. The 0.35 ft body snap is intentionally tight; users who want grid-only placement near a pipe may need to move further away. Heard in practice? → Phase 9.1 could add a `hold Alt` modifier to suppress snap, matching the AutoCAD convention.
- **The feedback store adds one `set()` per frame.** Zustand's shallow-equal means subscribers without changed fields don't re-render, but there's still a small constant overhead. Not measurable in profiling but noted for future micro-optimization if hundreds of subscribers land.

### Neutral

- **EndpointExtender's + glyphs remain** — Select mode keeps its visual affordance. Not removed because users who've learned the flow should still see the option. A future phase could make them optional via a `showExtendGlyphs` preference.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Snap priority tests (endpoint over body, etc.) | all pass | **11/11** ✓ |
| Draw-mode click near endpoint continues that pipe | yes | **yes** (cursorPos override + EV.PIPE_SNAP with snapType='pipe') |
| DrawingHintBar updates on state change | reactive | **reactive** (Zustand selector subscriptions) |
| CursorBadge visible in Draw mode without snap | yes | **yes** |
| CursorBadge visible in Select mode only with snap | yes | **yes** |
| TypeScript | 0 errors | **0** |
| New runtime deps | 0 | **0** |

## Rollout

- **This commit:** all four additions live. No feature flag — these are strict UX improvements; rollback = code revert.
- **Follow-ups to consider:** `Alt` to suppress snap; extend snap to Select mode hover; keyboard-only draw path (arrow keys to move cursor, Enter to place).

## Rollback

- Revert the Phase 9 commits. The feedback store + helper + three UI components are additive; removing their mounts restores the pre-Phase-9 behavior intact.

## References

- Source: `src/store/drawFeedbackStore.ts`, `src/core/pipe/nearestPipeSnap.ts`, `src/ui/draw/{DrawingHintBar,CursorBadge,CursorTracker}.tsx`, `src/App.tsx::DrawInteraction` + `SnapIndicator` + helpers
- Test: `src/core/pipe/__tests__/nearestPipeSnap.spec.ts`
- Dependencies: ADR 007 (extend session) + ADR 008 (tee-drag) patterns inform this; Phase 9 doesn't replace them
