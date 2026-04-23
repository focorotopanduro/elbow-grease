# ADR 034 — Assembly Templates (Phase 14.C)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.C
- **Depends on:** ADR 030 (BOM Accuracy), ADR 032 (Pricing Engine), ADR 033 (PDF Proposal).

## Context

Phases 13 + 14.A/B gave the app an accurate takeoff, a dollar bid, and a printable proposal. The remaining friction in a real bid day is *repetition*: the same contractor plumbs the same "standard 2-bath rough-in," the same "single kitchen + dishwasher + disposal," the same "laundry room + utility sink" on nearly every new construction job. Every redraw burns billable hours on keystrokes that produce nothing new.

An assembly-template library eliminates that cost: save a layout once, drop it into every future bid.

## Decision

Ship two pure modules + one store + one panel:

### 1. `assemblyTemplate.ts` — pure compose/instantiate

```ts
composeTemplate(input)      → AssemblyTemplate   // pipes+fixtures → normalized snapshot
instantiateTemplate(tpl, p) → InstantiateResult  // template + anchor → mintable payloads
```

Both functions are React-free, Zustand-free, Three-free. They take arrays in, return plain data out. **18 unit tests** pin the math with `toBeCloseTo(3)` precision.

### Normalization around the centroid

At `composeTemplate` time, every pipe point + fixture position is shifted by `-centroid` where centroid is the arithmetic mean of all such points (equally weighted). At `instantiateTemplate(tpl, anchorPos)` time, every position is shifted by `+anchorPos`.

Consequences of this symmetry:
- **Drop at origin** plants a template with its center-of-mass at (0,0,0).
- **Round-trip** `compose → instantiate(at original centroid)` returns the original coordinates exactly — verified by test.
- Template authors don't have to think about the source scene's origin. A template saved from a house-drawing at (100, 0, 50) lands indistinguishably from one saved at (0, 0, 0).

An alternative would be "save raw positions, let the user pick an anchor point at placement time." Rejected because (a) the user now has an extra decision to make on every drop, (b) the template's natural reference point *is* its centroid — that's what "where it is" means when you're not at its original origin.

### 2. `assemblyTemplateStore.ts` — library + scene integration

Zustand store holding:
- `templates: Record<string, AssemblyTemplate>`
- `order: string[]` (newest-first)

Actions:
- `saveCurrentSceneAsTemplate(name, description?)` — snapshots `usePipeStore` + `useFixtureStore`, composes, persists to localStorage.
- `applyTemplateToScene(id, anchorPos?)` — reads the template, instantiates at `anchorPos` (default origin), calls `pipeStore.addPipe` + `fixtureStore.addFixture` for each item.
- `deleteTemplate(id)` / `renameTemplate(id, name, description?)`.

Persistence schema is tagged with `version: 1`; a future breaking schema bump treats unknown versions as "empty library" rather than crashing.

### Apply path: call actions, don't emit events

`applyTemplateToScene` calls `addPipe` / `addFixture` **directly** rather than emitting `EV.PIPE_COMPLETE` / `EV.FIXTURE_PLACED`. Three reasons:

1. **Preserves saved diameters.** A template carries the diameters the user picked when they saved it. Emitting `PIPE_COMPLETE` would re-trigger the solver and potentially resize every dropped pipe. That's a useful v2 option ("paste and auto-size"), but the MVP default is "drop exactly what I saved."
2. **Zero risk of subscriber loops.** The hooks that translate `PIPE_COMPLETE` into `addPipe` are elsewhere in the tree; bypassing them keeps the causal chain local.
3. **Atomic visual effect.** Direct `addPipe` calls all complete synchronously; the renderer paints every dropped pipe on the same frame.

The trade-off is documented: if the dropped template doesn't match the receiving scene's fixture population (e.g. you drop a 2-bath template into a 3-bath job), the user should trigger the solver once they're done. We'll add a "Re-size dropped pipes" button in v2 if this becomes painful.

### 3. `AssemblyTemplatesPanel.tsx` — browser + save dialog

Ctrl+Shift+T toggles it open. Two modes inside the modal:

- **Browse**: list every saved template. Each row shows name, description, `N pipes + M fixtures`, bounding-box extents (`W′ × D′ × H′`), and the created-at date. Per-row actions: **Drop**, **Rename**, **Delete**. "Save current scene…" button at the bottom switches into save mode.
- **Save**: name + description fields. Shows a live count of what's about to be captured. Enter-to-save. Cancel (or Escape) returns to browse mode.

Focus-trapped via `useFocusTrap` (shared hook from Phase 10.C). Escape is handled in two steps: Escape in save mode returns to browse mode; Escape in browse mode closes the panel.

### Files

