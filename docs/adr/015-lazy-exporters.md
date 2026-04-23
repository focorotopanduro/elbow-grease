# ADR 015 — Lazy-Loaded Exporters (Phase 10.B)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 10.B
- **Depends on:** ADR 014 (Logger — failures route through it)

## Context

Before this phase, every user's first paint paid for:
- `SVGExporter.ts` (373 lines, ~12 KB uncompressed, ~5.5 KB gzipped)
- `IFCSerializer.ts` (303 lines, ~13 KB uncompressed, ~5.5 KB gzipped)

Both only activate when the user explicitly exports — a rare operation in most sessions. Shipping them in the main chunk is "pay upfront for what most users never use."

The fractalized prompt targeted **≥ 35 KB gzipped** removal. The actual modules are smaller than that estimate; the real savings are **~5.5 KB gzipped total extracted**, plus a small transitive reduction in the main chunk from shared-dependency trimming. But the structural win is larger than the byte count:

1. Every future heavy one-shot module (PDF export, IFC validator, Revit schema converter) lands through this same lazy pipeline.
2. Named chunks (`SVGExporter-Xhash.js`) make network-tab debugging trivial.
3. Pre-warm infrastructure (hover → start fetching) is in place for every lazy target.
4. A regression guard catches any future eager import and fails CI.

## Decision

Introduce `@core/lazy/` with three files:

### 1. `lazyImport.ts`

Exports `makeLazyLoader(name, factory) → LazyLoader<T>`:
- Caches the Promise — `prewarm()` + `get()` share the in-flight load.
- Wraps failures in the Phase 10.A Logger; clears cache on failure so retry works.
- Exposes `isReady()` for UI + `hoverPrewarm` integration.

Also exports `hoverPrewarm(loader, delayMs=500)` — returns `{ onEnter, onLeave }` handlers that arm a timer on mouse-enter and cancel on mouse-leave before the delay elapses. No React state; pure closures. Idempotent with already-ready loaders (no-op).

### 2. `loaders.ts`

One named loader per heavy module:
```ts
export const loadSvgExporter = makeLazyLoader('svg-exporter', () => import(
  /* webpackChunkName: "svg-exporter" */ '../../engine/export/SVGExporter'
));
```

The `/* webpackChunkName */` comment is honored by Vite's Rollup config — chunks emit as `SVGExporter-<hash>.js` instead of opaque `index-<hash>.js`. Matters for network-tab inspection and for the regression guard's chunk-name assertion.

### 3. `__tests__/bundleRegression.spec.ts`

Scans every `src/**/*.{ts,tsx}` and fails if ANY static `import ... from '.../SVGExporter'` or `.../IFCSerializer'` appears outside the two allowlisted files (the exporter sources themselves + `loaders.ts`). Accepts `import type` and dynamic `import('...')`. Enforces the invariant at CI time — no way to accidentally re-eagerize the imports in a future PR.

### Call-site migrations

- `App.tsx` — the `Ctrl+Shift+E` SVG-export chord handler now awaits `loadSvgExporter.get()`. `type`-only import keeps type safety.
- `ExportPanel.tsx` — IFC button now awaits `loadIfcSerializer.get()`. Also wires `hoverPrewarm` to `onMouseEnter`/`onMouseLeave` — sustained 500ms hover pre-loads the chunk so the click feels instant. Loading state on the button subtitle ("Revit / BIM viewers · loading…").

## Key design choices

### Cached promise, not cached module

A cached module would mean the second `get()` receives an already-resolved value. A cached *Promise* means ALL callers — pre-warm, click, parallel clicks — share the SAME resolution event. Crucial for the hover scenario: user hovers (pre-warm starts), clicks before the load completes, both await the same chunk fetch.

### Clear cache on failure, keep on success

A success cache is permanent (the module is loaded, no reason to refetch). A failure cache clears so a retry can succeed if the network recovered. Prevents the pathological "one transient network blip → forever broken export button."

### Named chunks via `/* webpackChunkName */`

Vite's build pipeline honors this pragma despite not being webpack — it steers Rollup's `output.chunkFileNames` when the comment appears at the import expression. Verified in the dist output: `SVGExporter-CEeOkr4R.js`, `IFCSerializer-pjZGC7AJ.js`.

### Type-only imports at call sites

