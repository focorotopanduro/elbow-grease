# Hybrid-Architecture Refactor — Migration Report

> Single-document summary of the 8-phase refactor that moved the
> codebase from "plumbing with a roofing sidecar" to the hybrid
> architecture defined in [`ARCHITECTURE.md`](./ARCHITECTURE.md):
> one shared shell, domain-scoped internals for plumbing and roofing.
>
> Branch: `refactor/hybrid-architecture` (19 commits on top of
> `main`'s WIP baseline).
>
> Audience: the reviewer merging this branch. Also a breadcrumb for
> the next contributor trying to understand why half the stores
> got renamed.

---

## TL;DR

- **8 phases, 19 commits, zero test regressions.**
- **13 stores renamed**, 0 behaviour changes. All renames carry
  historical notes in their own docstrings.
- **3 shared-shell additions**: `isAnyDrawActive()` selector,
  `domainPresence` module, extracted `KeyboardHandler`.
- **3 correctness fixes**: mode-guarded plumbing shortcuts, mode-
  stamped commands with per-mode undo partitioning, plumbing-only
  guard at the top of `SimulationBridge.PIPE_COMPLETE`.
- **Test count: 2946 → 3011** (+65 net). No previously-passing test
  was modified to accommodate a rename.
- **ARCHITECTURE.md**: §3 store classification rewritten to reflect
  post-rename state; §8 open-decisions log updated; §2 gained a
  CONTRIBUTING-style checklist for new events.
- **One known flake** (unrelated to this refactor): the CommandBus
  p95-latency perf test occasionally fails on first run and passes
  on rerun. Tracked as noise.

---

## Per-phase summary

Each row: commit hash · files touched · lines added/removed · one-
sentence purpose. `vitest run` was green at every row.

| Phase | Commit | Files | Diff | Purpose |
|---|---|---:|---|---|
| Pre-baseline | `e2aa6a9` | 488 | +big | Commit the uncommitted R.4–R.27 work + ARCHITECTURE.md on `main` so refactor commits diff against something stable. |
| 1 | `fee7139` | 32 | +466 / −460 | Rename `interactionStore` → `plumbingDrawStore`. |
| 2a | `c0c3b42` | 6 | +661 / −257 | `ShortcutRegistry.mode` field + extract `KeyboardHandler` with plumbing-mode guard (§4.1). |
| 2b | `279274f` | 3 | +122 / −3 | `isAnyDrawActive()` cross-store selector (§4.2). |
| 2c | `d44fc44` | 3 | +99 / −2 | `SimulationBridge.PIPE_COMPLETE` plumbing-only guard (§4.5). |
| 3 | `dbabc42` | 10 | +450 / −94 | Per-mode undo semantics — `mode` field on Command, handler classification, UndoManager partitioning + §4.3 scenario tests. |
| 4 | `92e1317` | 2 | +426 / −3 | Roofing bundle round-trip insurance tests (§4.4). Bundle.ts needed no changes — infrastructure was already correct. |
| 5 | `6efa7e3` | 7 | +690 / −24 | `domainPresence` module + gating for `PrintableProposal` / `PrintableBidPackage` / `PrintableChangeOrder` (§4.8). |
| 6a.1 | `aa0d73a` | 14 | +198 / −193 | `roofingPdfCalibStore` → `roofingCalibrationStore`. |
| 6a.2 | `38e1488` | 12 | +257 / −250 | `roofingSectionDragStore` → `roofingDragStore`. |
| 6a.3 | `afbda86` | 9 | +147 / −142 | `roofingEstimateScopeStore` → `roofingScopeStore`. |
| 6b.1 | `98ae351` | 6 | +183 / −175 | `complianceTraceStore` → `plumbingComplianceStore`. |
| 6b.2 | `112f2a5` | 16 | +168 / −158 | `layerStore` → `plumbingLayerStore`. |
| 6b.3 | `97743d6` | 11 | +169 / −160 | `phaseStore` → `plumbingPhaseStore`. |
| 7.a | `85c4d1b` | 6 | +267 / −259 | `assemblyTemplateStore` → `plumbingAssemblyTemplateStore`. |
| 7.b | `6b462bb` | 4 | +72 / −62 | `clipboardStore` → `plumbingClipboardStore`. |
| 7.c | `39ae76e` | 17 | +375 / −365 | `multiSelectStore` → `plumbingMultiSelectStore`. |
| 7 wrap | `678e2b3` | 1 | +53 / −41 | `ARCHITECTURE.md` §3 classification + §8 decision log. |
| 8 | `3ea3d0d` | 2 | +49 / −2 | Event-naming convention documented in `events.ts` docstring. |
| 8 wrap | `0c78f7d` | 1 | +25 / −0 | `ARCHITECTURE.md` §2 CONTRIBUTING checklist for new events. |

---

## Stores renamed (13 total)

All renames preserve behaviour. The state shape, actions, and
subscribers behave identically — only the import path, hook name,
and boot-function name (where applicable) changed.

### Domain prefix added (7)

- `interactionStore` → `plumbingDrawStore` (Phase 1, §7.2)
- `complianceTraceStore` → `plumbingComplianceStore` (Phase 6b.1, §7.8)
- `layerStore` → `plumbingLayerStore` (Phase 6b.2, §7.8)
- `phaseStore` → `plumbingPhaseStore` (Phase 6b.3, §7.8)
- `assemblyTemplateStore` → `plumbingAssemblyTemplateStore` (Phase 7.a, §3)
- `clipboardStore` → `plumbingClipboardStore` (Phase 7.b, §3)
- `multiSelectStore` → `plumbingMultiSelectStore` (Phase 7.c, §3)

### Roofing qualifier collapsed (3)

- `roofingPdfCalibStore` → `roofingCalibrationStore` (Phase 6a.1,
  §7.7) — "PDF" is an impl detail; DXF underlays calibrate through
  the same sequence.
- `roofingSectionDragStore` → `roofingDragStore` (Phase 6a.2,
  §7.7) — "Section" was redundant under the already-present
  `roofing` prefix.
- `roofingEstimateScopeStore` → `roofingScopeStore` (Phase 6a.3,
  §7.7) — "Estimate" was redundant; the store's only job IS
  estimator scope selection.

### Deliberately NOT renamed

- `pipeStore`, `roofStore` — already carry their domain; §7 leaves
  them alone.
- `src/core/commands/handlers/interactionHandlers.ts` — Phase 1
  renamed only the store, keeping the command-family file name.
  The "interaction" commands (mode change, draw-point accumulation)
  stayed identified that way because the family is broader than the
  underlying store.
- Type names: `InteractionMode`, `LayerState`, `SYSTEM_COLORS`,
  `ConstructionPhase`, `PhaseVisibilityMode`, `MultiSelectState`,
  `ClipboardPayload`/`ClipboardPipe`/`ClipboardFixture`,
  `AssemblyTemplate`, `TracedViolation`, `ComplianceTraceState`,
  `EstimateScope`, `SnapKind`, `NextAction`, `RenderMode`. All
  describe **shape or role**, not store identity — §7 explicitly
  advises against type-level churn on rename PRs.
- `drawFeedbackStore`, `renderModeStore` — Phase 7 audit classified
  both as shared. See §3.

---

## Correctness / safety fixes shipped

1. **Phase 2a — `ShortcutRegistry.mode` + plumbing-key guard.**
   `ShortcutRegistry` entries now carry a `ShortcutMode =
   AppMode | 'global'` field. Every registry entry tagged. The
   window-level keydown dispatcher (extracted from `App.tsx` into
   `src/ui/KeyboardHandler.tsx`) short-circuits plumbing-scoped
   keys when `useAppModeStore.getState().mode !== 'plumbing'`. D,
   N, S, Q, H, V, 1–6, Enter, Escape, Delete/Backspace, M — all
   no-op in roofing mode instead of silently mutating plumbing
   stores.

2. **Phase 2c — `SimulationBridge.PIPE_COMPLETE` plumbing-only
   guard.** One-line early-return at the top of the handler
   prevents the plumbing worker from waking on a hypothetical
   roofing-side emit of the same event name.

3. **Phase 3 — per-mode undo stacks.** `Command` gains a
   `mode: AppMode | 'shared'` stamp at dispatch time. `UndoManager`
   partitions by current workspace: Ctrl+Z walks only commands
   from the active mode, plus any `shared` commands
   (file save, customer edit, pricing edit — when those eventually
   move onto the CommandBus). Shared commands undone from either
   side are undone for both. All three §4.3 mandated scenarios
   pass.

4. **Phase 4 — roofing bundle round-trip insurance.** 8 integration
   tests verify persistent roofing state (`roofStore` +
   `roofingProjectStore`) round-trips bit-equal; transient stores
   (`roofingCalibrationStore`, `roofingDragStore`) are correctly
   excluded from the bundle; per-machine preferences
   (`roofingScopeStore`) stay local. Bundle.ts needed zero changes
   — the R.26/R.27 infrastructure was already correct.

5. **Phase 5 — domain-presence gating.** `getDomainPresence()`
   reads the four domain stores and returns `{ plumbing, roofing }`.
   `PrintableProposal`, `PrintableBidPackage`, and
   `PrintableChangeOrder` gate their plumbing-scoped sections on
   `presence.plumbing`. Roofing-only jobs print with header +
   customer + signatures + terms, NO empty "Materials & Labor"
   table. 10 integration tests lock this in. Roofing-side line-item
   rendering is feature work, not part of this refactor.

---

## Test count delta

| Phase | Cumulative tests | Net added |
|---|---:|---:|
| Baseline (`main` WIP) | 2946 | — |
| Phase 1 | 2946 | 0 |
| Phase 2a | 2967 | +21 |
| Phase 2b | 2974 | +7 |
| Phase 2c | 2976 | +2 |
| Phase 3 | 2982 | +6 |
| Phase 4 | 2990 | +8 |
| Phase 5 | 3011 | +21 |
| Phase 6a–6b | 3011 | 0 |
| Phase 7 | 3011 | 0 |
| Phase 8 | 3011 | 0 |
| **Final** | **3011** | **+65** |

No previously-passing test was modified. Renames propagated cleanly
through to test files because every spec imported via
`@store/XxxStore` and the alias updated with the rename.

---

## ARCHITECTURE.md edits

All four applied after explicit approval per §9 rule #9. No silent
doc drift.

- **§3** rewritten. ❓ "Needs investigation" category removed.
  Plumbing-only count: 11 → 14. Roofing-only: 7 → 10 (added the
  three transient drag sub-stores already on disk). Shared: 12 →
  14 (formalised `drawFeedbackStore` + `renderModeStore` as
  intentionally shared).
- **§8** open-decisions log: the "six ❓ ambiguous stores" entry
  flipped to `[x]` with a pointer to Phase 7 (2026-04-23) and the
  split between renamed (3) and kept-shared (2).
- **§4.3** Undo-semantics decision entry was already `[x]` from
  the doc baseline; Phase 3 implemented the "Option B — per-mode"
  decision.
- **§2** "Event naming" subsection gained a CONTRIBUTING checklist
  (three imperative items) so new-event PRs get reviewed against
  the convention without re-litigating scope decisions.

---

## Notable design calls (worth remembering)

1. **Extract over branch-by-mode for `KeyboardHandler`.** Phase 2a
   moved the inline keyboard handler out of `App.tsx` into
   `src/ui/KeyboardHandler.tsx` — 170-line extract. Made the §4.1
   behavioural test trivially writable (mount the component in
   isolation). Establishes a pattern for the remaining §6 root-
   level UI (`Toolbar`, `LayerPanel`, `StatusBar`, `HelpOverlay`,
   `ExportPanel`) when they get their own audit.

2. **Per-entry undone tracking instead of per-mode depth counters
   in `UndoManager`.** The initial instinct was
   `undoDepth: Map<AppMode, number>`. Shared commands break that
   model because their position in each mode's eligibility list
   differs. Replaced with `Set<correlationId>` + ordered
   `undoHistory` stack. Same asymptotic footprint (≤ log capacity),
   handles shared commands without special cases.

3. **Roofing rendering in Printables is deferred feature work.**
   Phase 5 installed the `presence.plumbing` gate; `presence.roofing`
   has no consumer yet. When the roofing `calcEngine` →
   `proposalData` bridge lands, its section plugs in behind the
   already-existing gate with zero changes to the Printable
   top-level structure.

4. **Synthetic handlers for §4.3 scenario tests.** Roofing commands
   don't go through the CommandBus today (roofStore mutates
   directly). Phase 3 registered `test.pipe.add` / `test.section.add`
   / `test.pricing.edit` in the spec file, tagged with the three
   modes. This validates the UndoManager mechanic that real-domain
   commands will slot into — without committing to a bigger roofing-
   on-bus migration that wasn't in scope.

