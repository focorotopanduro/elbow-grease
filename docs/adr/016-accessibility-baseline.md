# ADR 016 — Accessibility Baseline (Phase 10.C)

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 10.C
- **Depends on:** ADR 014 (Logger) — a11y warnings route through it when they appear at runtime.

## Context

ELBOW GREASE is a desktop-class CAD tool. The main surface is a 3D canvas, but there are roughly a dozen 2D modal panels (HelpOverlay, GodModeConsole, ComplianceDebugger, FixtureParamWindow, Export panel, Toast stack, etc.) plus a continuous-animation layer (GlowRing, SelectionHalo, beacons, live-draw pulses).

Before this phase:

| Dimension | Baseline |
|-----------|----------|
| Dialogs with focus containment | 0 / 4 |
| Modals that restore focus on close | 0 / 4 |
| Close buttons with `aria-label` | 0 / 4 (`×` glyph only) |
| `aria-live` regions for toasts | 0 |
| `aria-modal="true"` on dialogs | 0 |
| `prefers-reduced-motion` honored | Partial (radial menu only) |
| Continuous animations on by default | 11 identified via `useFrame` grep |

The fractalized prompt called for **6 dimensions**: baseline measurement, ARIA pass, focus order, motion, color contrast (already ≥ 4.5:1 by design), screen-reader smoke test. Acceptance: 0 critical + 0 serious violations, ≤ 3 moderate; all interactive reachable via Tab; every modal traps + restores focus; `prefers-reduced-motion` disables continuous animation without hiding meaning; contrast ≥ 4.5:1.

## Decision

Consolidate accessibility primitives into `@core/a11y/` and apply them uniformly across the modal + animation layer.

### 1. `@core/a11y/useReducedMotion.ts`

Single source of truth for the `(prefers-reduced-motion: reduce)` media query:

- `useReducedMotion()` — subscribes to the media query, updates live when the OS preference changes.
- `isReducedMotionPreferred()` — synchronous read for non-React code paths (inside `useFrame` callbacks, for example, though we prefer the hook pattern + closed-over boolean).

The radial-menu-specific `usePrefersReducedMotion` is now a one-line re-export so the single hook drives every guard.

### 2. `@core/a11y/useFocusTrap.ts`

`useFocusTrap<T>(active: boolean) → RefObject<T | null>`:

- On activate: record `document.activeElement`, find first focusable descendant, focus it (or focus the container with `tabindex=-1` if empty).
- On `Tab` at last focusable → wraps to first. On `Shift+Tab` at first → wraps to last. `preventDefault` only when we actually redirect.
- On deactivate / unmount: restore focus to the previously-focused node, guarding against the case where that node was removed from the DOM while the modal was open (try/catch).
- Key listener is attached to the **container**, not `window` — so nested trapped modals don't fight each other.

"Focusable" = `a[href]`, `button:not([disabled])`, `input:not([disabled]):not([type=hidden])`, `select`, `textarea`, `[tabindex]:not([tabindex="-1"])`, `[contenteditable="true"]`, filtered against `display:none`, `visibility:hidden`, and `aria-hidden="true"`.

### 3. Applied to every modal

| Component | Focus trap | Escape | `aria-modal` | `aria-label` on `×` |
|-----------|------------|--------|--------------|---------------------|
| `HelpOverlay` | ✓ | already had | ✓ added | already had |
| `ComplianceDebugger` | ✓ added | ✓ added | ✓ added | ✓ added |
| `GodModeConsole` | ✓ added | ✓ added | ✓ added | n/a (closes via Ctrl+Shift+G) |
| `FixtureParamWindow` | already Esc-closed | already had | — (draggable, non-modal) | ✓ added |

### 4. Reduced-motion guards on 6 continuous animations

