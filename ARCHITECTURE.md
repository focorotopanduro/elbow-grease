# ELBOW GREASE — Architecture & Nomenclature Contract

> **Purpose.** Single source of truth for how plumbing and roofing coexist in
> this codebase. Read this before adding any store, event, command, or UI
> panel. If a change contradicts this file, update this file *first* — don't
> silently diverge.
>
> Companion to `REFERENCE.md` (the auto-generated file index). This file is
> hand-maintained and authoritative for architectural decisions.

---

## 1. The core decision: hybrid, not split

ELBOW GREASE supports two trades — **plumbing** (3D CAD, pipe routing,
hydraulic simulation) and **roofing** (2D-PDF-first takeoff, section polygon
drawing, FL wind-zone compliance). Real jobs often involve both.

**Rule: share the shell, split the domain.**

- **Shared shell** — one implementation of: `appModeStore`, `ModeTabs`,
  top bar, `StatusBar`, `HelpOverlay`, `ProjectPanel`, customer/pricing/
  contractor stack, floor + backdrop + measure, `PrintableProposal` /
  `PrintableBidPackage`, radial-menu framework, plus primitives
  (`ToolbarShell`, `InspectorFrame`, `PanelShell`, `LegendChip` /
  `LegendRow` / `LegendGroup`).
- **Split domain** — viewport interactions, inspectors, toolbar *contents*
  (not the shell), domain stores, engines, compliance, color palettes.

**Why not full merge.** Pipe routing is 3D-CAD-first; roof takeoff is
2D-PDF-first. A single polymorphic inspector/toolbar becomes a
switch-statement nightmare.

**Why not full split.** `customerStore`, `pricingStore`, `floorStore`,
`backdropStore`, `measureStore`, and the proposal/bid-package pipeline
legitimately apply to both trades. Duplicating them guarantees data drift
and doubles maintenance for a solo-built tool.

---

## 2. Nomenclature contract

### Prefix rules

- `plumbing*` / `roofing*` — **domain-scoped**. Reads/writes never cross
  domains.
- **Bare** (no prefix) — **shared across domains**: floors, walls,
  customers, pricing, backdrops, measurements, app mode, feature flags,
  onboarding, proposal revisions, radial menu.

### Store-suffix taxonomy

| Suffix | Meaning |
|---|---|
| `*DrawStore` | Transient input state for a drawing interaction in its domain. |
| `*EntityStore` | Committed, persisted domain entities (pipes, roof sections). |
| `*ProjectStore` | Per-project metadata and settings for the domain. |
| `*ComplianceStore` | Validation / violation traces for the domain. |
| `*InspectorStore` | Selection-driven inspector panel state. |
| `*LayerStore` | Visibility toggles for the domain's system/layer concept. |
| `*PhaseStore` | Construction-phase filter for the domain. |

### Event naming

- Domain events: `EV.{DOMAIN}_{NOUN}_{VERB}` — e.g.
  `EV.PLUMBING_PIPE_COMPLETE`, `EV.ROOFING_SECTION_COMPLETE`.
- Shared events: bare — e.g. `EV.MODE_CHANGED`, `EV.FILE_SAVED`,
  `EV.SELECTION_CHANGED`.
- Past tense for things that happened; imperative for commands.
- **Going forward, new events must follow this.** Existing `EV.PIPE_*`
  events are grandfathered — rename only when you're already editing
  that file.

### Command naming

Same pattern: `plumbing.pipe.add`, `roofing.section.add`. Commands that
already use unambiguous names (`pipe.add`) are fine — don't rewrite
working code for cosmetics.

### Selector naming

- Hook: `useXStore`
- Derived selector: `selectX` (e.g. `selectSectionsArray`,
  `selectTotalAreaNet` — pattern already used in `roofStore`).
- Back-port this to other stores opportunistically.

---

## 3. Store classification

*(Resolved through Phases 1, 6, and 7 of the hybrid-architecture
refactor. Phase 7 closed out the ❓ audit category; no open
candidates remain.)*

