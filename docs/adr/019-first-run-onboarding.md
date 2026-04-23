# ADR 019 — First-Run Onboarding (Phase 10.F)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 10.F
- **Depends on:** ADR 016 (a11y — focus trap + reduced-motion consumed by the CoachMark).

## Context

A user opening ELBOW GREASE for the first time sees a near-empty 3D canvas with ten HUDs around the edges. The main interaction — place a fixture, draw from it, the solver sizes it — is not discoverable from the UI alone. The ShortcutRegistry + `?` help overlay are the documentation backstop, but you have to know to press `?` first.

Previously we'd considered:
- A static "getting started" PDF (users never read it).
- A one-time modal with a list of tips (dismissed without reading).
- A demo-data seed + a "click around" note (works, but doesn't teach the primitives).

The right answer for this kind of software is a **coach-mark walkthrough**: a small card sequence that highlights real UI and advances as the user performs the action. Five steps max, skippable at any time, replayable on demand.

## Decision

Add `src/core/onboarding/` + `src/ui/onboarding/` + `src/store/onboardingStore.ts`.

### Files

```
src/store/onboardingStore.ts             Zustand store (status, step idx, persist dismissed/completed)
src/store/__tests__/onboardingStore.spec Correctness + content sanity tests
src/core/onboarding/steps.ts             ONBOARDING_STEPS array — 5 entries
src/ui/onboarding/CoachMark.tsx          Floating card + backdrop + target highlight
src/ui/onboarding/OnboardingOverlay.tsx  Orchestrator: first-launch trigger + event bus advancement
```

### State machine

```
status: 'inactive' | 'active' | 'completed' | 'dismissed'
```

- Fresh install → `inactive`. Overlay auto-starts after 800 ms (lets the app paint first).
- `active` + `currentStepIdx` drives the rendered CoachMark.
- Stepping past the last step → `complete()` → persisted → subsequent launches stay inactive.
- User clicks Skip / Esc / backdrop → `dismiss()` → persisted.
- User clicks "Replay tutorial" in the `?` help overlay → `resetPersisted()` then `start()`.

### Step content

| # | id | Trigger | Target |
|---|----|---------|--------|
| 1 | welcome | (Next button) | centered |
| 2 | place-fixture | `EV.FIXTURE_PLACED` | — (text + shortcut) |
| 3 | draw-pipe | `EV.PIPE_COMPLETE` | — (text + shortcut) |
| 4 | see-compliance | (Next button) | top-right |
| 5 | done | (Got it button) | centered |

Steps 2 & 3 auto-advance when the user actually performs the action — the "this is what happens when you do X" feedback loop is the teaching moment. Step 4 has no event trigger because a user's first pipe may not produce a violation (which would be the ideal teaching moment); relying on `CODE_COMPLIANT` / `CODE_VIOLATION` would sometimes never fire on the happy path.

### Event-bus integration

```ts
useEffect(() => {
  if (status !== 'active') return;
  const step = ONBOARDING_STEPS[currentStepIdx];
  if (!step?.advanceOn) return;
  const off = eventBus.on(step.advanceOn, () => {
    const s = useOnboardingStore.getState();
    if (s.status === 'active' && s.currentStepIdx === currentStepIdx) next();
  });
  return off;
}, [status, currentStepIdx, next]);
```

The equality check on `currentStepIdx` inside the handler guards against a handler firing after the user has already manually advanced.

### A11y

- CoachMark card has `role="dialog" aria-modal="true" aria-labelledby`.
- Focus trap via `@core/a11y/useFocusTrap` — Tab/Shift+Tab cycle within the card.
- Primary button auto-focuses on mount; Escape dismisses; close button has `aria-label`.
- Target highlight is a decorative `<div>` with `pointer-events: none` + `aria-hidden` so it doesn't interfere with the real UI's hit testing.

### Persistence

Only `dismissedAt` + `completedAt` (timestamps, nullable) are persisted. The `currentStepIdx` is ephemeral — if the user reloads mid-tutorial they restart from step 0. Mid-tutorial reload is rare enough that the simpler state is worth it.

## Consequences

**Good:**
- New users get a 30-second onboarding that teaches the three primitive actions.
- Advancement keyed to real user actions — you don't finish the walkthrough without having actually placed a fixture and drawn a pipe.
- Replayable — if a user dismisses early and later wants the tour back, the `?` panel offers it.
- Zero cost for returning users — overlay renders `null` unless `status === 'active'`.

**Accepted costs:**
- Another Zustand store (3rd in the project: feature flags, pipe, now onboarding). The separation from the feature flag store is deliberate — "reset all flags" shouldn't replay the tutorial, and mixing developer toggles with user lifecycle pollutes both.
- Step content is hard-coded in English. i18n is out of scope for now; when we localize the app we'll move the copy into a resource file keyed by step id.
- Target-element highlight uses `getBoundingClientRect` polled at 500 ms (plus resize + scroll events). Imperfect for fast-animating UI, but good enough for the stable-position targets we currently highlight (only steps 2+3 have concrete targets and both reference stable HUD regions).

## Alternatives considered

**Shepherd.js / intro.js.** Both solve this with a full feature surface (positioning engines, keyboard routing, event layers). Rejected because:
- Both add 10–30 KB gz for features we don't need.
- Neither integrates with our EventBus out of the box — advancement triggers would still need bespoke glue.
- Our whole app is opinionated HUD primitives + three.js; a heavyweight drop-in library would clash stylistically.

**Single-shot modal on first launch.** Rejected — research on first-run experiences consistently shows users don't read "welcome" walls of text. The whole point is interleaving reading with doing.

**Event-driven suggestions (contextual hints instead of a linear walkthrough).** More sophisticated — e.g. "user is hovering over a fixture for 5s → show a hint about Ctrl+F." Out of scope for this phase, but the `onboardingStore` + step framework is compatible with a future conversion to non-linear "hints on demand."

## Validation

- `Vitest`: `src/store/__tests__/onboardingStore.spec.ts` — 14 tests covering status derivation, start/next/back/dismiss/complete/resetPersisted, plus content sanity on `ONBOARDING_STEPS`.
- `tsc --noEmit` clean.
- `vite build` clean.
- Manual: cleared localStorage, reloaded — welcome card appears after ~800 ms, placed a fixture → step 3 loads, drew a pipe → step 4 loads, clicked through to step 5 → dismissed forever. Opened `?` → clicked "Replay tutorial" → walkthrough starts again from step 1.
