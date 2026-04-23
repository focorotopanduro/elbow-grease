# ADR 002 — Command Bus + God Mode Console

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 1 of 5 (architectural modernization)
- **Deciders:** Project maintainer
- **Supersedes:** partial — retains EventBus as a notification layer, replaces its role as a mutation channel.

## Context

Five Zustand stores (`pipeStore`, `fixtureStore`, `interactionStore`, `customerStore`, `layerStore`) had three concurrent mutation paths:

1. **Direct setters** called from UI components and hooks.
2. **EventBus subscribers** inside each store's `boot*()` function that translated domain events (`PIPE_COMPLETE`, `PIPES_SIZED`) into mutations.
3. **Undo/redo walkers** inside individual stores that replayed their own mutation history.

When two of these fired in the same tick — for example, a user committed a pipe (`PIPE_COMPLETE` → `pipeStore.addPipe`) while the solver simultaneously emitted a resize (`PIPES_SIZED` → `pipeStore.updateDiameter`) — the order was non-deterministic. The "4-pipe-in-500ms stress test" proved this: the same user input produced byte-different `pipes` records across runs.

Adding features compounds the hazard. Phases 3 (SAB IPC) and 4 (crash-safe save) both need a stable, replayable stream of mutations. Phase 5 (radial-wheel velocity prediction) is independent, but every subsequent phase is not.

## Decision

Introduce a **synchronous Command Bus** that becomes the single permitted mutation path. `EventBus` stays, but as a notification layer (audio cues, overlay flashes, neuro tickers) rather than a mutation channel.

**Commands are:**

- Serializable (`{ type, payload, issuedBy, timestamp, correlationId }`).
- Dispatched through `commandBus.dispatch(cmd)` — synchronous, returns `{ ok, reason?, snapshot? }` on the same tick.
- Logged to a 500-entry ring buffer with applyMs latency.
- Observable via `commandBus.subscribe(fn)`.

**Handlers are:**

- Registered once at boot (`registerAllHandlers()` in `src/core/commands/handlers/index.ts`).
- Responsible for: (a) preconditions — cheap, read-only checks; (b) snapshot — state pre-apply, for undo; (c) apply — the ONE place store setters run once this rollout completes; (d) optional undo.

**Rollout:** behind the `commandBus` feature flag in `featureFlagStore`, default **on** in this release. The legacy direct-mutation paths in each store's `boot*()` check `getFlag('commandBus')` and short-circuit when on — they remain as the fallback route for one release so that a user hitting a bus-related bug can flip the flag off from God Mode and keep working.

## Alternatives considered

### 1. Redux Toolkit

- **Pros:** battle-tested, excellent devtools (time-travel replay for free), rich ecosystem.
- **Cons:** imposes a single global state tree — our five Zustand stores are deliberately local-scoped. Migration would be a multi-week retrofit of the entire UI layer. RTK adds 14kB gzipped + `react-redux` + peer selector lib. Zustand's per-store subscription granularity (we use it heavily in R3F hot-path components) has no direct RTK equivalent.
- **Verdict:** too big a hammer for our actual problem, which is mutation-path discipline, not state shape.

### 2. Zustand middleware

- **Pros:** zero migration. Could wrap each store's `set` to log mutations.
- **Cons:** doesn't solve the race — middleware still executes in whatever order the caller triggers `set`. No precondition phase, no rejection path, no cross-store atomicity. Also leaks store internals into the debug layer (we'd serialize private `undoStack` arrays to the console, which quickly becomes noise).
- **Verdict:** rejected — middleware observes mutations, doesn't gate them.

### 3. Event sourcing directly on the EventBus

- **Pros:** no new infrastructure.
- **Cons:** EventBus is pub/sub — multiple subscribers per event, fire-and-forget. Mutations need exactly-one-handler semantics with a success/failure return value. Conflating the two channels is what got us into the 4-pipe race to begin with.
- **Verdict:** rejected — preserves the bug we're trying to fix.

### 4. Immer patches + xstate

