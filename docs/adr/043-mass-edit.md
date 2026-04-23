# ADR 043 — Mass-Edit on Multi-Select (Phase 14.N)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.N
- **Depends on:** Phase 14.I (Multi-Select Foundation), Phase 14.M (Lasso + Group Rotate).

## Context

Phase 14.I/M let the user build up a multi-select (Shift+click, lasso, Ctrl+A, select-similar) and group-rotate / group-delete / save-selection-as-template. But one natural operation was missing:

**"I want to change a property on every selected pipe at once."**

Real workflows:
- Ctrl+Shift+click a copper pipe → Select all copper → decide "we're switching to PEX." Today: change each pipe one at a time via the (nonexistent) per-pipe editor, or re-export the scene and edit the `.elbow` JSON.
- Lasso a branch of "2"" drains → decide they should all be 3" for capacity → today: no tool for this.
- Mass-toggle visibility on a group of pipes you want to hide while working on something else.

Phase 14.N ships this with the same fractal depth treatment as 14.M: sparse change-sets, minimal setState churn, live "currently in selection" histograms, affected-count readout, set-if-changed semantics.

## Decision

### 1. `massEdit.ts` — pure change-set logic (24 tests)

```ts
applyPipeEdit(pipe, PipeChangeSet) → { id, changed, material?, diameter?, system?, visible? }
summarizeSelection(pipes, fixtureCount) → { pipeCount, fixtureCount, pipes: { materials, diameters, systems, visibleCount, hiddenCount } }
isEmptyChangeSet(set) → boolean
changeSetAffectsAny(pipes, set) → boolean
humanMaterial / humanSystem / humanDiameter → display strings
```

**The sparse change-set model:** Every field in `PipeChangeSet` is optional. An undefined field means "leave this property alone." A set field means "override to this value on every selected pipe, UNLESS the pipe already has this value (skip setState in that case)."

This gives the user a compositional tool: change only material, or only diameter + system, or everything at once. And it minimizes re-render cost — if 18 of 20 selected pipes already match the target diameter, only 2 get setState.

### 2. pipeStore additions

Two new thin actions mirror the existing `updateDiameter`:

```ts
setMaterial(id, material): void  // no-op if already that material
setSystem(id, system): void       // no-op if already that system
```

`setVisibility` + `updateDiameter` already existed. The mass-edit panel orchestrates all four as needed.

### 3. `MassEditPanel` — Ctrl+Shift+M modal

Structure:

```
┌─────────────────────────────────────────────┐
│ Mass Edit        [6 pipes · 2 fixtures] [×] │
├─────────────────────────────────────────────┤
│ Blank fields leave the property untouched…  │
│                                              │
│ ┌─ Currently in selection ───────────────┐ │
│ │ Material  3× PVC Sch 40, 3× Copper L   │ │
│ │ Diameter  4× 2″, 2× 3″                 │ │
│ │ System    4× Waste, 2× Vent            │ │
│ └────────────────────────────────────────┘ │
│                                              │
│ ┌─ Apply to all selected pipes ──────────┐ │
│ │ Material   [— leave unchanged —    ▾] │ │
│ │ Diameter   [— leave unchanged —    ▾] │ │
│ │ System     [— leave unchanged —    ▾] │ │
│ │ Visibility [Leave] [Show all] [Hide all]│ │
│ └────────────────────────────────────────┘ │
├─────────────────────────────────────────────┤
│ Will change 3 pipes · 3 already match │ Cancel │ Apply → │
└─────────────────────────────────────────────┘
```

**Fractal depth baked in:**
- **Live histograms** — as the selection changes (user Shift+clicks more items while the panel is open), the "currently in selection" box updates. Sorted: materials by count desc, diameters by value asc, systems by count desc.
- **Affected-count footer** — recomputes on every field change. Reads "Will change 3 pipes · 3 already match" so the user knows exactly what commit will do.
- **Set-if-changed** — pipes already matching the target are silently skipped.
- **No-op detection** — if the change-set is empty OR matches every pipe, the Apply button disables.
- **Visibility as a radio row** — three buttons (Leave / Show all / Hide all) are self-documenting vs a dropdown with the same options.
- **Empty-selection empty-state** — opening the panel with nothing selected shows a helpful "Shift+click pipes or press S for lasso mode" message instead of an empty form.
- **Fixtures-only empty-state** — if the selection has fixtures but no pipes, a message explains mass edit covers pipe properties (fixture bulk edit is a v2 scope).

### Files

```
src/core/selection/massEdit.ts                              Pure change-set + summarize (24 tests)
src/core/selection/__tests__/massEdit.spec.ts
src/ui/selection/MassEditPanel.tsx                          Ctrl+Shift+M modal
docs/adr/043-mass-edit.md

src/store/pipeStore.ts                (mod) +setMaterial + setSystem actions
src/App.tsx                           (mod) mounts MassEditPanel
src/core/input/ShortcutRegistry.ts    (mod) +Ctrl+Shift+M registered
```

## Consequences

**Good:**
- Closes the natural gap in the selection workflow. Select → Rotate (14.M) → Edit properties (14.N) → Delete / Save / Export are all one-step operations.
- Pure change-set logic is 24-test-locked. Set-if-changed, histograms, no-op detection all covered.
- Live "currently in selection" readout means the user doesn't have to scroll through the selection mentally before committing. Mixed-value warnings emerge naturally from the histogram (if you see "3× PVC, 3× Copper" you know your change will overwrite BOTH).
- Affected-count footer gives concrete feedback pre-commit — no surprises.
- Sparse change-set = user can batch a complex edit (all selected become 2″ copper supply in one go) or a simple one (just change material).
- Zero impact on existing single-pipe editors or any downstream consumer. BOM auto-recomputes from new pipe properties.