### 🔧 Plumbing-only (14)

`plumbingDrawStore`, `pipeStore`, `cappedEndpointStore`,
`pipeConnectivityStore`, `manifoldStore`, `plumbingComplianceStore`,
`fixtureStore`, `fixtureEditorStore`, `fixtureInspectorStore`,
`plumbingLayerStore`, `plumbingPhaseStore`,
`plumbingAssemblyTemplateStore`, `plumbingClipboardStore`,
`plumbingMultiSelectStore`.

### 🏠 Roofing-only (10)

`roofingDrawStore`, `roofStore`, `roofingProjectStore`,
`roofingCalibrationStore`, `roofingDragStore`, `roofingScopeStore`,
`roofingVertexDragStore`, `roofingRotationDragStore`,
`roofingAxisDragStore`.

The last three are transient interaction sub-stores — each holds
one drag session's anchors (vertex-edit, section-rotation,
axis-rotation respectively). They mirror `roofingDragStore`'s idle/
active lifecycle but are dedicated to their specific interaction
surfaces.

### 🤝 Shared (14)

`appModeStore`, `customerStore`, `pricingStore`,
`contractorProfileStore`, `backdropStore`, `measureStore`,
`featureFlagStore`, `onboardingStore`, `proposalRevisionStore`,
`radialMenuStore`, `wallStore`, `floorStore`, `drawFeedbackStore`,
`renderModeStore`.

- `floorStore` is shared infrastructure — primarily written by
  plumbing workflows, read by `backdropStore` which is itself
  shared; roofing bypasses floor assignment for its geometry —
  see §4.6.
- `drawFeedbackStore` stays shared by design. Its `SnapKind`
  (`'grid' | 'endpoint' | 'body' | 'fixture' | 'manifold-port'`)
  and `NextAction` unions are plumbing-biased today and should be
  widened (not split) when roofing cursor-feedback integration
  lands.
- `renderModeStore` is shared: the Sims-style walls-up /
  walls-down / cutaway cycle applies in every workspace, since
  walls themselves are shared infrastructure (see `wallStore`
  + §4.6).

Leaves **no ❓ category** — Phase 7 resolved all five audit
candidates. `pipeStore` and `roofStore` stay unchanged by design
— the domain is already in the name (§7 explicitly excludes them).

---

## 4. Logic constraints the refactor must preserve

These are the correctness rules. Violating any of them means bugs or data
loss.

### 4.1 Mode-scoped keyboard shortcuts

**Problem.** `N` / `D` / `S` / `Q` / `H` / `V` / `1`–`6` are defined for
plumbing. Once roofing adds its own draw mode, `D` would fire into both
`plumbingDrawStore` and `roofingDrawStore`.

**Rule.** `ShortcutRegistry` entries gain a `mode: AppMode | 'global'`
field. The dispatcher filters by `useAppModeStore.getState().mode`
before dispatching. Do this *before* adding any new roofing shortcut.

### 4.2 One "is drawing?" selector

**Problem.** `plumbingDrawStore.mode === 'draw'` and
`roofingDrawStore.mode !== 'idle'` are two sources of truth for the same
user-visible state. Escape-key handling, autosave `isDirty`, onboarding
advancement, and radial-menu open/close will all need to ask "is the user
mid-draw?".

**Rule.** Provide one cross-store selector `isAnyDrawActive()` that reads
both. All new code routes through it. Existing callers migrate
opportunistically.

### 4.3 CommandBus mode gating & undo semantics

**Problem.** `pipeHandlers`, `fixtureHandlers`, `manifoldHandlers` run
regardless of mode. `UndoManager` walks the command log — if a user draws
pipes, switches to roofing, then Ctrl+Z's, behavior is undefined.

**Rule.** Decide explicitly and document here:
- **Option A** — undo is global and crosses modes (user sees plumbing
  entities change while in roofing mode; surprising).
