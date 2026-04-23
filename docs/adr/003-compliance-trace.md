# ADR 003 — Compliance Inference Traces + Debugger Panel

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 2 of 5
- **Depends on:** ADR 002 (Command Bus + correlationId)

## Context

`ComplianceEngine.check(dag)` walks the PlumbingDAG, binds entities to knowledge-graph triples, instantiates PCSP constraints, solves, and emits a `ComplianceReport` containing a flat list of `ComplianceViolation` records. The `ComplianceOverlay3D` component turns each violation into a red/amber/cyan beacon in the 3D scene with a one-line callout like `IPC 704.1 — slope below minimum`.

That's enough to tell the user *something is wrong*. It tells them nothing about **why** the rule fired:

- Which rule, specifically? (The engine composes several constraint families per solve.)
- Which knowledge-graph triples contributed to that rule's instantiation?
- What were the variable values at rejection time?
- Which solver phase (arc-consistency? main solve?) caught it?
- If the user clicks the beacon, they get a 3-line callout and a glyph — no inference chain.

Today, diagnosing a surprise violation means adding `console.log` to the solver, recompiling the worker bundle, reproducing the scene, and reading logs in the DevTools console. Every compliance bug fix is a 10-minute round-trip for a 30-second analysis.

Phase 2 closes this loop.

## Decision

Introduce a **dev-flag-gated `ViolationTrace`** attached to every `ComplianceViolation`, plus a dedicated React panel (`ComplianceDebugger`, keyboard toggle `Ctrl+Shift+D`) that renders the chain as a collapsible tree.

Shape:

```ts
interface ViolationTrace {
  correlationId?: string;          // Phase 1 integration
  appliedConditions: TracedRuleCondition[];
  failedConstraint: TracedConstraint;     // serializable clone (no costFn)
  sourceTriples: Triple[];
  sourceCode: TracedCodeReference;        // with optional IPC deep link
  phase: 'arc-consistency' | 'solve' | 'suggest';
  variableValues: Record<string, number>;
  solvedAt: number;
}
```

**Construction** happens in `ComplianceEngine.buildReport` inside the worker. A solver-level `TRACE_ENABLED` static controls whether traces are built at all. On the main thread, `bootComplianceTraceStore` mirrors the `complianceTrace` feature flag into that static on every flag change.

**Transport** rides the existing `SIM_MSG.SIMULATION_COMPLETE` payload — we already ship the full `ComplianceReport` there. No worker-boundary schema change; structured clone carries the new `trace` field automatically because it contains only plain data (strings, numbers, booleans, arrays of same).

**Storage** is a Zustand store (`complianceTraceStore`) keyed by entity id with a flat severity-sorted mirror. The store replaces-on-solve; no history accumulation (the Phase 1 God Mode console handles historical debugging).

**Rendering** is a 460×max-vh right-side floating panel with a 180px entity list and a tree-of-`<details>` constraint view. No graph libraries — HTML semantics only.

## Key design choices

### 1. Strip `costFn` from the wire representation

`PCSPConstraint.costFn: (values: Map) => number` is a closure over engine-local state. Structured clone rejects functions (`DataCloneError`). Capturing a serializable mirror — `TracedConstraint` — means the UI can display everything about the constraint that matters (name, message, weight, hardness, code ref, variable ids, cost) without the solver's implementation detail. Trace round-trips through `JSON.stringify`; the spec file asserts this.

### 2. Flag-gated construction, not flag-gated rendering

We could build traces always and filter at render time. Rejected: even a 10-pipe scene generates ~40 variables × ~5 constraints = 200 costFn calls per solve; each produces a trace that allocates a new `TracedConstraint`, walks the KG, copies `Triple`s. Steady-state, that's 1-2ms of overhead per solve. Over a drawing session, thousands of solves accumulate GC pressure. Flag-gated at the **source** means zero overhead when the panel is closed.

### 3. Mirror flag into a static, not pass through solve()

`ComplianceEngine.check(dag)` is called from the worker. The worker has no direct access to main-thread Zustand stores. Alternatives considered:

- **Add `traceEnabled` param to `check(dag, opts)`** — changes the solver signature; every caller (including `PropagationSolver`) must pass it through. Signature churn in exchange for explicitness.
- **Subscribe the worker to feature flag changes via a bridge message** — adds a new message type + dispatch on boot. Defensible, but a flag that only changes at human speed doesn't warrant its own channel.
- **Static module-level `TRACE_ENABLED` set by the main thread via an exported function.** Chosen. Simple, testable (the `setComplianceTraceEnabled` export is how the Vitest drives both states), and the mirror happens in `bootComplianceTraceStore.subscribe(...)` so the wiring is one place.

The tradeoff: static is "global mutable state," which purists dislike. Mitigation: the static is internal to `ComplianceEngine.ts`, exposed ONLY through the typed setter + getter, and never read by code outside the engine.

### 4. Populate the store from `SIMULATION_COMPLETE`, not a new message

A new message type would be purer — the flag-off case could emit an empty payload and avoid shipping the full report. Rejected: the full report already crosses the boundary for other consumers (BOM panel, SolvePipelineHUD). Duplicating the channel just for traces is needless parallelism. When traces are absent, the `trace` field is `undefined` and the store populate step is a no-op; cost is one conditional per violation, <10μs.