5. **One `sed` per rename phase instead of 20+ `Edit` calls.** Each
   Phase 1 / 6 / 7 rename did a single mechanical token-substitution
   pass followed by `git grep` verification. Faster, diff-cleaner,
   and `git mv` preserved file history on every rename that passed
   git's 50% similarity threshold. Two spec-file renames
   (`multiSelectStore.spec.ts`, `roofingEstimateScopeStore.spec.ts`)
   fell below the threshold because of how many hook-name hits
   landed in short specs — they're recorded as delete+create. The
   CONTENT is preserved; `git log --follow` still works.

---

## Known issues / surprises

- **CommandBus `p95 < 0.2ms` perf test flakes under full-suite
  load.** Occasional first-run fail, passes on rerun. Not caused by
  this refactor — observed on `main` before Phase 1. Worth
  investigating separately (raise the bar, or mock `performance.now`
  in the test).

- **Pre-refactor working tree.** `main` had ~67 modified files +
  ~140 untracked representing the entire R.4–R.27 roofing domain.
  Phase 0 committed that as `e2aa6a9` ("WIP: pre-refactor
  baseline") before branching, so the refactor commits diff against
  a stable base. If someone wants to see what roofing looked like
  before Phase 1 ran, that's the commit to check out.

- **`EstimateScope` type + `EstimateScopeToggle` component kept
  their names** when `roofingEstimateScopeStore` was renamed to
  `roofingScopeStore` in Phase 6a.3. They describe the VALUES +
  UI control, not the store identity. Renaming would be a
  type-level cleanup commit per §7's discipline.

---

## Deferred to follow-up PRs (per §7 + §8 open decisions)

**Recommended priority — highest user-impact first:**

1. **§6 root-level UI audit.** `Toolbar` specifically. It's the
   most-visible plumbing-only control in the shared shell and
   will confuse roofing users the moment they try to draw. The
   `KeyboardHandler` extract-pattern from Phase 2a is a workable
   template. My read: branch-by-mode is likely right for
   `Toolbar` (a lot of mode-specific state; a split would duplicate
   the shell scaffolding), whereas `HelpOverlay` and `StatusBar`
   can probably stay shared with a mode-aware content slot.

2. **§4.3 roofing commands onto the CommandBus.** Phase 3 shipped
   the partitioning infrastructure. When roofing operations
   (section.add, section.remove, penetration.place, etc.) start
   going through the bus, Ctrl+Z in the roofing workspace
   "just works" thanks to the mode-stamped undo.

3. **§4.8 roofing line-item pipeline.** Makes
   `PrintableProposal`'s `presence.roofing` branch actually
   render something. Gated infrastructure is already there.

**Genuinely low priority (pure cosmetic):**

- §5 engine folder regroup (`engine/` → `engine/plumbing/`).
- §5 UI folder regroup (`ui/pipe|fixtures|manifold` → `ui/plumbing/…`).
- §7.11 `LegendChip` / `LegendRow` / `LegendGroup` extraction —
  not worth doing until roofing needs a layer panel.

**Already complete / decided:**

- [x] §3 ambiguous-store resolution (Phase 7).
- [x] §4.1 mode-scoped shortcuts (Phase 2a).
- [x] §4.2 `isAnyDrawActive` selector (Phase 2b).
- [x] §4.3 per-mode undo (Phase 3).
- [x] §4.4 roofing bundle round-trip (Phase 4).
- [x] §4.5 SimulationBridge guard (Phase 2c).
- [x] §4.6 floorStore shared + FloorResolver plumbing-only
  (documented in doc baseline; no code change needed).
- [x] §4.8 domain-presence gating (Phase 5).

---

## Merge checklist

- [x] `tsc --noEmit` clean.
- [x] `vitest run` — 130 files, 3011 tests, all passing.
- [x] No `any` / `@ts-ignore` / `@ts-expect-error` added.
- [x] Every rename has a historical note in its docstring.
- [x] Every phase is a discrete commit or sub-commit series — no
  cross-phase contamination.
- [x] `ARCHITECTURE.md` reflects post-refactor reality.
- [x] `npm run build` — clean production build (9.65s, chunk
  sizes within pre-refactor ranges; the >500kB warning is
  pre-existing and unrelated to this refactor).
- [ ] Branch rebased onto latest `main` if `main` has advanced.

---

_Report generated by the hybrid-architecture refactor wrap-up,
Phase 8 completion. For per-phase detail, see the commit message
of each phase (they carry their own contract + rationale)._