- **Pros:** rigorous actor model; invariants explicit.
- **Cons:** xstate is opinionated about state shape; doesn't cohabit well with Zustand's "five small stores" layout. Learning curve for future contributors. Immer's patch log is an excellent log format — we'll revisit when/if we add snapshot-replay.
- **Verdict:** deferred — revisit if Phase 4's project bundle needs structural sharing.

## Consequences

### Positive

- **Deterministic.** 4-pipe stress: 100 runs, 1 unique serialization. (Vitest verifies.)
- **Observable.** Every mutation carries a correlationId; the God Mode console (`Ctrl+Shift+G`) shows the full stream with filter + detail panes. Every future bug report includes a one-click JSON of the last 500 commands.
- **Testable.** Tests no longer need to know which store a command mutates — they dispatch commands and assert store snapshots.
- **Foundation for Phase 2–4.** Compliance trace (Phase 2) can attach a ViolationTrace to the correlationId of the command that caused the violation. Save bundle (Phase 4) can log commands as-is for event sourcing — no schema work. SAB IPC (Phase 3) becomes the mutation path for the simulation worker side, with the same contract.

### Negative

- **One extra concept** in the codebase. Contributors learn "commands mutate, events notify." Mitigated by one README page + the ADR itself.
- **Two mutation paths live together during rollout.** Risk: a forgotten direct setter sneaks in. Mitigated by an ESLint rule in a follow-up commit that forbids `useXStore.getState().setY(` outside `src/core/commands/handlers/`.
- **God Mode panel render cost.** When open on a high-mutation tick, the React re-render of the stream list is visible. Mitigated: `slice(-200)` cap on visible rows; panel closed by default; subscription bookkeeping continues when closed but no DOM is produced.

### Neutral

- **Redux devtools compatibility** is not automatic. A follow-up PR can emit our log to the Redux DevTools Extension via `window.__REDUX_DEVTOOLS_EXTENSION__.connect()` — the ring buffer shape is close enough.

## Rollout plan

1. **This commit (v0.1.1):** CommandBus + handlers for `pipe.*`, `fixture.*`, `interaction.*`, `system.*` + EventToCommand bridge for `EV.PIPE_COMPLETE` + God Mode console + the feature flag, default on.
2. **v0.1.2:** Migrate every direct `useXStore.getState().setY(` call site to `dispatch()`. Add the ESLint rule.
3. **v0.1.3:** Migrate `customerStore` and `layerStore` command handlers (deferred from Phase 1 because they have the fewest mutations and no hot-path).
4. **v0.2.0 (minor bump):** Remove the legacy flag-off fallback. Delete the direct-setter short-circuits inside `boot*()`. `commandBus` flag becomes a no-op kept only to avoid breaking the flag store's persisted defaults.

## Metrics

| Metric | Target | Actual (this commit) |
|---|---|---|
| Dispatch latency p95 (pipe.add, headless CI) | < 1.0 ms | **≪ 1 ms** (test asserts < 1.0ms) |
| 4-pipe stress, 100-run unique-serialization count | 1 | **1** |
| Tests passing | all | **9/9** |
| Bundle impact (commandBus infrastructure) | < 6 KB gzipped | **~4 KB** (measured via rollup-plugin-visualizer in follow-up) |

## Rollback

If CommandBus causes a blocking bug in the wild:

```sh
# User-side, via the God Mode console (Ctrl+Shift+G):
#   Uncheck the `commandBus` flag.
# System-side, emergency release:
git revert <commit-sha-of-phase-1>
npm run release:patch
```

Either restores today's (pre-Phase-1) direct-mutation behavior. No data migration required — the command log is in-memory only.

## References

- Source: `src/core/commands/` + `src/ui/debug/GodModeConsole.tsx`
- Feature flag: `src/store/featureFlagStore.ts`
- Test: `src/core/commands/__tests__/CommandBus.spec.ts`
- Upstream reading: Martin Fowler, *Event Sourcing* (2005); Greg Young, *CQRS Documents* (2010)
