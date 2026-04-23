# ADR 040 — Multi-Select Foundation (Phase 14.I)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.I
- **Depends on:** Phase 14.C (Assembly Templates), Phase 14.F (Rotation Gizmo).

## Context

Several accumulated features assume a single selected entity: the fixture gizmo (14.F), the param window (Phase 2.B), the pipe inspector, the template-save flow (14.C), the Escape / Delete / inspector-open key bindings. This is the cheap choice — one integer per store, one halo per click — and it covered the app all the way through 14.H.

But three real workflows want a *group* to act on:

1. **"Save just the 2-bath rough-in, not my whole scene"** — current 14.C always grabs every pipe + fixture in the scene.
2. **"Delete these 6 pipes I drew by mistake"** — current Delete only kills the single-selected pipe; the user has to click-select-delete six times.
3. **"Mass-rotate these 3 toilets to face the south wall"** — foundation for a future group-gizmo.

Adding multi-select cleanly requires one decision: **is it a replacement for single-select, or a layer on top?** A replacement is architecturally purer but touches every consumer (inspector, gizmo, Delete handler, template save, rotate shortcuts, BOM selection if any). A layer lets existing consumers keep working and adds multi-select as an opt-in via Shift+click.

This phase takes **the layer approach**. It's the safer refactor and preserves every pre-14.I interaction.

## Decision

### 1. `multiSelectStore` — the new layer

A Zustand store with two maps:

```ts
pipeIds:    Record<string, true>
fixtureIds: Record<string, true>
```

Actions: `add/remove/toggle` per entity kind, `clear`, `setSelection(pipeIds, fixtureIds)`, `addMany`. Queries: `isPipeSelected`, `isFixtureSelected`, `count`, `isEmpty`, `selectedPipeIds`, `selectedFixtureIds`. Records instead of `Set<string>` so Zustand's shallow equality + React StrictMode behave cleanly.

### 2. The invariant

- **Multi-select empty**  → single-select stores (`pipeStore.selectedId`, `fixtureStore.selectedFixtureId`) are authoritative. Every pre-14.I consumer works unchanged.
- **Multi-select ≥ 1**   → both are authoritative. An item is "highlighted" (halo / emissive material) if it's in *either* single-select OR multi-select. Bulk ops (Delete, template save) consume from multi-select first.

### 3. Click dispatch

```
bare click    → clear multi-select + single-select this item
Shift+click   → toggle this item's membership in multi-select
                (does NOT touch the single-select state)
empty-space click (onPointerMissed) → clear both
```

Both pipe and fixture click handlers now check `e.nativeEvent.shiftKey` and branch. For pipes, a shared `dispatchPipeClick(e, id, singleSelect)` helper factored into `PipeRenderer.tsx` keeps the three click targets (MergedPexRun lead mesh, FullPipe mesh, PipeClickTargets midpoint boxes) consistent.

### 4. Visual highlighting

Per-entity `useMultiSelectStore` subscriptions so only affected entities re-render when membership flips:

```tsx
// FullPipe
const inMultiSelect = useMultiSelectStore((s) => s.pipeIds[pipe.id] === true);
const isHighlighted = pipe.selected || inMultiSelect;
const mat = isHighlighted ? getSelectedPipeMaterial(...) : getPipeMaterial(...);
```

```tsx
// FixtureWithSelection
const inMultiSelect = useMultiSelectStore((s) => s.fixtureIds[fixture.id] === true);
const isHighlighted = selected || inMultiSelect;
{isHighlighted && <SelectionHalo />}
```

The yellow `#ffd54f` emissive + pulsing halo from Phase 14.F is reused — consistent visual language whether it's one item or twenty.

Merged PEX runs check the whole group: the run renders highlighted if *any* member pipe is in either selection store. The parent `PipeRenderer` subscribes to `multiSelectStore.pipeIds` so merged runs re-evaluate when a member's membership changes.

### 5. Keyboard shortcuts

New bindings in the global `App.tsx` keydown handler:

| Chord | Behavior |
|---|---|
| **Shift+click** | Toggle entity in multi-select |
| **Ctrl+A** | Select every visible pipe + fixture. Skipped while in Draw mode or while typing. |
| **Escape** | Clear multi-select. On second Escape, fall through to the existing chain (clear single-select → drop to Navigate). |
| **Delete / Backspace** | If multi-select is non-empty: remove every selected pipe + fixture. Otherwise: existing single-pipe delete. |

Escape is layered carefully to preserve the existing "Universal cancel chain" (wheel → pending fixture → draw → selection → mode). Multi-select insertion slots in just before single-select clearing.

### 6. Template save extension

`saveCurrentSceneAsTemplate(name, description, opts?)` now accepts an optional `{ pipeIds?, fixtureIds? }` filter. When provided, only those items are captured; omitted means "whole scene" (unchanged from 14.C).

The `AssemblyTemplatesPanel` save form shows a new checkbox when multi-select is non-empty:

```
☐ Save only the 6 multi-selected items (Shift+click adds/removes)
```

Capturing counts in the preview update in real time based on the checkbox state, so the user sees "12 pipes + 3 fixtures" vs "6 pipes + 1 fixture" before committing.

### Files

```
src/store/multiSelectStore.ts                            Layer store
src/store/__tests__/multiSelectStore.spec.ts             18 tests
docs/adr/040-multi-select-foundation.md

src/ui/PipeRenderer.tsx                    (mod) dispatchPipeClick helper + per-pipe subscription
src/ui/fixtures/FixtureModels.tsx          (mod) Shift+click branch + per-fixture subscription
src/App.tsx                                (mod) Ctrl+A, Escape chain, multi-delete
src/core/input/ShortcutRegistry.ts         (mod) 4 new selection-category entries
src/store/assemblyTemplateStore.ts         (mod) +opts.pipeIds / opts.fixtureIds filter
src/ui/templates/AssemblyTemplatesPanel.tsx (mod) "Save selected only" checkbox
```

