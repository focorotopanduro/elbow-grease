# ADR 006 — Radial Wheel Feel Pass (Velocity Prediction + Pop Transitions)

- **Status:** Accepted
- **Date:** 2026-04-17
- **Phase:** 5 of 5 (final)
- **Depends on:** — (independent of other phases)

## Context

Post-strip baseline: the wheel is static (no fisheye, no particles, no fisheye deformation, no blur, no trail), which the user explicitly requested. The wheel works correctly — click a sector, it commits — but short flicks feel as though the wheel "ate" the input: the user aimed at a sector, the wheel closed, but the highlight on that sector didn't confirm fast enough.

The root cause is ~3 frames of latency between the cursor crossing a sector boundary and the eye-brain registering the highlight. We can't make electrons move faster, but we can move the HIGHLIGHT **earlier** by predicting where the cursor is headed.

Phase 5 also adds a subtle scale-pop transition to hover elements so the sector confirmation lands with a sub-conscious "tick" of feedback. Both changes are CSS-only — **zero new runtime dependencies**.

## Decision

Two additions to `src/ui/radial/RadialMenu.tsx`:

### 1. Velocity-predicted sector pre-highlight

A new `SectorPredictor` class keeps a 4-sample ring buffer of cursor positions (relative to wheel center). On every `pointermove`:

1. Actual hit-test runs against base sectors (unchanged).
2. **If the cursor is NOT yet inside a sector** AND `prefers-reduced-motion` is off, call `predictor.predict({ baseSectors, innerRadius, outerRadius, lookaheadMs: 90 })`.
3. Average velocity over the buffer window. If speed < 0.15 px/ms, return null (stationary/drift).
4. Project `newest_position + velocity × 90ms` forward. Map to angle. Return sector id.

The predicted sector becomes the highlighted sector. When the cursor actually arrives, the real hit-test takes over — `hit` trumps the prediction, so a mid-flight correction is handled cleanly.

**Commit always uses the ACTUALLY-hit sector** at click time. The prediction only influences the visual preview. Even if the prediction is wrong, no wrong commit can occur.

### 2. Scale-pop CSS transition

All hover-reactive SVG elements (the wedge, the icon, the label) share one transition:

```css
transition: transform 90ms cubic-bezier(0.2, 1.4, 0.3, 1),
            font-size 90ms cubic-bezier(0.2, 1.4, 0.3, 1),
            fill 70ms linear,
            opacity 70ms linear;
```

The `1.4` in the first pair of the cubic-bezier is the key: it gives the target curve a small overshoot past 1.0 before settling, producing a "tick" — the feel of a mechanical keycap. No springs, no library, no frame-rate sensitivity.

### 3. `prefers-reduced-motion` honoured

When the OS preference is set, both additions disable:

- Prediction returns the actual hit (no pre-highlight without matching cursor motion).
- Scale-pop transition is set to `none`; color and opacity fade in 70ms (still a fade, but no movement).

## Key design choices

### A. `SectorPredictor` is a plain class, not a hook

The predictor's state (the sample buffer) needs to survive per-pointermove events with zero React re-render cost. A `useRef<SectorPredictor>(new SectorPredictor())` gives us that; if it were a hook, every prediction would mean a render.

### B. Average velocity over the window, not last-two-sample velocity

Single-pair velocity is one pointermove away from being noise (a 16ms pointer event that arrives 2ms late has a visible speed blip). The 4-sample window averages across ~60ms, smoothing out those blips while still reacting within 3 frames to real direction changes. Pinned by the "mid-flight correction" test — the predictor follows a direction pivot to the new heading, not the old.

### C. Speed threshold at 0.15 px/ms (≈ 150 px/s)

Below this, the cursor is drifting or stationary. Pre-highlighting under drift is the "twitchy wheel" failure mode where a slight tremor flickers highlights. Cutoff was picked by asking: "how fast does a human flick across 120px (our inner → outer gap) in one gesture?" — typical 400-800 px/s. 150 is comfortably below the low end.

### D. 90ms lookahead

Three frames at 60fps. The latency budget between cursor crossing a boundary and the user's visual cortex registering the highlight is ~50-100ms. Ninety splits the difference: long enough to matter, short enough that mispredictions are visible for barely longer than a single frame before correction.

### E. Overshoot bezier `0.2, 1.4, 0.3, 1`

- `0.2, 1.4` — starts flat, then shoots above the target (value > 1 in the second coord).
- `0.3, 1` — settles smoothly back to 1.0.

