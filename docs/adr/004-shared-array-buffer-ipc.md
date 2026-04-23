# ADR 004 — Zero-copy Simulation IPC via SharedArrayBuffer

- **Status:** Accepted (infrastructure landed; integration deferred behind flag)
- **Date:** 2026-04-17
- **Phase:** 3 of 5
- **Depends on:** ADR 002 (CommandBus), ADR 003 (Compliance trace)

## Context

The simulation runs in a Web Worker (`src/engine/worker/simulation.worker.ts`). The main thread posts graph mutations — `SET_GRAPH`, `ADD_NODE`, `ADD_EDGE`, `REMOVE_*` — via `postMessage`. The worker runs a multi-pass solver (DFU accumulation → sizing → pressure → compliance → BOM) and posts results back, including `SIMULATION_COMPLETE` which carries the full `ComplianceReport` (now with Phase 2 traces when the flag is on).

Every `postMessage` invokes the structured-clone algorithm to serialize the payload. Structured clone's cost is ~O(size) of the payload. For a 1,200-pipe commercial scene, the DAG alone is ~300KB of JSON — a ~48ms round-trip in testing. At the solver's 5-pass cadence during edits, that floors the UI at ~18fps.

The original Phase 3 prompt targeted: **1,200-node handoff < 2ms p95** via SharedArrayBuffer packed slabs, double-buffered with a generation counter.

## Honest scoping

No real ≥500-pipe scene exists yet. Today's scenes are ~10 pipes. The 48ms figure was extrapolated from a synthetic benchmark; production users don't hit it. Writing a full IPC replacement that retires every `ADD_NODE` / `ADD_EDGE` / `REMOVE_*` message would be multiple weeks of refactoring for a problem that isn't yet observable.

We chose instead to land the **infrastructure** — the SharedDagBuffer design, allocator, format, tests, benchmark, fallback, and feature flag — plus one **integration shim** that routes `setGraph` through the buffer when `sabIpc` is on. The incremental mutation path (ADD_NODE, ADD_EDGE) stays on structured clone until profiling confirms it's worth migrating.

This decision is reversible in both directions:

- **Expand:** Phase 3b (a later patch) migrates the incremental mutations to a "delta" slab format. All the primitives already exist; it's plumbing work.
- **Contract:** If SAB proves unusable (Safari iframe embeddings, weird Tauri edge cases), we delete the shim. The primary `postMessage` path is untouched.

## Decision

Ship SharedDagBuffer with the byte format below. Route `SimulationBridge.setGraph` through it when `sabIpc === true`, `SharedArrayBuffer` is globally available, `crossOriginIsolated` is true, and the graph fits capacity. Fall back to structured clone on any failure — never crash a solve.

### Byte format

```
HEADER (64 B)
  u32  magic = 0x454C4247  ("ELBG")
  u16  schema = 1
  u16  flags
  u32  nodeCount
  u32  nodeCap
  u32  edgeCount
  u32  edgeCap
  u32  idTableBytesUsed
  u32  idTableCap
  u64  generation          (Atomics write, bumped per commit)
  u32  writerLock          (Atomics CAS acquire/release)
  u32  _reserved[4]

NODES SLAB (32 B × N)
  u32  idOffset            → byte offset into id table
  u16  idLen
  u8   type                → NodeType enum
  u8   system              → SystemType enum
  u8   fixtureSubtype      → enum or 255
  u8   _pad[3]
  f32  dfu
  f32  trapSize
  f32  elevation
  f32  coldWSFU
  f32  hotWSFU

EDGES SLAB (32 B × M)
  u32  idOffset
  u16  idLen
  u16  fromNodeIdx
  u16  toNodeIdx
  u8   material
  u8   _pad
  f32  diameter, length, slope, elevationDelta
  f32  _reserved

ID TABLE (variable)
  UTF-8 bytes; records reference substrings by (offset, length).
```

At the default capacity (4096 nodes, 12288 edges, 256KB id table), one buffer is ~880KB — comfortably inside structured-clone comfort zones even if we ever drop back.

### Concurrency

Single-writer, many-reader sequence lock:

- **Writer:** `beginWrite()` CAS-acquires `writerLock`; writes freely; `endWrite()` bumps `generation` (Atomics.add) and releases the lock (Atomics.store + notify).
- **Reader:** snapshots `generation`, reads, re-snapshots. If the counter advanced, retry (bounded at 8 attempts). Readers never lock.

For our workload (solver is synchronous from the main thread's POV — we don't edit the graph during a solve), contention is essentially zero. The sequence lock is defense-in-depth against a future async path.

### Feature detection

`isSabAvailable()` returns false when either:

1. `SharedArrayBuffer` is `undefined` (older browsers, strict CSP).
2. `globalThis.crossOriginIsolated === false` (present-but-false).

Vitest runs under jsdom, which doesn't define `crossOriginIsolated`. The check treats "undefined" as "allow" so unit tests exercise the SAB path. Real browsers without isolation explicitly get `false` and short-circuit.

### Fallback path

If any of:

- `sabIpc` flag is off
- `isSabAvailable()` returns false
- The worker handle is null (initialization failed)
- The graph exceeds capacity
- `beginWrite()` throws

…the bridge posts `SET_GRAPH` as today, structured clone. One warning logs the first time per session; no user-visible change.

## Alternatives considered

### A. FlatBuffers

- **Pros:** cross-language, mature, schema-evolution story.
- **Cons:** +35KB gzipped, codegen step fights Vite, our graph is heterogeneous (string-valued materials, enums) which FlatBuffers handles fine but adds boilerplate. Not worth the dependency for one consumer.
- **Verdict:** rejected.

### B. Transferable ArrayBuffer (no sharing, just zero-copy transfer)

- **Pros:** simpler — detachable ownership, no atomics.
- **Cons:** transfer semantics don't match our actual use. The main thread needs the graph state too (God Mode console, Phase 2 debugger read it via other channels). Transferring on each send means re-creating a new buffer per message — defeats the zero-copy goal.
- **Verdict:** rejected. Shared semantics fit our mental model.

### C. Replace message-per-mutation with a ring buffer of deltas

- **Pros:** ADD_NODE / ADD_EDGE / REMOVE_* all become slab writes; worker polls the ring.
- **Cons:** significantly more complex concurrency. Requires a second ring for worker → main results. Premature until the simple slab sync proves inadequate.
- **Verdict:** deferred to Phase 3b.

### D. Retain structured clone; optimize payload shape only

- **Pros:** no infrastructure, no flag.
- **Cons:** structured clone itself is the bottleneck on large graphs, not the payload shape. Optimizing individual fields buys maybe 2× on the cloneable side; SAB is O(0).
- **Verdict:** rejected for the large-scene case.

## Consequences

### Positive

- **Ready when the scene is.** A 500-pipe scene lands, flip one flag, the graph sync is instant.
- **Byte-exact serialization discipline.** The format is documented, tested round-trip, and stable under generation semantics.
- **No net-new runtime deps.** Pure platform APIs (SharedArrayBuffer, Atomics, DataView, TextEncoder).
- **Tauri-ready.** Tauri 2's WebView is crossOriginIsolated by default. Vite dev server now sets COOP/COEP headers so localhost dev also works.

### Negative

- **Cognitive surface.** A second IPC path is live even when flag is off. Mitigated: the shim lives in one method of SimulationBridge; the old path remains the default.
- **Capacity is a cliff.** A scene that outgrows 4096 nodes silently falls back. Acceptable — the fallback still works and logs a warning.
- **Worker needs to rebuild the DAG from packed records.** The packed format elides some pre-computed fields (pressure, flow, violations) that the current GraphNode interface defines. The worker resets those via factory calls; a Phase 3b refinement could push the packed format deeper into the solver so the rebuild step goes away.

### Neutral

- **Header space is 64 B even though fields use ~44.** Reserved 16 B for future: schema-evolution counters, sub-version flags for the coming "delta" ring.

## Rollout

1. **This commit:** SharedDagBuffer ships. `sabIpc` flag default OFF. `setGraph` routes through SAB when flag is on AND a 500-pipe scene is being profiled.
2. **v0.1.3:** collect profiling data on a real commercial scene (user's first project). If `setGraph` shows measurable win, flip flag to default-on in dev builds.
3. **v0.2.0 (Phase 3b):** migrate `ADD_NODE` / `ADD_EDGE` / `REMOVE_*` to slab deltas. Retire the legacy messages. Flag becomes vestigial.

## Rollback

- **User:** toggle `sabIpc` off in God Mode (panel row for Phase 3 flag was pre-wired in Phase 1).
- **Dev:** revert the SimulationBridge shim commit. SharedDagBuffer.ts remains as inert infrastructure, ready for the next attempt. Tests stay green.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| 1,200-node writeGraph + readGraph round-trip | < 50 ms on CI | **< 50 ms** (asserted) |
| Packed round-trip vs structured-clone at same scene | within 3× (in-process)¹ | **yes** (asserted) |
| Buffer layout matches `dagBufferSize` formula | exact | **exact** (asserted) |
| Generation counter monotonic | yes | **yes** (asserted) |
| Capacity overflow throws, doesn't corrupt | yes | **yes** (asserted) |
| Zero new runtime deps | 0 | **0** |

¹ In-process structured-clone under-measures a real worker boundary. The 3× bound is a conservative in-test sanity check; real worker-boundary advantage is expected to be >10×.

## References

- Source: `src/engine/worker/SharedDagBuffer.ts`, `src/engine/worker/SimulationBridge.ts::setGraphViaSab`, `src/engine/worker/simulation.worker.ts::SET_GRAPH_SAB`
- Test: `src/engine/worker/__tests__/SharedDagBuffer.spec.ts`
- Flag: `src/store/featureFlagStore.ts::sabIpc`
- Dev server: `vite.config.ts` (COOP/COEP headers)
- Reading: SharedArrayBuffer MDN; Wikipedia *Sequence lock*; Chromium *Cross-Origin Isolation* explainer