**Accepted costs:**
- **Fixtures have nothing to mass-edit yet.** `FixtureInstance` doesn't have a visibility field, and changing `subtype` is destructive (resets params). The panel honestly says so when the selection is fixture-only. Future fixture-level mass edits (rotate-to-cardinal, bulk tag, set param) can plug into this panel's shell — the HistogramRow component + footer hint are already reusable.
- **No undo grouping yet.** Each setState for each pipe is an independent command. Ctrl+Z reverses one pipe at a time, not the whole mass edit. A future "group-undo" feature (command batch in pipeStore) would cover this. Phase 14.I has the same limitation for mass-delete.
- **Diameter options are a fixed list** (½" through 6"). Custom diameters (e.g., 2.5" in a legacy system) aren't selectable from the dropdown. Mitigation: use the per-pipe param window for odd sizes, or add a "custom…" option in the dropdown later.
- **Material change doesn't re-validate bend radius.** A user could mass-change PVC (rigid) to PEX (flexible), and the existing point layout may violate PEX bend-radius minimums. The solver catches it on next run; no prevention at commit time. Acceptable — the user explicitly asked for the change.
- **System change doesn't re-run the solver.** If a pipe's system changes from waste to vent, pipe sizing assumptions change too. Accepted cost — solver runs are explicitly triggered elsewhere. The mass-edit panel just changes the raw property.

**Non-consequences:**
- No changes to BOM, pricing, proposal, compliance, revisions, templates, library-sync, or any export. BOM picks up new values automatically.
- No schema bump. Existing `.elbow` bundles keep working.
- No new dependencies; main bundle grows a few KB for the panel + store actions.
- Lasso + group-rotate (14.M) work unchanged — mass-edit is orthogonal.

## Alternatives considered

**Inline mass-edit on the `SelectionCountBadge`.** Considered — would be faster to trigger (expand a tray on the badge). Rejected because the field list is non-trivial (histograms + 4 fields + footer) and would blow the badge's tight footprint. A dedicated modal is the right size for this amount of info.

**"Apply" per-field instead of one big Apply.** One button per field (Apply material, Apply diameter, etc.). More explicit but requires 4x clicks for a common "change everything at once" edit. Single Apply + sparse change-set covers both cases with less clicking.

**Allow arbitrary diameter input.** A free-text number field instead of a fixed dropdown. Rejected because (a) the dropdown matches existing per-pipe UX, (b) the existing diameter dropdown already covers every manufacturer-standard size, (c) a typo of "24" instead of "2.4" would mass-change every pipe to 24″ — expensive to unwind. Safer to enumerate.

**Auto-trigger mass-edit panel when Ctrl+Shift+click select-similar produces ≥ N items.** Removes a click. Rejected because "I want to examine the selection" is a valid intermediate state — forcing the panel on select-similar would be annoying in the cases where the user just wants to see the group first, maybe subtract a couple with Alt+click, then edit.

**Extend for fixture subtype change.** E.g., "change all selected toilets to elongated-bowl." Rejected because changing subtype means resetting params (different fields, different defaults). A subtype change belongs in the per-fixture editor where the user can review the new param defaults.

**Show a second "Affected Pipes" preview list** in the modal (small list of pipe IDs about to change). Useful but bulky. Deferred — the affected-count footer plus the histogram currently gives enough confidence for commit.

**Use the 14.G revision store to snapshot before mass edit.** Interesting — a mass edit is exactly the sort of thing a user might want to roll back with a "revert R2." But that couples the two features in a way that might bloat bundle snapshots. Deferred; current revision history captures whole-proposal states at print time, not intermediate edits.

## Validation

- `Vitest`:
  - `src/core/selection/__tests__/massEdit.spec.ts` — **24 tests**: `applyPipeEdit` empty-set / same-value / different-values / multi-field, visibility show/hide/unchanged / no-diff-when-already-matching, `summarizeSelection` empty / material histogram sorted by count / diameter histogram sorted ascending / visibility counts / fixture count pass-through, `isEmptyChangeSet` literal empty / all-undefined / set / fixture-visibility, `changeSetAffectsAny` empty-set / all-match / some-match, `humanMaterial` / `humanSystem` / `humanDiameter` mapping each case + fallback.
  - All prior tests continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. No runtime deps.
- Manual plan:
  - Draw 4 PVC pipes + 2 copper pipes, various diameters. Press S → lasso them all.
  - Ctrl+Shift+M opens panel. "Currently in selection" shows 4× PVC, 2× Copper + diameter breakdown.
  - Set Material = PEX. Footer: "Will change 6 pipes." Apply → all 6 turn PEX; panel closes.
  - Reopen panel. Histogram now shows 6× PEX. Footer reads "Every selected pipe already matches — no changes would apply" until another field is set.
  - Set Visibility = Hide. Apply → all 6 hide.
  - Press Escape, Ctrl+A, Ctrl+Shift+M. Set Visibility = Show → every pipe + fixture stays selected, all pipes re-render visible.
  - Verify BOM recomputes on next export (new pipe material + diameter reflected).
