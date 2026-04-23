# ADR 041 — Shareable Contractor Library (Phase 14.J)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.J
- **Depends on:** Phase 14.A (Pricing), 14.B (Contractor Profile), 14.C (Templates), 14.G (Revisions).

## Context

By Phase 14.I the app has accumulated four contractor-level settings, all stored in browser localStorage:

| Store | localStorage key | What lives there |
|---|---|---|
| `contractorProfileStore` | `elbow-grease-contractor-profile` | Company name, license, logo, terms |
| `pricingStore` | `elbow-grease-pricing-profile` | Rate, overhead, margin, tax rules |
| `assemblyTemplateStore` | `elbow-grease-assembly-templates` | Reusable pipe+fixture layouts |
| `proposalRevisionStore` | `elbow-grease-proposal-revisions` | Every R1/R2/R3 snapshot |

All of it is local to the installation. Three user-visible problems:

1. **Switching machines starts from zero.** A contractor buying a new laptop has to re-upload their logo, re-enter their rate, re-save every template, lose all revision history.
2. **No way to share templates** (the whole point of 14.C) with a colleague working in the same office. Every plumber rebuilds the same "2-bath rough-in" library.
3. **No disaster-recovery path.** If localStorage gets cleared (browser settings reset, OS reinstall), everything is gone.

Full cloud sync (auth + backend + conflict resolution) is out of scope for one phase. File-based import/export is the 90% solution: a single `.elbowlib.json` file a contractor can back up to Dropbox / email / USB drive / colleague, and import back with surgical control over what gets merged.

## Decision

Ship two pieces:

### 1. `contractorLibrary.ts` — pure serialize / parse / merge

A single module owns the library file format + the merge logic. All JSON-in/JSON-out; no Zustand, no React, no file I/O. 22 unit tests lock the behavior.

**File format:**

```ts
interface ContractorLibrary {
  magic: 'elbow-grease-library';
  version: 1;
  exportedAt: string;            // ISO
  label?: string;                // free-form tag, user-set
  contractorProfile?: ContractorProfile;
  pricingProfile?: PricingProfile;
  templates?: { order: string[]; byId: Record<string, AssemblyTemplate> };
  revisions?: { byBase: Record<string, SavedRevision[]> };
}
```

Each section is **independently optional**. "Templates only" export for sharing with a colleague just omits the three other sections. Import side likewise — you can pull pricing from an old backup without touching current templates.

**Version gating:** `parseLibrary` rejects files whose version > LIBRARY_SCHEMA_VERSION. Users get a clear error ("Library version 2 is newer than this app supports (1). Update the app, or re-export from a matching version.") rather than silent data corruption. Backward compat: current reader accepts v1 (the current format).

**Merge strategies** (per section):
- `replace` — incoming overwrites local on conflict
- `skip` — local wins on conflict, incoming new items still added
- `keep-both` — duplicate the incoming item with a `(imported)` suffix; local untouched

For contractor + pricing profiles, `keep-both` isn't meaningful (there's only one contractor identity at a time), so those fall back to `replace` or `skip`. For templates, all three apply cleanly (`keep-both` renames with `(imported)` suffix + fresh ID). For revisions, the "two revisions with the same R-label from different installations" case only makes sense as `replace` or `skip`; `keep-both` is hidden in the UI.

**Report object:** `mergeLibrary` returns both the next state AND a `MergeReport` with counts (`templates.added`, `templates.replaced`, `templates.skipped`, `templates.renamed`, `revisions.basesAdded`, etc.) so the UI can surface "✓ 3 templates added, 1 renamed, 0 skipped."

### 2. `LibraryExportImportPanel` — Ctrl+Shift+X

Single modal with two tabs:

**Export tab:**
- Four section checkboxes (all on by default) with live counts of what would be captured
- Optional label field ("pre-rate-bump", "backup-2026-Q2")
- "Download →" button calls existing `downloadFile` helper from BOMExporter
- Suggested filename: `<label>-<YYYY-MM-DD>.elbowlib.json`

**Import tab** (three sub-stages):
1. **awaiting-file** — choose file button opens file picker
2. **review** — parse result + summary shown. Per-section checkbox to include/exclude. Per-section conflict strategy picker (radio group) for templates + revisions. Warnings surfaced for destructive choices (e.g. "Imports replace your current contractor profile").
3. **applied** — success screen with a bullet list from the MergeReport

**Safe defaults:** On import, the checkboxes default to match whatever's in the file *except* contractor + pricing default off (destructive — user opts in explicitly). Template strategy defaults to `keep-both` (non-destructive). Revision strategy defaults to `skip` (preserve local history).

### 3. Wiring back to stores

The panel reads from each store's `.getState()` on export. On import, it calls `setState` directly for each section (with `saveState` / `setProfile` where applicable) + writes the same localStorage key the stores use for persistence, so reopening the app sees the imported data.

**Files:**

```
src/core/sync/contractorLibrary.ts                            Pure format + merge (22 tests)
src/core/sync/__tests__/contractorLibrary.spec.ts
src/ui/sync/LibraryExportImportPanel.tsx                      Ctrl+Shift+X modal
docs/adr/041-contractor-library-sync.md

src/App.tsx                                (mod) mounts LibraryExportImportPanel
src/core/input/ShortcutRegistry.ts         (mod) Ctrl+Shift+X registered
```

## Consequences