- **Option B** — undo stacks are per-mode (Ctrl+Z only undoes actions
  from the current mode; predictable).

**Decision: Option B — per-mode undo stacks.** `Ctrl+Z` only undoes
actions taken in the currently active mode. Switching modes does not
clear either stack. Rationale: predictability for the user, and prevents
"surprise" mutations to invisible entities.

**Implementation notes.**
- `UndoManager` partitions the command log by the `appMode` value at the
  time each command was dispatched. Each command entry must carry a
  `mode: AppMode` field (stamp at dispatch, not at undo time).
- `canUndo()` / `canRedo()` read `appModeStore` and check only the
  current mode's segment.
- Shared-domain commands (file save, customer edit, pricing edit) are
  tagged `mode: 'shared'` and participate in **both** stacks — undoing
  a pricing change from either mode works.
- `UndoManager.spec.ts` must cover: (a) draw pipe → switch to roofing →
  Ctrl+Z does nothing, (b) draw pipe → switch to roofing → draw section
  → Ctrl+Z removes the section → Ctrl+Z does nothing → switch to
  plumbing → Ctrl+Z removes the pipe, (c) edit pricing in plumbing →
  switch to roofing → Ctrl+Z reverts the pricing edit.

### 4.4 Bundle format must round-trip both domains

**Problem.** `.elbow` / `Bundle.ts` was built around plumbing. If
roofing state (roofStore, roofingProjectStore, PDF calibration, section
drags) isn't serialized, roofing-only projects silently lose data on
reopen.

**Rule.** Integration test: draw a roof, save, quit, reopen, diff the
stores. Must be green before shipping roofing to users.

### 4.5 SimulationBridge is plumbing-only

**Problem.** The bridge intercepts `PIPE_COMPLETE` and wakes the worker.
In roofing mode this should never fire.

**Rule.** One-line guard in `SimulationBridge` that early-returns when
`appMode !== 'plumbing'`. Cheap insurance against future event leakage.

### 4.6 Floor and backdrop semantics

**Problem.** A plumbing backdrop is a traced blueprint at floor level.
A roofing backdrop is a site plan or elevation. `FloorResolver` assumes
plumbing geometry.

**Decisions.**

- **`floorStore` stays shared.** It is shared infrastructure — mostly
  written by plumbing workflows but read by `backdropStore` (which is
  itself shared: roofing users legitimately upload PDF site plans as
  backdrops). Splitting it would force `backdropStore` to fork or
  duplicate floor tracking, and the write surface is small enough that
  shared ownership is fine.
- **`FloorResolver` is plumbing-only.** It is pure plumbing domain logic
  (mapping pipe geometry onto floor slabs for phase classification and
  rendering). Scope it explicitly: live it in `src/core/floor/` for now
  but rename to `plumbingFloorResolver` or move to `src/engine/plumbing/`
  when convenient. Roofing code must not import it.
