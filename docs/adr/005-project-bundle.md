# ADR 005 — Crash-safe `.elbow` Project Bundle

- **Status:** Accepted (infrastructure + fuzz tests landed; dual-path rollout)
- **Date:** 2026-04-17
- **Phase:** 4 of 5
- **Depends on:** ADR 002 (CommandBus — event stream provenance)
- **Supersedes:** partial — the monolithic `.elbow` JSON format is preserved as a migration source.

## Context

Today's `.elbow` is a single JSON blob. AutoSave rewrites it in full every ~30s to `localStorage` (rotating 3 slots). That has three weaknesses:

1. **No filesystem durability.** localStorage is browser-scoped — a user who reinstalls the app or switches machines loses everything. With Tauri and a real FS available, we should use it.
2. **Torn-write corruption window.** The prompt called out: "A power cut during a 400KB rewrite truncates the file." That's accurate if/when we switch to `fs.writeTextFile`: no atomic rename, no fsync, no partial recovery.
3. **Write amplification.** A 1-byte logical change (rename a fixture) rewrites the entire project. At 400KB and 60fps editing, that's pathological.

Phase 4 addresses all three with a **directory-bundle format** — the same pattern used by `.app` packages on macOS, git's `.git/` directory, and SQLite's WAL files.

## Decision

Replace the flat `.elbow` file with a directory bundle:

```
foo.elbow/
  header.json              metadata + schema version
  snapshot.json            full state at last compaction
  log.ndjson               sealed event log (one JSON object per line)
  log.ndjson.partial       currently-being-written log
```

**Writer protocol (append):**

1. `appendText(log.ndjson.partial, serialized_event + "\n")`
2. `fsync(log.ndjson.partial)` — durability marker
3. Every 20 events OR 500ms idle → promote: merge partial into sealed via a `.tmp` + atomic rename; delete partial.
4. On explicit `save()` or every ~1000 events → compact: write `snapshot.json.tmp`, fsync, atomic rename to `snapshot.json`, truncate log.

**Reader protocol (load):**

1. Parse `header.json` (required).
2. Parse `snapshot.json` if present.
3. Parse `log.ndjson` line-by-line (sealed — malformed line is a fatal corruption signal, stop).
4. Parse `log.ndjson.partial` line-by-line; the **last line may be torn** — drop it on parse error, keep everything before. Expose `repairedTornWrite: true` so the caller can surface a toast.

**Legacy migration:** on first open of a flat `.elbow` file, rename to `.elbow.legacy` and seed a fresh bundle with the legacy JSON as the initial snapshot. User data is never overwritten.

## Key design choices

### 1. Directory, not single file with internal format

SQLite + WAL, git + pack files, macOS app bundles all chose directory formats. The alternative (a single archive — tar, zip, custom container) gives one filename but loses:

- Atomic partial writes (you can't rename one file inside an archive).
- OS-level file locks (each bundle file can be watched independently).
- Cheap inspection (`cat log.ndjson` beats custom unpack tools during a forensic investigation).

The cost — a directory looks "weird" in Explorer — is acceptable because Tauri's save dialog will present the `.elbow` bundle as a first-class item via `package.json`-style file type registration when we ship on Windows/macOS.

### 2. NDJSON, not msgpack/protobuf

Binary encodings save ~30-40% of disk but add dependency weight (~15KB for msgpack, 50KB+ for protobuf with codegen). The log is append-only and rarely read. Disk is cheap; bundle size in the 1-10 MB range is unremarkable. Human-readable NDJSON is debuggable with `cat`, supports grep, and lets us inspect production bundles without special tools.

If the corpus grows past 100 MB on real projects, we revisit — but the compaction mechanism already caps bundle growth by collapsing to a snapshot.

### 3. Sequential log, not SQLite / IndexedDB / dexie

The prompt explicitly mentioned `better-sqlite3` as an option. Rejected:

- Adds a native Rust dep to the Tauri bundle (sqlite.dll) that conflicts with any future server-side SQLite we add.
- Single-user CAD doesn't need query capabilities — writes are append-only, reads are "load everything at boot".
- SQLite's WAL is ALREADY this pattern with a database on top. Skipping the database shortcircuits the complexity.
- `better-sqlite3` doesn't run in the browser — we'd need conditional code paths for dev.

A flat NDJSON log is the SIMPLEST pattern that meets all durability requirements. When we genuinely need query (e.g. "show me every edit in this session"), we add SQLite on top of the log in a follow-up phase.

### 4. FsAdapter interface separates concerns

Two adapters:

- `TauriFsAdapter` — production, uses `@tauri-apps/plugin-fs`.
- `MemoryFsAdapter` — tests, dev, non-Tauri preview. Supports `simulateWriteFailure()` for crash fuzz.

`ProjectBundle` takes any `FsAdapter`. A third (e.g. a cloud-sync adapter) could be added later without touching bundle logic.

### 5. Dual-path rollout

AutoSave keeps localStorage writes untouched. When `projectBundle` flag is on, bundle writes happen IN PARALLEL. Rationale: if bundle has a bug, user loses nothing — localStorage still has a recent state. Once bundle has 2-3 months of production validation, we flip the flag default-on and localStorage becomes the fallback.

## Alternatives considered

### A. CRDT log (e.g. Automerge)

- **Pros:** Free merging of concurrent edits (useful if we later add multi-user).
- **Cons:** ~100KB of gzipped runtime, non-trivial performance ceiling on large graphs, the actual merge semantics don't fit plumbing graphs well (operations on edges that reference unresolved nodes).
- **Verdict:** Overkill for single-user CAD. Revisit if multi-user enters the roadmap.

### B. SQLite via `better-sqlite3`

Covered above. Rejected on dependency/complexity grounds.

### C. Event-sourced command log from CommandBus

Tempting — the Phase 1 ring buffer is already an event stream. Connect `commandBus.subscribe` to `bundle.appendEvent`, map commands to project events, done.

This is the **actual plan for v0.2**. For Phase 4 MVP we log events from the existing `EV.PIPE_COMPLETE` pathway directly, keeping the bundle independent of Phase 1 so it can be tested and rolled out in isolation. Once both systems are production-validated, they merge.

### D. Immer patches

Immer emits JSON-patch-shaped diffs on every state change. These could BE the log format. Rejected because the log would become a sequence of patches over the UI state, NOT a sequence of user-intent events. Patches aren't easily human-readable (`{ op: 'replace', path: '/pipes/3/diameter', value: 2 }` vs `{ k: 'pipe.updateDiameter', id: 'p3', diameter: 2 }`). Event semantics survive refactors; patch paths break when we rename store fields.

## Consequences

### Positive

- **Durable.** Survives power cuts at any offset. The 1,000-iteration fuzz test asserts this.
- **Cheap 1-byte edits.** One appended JSON line per mutation — typical 120-180 bytes. Compaction every ~1000 events keeps the bundle bounded.
- **Portable.** A `.elbow/` directory can be zipped and shared. Opening a shared bundle resumes at the exact event horizon, including mid-session edits.
- **Inspectable.** `cat log.ndjson | jq` gives a full session audit.
- **Auto-migrated.** Legacy flat files get migrated on first open, never lost.
- **Testable.** 1,000-iteration crash fuzz runs in ~1 second on CI.

### Negative

- **Directory format surprises some users.** Windows Explorer shows `foo.elbow` as a folder. Mitigated by bundling a shell extension (later) or by using Tauri's file-type registration.
- **Log replay is O(n).** Loading a bundle with 10k events without compaction would take ~5s. Compaction at 1000-event cadence keeps this bounded. The explicit `save()` triggers compaction.
- **One extra flag.** `projectBundle` joins `commandBus`, `godMode`, `sabIpc`, `complianceTrace` — 5 flags total.

### Neutral

- **The MemoryFsAdapter is production code, not just a test harness.** It's used as the fallback when no Tauri runtime exists (e.g. Vite web preview). The flag-off path is localStorage, so the MemoryFsAdapter is really only exercised in unit tests. We keep it in production code anyway so the bundle API has one shape everywhere.

## Rollout

1. **This commit (v0.1.2):** `projectBundle` flag default OFF. When user toggles it in God Mode, writes happen to both localStorage AND the bundle. No user-visible change unless they toggle.
2. **v0.1.3:** add bundle-backed load path on app boot — if `autosave/current.elbow/` exists, offer to restore from it alongside the existing localStorage auto-save.
3. **v0.2.0:** flip flag default-on. localStorage becomes the fallback. Connect CommandBus output to bundle events (currently we log from EV.PIPE_COMPLETE directly).
4. **v0.3.0:** retire the localStorage path. Remove the rotating-slot code.

## Rollback

- **User:** toggle `projectBundle` off in God Mode; future events stop writing to the bundle.
- **Dev:** revert the AutoSave.ts edits; ProjectBundle.ts remains as inert infrastructure.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Round-trip fidelity (append → load) | 100% | **100%** ✓ |
| Compaction preserves snapshot, truncates log | yes | **yes** ✓ |
| Torn-write recovery keeps well-formed prefix | yes | **yes** ✓ |
| 1,000-iteration crash fuzz: 0 unreadable bundles | 0 | **0** ✓ |
| Write amplification for 1-byte edit | ≤ 256 B | **< 256 B** (asserted) ✓ |
| Legacy migration preserves original as `.legacy` | yes | **yes** ✓ |
| New runtime deps | 1 (`@tauri-apps/plugin-fs`) | 1 |
| Tests (all phases) | 36/36 | **36/36** ✓ |

## References

- Source: `src/core/project/ProjectBundle.ts`, `src/core/project/ProjectEvents.ts`, `src/core/project/fs/`
- Test: `src/core/project/__tests__/ProjectBundle.spec.ts`
- Flag: `src/store/featureFlagStore.ts::projectBundle`
- Tauri plugin: `@tauri-apps/plugin-fs` (JS) + `tauri-plugin-fs` (Rust)
- Upstream reading: SQLite WAL documentation; LMDB durability model; Ink & Switch *Local-first software*
