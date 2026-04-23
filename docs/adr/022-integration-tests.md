# ADR 022 — Integration Test Layer (Phase 11.C)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 11.C
- **Depends on:** ADRs 002 (CommandBus), 014 (Logger), 019 (Onboarding), 020 (Bundle), 021 (Bundle v2).

## Context

After Phases 10.A through 11.B we had ~120 unit tests. Every one of them isolated a single module with mocks / fakes at the boundaries. That's the right shape for unit tests, but it left a gap:

- Unit tests would stay green even if someone renamed `EV.PIPE_COMPLETE` to `EV.PIPE_DONE` in events.ts but missed the subscription in pipeStore.ts.
- Unit tests for the bundle module would pass even if `applyBundle` forgot to reset the undo stack (because the test seeded the undo stack directly rather than dispatching commands that would populate it).
- Onboarding unit tests passed without ever firing a real EventBus event — they called `store.next()` directly.

**Integration tests fill that gap.** They exercise the wiring between modules: real EventBus → real store subscriptions → real side effects.

## Decision

Add `src/__tests__/integration/` with:

1. **`harness.ts`** — shared setup: `resetAllStores`, `bootEventWiring`, `emit`, `seedCustomer`. Provides a uniform baseline so every integration spec starts from the same clean state without copy-paste.
2. **One spec per flow, no module-per-spec mapping.** Integration tests are organized by user-visible behavior ("pipe drawing," "bundle roundtrip"), not by the modules they touch.

### Specs in this phase

| File | What it proves |
|------|----------------|
| `pipeFlow.spec.ts` | Emitting `EV.PIPE_COMPLETE` on the real EventBus lands a `CommittedPipe` in the real `pipeStore`. CommandBus flag ON correctly skips the direct-subscription path (no double-add). |
| `bundleRoundtrip.spec.ts` | Seed a scene (pipes + fixtures + walls + measurements), capture → serialize → parse → apply. Content survives bit-for-bit. Active customer is captured, resolved on re-apply when the customer exists locally, falls back gracefully when it doesn't. |
| `onboardingFlow.spec.ts` | Mount `<OnboardingOverlay />`, emit `EV.FIXTURE_PLACED`, verify the store advances to the next step. Dismissed state rejects further advancement. Stepping past the final step flips status to `completed`. |
| `autosaveDirtyFlow.spec.ts` | Register a real CommandHandler, dispatch via real CommandBus, verify autosave's dirty flag flips. `undo`/`redo`-origin commands do NOT flip dirty. `markClean` resets. |

### What integration tests DO NOT cover here

- **Rendering / visual output.** We render components only when we need their `useEffect` subscriptions (OnboardingOverlay). Pixel-level tests are a separate concern.
- **Web Worker solver.** The SimulationBridge worker path runs in prod, but integration tests run against the main-thread fallback.
- **File-system I/O.** `downloadBundle` + `requestBundleUpload` touch the DOM in ways jsdom doesn't reliably emulate; the serialize/parse round-trip is tested instead.

### Running

```
npx vitest run src/__tests__/integration
```

The harness resets every store `beforeEach`, so specs are order-independent within a file. Different files get isolated module registries via Vitest's default pool.

### When to add a new integration test

Add one when:
1. A new wiring layer ships (e.g. "fixtureStore now publishes EV.FIXTURE_PLACED" — without a test, a refactor could silently break onboarding progression).
2. A bug is found that unit tests should have caught but didn't. Write the integration test first, fix the wiring, confirm it's red-green.
3. A Phase ADR adds cross-module behavior (Phase 11.A, 11.B both did — that's why they gained specs here).

Do NOT add an integration test when the behavior is already exhaustively covered by a module's own unit test. Integration tests are about the GLUE.

## Consequences

**Good:**
- Four refactor-resistant assertions now live in CI. Rename an EventBus constant or tweak a subscription shape and the integration suite fails loudly.
- Bundle-roundtrip insurance: if someone adds a new persistable field to pipeStore and forgets to update `captureBundle`, `bundleRoundtrip.spec` will report missing content.
- Customer-linking happy-path + unknown-customer path both verified — a regression in the resolve logic shows up immediately.
- Onboarding advancement is no longer "we hope it works because the store is tested and the overlay is tested separately."

**Accepted costs:**
- Integration tests are slower per assertion than unit tests. The full integration suite runs in <1 s here — acceptable — but a future suite with 50 flows and real worker mocks could push the number up. Budget-aware scaling will come when that's a real problem.
- Test bodies are longer than unit tests because they have to set up legitimate preconditions (seed stores, mount components, etc.). That's inherent to the shape; the trade-off is tests that actually cover real flows.
- Some integration specs depend on React + `@testing-library/react` (already in devDeps from Phase 10.C).

**Non-consequences:**
- No changes to shipped code. This phase is pure tests + ADR.

## Alternatives considered

**Playwright / Cypress end-to-end tests.** Drive the actual browser, click real buttons, wait for real DOM updates. Rejected for this phase because:
- They're the RIGHT tool for UI-level flows (does the `?` keybinding open the help overlay?) but overkill for data-path flows (does PIPE_COMPLETE hit pipeStore?).
- Browser-driver tests are 10-100× slower than jsdom + Vitest.
- We can (and should) add E2E later for UX flows. Not this phase.

**Testing-library + jsdom for everything.** Render the whole `<App />` and assert on the DOM. Rejected because the three.js canvas doesn't render in jsdom, so most of the app ends up mocked anyway — and at that point we're just testing the mocks.

**Separate CI job per spec.** Some codebases split unit and integration into separate runs. Rejected — Vitest runs both in the same process, the overhead is negligible, and a single green "tests pass" status is simpler to reason about.

## Validation

- `Vitest`: `src/__tests__/integration/` — 4 specs, 14 tests total (3 in pipeFlow, 3 in bundleRoundtrip, 3 in onboardingFlow, 3 in autosaveDirtyFlow + 2 in pipeFlow undo stack).
- `tsc --noEmit` clean.
- `vite build` clean.
- No production code touched.