```
src/core/templates/assemblyTemplate.ts              Pure compose+instantiate (18 tests)
src/core/templates/__tests__/assemblyTemplate.spec.ts
src/store/assemblyTemplateStore.ts                  Library + apply-to-scene + localStorage
src/ui/templates/AssemblyTemplatesPanel.tsx         Ctrl+Shift+T modal
```

## Consequences

**Good:**
- Biggest productivity multiplier on repeat work. A contractor drawing their 20th 2-bath rough-in this year does it in ~3 seconds instead of ~3 minutes.
- Pure core means the data model is testable without the DOM or a worker thread. Any future template-aware feature (import/export to file, per-customer libraries, template marketplace) can reuse the core unchanged.
- Centroid-normalization means templates are genuinely position-independent; drop them anywhere and the math just works.
- Library is localStorage-backed so templates survive app restarts without requiring bundle-schema changes.
- Versioned persist shape allows future breaking changes without corruption.

**Accepted costs:**
- Drop-at-origin only in this MVP. No click-to-place-at-cursor UX. The user can manually move the dropped pipes/fixtures afterward if needed, or zoom to origin before dropping. Click-to-place is a natural v2 — add a "Place template…" mode that converts the next click into the anchor.
- No rotation on placement. If a contractor has a template laid out east-west and needs it north-south, they have to drop it and manually rotate. Rotation-on-place is a v2 enhancement (requires a rotation matrix pass in `instantiateTemplate`; trivial additively).
- Dropped pipes keep their saved `SystemType` in the template, but `pipeStore.addPipe` defaults all new pipes to `system: 'waste'` (the solver reassigns). This means a template capturing a vent riser drops as "waste" until the solver runs. Acceptable MVP cost; a future refactor can pass `system` through `PipeCompletePayload`.
- localStorage quota is finite. A large library of templates (each template with a 100-pipe scene) will eventually hit the ~5MB default quota. MVP silently drops the save on quota error rather than crashing; we'll add a "prune oldest" action if users report it.
- Saving captures the *whole* current scene — no selection-based save yet. In practice this is what users want (one template per "project type"), but contractors who want to save a sub-assembly from a larger scene need multi-select first. Multi-select is its own v2 phase.

**Non-consequences:**
- No changes to BOM, pricing engine, compliance, or any export. Templates are a pure scene-side feature.
- No schema bump on `.elbow` bundles. Templates are local to the installation, not tied to a project file.
- No bundle growth — zero new dependencies.

## Alternatives considered

**Selection-based save (save just what's selected).** Requires a multi-select store that doesn't exist yet — a meaningful scope expansion. Deferred to a "14.C-follow-up" phase. "Save current scene" covers the common case (contractor drew exactly the template they want) without blocking on the multi-select UI.

**Click-to-place at cursor position.** Nice UX but requires coordinating with the pointer/camera system for a new "placement mode" state. Pragmatic MVP is drop-at-origin with a visible extent so the user can orient themselves. v2 will add the placement mode.

**Include templates in `.elbow` bundles.** Would let templates travel with a project file. Rejected for MVP — templates are a *contractor-level* resource (their standard assemblies), not a *project-level* resource. A future bundle-schema bump can add an optional "embedded templates" field for the contract-lock use case.

**Store templates on a remote service.** Multi-device sync is clearly useful, but adds auth + backend + conflict resolution. Local-only for MVP; user can export via localStorage-dump if they want to move to another machine. v2 could add a sync adapter.

**Snapshot the solver results too** (so dropped pipes carry their friction/velocity/pressure-drop numbers). Rejected — solver outputs are derivations of the scene, not intrinsic to it. Re-running the solver on drop produces the correct numbers for the new context. Including stale solver data would be confusing.

## Validation

- `Vitest`:
  - `src/core/templates/__tests__/assemblyTemplate.spec.ts` — **18 tests** covering: centroid normalization (1D, 2D, 3D), data preservation (diameter/material/system/params, deep-cloning), extents computation, empty-input safety, instantiate at origin / at offset / round-trip, ID minting via injected minter, `computeCentroid` on empty arrays, `generateTemplateId` format + time-sortability.
  - All 39 prior test files + 649 tests continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean, no new bundle growth (no new deps).
- Manual test plan:
  - Press Ctrl+Shift+T — panel opens empty, shows "No templates saved yet."
  - Close, draw a few pipes + drop a couple of fixtures, reopen panel.
  - Click "Save current scene…", name it "Test rough-in", click Save.
  - Panel returns to browse mode; row shows name + counts + extents.
  - Click "Drop" — pipes + fixtures appear at origin in the scene.
  - Move camera, click Drop again — another copy appears at origin.
  - Click Rename — input becomes editable inline; press Enter to commit.
  - Click Delete — confirm dialog; template disappears from the list.
  - Close & reopen the app — templates persist via localStorage.