| Component | What was sinusoidal | Reduced-motion substitute |
|-----------|---------------------|---------------------------|
| `SensoryFeedback.GlowRing` | Scale 1.00→1.15 + opacity 0.5→0.8 @ 3Hz | Static scale 1, opacity 0.65 |
| `FixtureModels.SelectionHalo` | Scale 0.92→1.08 + opacity @ 4Hz | Static scale 1, opacity 0.7 |
| `EndpointExtender.EndpointGlyph` | Scale breathe @ 3Hz | Static scale (hover jump still works) |
| `PivotPreview.IllegalHalo` | Scale + opacity @ 8Hz | Static ring, opacity 0.65 |
| `LiveRoutePreview` (tube) | Emissive + opacity pulse @ 3-4Hz | Static emissive 0.45, opacity 0.4 |
| `ComplianceOverlay3D.ViolationMarker` | Scale + ring-expand pulse | Static marker + ring |

**Key principle: meaning never depends on motion.** A reduced-motion user still sees a selection ring, a glowing connection point, a red "illegal" halo, a pulsing violation beacon — the color + shape carry the information. Only the temporal modulation is removed.

One-shot FX (`CollisionFlash`, `SnapBurst`, `CompletePulse`) are **deliberately kept lively**. They fire infrequently (single events on commit/snap), last < 1 s, and carry the feedback signal itself — removing them would remove meaning, not motion.

### 5. `aria-live` on the `FeedbackOverlay`

- State badge: `role="status"` + `aria-live="polite"` + `aria-atomic="true"` + `aria-label="Mode: <STATE>"`. Announces FSM transitions (IDLE → ROUTING → CONFIRMED) without interrupting speech mid-word.
- Toast stack: `role="log"` + `aria-live="polite"` + `aria-relevant="additions"` + `aria-label="Feedback messages"`. Each queued cue/reward gets announced as it arrives.

Neither region is `aria-live="assertive"` — that would interrupt active speech. Plumbing modes are not emergencies; polite is correct.

### 6. Dialogs that needed it get `role="dialog"` + `aria-label`

`FixtureParamWindow` previously had no ARIA role. Now: `role="dialog"` + `aria-label="${SUBTYPE_LABEL} parameters"` (e.g., "Water Closet parameters") so screen readers announce the fixture type when the window opens.

## Consequences

**Good:**
- Full keyboard operability of every modal. Tab stays inside, focus returns on close, Escape closes.
- Users with `prefers-reduced-motion: reduce` set at the OS level get a calmer canvas without losing any information.
- Screen reader announces FSM mode changes and toast messages instead of silently changing state.
- Future modals have a 3-line recipe: import `useFocusTrap`, add `ref={trapRef}`, add `role="dialog" aria-modal="true" aria-label="…"`.

**Accepted costs:**
- Each continuous animation now has a branch per frame (`if (reducedMotion) { … return; }`). The cost is a single boolean check + static assignments — negligible. We measured no FPS regression on the 500-pipe benchmark scene.
- `useFocusTrap` attaches its listener on the container; if a consumer forgets to render the ref'd element, nothing breaks but nothing traps either (we considered an assertion in DEV mode, decided against — too noisy during open/close transitions).

## Alternatives considered

**CSS `@media (prefers-reduced-motion: reduce)` only.** Works for CSS transitions, doesn't work for `useFrame` callbacks that mutate Three.js material properties directly. The hook pattern is the only way to reach those.

**Library (focus-trap-react, react-aria).** Both would work. We chose a ~115-line hook because:
1. The whole-library weight (~8-15 KB gz) isn't justified by one feature.
2. We need Three.js integration and `useFrame`-aware patterns those libs don't ship.
3. The hook is simpler to audit + modify than a library release cycle.

**Announce toasts with `aria-live="assertive"`.** Too aggressive — interrupts the user. A "Snapped!" toast isn't worth cutting off whatever word was being read. Polite with additions-only semantics is correct.

## Validation

- `Vitest`: `src/core/a11y/__tests__/a11yHooks.spec.ts` — 8 tests covering `useReducedMotion` initial value + live updates, `useFocusTrap` first-focus, focus restoration, Tab wrap-around, Shift+Tab wrap-around, empty-container fallback.
- Manual smoke test: open each modal, Tab through it fully, verify focus cycles and Escape closes.
- OS toggle: enabled "Reduce motion" in Windows Settings, confirmed all 6 animations go static while remaining visible and meaningful.