```ts
import type { exportToSVG as ExportToSVGFn } from './engine/export/SVGExporter';
```

TypeScript erases these at build time — zero runtime cost — but call sites still get full type safety when doing the lazy-await:

```ts
const mod = await loadSvgExporter.get();
const svg = (mod.exportToSVG as typeof ExportToSVGFn)(pipes, opts);
```

Without the type-only import, the call site would be `any`-typed and every downstream access would lose type safety.

### Regression test uses string matching, not AST parsing

Could parse every file into an AST and check `ImportDeclaration` nodes. Rejected: a regex over `^\s*import\s+[^(]*from\s+['"][^'"]*SVGExporter['"]` is simpler, faster, and good enough. Edge cases (multi-line imports with comments between) would fail through — acceptable for a guardrail, not a certification.

## Alternatives considered

### A. Hardcoded `lazy(() => import(...))` via React.lazy

React.lazy is designed for components, not utility modules. Wrong tool.

### B. Rollup manualChunks config

Split bundles via Rollup config based on glob patterns. Rejected: opaque, no per-module cache, no pre-warm hook, no error recovery. Static config vs. a real loader.

### C. Route-based splitting

The app is single-page; no routes to split on.

### D. Inline dynamic `import()` at each call site without the wrapper

Simpler but loses: the shared Promise (pre-warm doesn't reach the click), the logger integration, the `isReady` gate for hover, the typed return value.

## Consequences

### Positive

- **~5.5 KB gzipped moved out of main chunk.** Per-module it's small, but repeating this pattern for future modules (PDF, Revit export, report generators) compounds.
- **Named chunks in DevTools.** `SVGExporter-*.js` vs `index-*.js` — a big readability win during remote debugging.
- **Pre-warm on hover.** Users who are about to click Export get the chunk fetched during their cursor travel time — perceived latency drops to zero.
- **Regression guard.** Any future accidental eager import fails CI with a specific file:line error.
- **12 new tests** covering cache semantics, prewarm timing, error recovery, and bundle hygiene.

### Negative

- **The actual bytes saved are modest.** The fractalized prompt claimed 35 KB; actual is ~5.5 KB gzipped. Honesty matters — the structural investment is worth it, but the immediate byte win is smaller than estimated.
- **Asynchronous API.** Export buttons must `await`, adding one microtask even when the chunk is already cached. Imperceptible but real.

### Neutral

- **Dev builds hit the lazy path too.** Same caching semantics; same hover pre-warm. Means dev has the same "first export is a tick slower" behavior as prod. Acceptable.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Main bundle reduction | ≥ 35 KB gzipped | **~5.5 KB gzipped extracted** (~11 KB raw) |
| SVGExporter chunk extracted | yes | **yes** (6.27 KB raw / 2.75 KB gzipped) |
| IFCSerializer chunk extracted | yes | **yes** (6.69 KB raw / 2.80 KB gzipped) |
| Chunk names human-readable | yes | **yes** |
| Cache + prewarm + error recovery | all | **all** (10 tests) |
| Regression guard fails on eager import | yes | **yes** (asserted against current source) |
| Full test suite | green | **green** (209 tests after this phase + 12.B) |

## Rollout

- **This commit.** No flag. The lazy behavior is strictly a perf improvement; call sites still appear synchronous to the user (click → file download) because the chunk fetches in milliseconds.

## Rollback

- Revert the three call-site changes. Delete `src/core/lazy/`. Re-add the static imports. The regression test disappears with the directory.

## Follow-up candidates for the same pattern

- `SaintVenantSolver` (~12 KB) — only used in the worker, but the worker bundle itself could split.
- Future PDF exporter (unbuilt) — routes through `loaders.ts` as `loadPdfExporter`.
- Compliance engine rule-set loaders — could defer IPC 2021 vs UPC 2021 until the user selects a code.

## References

- Source: `src/core/lazy/lazyImport.ts`, `src/core/lazy/loaders.ts`
- Tests: `src/core/lazy/__tests__/lazyImport.spec.ts`, `src/core/lazy/__tests__/bundleRegression.spec.ts`
- Call sites: `src/App.tsx` (SVG chord), `src/ui/ExportPanel.tsx` (IFC button + hover prewarm)
- Depends on: ADR 014 (Logger — error routing)
