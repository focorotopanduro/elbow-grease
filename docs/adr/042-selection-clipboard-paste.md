# ADR 042 — Selection Clipboard + Paste / Duplicate (Phase 14.P)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.P
- **Depends on:** Phase 14.I (Multi-select foundation), 14.O (Group translate).

## Context

By Phase 14.O the user can box-select a group of pipes + fixtures,
rotate them (14.M), mass-edit their properties (14.N), and drag or
arrow-nudge the whole group (14.O). The obvious next gesture — the
one every user trained on any other editor tries first — is
**duplicate**.

Typical flow today without duplicate: the plumber lays out one
bathroom (water closet + lavatory + shower + the eight-foot waste run
that ties them together), and for the second bathroom in the same
floor plan they have to **lay it out again**. Every tick of drawing,
every fixture placement, every material choice. The selection system
is built; the duplicate is missing.

Constraints:

- **Must work from multi-select AND single-select.** A user who has
  one fixture clicked and hits Ctrl+D expects that fixture to
  duplicate, not nothing.
- **Paste must preserve everything.** Material, system, diameter,
  color, fixture parameters — every field the user had chosen. A
  duplicate that resets the copied pipe to default 3" PVC waste would
  be worse than no duplicate feature at all.
- **Fresh IDs, always.** Two pipes sharing an id would corrupt the
  graph + the BOM + the worker.
- **No shared references.** Mutating the copied fixture's params
  after paste must not retroactively edit the original. Ordinary
  JavaScript object-reference semantics are a footgun here.
- **Must replay downstream.** ConnectivityManager, SimulationBridge,
  and AutoRouteTrigger all listen for `PIPE_COMPLETE` / `FIXTURE_PLACED`
  events. The paste must emit those so the worker re-solves, the
  graph re-connects, and the BOM re-tallies. A silent `setState`
  that skips the events would ship ghost items that the engine
  doesn't know exist.

## Decision

Ship three pieces, same layering contract as Phase 14.I–14.O:

### 1. `selectionClipboard.ts` — pure module

A single file that knows the clipboard's data shape + the pure
operations over it. Zero imports from React, Zustand, or Three — just
plain types + functions.

**Payload shape:**

```ts
interface ClipboardPayload {
  version: 1;
  pipes: ClipboardPipe[];      // no id, no `selected`
  fixtures: ClipboardFixture[];// no id, no connectedPipeIds
  anchor: Vec3;                // payload centroid at copy time
  copiedAt: number;            // wall-clock
}
```

IDs are intentionally stripped from the payload — they're re-minted
on paste. `selected` is stripped because the clipboard has no
selection state. `connectedPipeIds` is stripped because the paste
breaks connectivity anyway; ConnectivityManager will re-populate it
when the fresh pipes trigger `PIPE_COMPLETE`.

**Three pure operations:**

- `extractForCopy(pipeIds, fixtureIds, pipes, fixtures)` → payload
  (or null if nothing selected). Deep-clones points + params so
  subsequent store edits don't retroactively corrupt the clipboard.
- `preparePaste(payload, delta, idGen)` → `{pipes[], fixtures[]}` —
  fresh-id copies with every position offset by `delta`. Another
  deep-clone on the way out so the clipboard stays reusable for
  another paste.
- `computePayloadCentroid(pipes, fixtures)` → Vec3. Exported so the
  UI can preview the ghost at the payload's center of mass.

A version constant (`CLIPBOARD_SCHEMA_VERSION = 1`) is the single
checkpoint for a future breaking change. The test suite locks the
constant — bumping it requires an explicit test update, which
forces a migration decision.

22 tests lock the round-trip + deep-copy guarantees.

### 2. `clipboardStore.ts` — Zustand state holder

Single slot. Not persisted. Four members:

```ts
payload:    ClipboardPayload | null
setPayload: (p) => void
clear:      () => void
hasData:    () => boolean
itemCount:  () => number
```

**Why not persisted:** a clipboard that survives app restart is
surprising (users expect fresh sessions to have empty Paste), and
the anchor-relative geometry would point at potentially-deleted
source items in a different project anyway. Session-only is correct.

**Why single-slot:** Every editor the user has trained on uses
single-slot. History ("clipboard reel" / ring) could come later as
a 14.Q if users ask; single-slot is the correct first iteration.