- **Roof sections bypass the floor system.** Roof section geometry lives
  in world space without floor assignment. If a roofing feature ever
  needs an "associated floor" for display purposes (e.g. "roof above
  floor 2"), it reads `floorStore` directly — it does not go through
  `FloorResolver`.
- **Backdrops remain floor-associated for both domains.** A roofing
  backdrop still pins to a floor level (usually floor 1 / ground) via
  the existing `rotateActiveFloorBackdropsToLevel` mechanism. No new
  "roofing backdrop" concept is needed.

### 4.7 Phase filter must not cross domains

**Problem.** `PhaseClassifier` and the current `phaseStore` are plumbing
concepts (rough-in, top-out, trim-out). Roofing phases are different
(tear-off, dry-in, shingle, finish).

**Rule.** After renaming to `plumbingPhaseStore`, the selector no-ops
when `appMode === 'roofing'`. A future `roofingPhaseStore` handles the
roofing side.

### 4.8 Pricing + proposal are the merge point

**Problem.** This is the one place where both domains legitimately need
to combine — a single proposal covering re-pipe + re-roof.

**Rule.** `PrintableProposal` and `PrintableBidPackage` must accept line
items from both engines (`engine/`'s pass-5 BOM aggregator for plumbing,
`engine/roofing/calcEngine` for roofing). Dedicated integration test for
combined proposals. This is the feature that justifies the hybrid
approach — treat it as a first-class requirement, not an afterthought.

**Domain-presence rule.** The rendered proposal shows *only* domains
that have content. Pure-plumbing jobs have no roofing section (no
header, no empty table, no "N/A"). Pure-roofing jobs have no plumbing
section. Mixed jobs show both.

**Implementation.**

```ts
// src/core/proposal/domainPresence.ts
export type DomainPresence = {
  plumbing: boolean;
  roofing: boolean;
};

export function getDomainPresence(): DomainPresence {
  return {
    plumbing:
      pipeStore.getState().pipes.length > 0 ||
      fixtureStore.getState().fixtures.length > 0 ||
      manifoldStore.getState().manifolds.length > 0,
    roofing:
      roofStore.getState().sections.length > 0,
  };
}
```

Every print component (`PrintableProposal`, `PrintableBidPackage`,
`PrintableChangeOrder`) calls this once at the top and conditionally
renders domain sections.

**Presence semantics.**
- Presence = *entity existence*, not pricing > $0. Users who draw items
  before pricing them still see the section.
- Both-empty case: renders header + customer + terms block, does not
  crash. (Unusual in practice but must be safe.)
- `roofingEstimateScopeStore` affects *pricing inclusion*, not
  presence. A scoped-out section still counts as "roofing is present."
- `CombinedTotals` receives the `DomainPresence` object and sums only
  present domains — no `$0.00` filler rows for absent domains.
- Change orders follow the same rule — a CO touching only plumbing
  contains no roofing section.

### 4.9 Feature flags scoped by mode

**Rule.** Flag keys adopt `plumbing.*` / `roofing.*` prefix convention
inside the flat `featureFlagStore`. Enables shipping half-built features
on one side without exposing them on the other.

### 4.10 Color palettes stay domain-specific; rendering is shared

**Problem.** `DIAMETER_COLORS`, `SYSTEM_COLORS`, `PHASE_COLORS`,
`SECTION_PALETTE`, `EDGE_COLORS` each mean different things. Merging
them would be wrong.

**Rule.** Each palette stays in its domain store. A shared `Palette<K>`
adapter + `LegendChip` / `LegendRow` / `LegendGroup` primitive renders
them uniformly. Adding a new chip state (e.g. `'violation'`) in the
primitive applies to both domains for free.

---

## 5. Engine and UI folder structure

### Engine

Current: `src/engine/` (implicit plumbing) + `src/engine/roofing/`.
**Asymmetric but tolerable.** Document in glossary that bare `engine/`
means plumbing. Consider moving plumbing solver into
`src/engine/plumbing/` for symmetry if touching the engine anyway.

### UI

Current: `src/ui/pipe/` + `src/ui/fixtures/` + `src/ui/manifold/` +
`src/ui/walls/` are plumbing-flavored but scattered. `src/ui/roofing/`
is one folder.

**Target.** `src/ui/plumbing/{pipe,fixtures,manifold}/` +
`src/ui/roofing/` + `src/ui/shared/` (shell primitives, LegendChip,
etc.) + `src/ui/walls/` stays shared.

**Migration.** Not urgent. Do it the next time you touch multiple
plumbing UI folders in one PR.

---

## 6. Root-level UI that silently assumes plumbing

These `src/ui/` components pre-date the mode split and need auditing:
`Toolbar`, `ExportPanel`, `LayerPanel`, `StatusBar`, `HelpOverlay`.

**Options per component:**
1. Make mode-branching explicit via `useAppModeStore()`.
2. Split into `Plumbing*` / `Roofing*` variants sharing a shell.

**Rule.** Do not add new roofing features that patch these components
ad-hoc. Audit first, decide split-or-branch, then extend.

---

## 7. Migration order (lowest risk first)

Do these in order. Don't skip ahead.

1. **Commit this file** to the repo as `ARCHITECTURE.md` next to
   `REFERENCE.md`.
2. **Rename `interactionStore` → `plumbingDrawStore`.** Biggest clarity
   win, isolated blast radius. All callers update in one PR.
3. **Add `ShortcutRegistry.mode` field** + dispatcher filter (§4.1).
4. **Add `isAnyDrawActive()` selector** (§4.2).
5. **Decide undo semantics** (§4.3), document choice in this file.
6. **Bundle round-trip test for roofing** (§4.4).
7. **Rename the three awkward roofing stores** (`roofingPdfCalibStore`,
   `roofingSectionDragStore`, `roofingEstimateScopeStore`) — newer code,
   fewer callers.
8. **Rename `complianceTraceStore` → `plumbingComplianceStore`**,
   `layerStore` → `plumbingLayerStore`, `phaseStore` →
   `plumbingPhaseStore`.
9. **Resolve the six ❓ ambiguous stores** — grep imports, decide, rename
   or keep.
10. **Adopt event-naming convention for new events.** Don't rename
    existing ones unless already editing.
11. **Extract shared `LegendChip` / `LegendRow` / `LegendGroup`** when
    next touching `LayerPanel` or `SectionsPanel`.
12. **Root-level UI audit** (§6) — opportunistic.

Leave `pipeStore` and `roofStore` alone. They already carry their domain
in the name.

---

## 8. Open decisions (to be filled in)

- [x] Undo semantics: global vs per-mode? **Per-mode** (see §4.3).
- [x] Does `floorStore` stay shared or become `plumbingFloorStore`?
  **Shared** (see §3, §4.6).
- [x] `FloorResolver` scope — plumbing-only, or defined for roofing?
  **Plumbing-only** (see §4.6).
- [x] Resolution for each of the five ❓ ambiguous stores (§3) —
  **Phase 7 (2026-04-23)**. Three renamed to plumbing-prefixed
  (`assemblyTemplateStore` → `plumbingAssemblyTemplateStore`,
  `clipboardStore` → `plumbingClipboardStore`,
  `multiSelectStore` → `plumbingMultiSelectStore`). Two kept
  shared (`drawFeedbackStore`, `renderModeStore`).
- [ ] Move `engine/` plumbing solver into `engine/plumbing/`? (§5)
- [ ] Regroup `src/ui/` plumbing folders under `src/ui/plumbing/`? (§5)
- [ ] Root-level UI components: branch-by-mode or split? (§6)

---

## 9. Rules for Claude Code when editing this codebase

*(These are meta-rules for any AI coding agent working in this repo.)*

1. **Before creating a new store, event, or command**, check §2
   nomenclature. If the name would be ambiguous (no domain prefix but
   domain-specific content), use the prefix.
2. **Before renaming an existing store**, check §7 migration order. Don't
   do step 8 before step 2.
3. **Before adding a keyboard shortcut**, check §4.1. New shortcuts must
   declare `mode`.
4. **Before modifying `Bundle.ts`**, check §4.4. Changes must preserve
   round-trip for both domains.
5. **Before touching `SimulationBridge`**, check §4.5.
6. **Before adding cross-domain behavior** (any code that reads both
   plumbing and roofing stores), stop and ask the user. Cross-domain is
   reserved for §4.8 (pricing/proposal) and the shared shell. Anywhere
   else is probably a design mistake.
7. **Before touching any `Printable*` component**, check §4.8. Every
   domain section must be gated on `getDomainPresence()`. Never
   hard-render an empty section with placeholder text.
8. **When classifying an ambiguous store**, don't guess — grep imports
   and report findings to the user before renaming.
9. **Never silently update this file.** Propose the change, get
   agreement, then update.

---

_Maintained by hand. Last reviewed: 2026-04-22._