### 5. Tree-of-`<details>` over a graph library

react-flow (~60KB gzipped) and @xyflow/react (~70KB) both ship layout engines we don't need. The inference chain is a list, not a graph — conditions come from the rule, constraints evaluate, triples are facts. A `<details>`-based tree is 0 KB, accessible for free (native keyboard navigation, ARIA semantics), and matches the visual language of the God Mode console.

## Alternatives considered

### A. Ship the PCSPConstraint object directly

Would be rejected on first message by the structured-clone algorithm. `costFn` is a function; `Map`s inside closures clone fine but the function itself does not. Would require converting `costFn` to a serializable DSL (e.g. a small expression AST). Added complexity for no user benefit — the UI only renders cost, not re-evaluates it.

### B. Build a separate "explain mode" that re-runs solve with instrumentation

Two-mode solver (fast / instrumented) is an old CSP-solver pattern. Rejected: doubles the code to maintain, and our solver is already fast — the overhead of trace construction is the only cost. One code path, one flag.

### C. Log traces to the Phase 1 command bus ring buffer

Tempting — every trace becomes a `compliance.violationTraced` command log entry and the God Mode console can replay them. Rejected for Phase 2: ring buffer is 500 entries; a 200-violation scene refreshed every second would flood the log. Instead, traces live in their own store with their own lifecycle (replace-on-solve). A future addition could dispatch **one** `compliance.reportReceived` command per solve as a summary entry. Deferred to a v0.1.2 follow-up.

## Consequences

### Positive

- **Diagnosability.** Every violation now answers "why did this fire?" in one panel, no round-trips. Estimated debugging speedup: 10× on compliance rule bugs.
- **Deep links.** `up.codes` URLs rendered in the panel footer; one click opens the actual IPC section via `@tauri-apps/plugin-shell`.
- **Copy-paste bug reports.** The `Copy JSON` button serializes a full trace into a paste-ready blob that a dev reviewing a report can replay.
- **Zero production cost.** Flag-off: `trace === undefined` everywhere, store stays empty, panel returns null before touching any DOM.
- **Testable.** Vitest seeds a deliberately-bad DAG (slope below IPC 704.1 minimum) and asserts 14 structural properties of the resulting trace.

### Negative

- **One more flag** in `featureFlagStore`. Low cost — the flag naming is consistent with Phase 1 (`commandBus`, `godMode`, `sabIpc`, `projectBundle`, `complianceTrace`).
- **Mutable static in the solver.** `TRACE_ENABLED` is module-level. Mitigated by the typed setter and the boot-time mirror; no other code reads it.
- **Trace size.** A worst-case 500-violation scene with ~8 triples per violation ships ~4000 triples (~200 KB of JSON) per solve across the worker boundary. When flag is off, zero; when on, this is within the structured-clone comfort zone on the i5 target (< 10ms). If scene scale grows beyond this, Phase 3 (SAB IPC) removes the clone cost entirely.

### Neutral

- **Trace structure is intentionally shallow** — `appliedConditions` is a single-element array in most cases because the engine today hardcodes constraint families rather than matching rule templates. When `IPCRuleParser` becomes a real rule engine (tracked in a follow-up issue), `appliedConditions` will grow and `buildTrace` already accommodates a fuller shape.

## Rollout

- **Immediate:** `complianceTrace` flag default off. `Ctrl+Shift+D` toggles both the flag and the panel. No visible change until the user opens the panel.
- **Invariant:** The solver's TRACE_ENABLED mirrors the flag via `useFeatureFlagStore.subscribe`. A user flipping the flag in God Mode takes effect on the NEXT solve.
- **Graduation:** In v0.2.0, consider promoting `complianceTrace` to default-on in dev builds only (gated off `import.meta.env.DEV`). Production stays off.

## Rollback

- **User-side:** close the panel — flag toggles off, solver stops building traces on next solve, store clears, panel returns null.
- **Dev-side emergency:** revert this commit. No data migration. No schema change at the worker boundary. `ComplianceOverlay3D` continues to work because it reads the pre-existing `CompliancePayload`, unchanged.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Flag off: violations with `trace` | 0 | **0** ✓ (asserted) |
| Flag on: violations with `trace` | 100% | **100%** ✓ (asserted) |
| JSON round-trip preserves trace | yes | **yes** ✓ (asserted) |
| Min-slope violation has expected structure | all 7 fields | **all 7** ✓ (asserted) |
| Bundle delta (Phase 2) | < 10 KB gzipped | ~6 KB (measured) |
| Vitest total | 14/14 | **14/14 in 241ms** |
| TypeScript | 0 errors | **0** |

## References

- Source: `src/engine/compliance/ViolationTrace.ts`, `src/engine/compliance/ComplianceEngine.ts` (buildTrace), `src/store/complianceTraceStore.ts`, `src/ui/debug/ComplianceDebugger.tsx`
- Test: `src/engine/compliance/__tests__/ViolationTrace.spec.ts`
- Flag: `src/store/featureFlagStore.ts::complianceTrace`
- Upstream reading: Kautz & Selman, *Planning as Satisfiability* (1992); Freuder & Wallace, *Partial Constraint Satisfaction* (1992)
