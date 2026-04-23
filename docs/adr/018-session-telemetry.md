# ADR 018 — Local Session Telemetry (Phase 10.E)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 10.E
- **Depends on:** ADR 014 (Logger — warn/error/fatal counts), ADR 017 (PerfStats — FPS + worker latency source).

## Context

After Phase 10.D the app has three real-time signals worth remembering:

1. **`PerfStats.getSample()`** — FPS, frame time, worker round-trip.
2. **`commandBus.subscribe()`** — every dispatched command + its rejection state.
3. **`logger.subscribe()`** — every log entry with level.

The HUD shows the first in real time. The God Mode console tails the second and third. None of them *persist*. A user filing a bug ("it got sluggish around 4 PM while I was drawing the second floor") has no history to attach.

The obvious next step would be "phone home." It's not what we want. This project is a desktop CAD tool for a plumbing contractor — the scene contains customer addresses, fixture layouts that might be proprietary to a client's build, and pricing that definitely is. Any automatic transmission of anything is a privacy mistake.

What we actually need is **local-only telemetry with a voluntary export path**.

## Decision

Add `src/core/telemetry/SessionTelemetry.ts` — a bucket aggregator that subscribes to the three signals above, rolls every minute, and exposes JSON / JSONL download through the God Mode console.

### Shape

```
TelemetrySession
 ├─ sessionId        (UUID, per-session)
 ├─ sessionStartTs   (wall clock)
 ├─ appVersion       (from Vite's VITE_APP_VERSION env)
 ├─ userAgent        (for platform triage)
 └─ buckets: TelemetryBucket[]      // ≤ 60 = 1 hour
     ├─ bucketStartTs, durationMs
     ├─ fps             { mean, p50, p95, min, samples }
     ├─ frameTimeMs     { mean, p95, max }
     ├─ workerLatencyMs { mean, p95, count }
     ├─ commandCount, commandRejections
     ├─ commandsByType  (top 20 only)
     ├─ warnings, errors, fatals
     └─ pipeCount, fixtureCount     // scene snapshot at bucket close
```

### Flow

```
featureFlagStore.telemetryEnabled ───► bootSessionTelemetry()
                                            │
                                            ▼
                    SessionTelemetry.start({ sceneCountReader })
                       │              │               │
         commandBus.   logger.    setInterval(         setInterval(
         subscribe     subscribe   sampleFromPerf,     rolloverBucket,
                                   1000ms)             60000ms)
                                            │
                                            ▼
                        bucket = aggregate(reservoirs)
                        session.buckets.push(bucket)
                        persist(session)   ───► localStorage
```

When the flag flips off, `stop()` unsubscribes and cancels timers — the session stays in memory (and in localStorage) so the user can still export after disabling collection.

### Design choices

**1. Opt-in at runtime, not build-time.**
A compile-time flag would mean "telemetry build" vs "telemetry-free build" — operationally confusing. The runtime flag lets a user toggle it during a debugging session, reproduce a bug with collection on, then export.

**2. Bounded memory.** 60 buckets × ≤ 2 KB each ≈ 120 KB peak. `top 20` command-type cap keeps `commandsByType` finite even on pathologically chatty sessions. localStorage persistence is bounded by the usual ~5 MB quota, and we write < 200 KB worst-case.

**3. Empty buckets are dropped.** A minute with zero FPS samples, zero commands, zero warnings means the user stepped away — no point recording a row of zeros. This keeps idle-app sessions from filling the hour-window with empty buckets the interesting moments would otherwise roll off.

**4. Resume on reload, discard when stale.** On boot we try to resume the prior session from localStorage if < 4 h old AND same `appVersion`. A mismatched version would mean bucket numbers compare against a different codebase — misleading. Older-than-4h is "a different workday" — discarded.

**5. Dedup worker-latency reads.** `PerfStats` holds the *most recent* round-trip forever. Polling at 1 Hz without dedup would count one solve 60 times during an idle minute. We track `lastWorkerLatencySeen` and only record when the value changes.

**6. Scene counts injected, not imported.** SessionTelemetry stays free of cross-module imports to the UI stores (`pipeStore`, `fixtureStore`). `boot.ts` wires a `sceneCountReader` closure that reaches into them. Tests can pass a stub and avoid having to stand up the whole store tree.

### UI

God Mode console → Controls tab → new **Telemetry** section:

- Status line: `● collecting · 17 buckets · a1b2c3d4` / `○ paused` / `○ disabled`
- Buttons: **Export JSON** / **Export JSONL** / **Copy** / **Clear**
- Disclaimer: *"Exports contain performance + command counts only. No pipe geometry, fixture parameters, or customer data. No automatic network submission."*

Export flushes the in-progress bucket first so the download includes the current minute.

## Consequences

**Good:**
- Users can file concrete bug reports ("FPS p95 dropped from 58 to 22 starting bucket 14 — attached") without having to tail a console.
- A developer reproducing a regression has ground truth to compare against.
- The infrastructure is in place if we later choose to ship an opt-in network uploader — we already have the schema, the aggregation, and the UI toggle.

**Accepted costs:**
- localStorage write once per minute (~2–5 KB payload). Negligible on desktop SSDs; within quota budget.
- A module-level singleton (like PerfStats). Tests reset() between cases. The singleton shape is deliberate — the collector must be globally reachable from subscribe callbacks + useEffects without prop drilling.
- `commandsByType` is bounded to top 20 — a command type that's active rarely but in small counts can be dropped. Acceptable; the dominant types are the ones we care about for "what was the user doing in this bucket."

**Non-consequences:**
- No network exfiltration path exists. Grep: no `fetch`, `XMLHttpRequest`, or `navigator.sendBeacon` calls in `src/core/telemetry/`. Future work that adds one should be an explicit ADR with a user-consent UI.

## Alternatives considered

**PostHog / Sentry SDK.** Either would do most of this with zero custom code. Rejected because:
- Both phone home by default, which is a privacy non-starter here.
- Both impose a runtime dep (~15–50 KB gz).
- Our signals are internal (PerfStats, commandBus) — a generic SDK would need glue anyway.

**Log-file-only (no aggregation).** Just tail the existing logger's ring buffer to a JSONL. Rejected:
- Logger ring is capped at 1000 entries; a chatty session overflows quickly.
- No structured aggregates — "what was FPS p95 during bucket 14?" requires custom post-processing every time.

**IndexedDB instead of localStorage.** Would allow more history. Rejected for scope — 1 hour of per-minute buckets is sufficient for debug sessions; longer retention is a future concern.

## Validation

- `Vitest`: `src/core/telemetry/__tests__/SessionTelemetry.spec.ts` — covers start/stop idempotence, resume vs. discard, PerfSample de-dup, bucket rollover math, empty-bucket suppression, retention cap, export formats, command subscription counts.
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual: toggle `telemetryEnabled` in God Mode, draw a few pipes, flushBucket, Export JSON, verify bucket contains sensible FPS + command counts.
