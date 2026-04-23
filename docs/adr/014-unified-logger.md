# ADR 014 — Unified Logger (Phase 10.A)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 10.A
- **Depends on:** ADR 002 (CommandBus — parallel log pattern), ADR 012 (God Mode console)

## Context

14 scattered `console.warn` / `console.error` sites across the codebase. No way to:
- Filter by level (all-or-nothing).
- Attribute to subsystem (each call prepended its own `[SubsystemName]` tag by convention).
- Inspect history (the browser's console clear wipes them).
- Subscribe programmatically (for telemetry, for test assertions).
- Correlate with the CommandBus chain.

Mature apps have an observability pipeline. Phase 10.A installs one.

## Decision

A single `Logger` module at `src/core/logger/Logger.ts` with:

### 1. Factory-based API

```ts
import { logger } from '@core/logger/Logger';
const log = logger('SimBridge');
log.warn('slow solve', { ms: 420 });
log.error('worker crashed', err);
```

Six levels: `trace` < `debug` < `info` < `warn` < `error` < `fatal`. Source (first factory argument) stamps every entry automatically — no string prefixing by hand at call sites.

### 2. Lazy evaluation for hot paths

```ts
log.trace(() => `heavy dump: ${JSON.stringify(bigObject)}`);
```

Below threshold, the function is NOT invoked. Asserted in the test suite.

### 3. 1000-entry ring buffer + subscribers

Separate from the CommandBus log (which holds mutations). Logs are observations. Every entry: `{ level, source, timestamp, message, args, correlationId? }`.

`subscribe(fn)` returns an unsubscribe. Used by:
- God Mode console's new **"Logs"** tab (live append).
- Future telemetry subscriber (Phase 10.D) — no rewiring needed.

### 4. Level filtering (runtime + build-time)

Build-time: `import.meta.env.DEV` gates the default — `info` in dev, `warn` in prod.

Runtime: `useFeatureFlagStore.logLevel` — user can change live in the God Mode Logs tab.

### 5. `withCorrelation(id, fn)` context threading

Run a block with a correlation id attached to every log emitted inside it. Restores on exit (even on throw). Nestable. Used by the CommandBus dispatch wrapper in a follow-up to auto-link logs emitted inside a handler's `apply()` with that command's correlationId.

### 6. God Mode "Logs" tab

Tab strip at the top of the console (Commands / Logs). Logs tab has its own filters: level selector, source input (with datalist of seen sources), text filter. Independent state from Commands tab. Every log entry shown with color-coded level + source + message + truncated correlationId.

### Site migration

14 sites audited and reclassified by INTENT, not blanket-replaced:

| Site | Old | New | Rationale |
|---|---|---|---|
| `App::spatialAudio boot` | `console.warn` | `log.warn` | actual warning |
| `CommandBus::overwrite handler` | `console.warn` | `log.debug` | only happens in tests |
| `AutoSave::5 sites` | `console.warn` | `log.warn` | user-visible persistence concern |
| `XR::session fail` | `console.warn` | `log.info` | expected on non-XR devices |
| `SimBridge::worker error` | `console.error` | `log.error` | real bug |
| `SimBridge::worker unavailable` | `console.warn` | `log.info` | expected fallback |
| `SimBridge::SAB failed` | `console.warn` | `log.info` | expected fallback |
| `SimBridge::slow solve` | `console.warn` | `log.warn` | perf regression signal |
| `UpdateManager::check failed` | `console.error` | `log.info` | network/offline is OK |
| `UpdateManager::install failed` | `console.error` | `log.error` | user initiated + broke |
| `ErrorBoundary::catch` | `console.error` | `log.fatal` | runtime crash |
| `MeasureToolbar::upload fail` | `console.error` | `log.error` | user-visible |
| `main.tsx::entry crash` | `console.error` | `console.error` (kept) | pre-logger-boot fallback |

## Key design choices

### Separate ring from CommandBus log

CommandBus holds MUTATIONS (state changes to store). Logger holds OBSERVATIONS (things that happened, weren't store changes). Conflating them would lose the type signal and make replay/undo ambiguous. Two rings, two tabs, one mental model.

### Factory captures source at call site

```ts
const log = logger('Foo');  // once per module
log.warn(...)                // every call is tagged
```

Alternative: `logger.warn('Foo', ...)` at every call. Rejected — repetitive, typo-prone, and doesn't localize "who owns this subsystem" to one line.

### Lazy eval variant for hot paths

`log.trace(() => expensive())` is the bypass-serialization mechanism. Without it, every in-hot-path log pays its full formatting cost even when filtered. With it, below-threshold logs are genuinely zero-cost (asserted in tests).

### Keep `main.tsx` on raw `console.error`

Top-level entry-point ErrorBoundary catches a crash BEFORE the rest of the app (including the Logger) has booted. Routing through the logger creates a "what if the logger itself is the crash?" risk. The ONE `console.error` there is intentional, with `eslint-disable-next-line` annotation.

## Consequences

### Positive

- **One pipeline for observations.** Every warn/error now lands in the ring buffer, visible in God Mode, subscribable.
- **Correlation linkage ready.** `withCorrelation` available; CommandBus integration can thread correlationIds automatically in a follow-up.
- **Telemetry-ready.** Phase 10.D subscribes via `Logger.subscribe` — no extra wiring.
- **Zero hot-path cost for disabled logs.** Lazy-eval variant guaranteed.
- **Classification discipline.** Each of the 14 sites reviewed for INTENT, not blanket-replaced. Some downgraded (XR → info, UpdateManager check → info), some upgraded (ErrorBoundary → fatal).
- **18 new tests** pinning all six fractal dimensions.

### Negative

- **Two logs in the UI** (Commands + Logs) — minor cognitive overhead. Mitigated by the tab-strip UI making the distinction obvious.
- **One module-level static state** (`activeThreshold`, `activeCorrelationId`). Tests must reset via `__resetLoggerForTests`. Acceptable — standard pattern for singleton observability.

### Neutral

- **The logger's own console mirror** in dev is still a `console.*` call site. Intentional — it's THE boundary. Annotated with `eslint-disable-next-line`.

## Rollout

- **This commit:** logger boots in `bootLogger()` after `bootFeedbackLoop`. 14 sites migrated. God Mode Logs tab live.
- **Follow-up:** auto-thread correlationIds from CommandBus dispatch into `withCorrelation`. Add ESLint `no-console` rule with the two intentional exemptions annotated. Phase 10.D telemetry subscribes to the logger.

## Rollback

- Revert this commit. The 14 sites go back to `console.*`. God Mode loses its Logs tab. Logger files remain as inert modules (no consumers after revert). No data-format break.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| console.warn/error sites in src/ (excluding main.tsx fallback + logger mirror) | 0 | **0** ✓ |
| Logger tests | 10+ | **18** ✓ |
| Ring buffer capacity | 1000 | 1000 ✓ |
| Lazy-eval callback NOT invoked below threshold | verified | **verified** (spy test) ✓ |
| God Mode has Logs tab | yes | **yes** ✓ |
| TypeScript errors | 0 | **0** ✓ |
| New runtime deps | 0 | **0** ✓ |

## References

- Source: `src/core/logger/Logger.ts`, `src/core/logger/boot.ts`
- Tests: `src/core/logger/__tests__/Logger.spec.ts`
- Flag: `src/store/featureFlagStore.ts::logLevel`
- UI: `src/ui/debug/GodModeConsole.tsx::LogsView`
- Migrated sites: App.tsx, CommandBus.ts, AutoSave.ts (5×), XRSessionManager.ts, SimulationBridge.ts (4×), UpdateManager.tsx (2×), MeasureToolbar.tsx, ErrorBoundary.tsx