## Consequences

**Good:**
- Templates-from-selection is finally a thing. A contractor can select the kitchen sink + its supply manifold + drain + vent, Ctrl+Shift+T, "Save only the selected 8 items" → reusable kitchen-rough-in template. 14.C's feature is now actually what its name implied.
- Mass delete in one keystroke. Draw 20 experimental pipes, decide "that's wrong," Ctrl+A → Delete → clean canvas. Previously: 20 click-delete cycles.
- Every pre-14.I consumer is untouched. Inspector, param window, rotation gizmo, Escape chain, template apply, BOM flows — all still work exactly as they did, because the layer activates only when the multi-select set is non-empty.
- Visual language is consistent: yellow emissive on pipes, yellow pulsing halo on fixtures, whether one or many.
- 18 unit tests pin the store: add/remove idempotency, toggle flips, bulk replace/merge, count/isEmpty, pipe↔fixture independence (shared id doesn't cross-select).

**Accepted costs:**
- No group rotation yet. The 14.F gizmo stays a single-select tool; multi-selected fixtures highlight but don't rotate as a group via bracket keys. Group rotate around centroid is a natural v2 (the gizmo math module already has the centroid logic — just needs a different anchor).
- No group translate (move). Same reason — v2 with a group gizmo.
- No lasso/box-select yet. Shift+click is the only way to build up a selection. Lasso would need a 2D-overlay pointer-down→drag→pointer-up handler on the canvas root, which is a meatier UX feature. 18-test multi-select store is ready for it when we ship the lasso.
- Ctrl+A selects EVERY visible pipe+fixture regardless of layer / floor filter. Advanced filters ("select all waste pipes on floor 1") are nice-to-have; current UX is "crowd → Ctrl+A → subtract with Shift+click."
- Multi-delete doesn't create an undo-able batch. Each individual remove goes through its existing command; Ctrl+Z reverses one at a time. A true bulk-undo needs a command-group feature in pipeStore/fixtureStore — deferred.
- Templates-from-selection recenter to the selection's centroid (14.C behavior preserved), which means a partial selection from near the edge of a larger scene snaps to a different local origin than the full scene would. Correct, but occasionally surprising. The template's `extents` field in the preview makes this visible.

**Non-consequences:**
- No changes to BOM, pricing, proposal, compliance, revisions, PDF backdrops, or any export.
- No schema bump on `.elbow` bundles. Multi-select is session-level state, not persisted.
- No runtime deps added. Main bundle grows ~3 KB raw / ~1 KB gzip for the store + dispatcher.
- Rotation gizmo (14.F) is unchanged — it only mounts on the single-selected fixture. Multi-selected fixtures show their halo but not the gizmo.

## Alternatives considered

**Evolve the existing stores** (`pipeStore.selectedId` → `selectedIds[]`). Cleaner in isolation but requires updating every consumer — the inspector, gizmo, 14.C template save, 14.G revision compare, Escape chain, Delete handler. Each touch point is small; together they'd be a 20-file diff with risk spread across them. The layer approach is zero-regression by construction.

**Make multi-select a temporary overlay** that vanishes on any bare click. More Figma-like. Rejected because users dragging across many entities to build a selection benefit from persistence — they want to Shift+click six times without losing what they already picked. Bare-click clears, but Shift+click keeps.

**Render multi-select with a DIFFERENT color than single-select.** Some apps use blue-for-single, green-for-group. Rejected for MVP — yellow-for-selected is already a learned signal in this codebase. Distinguishing would add visual noise without obvious benefit. Future: the gizmo's presence already tells the user "this is the primary / single-selected one."

**Add a dedicated "select all pipes" or "select all fixtures" shortcut.** Ctrl+Shift+A for one, Ctrl+A for the other, etc. Rejected as premature partitioning. Ctrl+A = everything covers the common case; Shift+click to subtract is the standard filter pattern.

**Multi-select includes walls + measurements + backdrops too.** Rejected for MVP. Pipes and fixtures are the two high-value targets that every downstream feature (templates, delete, future group-rotate) cares about. Walls + measurements + backdrops have their own dedicated edit flows already. Expanding later is additive.

## Validation

- `Vitest`:
  - `src/store/__tests__/multiSelectStore.spec.ts` — **18 tests**: add/remove idempotency, toggle flips for both pipes + fixtures, clear/setSelection/addMany bulk ops, count/isEmpty queries, selectedPipeIds/selectedFixtureIds filtering, pipe↔fixture independence (shared id doesn't cross-contaminate, removing a pipe doesn't affect a fixture with the same id).
  - All prior test files continue to pass (BOM, pricing, proposal, revisions, templates, compliance planners, hangers, rotation gizmo, etc.).
- `tsc --noEmit` — clean.
- `vite build` — clean. No new deps.
- Manual plan:
  - Draw 5 pipes, drop 3 fixtures. Press Ctrl+A — all 8 render with yellow highlight.
  - Escape — selection clears.
  - Shift+click 2 pipes + 1 fixture — 3 items highlight. Press Delete — all 3 gone.
  - Click a single pipe → single-select halo + inspector appears (14.F gizmo on selected fixture too, as before).
  - Shift+click 4 more pipes → 5 highlighted; primary still has gizmo.
  - Ctrl+Shift+T → save template → tick "Save only the 5 multi-selected items" → commits with just those 5 in the template.
  - Click empty space → both clears.
  - Verify no regression in inspector (Ctrl+Shift+L), pricing (Ctrl+Shift+B), contractor (Ctrl+Shift+I), templates (Ctrl+Shift+T), revisions (Ctrl+Shift+V).