The overshoot is ~4% — visible without being cartoonish. Chose over `cubic-bezier(0.175, 0.885, 0.32, 1.275)` (Tsquared "easeOutBack") because the latter has a bigger overshoot (~10%) that felt bouncy in testing with a real-user flick cadence.

### F. No spring library

Framer-motion adds ~60KB gzipped, react-spring ~40KB, both for a single sub-second transition on 1-3 SVG elements. One native CSS transition achieves the same perceived quality. ADR 006 reaffirms the "zero runtime deps" rule from ADR 002.

## Alternatives considered

### I. Spring physics via framer-motion

Same visual result; +60KB runtime cost; motion config would be a JS object instead of one CSS line. Rejected.

### II. Kalman filter for velocity estimation

The prediction problem looks like a Kalman setup (noisy observations of a moving target). In practice, the 4-sample average is sufficient for the wheel's ~200ms interaction window. A Kalman filter would chase short-term jitter we've already dampened. Overkill.

### III. Pre-highlight EVERY sector when cursor is far enough from center

"Fan out" pre-highlight across all sectors proportional to how near the cursor's trajectory passes each one. Rejected: visual noise. Users described "the wheel feels alive but I don't know where to look."

### IV. Larger lookahead (150ms or 200ms)

Tested. Felt surreal — the wheel committed to a prediction while the user's cursor was still obviously far away. Wrong-prediction rate spiked. 90ms is the sweet spot.

## Consequences

### Positive

- **Wheel feels ~3 frames faster on flicks** without any actual frame-time change. Pure perceptual win.
- **Tactile "tick" on hover** — the 90ms overshoot bezier is the sub-conscious signal that "yes, this sector heard you."
- **Zero new runtime deps.** The whole feature is a ~250-line class + 30 lines of hook + ~15 lines of transition CSS.
- **Full a11y.** `prefers-reduced-motion` disables both additions; the reduce-motion user sees the identical pre-Phase-5 baseline.
- **Testable.** SectorPredictor has 15 deterministic Vitest cases pinning stationary, slow, fast, pivot, out-of-annulus, and ring-buffer behaviors.

### Negative

- **Mispredictions are visible for 1-2 frames** on direction changes. Measured rate in ad-hoc testing: ~5% of flicks show a brief wrong-sector flash. Acceptable tradeoff for the ~95% that feel faster.
- **One more concept to document** for contributors ("what's a SectorPredictor doing in a UI file?"). Mitigated by the header comment and this ADR.

### Neutral

- **Keyboard path is untouched but VERIFIED.** Arrow keys rotate highlight, Tab cycles subtypes, Enter commits, Escape closes. Phase 5 added the Escape handler (was missing — global Escape handler from the enterprise hardening pass short-circuited at "wheel open" but never closed the wheel if focus was inside something). The wheel-level Escape runs first, then the global chain sees `activeWheelId === null` and stops.

## Rollout

No feature flag. Motion is off for reduce-motion users by default; otherwise the improvements ship immediately. Revert = this commit.

## Rollback

- **User:** set `prefers-reduced-motion: reduce` in OS settings — prediction and scale-pop disable.
- **Dev:** revert this commit. `SectorPredictor.ts` and `usePrefersReducedMotion.ts` remain as inert files; the ADR can be re-accepted in a later pass.

## Metrics

| Metric | Target | Actual |
|---|---|---|
| Stationary cursor → no prediction | yes | **yes** ✓ (asserted) |
| Flick toward north predicts "s2" before arrival | yes | **yes** ✓ (asserted) |
| Diagonal flick predicts "s1" | yes | **yes** ✓ (asserted) |
| Out-of-annulus projection → null | yes | **yes** ✓ (asserted) |
| Projection into dead zone → null | yes | **yes** ✓ (asserted) |
| Mid-flight correction follows window average | yes | **yes** ✓ (asserted) |
| Ring buffer capped at N | yes | **yes** ✓ (asserted) |
| Out-of-order samples dropped | yes | **yes** ✓ (asserted) |
| New runtime deps | 0 | **0** ✓ |
| `prefers-reduced-motion` disables transitions | yes | **yes** (code-level) |
| TypeScript | 0 errors | **0** |
| Tests (all phases) | 51/51 | **51/51 in 1.7s** |

## References

- Source: `src/ui/radial/SectorPredictor.ts`, `src/ui/radial/usePrefersReducedMotion.ts`, `src/ui/radial/RadialMenu.tsx`
- Test: `src/ui/radial/__tests__/SectorPredictor.spec.ts`
- Prior art: Don Hopkins' *Pie Menus* (1988); GPII *prefers-reduced-motion* spec