**Good:**
- A contractor can now move to a new machine in two clicks: open library panel on old machine → Export; open on new machine → Import → all four sections → Apply.
- Templates become genuinely shareable. Export with templates-only checked, email the .elbowlib.json, colleague imports with `keep-both` strategy → two libraries merge without stepping on each other's pricing.
- Disaster recovery exists: a habitual backup (export once a week, keep on Dropbox) survives localStorage wipe / browser reset / OS reinstall.
- Merge logic is pure + 22-test-locked. Edge cases (conflicting R-numbers, identical template IDs, missing sections) all covered.
- No server, no auth, no backend — zero operational cost + zero privacy concern. The file stays on the contractor's device.
- Versioned format with magic string → future schema bumps (e.g. embedded assemblies in bundles, per-customer template subsets) migrate cleanly without breaking existing library files.

**Accepted costs:**
- **Revisions + templates are big.** A fully-populated library from a busy contractor could be multi-MB (logos + BOM snapshots + contractor/customer data per revision). Fine for local files; a concern if someone tries to email it. No compression for MVP; gzip via the OS (macOS / Windows built-in zip) works fine.
- **No auto-backup.** User has to remember to export. A future Phase 14.J.2 could add a "backup on every 10th proposal print" auto-rotate. Deferred.
- **No schema migration in the reader.** Parsing a future v2 file into a v1 reader throws; no attempt to best-effort-import. Acceptable because the magic string + version gate give a clear error; users update the app.
- **Contractor + pricing profile on import is all-or-nothing per section.** You can't merge "new rate, keep old license number." Real need is low; if it surfaces we can add field-level diff later.
- **No preview of individual templates before import.** The summary says "8 templates" but not their names. A future "expand to list" disclosure in the review stage is a small add.
- **Duplicate revisions (same base + R-label) can't keep-both**: semantically a revision number is a claim on history, so two R2's of the same proposal would be confusing. Locked at strategy level (`keep-both` hidden for revisions in the UI).

**Non-consequences:**
- No changes to the underlying stores' shapes or APIs (other than `saveCurrentSceneAsTemplate` which was already extended in 14.I). Import writes via the same `setState` path stores use internally.
- No schema bump on `.elbow` bundles (which are per-project scene files). This is a contractor-library format, separate concern.
- No runtime dep added; everything uses existing `downloadFile` + plain `FileReader`.
- No collision with existing shortcuts. Ctrl+Shift+Y was considered but overlapped with FixtureVisualEditor's Ctrl+Y (redo); Ctrl+Shift+X is clean.

## Alternatives considered

**Full cloud sync with auth + backend.** The eventual ideal, but way out of scope for a single phase. ~20 hours of work minimum for auth flow + sync adapter + conflict resolution + privacy policy. File-based covers the 90% case with 2 hours of work.

**Browser-native File System Access API.** `showSaveFilePicker()` / `showOpenFilePicker()` — better UX than `<input type="file">` + `downloadFile`. Rejected for MVP because it's Chrome-only; our Tauri WebView might support it but the fallback path (`<input>` + download) works in every environment. Can be added later as a progressive enhancement.

**Embed library in `.elbow` bundle.** The `.elbow` file is a per-project scene. Contractor library is cross-project. Coupling them would mean every bundle carries logo + all templates + all revision history — bundle bloat for no benefit.

**Store the library as TOML / YAML instead of JSON.** Human-readable, but users don't hand-edit; JSON serializes a logo as a base64 string cleanly, TOML would either need an external logo file or awkward string escaping.

**Separate .elbowlib.json files per section.** More granular but more files to manage. One bundled file is the contractor-oriented choice ("my setup" vs "my templates" vs "my rate"). Sections can be re-exported selectively anyway.

**Compress the library (gzip) before saving.** ~4× size reduction on typical content. Deferred — most libraries are < 1 MB raw; gzip adds complexity (encode/decode dependency) for a perf win nobody's asked for. Can layer in via `?compress` query flag in a future phase.

**Per-field diff view on import.** "R2 of P-260418-ABCD has $2,780 local total vs $3,420 incoming — pick." More granular but huge UI scope. The current `MergeReport` bullet list is enough for "did you overwrite what I thought you did?" verification; granular diff is v2.

## Validation

- `Vitest`:
  - `src/core/sync/__tests__/contractorLibrary.spec.ts` — **22 tests**: `buildLibrary` (magic + version embedding, optional sections, carries provided sections), `parseLibrary` (round-trip, rejects bad JSON / wrong magic / future version / missing version / wrong exportedAt type), `summarizeLibrary` (empty vs populated counts + metadata detection), `mergeLibrary` section-inclusion gating, per-section strategies (`replace` / `skip` / `keep-both` on templates with conflict + new items, `replace` / `skip` on revision snapshots with R-label collisions), immutability (doesn't mutate inputs), `suggestExportFilename` (default / tag sanitization / empty handling).
  - All prior tests continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. No runtime deps.
- Manual plan:
  - Set up a contractor profile, pricing profile, save a template, print a proposal → Ctrl+Shift+X → Export → file downloads.
  - Clear localStorage (devtools), reload — app is fresh with defaults.
  - Ctrl+Shift+X → Import → select the file → review stage shows the sections, defaults. Check all four, Apply → success screen shows "✓ Contractor profile replaced. Pricing profile replaced. 1 template added. 1 proposal history added. 1 revision snapshot added."
  - Reload the app → all four sections survive the reload (localStorage persistence works).
  - Export a templates-only library, open on a second profile → templates appear, pricing unchanged.
