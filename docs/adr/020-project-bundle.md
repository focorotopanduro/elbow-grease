# ADR 020 — Project Bundle Format (.elbow) (Phase 11.A)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 11.A
- **Supersedes:** parts of ADR 005 (placeholder). That ADR proposed an append-only bundle; this ADR ships a concrete JSON-snapshot bundle as the v1 floor. Append-only can still land as v2 if we need crash-atomic partial writes.
- **Depends on:** ADR 002 (CommandBus — dirty tracking subscribes to it), ADR 014 (Logger — bundle errors route through it).

## Context

Until now there's been no way to save and reload a project. `usePipeStore`, `useFixtureStore`, `useWallStore`, and `useMeasureStore` all hold persistent document state — but closing the tab erased them. The `projectBundle` feature flag (ADR 005) had been a placeholder since Phase 4 with nothing behind it.

The user (Beit Building Contractors) cannot reasonably do real work on a CAD tool that can't save. This phase closes that gap.

## Decision

Introduce `src/core/bundle/` with four modules + one ADR entry, shipping:

1. **Save to `.elbow` file** (`Ctrl+S` → browser download, also works in Tauri native dialog).
2. **Load from `.elbow` file** (`Ctrl+O` → file picker → replaces in-memory state).
3. **Autosave** to localStorage every 10 s when dirty, with `beforeunload` flush.
4. **Recovery on boot** — if an autosave exists and current state is empty, hydrate silently.
5. **Schema versioning** — every bundle carries `version`. Migrator scaffold is in place for future bumps.

### Files

```
src/core/bundle/Bundle.ts               Schema, capture/apply/migrate, serialize, file I/O
src/core/bundle/autosave.ts             Dirty flag, interval persister, recovery
src/core/bundle/useBundleHotkeys.ts     Ctrl+S / Ctrl+O wiring + toast via EV.CUE
src/core/bundle/__tests__/Bundle.spec   Roundtrip + migration + validation tests (19 tests)
```

### Bundle schema v1

```ts
interface BundleV1 {
  version: 1;
  meta: {
    createdAt: number;    // first save, wall clock
    savedAt: number;      // most-recent save
    appVersion: string;
    name?: string;
  };
  data: {
    pipes:        CommittedPipe[];
    fixtures:     FixtureInstance[];
    walls:        Wall[];
    measurements: Measurement[];
  };
}
```

**What's in the bundle:** document content — the 4 persistent stores above.
**What's NOT in the bundle:** ephemeral UI (current mode, selection, draw session, pivot session, radial menu state, onboarding status, feature flags, telemetry session). Loading a bundle shouldn't rearrange the user's editor — only the scene.

### capture → serialize → parse → apply

```ts
const b = captureBundle({ name: 'Jones Residence' });  // read stores
const json = serializeBundle(b);                       // string
// ... save to disk via downloadBundle(b) ...
const b2 = parseBundle(json);                          // roundtrip
applyBundle(b2);                                        // replace stores
```

`captureBundle` deep-clones via `structuredClone` so live mutations don't affect the captured payload. `applyBundle` uses `setState` with explicit shapes — selection, undo/redo stacks, and draw sessions are explicitly cleared (stale references would point at fictional scene elements).

### Migration strategy

```ts
export function migrateBundle(input: unknown): Bundle {
  // 1. Is it an object at all?
  // 2. Does it have a numeric `version` field?
  // 3. Is `version` ≤ CURRENT_BUNDLE_VERSION?
  // 4. Walk the chain: v1 → v2 → … → CURRENT
}
```

Currently only v1 exists. Future schema bumps append a migrator function; old ones stay untouched. Every migrator is pure + tested independently. Forward-incompatibility is explicit — loading a v2 bundle in a v1 app throws a clear `"update ELBOW GREASE, or open this bundle in a newer build"` error rather than silently dropping fields.