### 3. `useSelectionClipboardShortcuts.ts` — keyboard bindings

Three shortcuts:

- **Ctrl+C** — `copySelectionToClipboard()`. Uses multi-select if
  populated; falls back to single-select otherwise. No-op on empty
  selection. Doesn't clear existing clipboard on empty copy (so an
  accidental Ctrl+C in empty space doesn't wipe a useful clipboard).
- **Ctrl+V** — `pasteFromClipboard()`. Applies the payload at
  `DEFAULT_DUPLICATE_OFFSET = [1, 0, 1]` so the copy is adjacent
  but not overlapping. Pasted items become the new multi-select for
  immediate follow-up edits.
- **Ctrl+D** — `duplicateSelection()`. One-keystroke equivalent of
  "Ctrl+C, Ctrl+V of the current selection." Does NOT touch the
  clipboard — the user's previous Ctrl+C payload is preserved.

`metaKey` (Cmd) is accepted alongside `ctrlKey` so Mac users (or
users RDP'ing from Mac into the Windows build) get the native
shortcut.

`Shift` and `Alt` modifiers are intentionally unbound — leaving
them free for future variants (paste-inverted, paste-at-cursor,
paste-special).

Standard text-input guard: skipped when focus is in an
`<input>` / `<textarea>` / contenteditable element.

## Why direct `setState` on pipeStore instead of `addPipe`

`pipeStore.addPipe(payload)` only carries `{id, points, diameter,
material}` (it's built for the draw-to-commit flow where system +
color are derived by the solver). For paste to preserve the
**copied** system + material + color faithfully, we need to write
every field directly. The clipboard hook does:

```ts
usePipeStore.setState({
  pipes: { ...existing, ...freshPastedPipes },
  pipeOrder: [...existing, ...freshIds],
});
eventBus.emit(EV.PIPE_COMPLETE, { id, points, diameter, material });
```

The emit after `setState` is the key — ConnectivityManager and
SimulationBridge both subscribe to `PIPE_COMPLETE`, so the pasted
pipes show up in the graph + the BOM same as freshly-drawn ones.

Fixtures are handled symmetrically: `setState` with the new
instances, then `EV.FIXTURE_PLACED` per id.

## Trade-offs considered

- **Undo granularity.** Paste currently writes N new pipes + M new
  fixtures. Undo removes them one-at-a-time rather than as a single
  "undo paste" atom. Fine for now — the store's existing undo stack
  is per-pipe; a grouped-undo would require a shared command/log
  across stores and belongs to Phase 14.Q if we get complaints.
- **Paste target.** We paste at `[1, 0, 1]` offset rather than at
  the cursor hit. A cursor-follow ghost preview + click-to-commit
  would be ideal but requires a 3D UI pass (ghost renderer, drop
  catcher) that doesn't fit in this phase. `deltaForTarget(anchor,
  cursorHit)` is exported from the pure module so the follow-up
  phase can add the cursor flow without touching the core.
- **Cross-session clipboard.** Not persisted. If users ask for
  "copy in project A, paste in project B," we can add a per-store
  localStorage write without changing the payload shape — version
  gate already in place.

## Files

- `src/core/selection/selectionClipboard.ts` — pure module, 225 LOC
- `src/core/selection/__tests__/selectionClipboard.spec.ts` — 22 tests
- `src/store/clipboardStore.ts` — Zustand store, 48 LOC
- `src/ui/selection/useSelectionClipboardShortcuts.ts` — hook + three
  exported action functions (`copySelectionToClipboard`,
  `pasteFromClipboard`, `duplicateSelection`) + `SelectionClipboard\
ShortcutsBinder` component
- `src/App.tsx` — one new import + one `<SelectionClipboardShortcuts\
Binder />` mount next to the existing 14.O binder

## Verification

- `npx vitest run` — 979 tests pass (957 pre-phase + 22 new).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Place 2 fixtures + draw a pipe between them.
  2. Box-select all three.
  3. Ctrl+D → fresh copy appears 1 ft away in +X and +Z, pasted copy
     is the new multi-select.
  4. Ctrl+Z → pasted items disappear one-at-a-time (expected; see
     trade-offs above).
  5. Ctrl+C on empty selection → prior clipboard payload survives
     (no-op, not a clear).
