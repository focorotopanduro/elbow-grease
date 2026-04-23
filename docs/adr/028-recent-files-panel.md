# ADR 028 — Recent Files Panel (Phase 11.E)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 11.E
- **Depends on:** ADR 020 (Project Bundle Format), ADR 021 (Customer-Linked Bundles v2), ADR 023 (Tauri FS Integration).

## Context

Phase 11.D shipped the `currentFileStore` — a Zustand store with `currentPath` plus a `recents: RecentFile[]` list persisted to localStorage. It was a complete data layer, but with no UI surfacing it. Users saved projects, the recents list populated silently, and there was no way to read it short of opening DevTools.

Phase 11.B added customer linking: every bundle optionally carries a `project.customerSnapshot.name`. A recents UI that *doesn't* show customer context would miss the most important piece of information for a contractor juggling multiple client projects ("which Jones Residence file is this?").

## Decision

Ship `RecentFilesPanel` — a modal panel triggered by `Ctrl+Shift+R`, listing recents grouped by linked customer, with keyboard navigation and graceful handling of moved / deleted files.

### Files

```
src/core/bundle/currentFileStore.ts        +1 field (customerName) on RecentFile
src/core/bundle/openRecentFile.ts          new: read → parse → apply → cleanup
src/core/bundle/__tests__/openRecentFile   4 tests (happy, stale, corrupt, future-version)
src/ui/file/RecentFilesPanel.tsx           new: modal UI with keyboard nav
```

Plus shortcut registration + App.tsx mount + save/open flow threading.

### Schema extension

`RecentFile` gains an optional field:

```ts
export interface RecentFile {
  path: string;
  savedAt: number;
  name: string;
  customerName?: string;     // NEW
}
```

Populated from `bundle.project.customerSnapshot.name` at save time (Ctrl+S) and from the `applyBundle` result at load time (Ctrl+O). Old entries from before this change leave it undefined and land in the "No customer linked" group.

### `openRecentFile(path)` — the click handler logic

Three failure modes, each handled differently:

| Failure | Response | Side effect |
|---|---|---|
| `readFromPath` throws | return `ok: false, removedFromRecents: true`, error string | Remove entry from recents |
| `parseBundle` throws (invalid JSON, future version) | return `ok: false, removedFromRecents: false` | Keep entry (the file exists, just corrupt) |
| `applyBundle` succeeds | return `ok: true, applyResult`, call `setCurrent(path, name, customerName)` | Standard "current file" update |

The different removal semantics matter: a moved/deleted file is dead weight in the list. A corrupt file might be recoverable (manual fix, newer app build later); removing its entry would make re-finding it harder.

### Panel UX

Opened with `Ctrl+Shift+R`. `Esc` or backdrop click closes. Focus-trapped (`useFocusTrap`).

Groups:
- One section per customer (alphabetical).
- A trailing "No customer linked" section for ungrouped entries.

Each row:
- Filename (bold)
- Relative age (`just now` / `5m ago` / `3h ago` / `2d ago` / date)
- Path (monospace, left-elided if long, full path on hover)
- Remove button (`×`) — removes from list without deleting the file

Keyboard nav:
- `↑` / `↓` move selection across groups (flat index model)
- `Enter` opens the selected entry
- `Delete` / `Backspace` removes it from the list

### Empty states

Two distinct empty states depending on runtime environment:

- **Browser mode** (no Tauri FS): "Recent files unavailable — this panel tracks files that were saved with a stable path. The desktop build opens a native Save dialog and remembers the path; the browser version cannot."
- **Tauri mode, no recents**: "No recent projects yet — press Ctrl+S to save a project. The first save opens a native Save dialog; subsequent saves go to the same file silently, and the entry appears here."

The browser empty state is important because the list would otherwise look "broken" to a dev-server user.

### Toast on open

Existing `EV.CUE` pathway → FeedbackOverlay. Messages include the customer context:
- `"Opened Jones Residence for Eleanor Jones"` on success.
- Error message from `openRecentFile` on failure.

### Capture points (save + open)

`useBundleHotkeys.ts` now captures `customerName` when it calls `setCurrent`:

```ts
// Ctrl+S success
useCurrentFileStore.getState().setCurrent(
  path,
  /* displayName */ undefined,
  bundle.project?.customerSnapshot?.name,
);

// Ctrl+O success
useCurrentFileStore.getState().setCurrent(
  picked.path,
  undefined,
  result.project?.customerName,
);

// Ctrl+Shift+R (open from recents) — inside openRecentFile.ts
useCurrentFileStore.getState().setCurrent(
  path,
  undefined,
  applyResult.project?.customerName,
);
```

All three paths converge on the same capture logic. The customer snapshot is always derived from what the BUNDLE says — not from whatever the current `useCustomerStore.activeCustomerId` is. This matters for cross-machine scenarios: loading a bundle from a colleague's project correctly shows their customer label, even if the customer isn't in the local store.

## Consequences

**Good:**
- The recents registry (data-only since Phase 11.D) is now discoverable and operational.
- Grouping by customer makes "find the Jones Residence bathroom project" fast even with 10 projects loaded.
- Keyboard navigation is as fast as a command-palette — Ctrl+Shift+R, ↓ ↓ Enter.
- Stale-file cleanup happens automatically — users aren't stuck with broken entries that fail every time.
- ADR 023's "Tauri-only features surface gracefully in browser" promise is kept: the panel shows an explanatory empty state instead of acting broken.

**Accepted costs:**
- `RecentFile.customerName` is an additional optional field serialized to localStorage. A handful of extra bytes per entry; bounded at MAX_RECENTS × filename-size.
- Open-from-recents bypasses the file picker. In Tauri this is correct behavior (we have a stable path). In browser it would be impossible (handles are ephemeral) — which is why the panel is Tauri-gated via `supportsRecentFiles`.
- Clicking "Remove" removes from recents but NOT from disk. Clear in the tooltip (`Remove {name} from recents`), matching every IDE's recents-list convention.

**Non-consequences:**
- No new store. The existing `useCurrentFileStore` is extended with one optional field.
- No change to bundle schema (no new version bump). The customer snapshot is already in v2; this phase just reads an extra value from what's already there.
- No telemetry. Recent-file selection isn't logged to SessionTelemetry beyond the existing `commandBus` counts.

## Alternatives considered

**Inline "Recent" dropdown in the top bar.** Visual discoverability > hotkey. Rejected for Phase 11.E — adds a new HUD element and the app already has a crowded title area. Can add later once we know users are using the hotkey.

**Flat list (no customer grouping).** Simpler render code. Rejected — customer grouping is the one thing that makes the list immediately useful for a contractor with multiple active projects.

**Auto-show the panel on app boot when there are recents.** Some apps do this ("pick up where you left off"). Rejected — interrupts returning users who already know which project they want. Autosave recovery (ADR 020) handles the "reboot mid-session" case; the recents panel is for "start a new session, pick up project X".

**Remove entry from recents on every parse failure** (regardless of file existence). Rejected — corrupt files are a recoverable user problem (patch up the JSON manually, or wait for a newer build); stale paths are not. The distinction is worth the extra code.

**Feature-flag the whole panel.** Rejected — it's additive UX with no footgun. A user who doesn't want it just doesn't press Ctrl+Shift+R.

## Validation

- `Vitest`:
  - `src/core/bundle/__tests__/openRecentFile.spec.ts` — **4 tests** covering happy path (reads + applies + returns ok), stale-path (removes from recents, returns error), corrupt-bundle (keeps in recents, returns error), future-version (keeps in recents, returns error).
  - Full suite: **408/408 pass across 33 files** (+4 new, no regressions).
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual test plan (requires `npm run tauri:dev`):
  - Save a project for a customer → close panel → `Ctrl+Shift+R` → entry appears under that customer's group.
  - Save 3 projects across 2 customers → `Ctrl+Shift+R` → 2 groups, entries sorted by recency within each.
  - Rename / move a file on disk → `Ctrl+Shift+R` → click the moved entry → toast shows stale-file error and entry is gone from the list.
  - Open a corrupt file → `Ctrl+Shift+R` → click it → toast shows parse error, entry STAYS in the list.
  - Browser mode (`npm run dev`) → `Ctrl+Shift+R` → empty-state message about desktop requirement.