Shape validation (`validateV1`) is deliberately shallow: array presence for the 4 collection fields, object presence for `meta` and `data`. We tolerate extra fields (future-compatible) and missing optional fields (Zustand won't explode on `undefined`). A stricter per-item validator could land as Phase 11.B if malformed bundles become a pain point.

### File I/O

Both directions use standard browser primitives:
- **Save**: `Blob` + anchor click with `download` attribute. In Tauri, the webview intercepts this and shows a native save dialog — works everywhere, no platform conditional code.
- **Load**: hidden `<input type="file">`, `accept` attribute narrows to `.elbow` / JSON.

No dependency on `@tauri-apps/plugin-fs` — the common path works in every environment. We can layer Tauri-specific shortcuts (e.g. "Recent files" menu via the Tauri settings plugin) later.

### Autosave

- **Dirty flag** is flipped by a `commandBus.subscribe` listener — any successful non-undo/non-redo command sets it.
- **Timer** fires every 10 s; if dirty, captures + writes to localStorage + clears the flag.
- **beforeunload** safety net flushes one more write if dirty at tab close.
- **Recovery** on boot runs unconditionally (even when the flag is off) so a user who disables autosave after a session doesn't orphan their recovery data.

### Flag gating

`featureFlagStore.projectBundle` is now **default ON** (formerly placeholder). The flag gates only the interval autosave loop — Ctrl+S / Ctrl+O / recovery always work. Rationale: save/load is basic CAD functionality and should never be toggleable, but a user annoyed by localStorage churn can disable the background loop without losing access to explicit save.

## Consequences

**Good:**
- Users can save and reload their work. The single most-requested feature of any document-oriented app is done.
- Crash recovery — a hung tab or kernel panic loses at most 10 s of work.
- Clean migration scaffold — adding fields in v2 is additive, not scary.
- Zero new runtime dependencies (no file-saver, no fast-json-stringify).
- Toast feedback via the existing `EV.CUE` event — no new UI layer.

**Accepted costs:**
- Bundle size is unbounded — a 10,000-pipe scene produces a multi-MB JSON. localStorage has a 5 MB soft limit; the autosave writer catches quota-exceeded errors and logs a warning. Future work: chunked autosave via IndexedDB.
- `applyBundle` clears undo/redo. A user who loads a file can't Ctrl+Z back to the previous session. This is correct — undo history across an explicit load would mean "undo" produces state that was never in this session. The exchange is worth it.
- Customer store is not serialized in v1. Customers are a separate persistence scope (they survive across project files). Future v2 may add an optional `customerRef: string` pointing at a customer record.

**Non-consequences:**
- No network path. Bundles are files; they go from local disk to local disk. Zero telemetry / sync / cloud-backup behavior.
- No cryptographic signing. v1 bundles are plain JSON — tampering is trivial, but that's fine for a local CAD tool. If multi-user workflows later need integrity guarantees, v2 can add a signed manifest.

## Alternatives considered

**Protocol Buffers / MessagePack binary format.** Smaller on disk (~2-3×), faster parse. Rejected for v1 because:
- JSON is debuggable — a user can open a `.elbow` file in any text editor to inspect what they saved. Huge win for first-time CAD users who aren't sure what a "project file" means.
- Binary format locks us into a versioning library choice early. JSON + `version` field stays simple.
- No dependency footprint.

**Append-only event log (ADR 005's original proposal).** Every mutation appended as a command; load = replay log. Rejected for v1 because:
- Replay requires every command's handler to be pure / deterministic. Not currently true of everything (SimulationBridge solve results are async).
- Bundle size grows unboundedly even for simple scenes — a user who draws then undoes 1000 times has 2000 log entries for zero net mutations.
- JSON snapshot is more robust to future refactors (rename a store? migrator handles it. Replayed log against a renamed handler would throw).

Append-only could still land as v2 if crash-atomicity becomes a real concern — e.g. "user's hard drive failed mid-save and corrupted the file." The snapshot approach writes atomically (single JSON string replaces prior content) so this is not currently a problem.

**Proprietary compressed format (e.g. ZIP with manifest).** Reasonable for multi-file bundles (embedded images, referenced CAD blocks). Out of scope for v1 — our document today is pure geometry + metadata, no binary assets. A v2 can wrap the JSON in a ZIP if we need it.

## Validation

- `Vitest`: `src/core/bundle/__tests__/Bundle.spec.ts` — 17 tests covering capture (4), roundtrip (1), applyBundle (2), migrateBundle (6), parseBundle (2), helpers (2). Total suite: 109/109 pass across 8 files.
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual: drew 3 pipes, pressed Ctrl+S → file downloaded. Reloaded tab → empty scene. Pressed Ctrl+O → picked the file → 3 pipes restored.
- Autosave: drew 1 pipe, waited 11 s, reloaded tab → pipe restored from autosave. Confirmed via DevTools localStorage that the key `elbow-grease-autosave` held a valid JSON bundle.
