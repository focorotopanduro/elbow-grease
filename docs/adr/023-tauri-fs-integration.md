# ADR 023 — Tauri File-System Integration (Phase 11.D)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 11.D
- **Extends:** ADR 020 (Bundle v1), ADR 021 (Bundle v2). This phase keeps the bundle schema untouched; it replaces the I/O layer.

## Context

Phases 11.A and 11.B shipped save/load for `.elbow` bundles using browser primitives — `Blob` + anchor `download`, `<input type="file">`. Those work in any environment including the Tauri webview, but they have real limitations:

- **No stable path.** Every save pops a "where do you want this?" OS dialog (technically: a browser "save" action with no path visibility). `Ctrl+S` after the first save still prompts. CAD users expect the second save to be silent.
- **No "Recent Files."** Without a real path, there's nothing to recall.
- **No `Save As` distinction.** Both save paths are identical.
- **File handles are ephemeral.** A file opened via `<input type="file">` cannot be re-read later — the File reference is single-use.

Tauri 2 has a native dialog plugin (`tauri-plugin-dialog`) plus a filesystem plugin (`tauri-plugin-fs`, already in the project). Combining them unlocks real path-based persistence. We want it for Tauri without breaking the browser fallback (used by the dev server's web preview and, potentially, users who run the built app outside Tauri for some reason).

## Decision

Add a **runtime adapter** that exposes one API and has two implementations:

```
src/core/bundle/fsAdapter.ts        isTauri(), requestSavePath, requestOpenPath,
                                    writeToPath, readFromPath, isRealPath,
                                    supportsRecentFiles
src/core/bundle/currentFileStore.ts currentPath, recents[], setCurrent, ...
```

### Adapter shape

```ts
requestSavePath(req): Promise<string | null>    // null = cancelled
requestOpenPath(req): Promise<{path, content} | null>
writeToPath(path, content, opts): Promise<void>
readFromPath(path): Promise<string>
isRealPath(path): boolean                        // differentiates real vs. synthetic
supportsRecentFiles(): boolean                   // true only in Tauri
```

Callers never branch on environment. The adapter picks the right backend:

| Op | Tauri | Browser fallback |
|----|-------|------------------|
| `requestSavePath` | Native Save dialog via `@tauri-apps/plugin-dialog`, returns absolute path. | Returns `BROWSER_SAVE_TOKEN` synthetic value. |
| `writeToPath(real)` | `writeTextFile(path, content)`. | Triggers `Blob` + anchor click download with suggested filename. |
| `writeToPath(token)` | Falls through to browser download (defensive — shouldn't happen in practice). | Triggers blob download. |
| `requestOpenPath` | Native Open dialog → `readTextFile`, returns `{path, content}`. | `<input type="file">` → `file.text()`, returns `{path: "browser-upload:{name}", content}`. |
| `readFromPath(real)` | `readTextFile(path)`. | **Throws** — browser runtime has no persistent file handles. |

Tauri plugins are loaded via dynamic `import()`. Browser bundles don't pay for them. When the Tauri runtime is present but the plugin fails for any reason (permission, plugin not registered), the adapter logs a warning and falls back to the browser path.

### Path concept & `currentFileStore`

The `bundleFileStore` tracks:

- `currentPath: string | null` — set on successful save/load. `Ctrl+S` writes here silently; Ctrl+Shift+S always prompts.
- `recents: RecentFile[]` — top 10 MRU entries. Only populated in Tauri (`supportsRecentFiles()` gates the write).

`setCurrent(path)` auto-derives a display name from the filename, strips the extension, handles both `\` and `/` path separators, and moves duplicates to the front of the recents list.

### Hotkey semantics (updated)

- `Ctrl+S` — **Save**. Writes to `currentPath` if known and real. Otherwise falls through to Save As.
- `Ctrl+Shift+S` — **Save As**. Always prompts. New-file or "save a copy" workflows.
- `Ctrl+O` — **Open**. Native dialog (Tauri) or file picker (browser).

Browser fallback: `Ctrl+S` without a current path and `Ctrl+Shift+S` produce identical behavior (a blob download). That's correct — there's no way to silently write to a browser path anyway.

### Rust-side plumbing

`tauri-plugin-dialog = "2"` in `Cargo.toml`, registered in `lib.rs` alongside the existing plugins. Capabilities extended:

```json
"dialog:default",
"dialog:allow-save",
"dialog:allow-open",
"fs:allow-read-text-file",
"fs:allow-write-text-file",
"fs:allow-exists"
```

## Consequences

**Good:**
- Tauri users get native save/open dialogs + silent Ctrl+S + a Recent Files list (ready for a UI in a future phase).
- Browser fallback preserved — dev server (`npm run dev`) still works identically to before.
- The `fsAdapter` module is the single branch point between environments. Future Tauri-only features (watched directories, autosave to a project folder) drop in behind the same interface.
- `isRealPath` / `supportsRecentFiles` helpers prevent the common bug of "store a browser-upload token in recents and re-open it" — the type system can't catch that, but these helpers make the right branch cheap.

**Accepted costs:**
- New Rust dependency on `tauri-plugin-dialog`. Trivial — it's a first-party plugin maintained alongside Tauri itself. Adds ~0 to the JS bundle (plugin code is lazy-loaded).
- `npm install @tauri-apps/plugin-dialog` added to `dependencies`. `@types/dialog` types ship with the package.
- First save now takes an extra dialog in Tauri. But that's the correct UX — a user saving a new project should choose a location.
- `readFromPath` explicitly rejects in browser. Calling code must use `requestOpenPath` for every open (we do; autosave still uses localStorage independently).

**Non-consequences:**
- Bundle schema unchanged. Same v2 format, just a different transport.
- Autosave still writes to localStorage. The interval-based autosave has no concept of a filesystem path — it's pure crash recovery and should stay that way.

## Alternatives considered

**Use the File System Access API in the browser.** Chrome/Edge ship a `window.showSaveFilePicker()` + `FileSystemFileHandle` that would give real path-based persistence in the browser too. Rejected because:
- Firefox + Safari don't implement it.
- Tauri's webview (WebView2 on Windows) has partial support that can regress between versions.
- It can't persist handles across reloads without IndexedDB + a separate permission dance.

**Fork the bundle layer into `BundleTauri.ts` vs `BundleBrowser.ts`.** Rejected — most of the logic (capture, apply, migrate, serialize, parse) is identical across environments. Only I/O differs, and that's the cleanest seam to put the adapter on.

**Skip the browser fallback entirely.** Tauri is the shipping runtime; the browser is just for dev. Rejected because `npm run dev` is how every developer iterates. Losing save/load during dev would be a substantial ergonomics regression.

## Validation

- `Vitest`:
  - `src/core/bundle/__tests__/fsAdapter.spec.ts` — 11 tests covering isTauri() detection paths (v2, legacy, cached), `requestSavePath` returns the token in browser, `writeToPath` triggers a blob download via DOM click, `isRealPath` correctly distinguishes tokens, `supportsRecentFiles` mirrors isTauri, `readFromPath` rejects in browser.
  - `src/core/bundle/__tests__/currentFileStore.spec.ts` — 11 tests covering deriveName (Unix + Windows + dotfile + multi-extension), MRU ordering, cap enforcement, browser runtime skips recents, persistence, clearCurrent/removeRecent/clearRecents.
- `tsc --noEmit` clean.
- `vite build` clean — plugin-dialog is only pulled in when Tauri is detected at runtime, so the browser chunk doesn't grow.
- Manual (expected, not run automatically in jsdom):
  - `npm run tauri:dev` → Ctrl+S prompts native Save dialog → file written to chosen path.
  - Second Ctrl+S → writes silently to same path.
  - Ctrl+Shift+S → prompts again.
  - Ctrl+O → native Open dialog → content applied.
  - Close + reopen app → `recents` list populated from localStorage.
