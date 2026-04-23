# ADR 072 — Autosave Idle Deferral + One-Pass Capture (Phase 14.AD.1)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AD.1
- **Depends on:** Phase 11.A autosave; Bundle module.

## Context

The autosave timer fires every 10 seconds (`AUTOSAVE_INTERVAL_MS`).
On a dirty tick it ran:

```ts
const bundle = captureBundle();   // deep-clones via structuredClone
writeToStorage(bundle);            // serializes via JSON.stringify
```

Two inefficiencies compounded:

1. **Redundant structural copy.** `captureBundle` ran
   `structuredClone` on every pipe, fixture, wall, and measurement
   to decouple the in-memory Bundle from live store state. Then
   `writeToStorage` immediately ran `JSON.stringify` on it — which
   is itself a structural deep-copy into a string. Two full
   serialization passes where one would do.
2. **Synchronous main-thread work.** The whole capture + write
   ran inline in the `setInterval` callback. On a scene with 100+
   pipes and 50+ fixtures, benchmarks show 15-65ms of blocking
   serialization. If the user was mid-drag when the timer fired,
   that's a 1-4 frame stutter right on top of their interaction.

This was a medium-severity latent hotspot that the
`fixtureGraph`-flipped state (14.AC.9) exacerbated — fixtures are
now live in the worker graph and produce more dirty ticks per
session.

## Decision

Two targeted fixes, both flag-free and backwards-compatible.

### 1. `captureBundleSerialized(opts?) → string`

New function in `Bundle.ts`. Same output shape as
`serializeBundle(captureBundle(opts))` but skips the intermediate
`structuredClone`. JSON.stringify already produces a fully-
decoupled string — the deep-copy is only necessary for callers
that retain the Bundle object in memory and keep editing the
stores. Anyone who goes straight from capture to
`localStorage.setItem` doesn't need it.

```ts
// Old autosave path (redundant):
const bundle = captureBundle();              // structuredClone(...)
localStorage.setItem(key, serializeBundle(bundle));  // JSON.stringify(...)

// New path:
localStorage.setItem(key, captureBundleSerialized());  // one pass
```

Existing `captureBundle` stays — it's still called by `Ctrl+S` +
tests that hold the Bundle for assertions. Only autosave + the
beforeunload safety net switch to the fast path.

### 2. `requestIdleCallback` deferral for the 10s tick

The timer callback no longer captures + writes synchronously.
Instead it schedules an idle callback:

```ts
setInterval(() => {
  if (!dirty) return;
  scheduleIdleCapture();        // ← defers capture + write
}, AUTOSAVE_INTERVAL_MS);

function scheduleIdleCapture() {
  if (idleHandle !== null) return;   // already pending — don't pile up
  idleHandle = requestIdle(() => {
    idleHandle = null;
    if (!dirty) return;
    const json = captureBundleSerialized();
    writeStringToStorage(json);
    lastSavedAt = Date.now();
    dirty = false;
  });
}
```

`requestIdle` is a wrapper over `requestIdleCallback` with a
`setTimeout(0)` fallback for Safari + non-browser environments.
Deadline is 1000ms — if the browser never reports idle (pegged-
CPU session), we fire anyway.

**beforeunload stays synchronous.** The browser is about to kill
the tab; it won't wait for an idle callback. The beforeunload
handler cancels any pending idle, calls `captureBundleSerialized`
inline, writes, and exits. Frame-blocking cost is acceptable
there because there's no next frame.

### 3. Overlap guard

`idleHandle` acts as a lock — if the autosave timer fires a
second time while the previous idle is still pending, the second
`scheduleIdleCapture` early-returns. Prevents pileup on machines
where idle detection is slow.

## What this saves

For a 100-pipe / 50-fixture scene, rough profile (before → after):

| Phase | Before | After |
|---|---|---|
| structuredClone | ~10-25 ms | 0 ms (removed) |
| JSON.stringify | ~5-15 ms | ~5-15 ms (same) |
| localStorage.setItem | ~5-30 ms | ~5-30 ms (same) |
| **Total on tick** | **20-70 ms** | **10-45 ms** |
| **Timing** | synchronous in interval | deferred to idle |

Two wins:

- **~50% less work per tick.** The structuredClone pass is gone.
- **Zero frame budget impact during active interaction.** The
  remaining ~10-45ms runs when the browser reports idle, not
  when the interval timer fires.

## Trade-offs

- **Idle deferral pushes the write 0-1000ms later than the timer
  tick.** If the tab crashes in that window, a dirty change that
  was about to be autosaved is lost. Mitigation: beforeunload
  still flushes synchronously, so ordinary navigation is safe.
  An actual crash (OOM, force-close) during a burst of edits is
  the only failure mode, and it was already a failure mode
  pre-AD.1 (the dirty change between the 10s window is
  always-vulnerable). Net no regression.
- **Tests must fake both `setTimeout` and `setInterval`.** The
  spec strips `window.requestIdleCallback` to force the fallback
  path deterministically. Real-browser runtime still uses rIC
  when available.
- **No configurable deadline.** 1000ms is a one-constant policy.
  If real-world feedback suggests tuning, it's a one-line change.
- **`captureBundleSerialized` duplicates some structure with
  `captureBundle`.** The two functions share the store reads but
  diverge on the copy semantics. Kept separate rather than
  parameterizing because the signature difference
  (`→ Bundle` vs `→ string`) is clearer as two entry points than
  a union return.

## Verification

- `npx vitest run` — 1552 tests pass (1543 prior + 9 new).
- `npx tsc -b --noEmit` — clean.
- Existing autosave tests (`autosaveDirtyFlow.spec.ts`)
  unchanged and still pass — dirty flag semantics and
  `markClean` behavior preserved.

## Files

- `src/core/bundle/Bundle.ts` — new `captureBundleSerialized`
  export.
- `src/core/bundle/autosave.ts` — `scheduleIdleCapture` +
  `requestIdle` + `cancelIdle` helpers, timer callback switched
  to deferred path, beforeunload switched to serialized fast
  path, dead `writeToStorage(bundle)` removed.
- `src/core/bundle/__tests__/autosaveIdleDeferral.spec.ts` —
  9 tests.
- `docs/adr/072-autosave-idle-deferral.md` — this document.

## What's queued

- **14.AD.2** — `FittingMeshes.tsx` overbroad dependency array.
  `groups` useMemo keyed on `[pipes, fittingsVisible, ...]` re-
  runs `buildGroups()` on any pipe-store mutation including
  unrelated selection changes. Same per-pipe identity cache
  pattern that AC.2 shipped for `PipeInstanceRenderer`.
- **14.AD.3** — `FixtureModels.tsx` inline geometry churn.
  20+ fixture types rebuild 10+ THREE primitives per render.
  Move geometry creation to module-level cached factories
  keyed on subtype + parametric inputs.
