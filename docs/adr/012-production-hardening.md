# ADR 012 — Production Hardening (Phase 8)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 8 of 8
- **Depends on:** ADR 002 (CommandBus)

## Context

After 15 feature phases + a consolidation pass, the app is feature-complete for the user's Uponor workflow. This ADR documents the defensive plumbing that graduates it from "feature-complete" to "production-ready":

- **Containment**: one throwing component must not take down the whole app.
- **Reversibility**: the Phase 1 CommandBus promised deterministic replay. Phase 8 cashes that check — `Ctrl+Z` now undoes ANY command whose handler defines `undo()`, not just pipes.
- **Discoverability**: 20+ keyboard shortcuts and no way for a new user to learn them. `?` now opens a filterable reference table.

## Decision

Three additions, shipped together as Phase 8:

### 8.A — `ErrorBoundary`

Class component implementing the React error-boundary protocol (`getDerivedStateFromError` + `componentDidCatch`). Caught errors:

1. Show a compact red-bordered fallback with the error message + `Reset` (remounts subtree) + `Reload app`.
2. Fire a `ui.errorBoundary` command on the CommandBus with the stack + component stack — visible in God Mode with the correlationId needed for bug reports.
3. Echo to `console.error` for dev builds.

Three wrapping placements in `App.tsx`:
- **3D Scene** — around `<Canvas>`. A crashed R3F component shows the fallback instead of the white-of-death; HUD panels keep working.
- **God Mode console** — so one malformed log entry can't hide the console permanently (you can reset it).
- **Compliance debugger** — same story for Phase 2's trace panel.

We hand-roll instead of using `react-error-boundary` (~6KB gzipped). No runtime dep added; the ~80-line implementation covers our exact three placements.

### 8.B — Universal Undo via CommandBus

New `UndoManager` in `src/core/commands/UndoManager.ts`. Walks the CommandBus ring buffer, filters to entries whose handler defines `undo()`, and pops/pushes a pointer (`undoDepth`) into the log. On `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z`:

- **Undo**: finds the most-recent undoable entry at position `length - 1 - undoDepth`; re-dispatches it with `issuedBy: 'undo'` and `__undoSnapshot` set to the captured pre-apply state.
- **Redo**: re-applies the command at position `length - undoDepth` with `issuedBy: 'redo'` (fresh precondition check + new snapshot).
- **New user command**: truncates the redo region to zero (standard undo semantics).

The old `usePipeStore.undo()` / `.redo()` were pipe-specific. They still exist for any consumer that wants them directly but are no longer the Ctrl+Z path — that now routes through the universal manager.

**Side effect of this phase: `CommandBus.dispatch` now skips preconditions when `issuedBy === 'undo'`.** Rationale: a handler's preconditions assert the state `apply()` mutates FROM; an undo reverses that apply, so the precondition will naturally fail every time. We trust the handler's `undo()` to be robust on its own (existence checks happen inside it).

### 8.C — Shortcut Registry + Help Overlay

`src/core/input/ShortcutRegistry.ts` enumerates every keyboard shortcut as `{ id, category, keys, description, hint? }`. Currently 33 entries across 9 categories.

`src/ui/HelpOverlay.tsx` reads the registry and renders a filterable modal table. Toggle: `?` (or `Shift + /`). `Escape` closes. Search filter narrows to any category / keys / description / hint match.

Crucially, the registry is INFORMATIONAL — adding an entry does not install a handler, and installing a handler does not auto-update the registry. Keeping those concerns separate means the registry stays a deliberate, curated source of truth. A future lint rule can enforce pairing.

## Key design choices

### Filter semantics in UndoManager use handler identity, not snapshot presence

Earlier iteration of the filter was `snapshot !== undefined`. That broke for `pipe.add` which uses `snapshot: () => null` (handler has no meaningful pre-state but still has an `undo()` that removes the pipe by id). The right question is **"does the handler define undo?"** — exposed via `commandBus.hasUndo(type)`.

### Preconditions skipped on undo dispatches

A handler's `preconditions` typically asserts something like "pipe with this id exists" — which is true BEFORE the apply but false AFTER. An undo reverses the apply, so preconditions would reject the reverse. Two options:

1. Define a separate `undoPreconditions` per handler.
2. Trust `undo()` to handle its own safety checks and skip the forward preconditions.

Option 2 is simpler and matches real handler semantics: every current `undo()` already guards against stale snapshots. Option 1 doubles the API surface for no observable benefit.

### ErrorBoundary emits via CommandBus instead of its own channel

Every other observable event in the app is on the CommandBus log. Routing error-boundary catches through the same channel means:

- The God Mode console shows crashes interleaved with user commands (diagnostic gold when reproducing issues).
- The correlationId chain from a preceding user command threads through to the error, so "the pipe.add right before the crash" is visible.

### Help overlay reads from a STATIC list, not runtime-registered handlers

Runtime registration is what `chordDetector.registerHold` does. That pattern is fine for *installing* a handler, but it means the "list of shortcuts" is distributed across dozens of call sites. The help overlay needs a centralized, ordered, categorized view. A static registry gives us that; the cost is that shortcuts land in two places. Acceptable — the registry is the canonical docs.

## Consequences

### Positive

- **Single-component crashes are contained.** A bad pipe polyline no longer white-screens the app.
- **Ctrl+Z works on everything.** Pipe add, pipe remove, pipe diameter change, pipe.insertAnchor, fixture place, fixture remove, fixture param changes, fixture position, manifold add/remove/move/merge — anything whose handler has `undo()`.
- **Self-documenting UI.** `?` shows the full keybinding map with search.
- **+10 new tests** (UndoManager spec).
- **Zero new runtime dependencies.** Error boundary + undo manager + help overlay all use platform APIs + existing CommandBus.

### Negative

- **Preconditions on undo paths are skipped globally.** The trust boundary shifts from bus-enforced to handler-enforced. Mitigated by the handler's own guards; documented here as a known semantic change.
- **Registry is hand-maintained.** A new shortcut without a registry entry still works — it just won't show in the help overlay. An ESLint rule could enforce pairing; deferred to a follow-up commit.
- **Error boundaries are class components.** Stylistic inconsistency in a functional-component codebase. No practical impact — it's literally what React requires.

### Neutral

- **Old pipeStore undo/redo actions remain** as public store surface. Not removed because a handful of internal tests use them, and the store's undo ring behaves slightly differently (walks its own command stack, not the bus log). Post-Phase-8 cleanup could remove them after all consumers migrate.

## Rollout

- **This commit:** all three additions live. `Ctrl+Z` immediately extends to manifolds and fixtures in addition to pipes. `?` opens the help overlay. Error boundaries kick in on first render.
- **No feature flag.** These are strict UX improvements; a rollback would be a code revert, not a runtime toggle.

## Rollback

- **ErrorBoundary:** revert the three `<ErrorBoundary>` wrappers in `App.tsx`. The component file remains inert.
- **UndoManager:** replace the `undoLastCommand` / `redoLastCommand` calls in `KeyboardHandler` with the old `usePipeStore.getState().undo()` / `.redo()`. The UndoManager remains unused.
- **HelpOverlay:** remove the `<HelpOverlay />` mount. The registry file remains as documentation.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| UndoManager tests | 8+ | **10** ✓ |
| Error boundary fallback covers Canvas, GodMode, Compliance | 3 wraps | **3** ✓ |
| Shortcut registry entries | 30+ | **33** ✓ |
| Ctrl+Z works on non-pipe commands | yes | **yes** (manifold merge undo test asserts it) |
| TypeScript | 0 errors | **0** |
| New runtime deps | 0 | **0** |

## References

- Source: `src/ui/ErrorBoundary.tsx`, `src/core/commands/UndoManager.ts`, `src/core/input/ShortcutRegistry.ts`, `src/ui/HelpOverlay.tsx`
- CommandBus change: `src/core/commands/CommandBus.ts` now exposes `hasUndo(type)` and skips preconditions on `issuedBy==='undo'`
- Test: `src/core/commands/__tests__/UndoManager.spec.ts`
- Boot wiring: `src/core/commands/boot.ts::installUndoHook`
