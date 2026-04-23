# ADR 044 — Locked-Angle Draw Cursor (Phase 14.R)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.R
- **Depends on:** Phase 14-bug-fix pass (angleSnap), 14.Q (Live Draw
  Polish).

## Context

After Phase 14.Q's live-draw polish, the user reported that they
could still draw "impossible angles" — bends that no stock fitting
could produce. Investigating showed three separate leaks:

1. **Post-angle grid snap.** `addDrawPoint` snapped to grid →
   snapped angle to a legal detent → snapped to grid AGAIN. The
   third step pushed 22.5°/45° angles off their legal direction
   because those directions almost never land on a 0.5 ft grid
   multiple. The user drew a 45° segment and got a 47° segment
   committed.

2. **Vertical plane bypass.** The `addDrawPoint` constraint only
   fired when `drawPlane === 'horizontal'`. In vertical draw mode
   (`V` key), any angle was accepted — a user nudging a riser could
   commit a 7° "barely-rising" drain that has no 7° stock fitting.
   Worse, the constraint wasn't even checking the Y rise of
   horizontally-drawn segments, so "drain slopes up 3° over 20 ft"
   slid right through.

3. **No live preview of the constraint.** The cursor in draw mode
   moved freely with the pointer. Only on click did the constraint
   apply — so the user got no feedback about where their next point
   would actually land. "Click to find out" is a bad UX.

## Decision

Four changes, shared via one new pure entry point:

### 1. `applyDrawConstraints` — unified pure function

All draw-snap logic moves into a single function in `angleSnap.ts`:

```ts
applyDrawConstraints(raw: Vec3, ctx: {
  points, material, drawPlane, gridStep
}): Vec3
```

The function composes three stages:

```
constrainCandidateToLegalBend  (XZ bend snap, ≥ 2 prior points)
  ↓
constrainRiseToLegal            (vertical rise snap, always active)
  ↓
snapLengthOnDirection           (length quantize, preserves direction)
```

Stage order matters: bend first (fixes horizontal heading), rise
second (fixes vertical tilt without touching horizontal heading),
length last (quantizes length along the now-legal direction without
touching angles). PEX material + "first point" bypass all stages
and fall back to classic grid snap.

### 2. `constrainRiseToLegal` — new vertical-plane snap

Legal rise angles off horizontal: `{0°, ±45°, ±90°}`. Deliberately
**no 22.5°** — no stock DWV fitting pairs a 22.5° rise with its
22.5° horizontal counterpart, and the confusion cost isn't worth
the occasional special-case fit. `0°` is the "pipe stays horizontal"
continuation; `±90°` is a vertical riser; `±45°` covers roof drains
coming down at the common slope.

### 3. `snapLengthOnDirection` — angle-preserving length quantize

Replaces the buggy "grid-snap after angle-snap" pattern. Given a
start point and a destination at a legal direction, snap ONLY the
SEGMENT LENGTH to `gridStep` multiples, leaving the direction exact.
Minimum output length is one grid step (prevents zero-length
segments in the commit path).

For a 22.5° segment of raw length 8.1 ft with grid 0.5 ft:
- Old: `(x=7.48, y=0, z=3.10)` → `snapToGrid` → `(7.5, 0, 3.0)` →
  angle is now **22.62°**, just wrong enough to be illegal.
- New: length quantizes to 8.0 ft, direction stays exactly at 22.5°.
  Output: `(7.39, 0, 3.06)` — length snapped, angle exact.

### 4. Live-cursor constraint in `DrawInteraction.useFrame`

The cursor's `cursorMeshRef` position is now run through
`applyDrawConstraints` every frame (when draw mode is active + the
cursor isn't locked to a pipe-snap target). User sees EXACTLY where
their next click would land before clicking.

### 5. Rubber-band preview + readout

A dashed line renders from the last committed draw point to the
cursor's constrained position, updated per-frame via the cursor
ref (no React rerender). A Billboard above the midpoint shows
`length_ft · rise_deg`, e.g. `10.00 ft · 45°` when the user is
dragging up the 45° detent. Visual confirmation that the constraint
is working; no more blind clicks.

## Trade-offs

- **Pipe-snap bypasses the constraint.** When the cursor latches
  onto an existing pipe endpoint or body (Phase 9.B), we skip the
  angle constraint so "snap to existing endpoint" still works.
  If the snap target creates an illegal angle, `addDrawPoint` will
  still enforce the legal-angle constraint on commit — so the
  network stays consistent. But the live visualization momentarily
  diverges from the commit result. Acceptable: pipe-snap is the
  higher-priority intent.
- **No 22.5° vertical rise.** Intentional. See Decision #2 above.
  If a future code inspection asks "why can't I draw a 22.5° roof
  drain," the ADR is the answer.
- **Length-minimum bump.** `snapLengthOnDirection` enforces ≥ 1
  grid step. A user clicking 0.1 ft from the last point gets a
  0.5 ft segment, not a no-op. The `addDrawPoint` near-duplicate
  check (≥ 0.1 ft threshold) still runs, so pure duplicate clicks
  are still dropped — the length-minimum only kicks in when the
  user is "close but not duplicate."

## Verification

- `npx vitest run` — 1025 tests pass (1011 prior + 14 new for the
  Phase 14.R additions on `angleSnap.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Draw mode, 2" PVC. Click (0,0,0), hover cursor around — cursor
     snaps to integer multiples of the grid, rubber band readout
     reads `N.0 ft` as the cursor moves.
  2. Click (10,0,0). Move cursor to ~19°-off → cursor visibly
     snaps to 22.5° — rubber band shows `length · 0°`.
  3. Pull the cursor up → Y component jumps to 0° / 45° / 90°,
     no intermediate values. Rubber band reads `length · 45°`.
  4. Switch to PEX material → cursor moves freely.

## Files

- `src/core/pipe/angleSnap.ts`: added `snapLengthOnDirection`,
  `constrainRiseToLegal`, `applyDrawConstraints`,
  `LEGAL_VERTICAL_RISE_DEG`.
- `src/core/pipe/__tests__/angleSnap.spec.ts`: +14 tests (29 total).
- `src/store/interactionStore.ts`: `addDrawPoint` now calls
  `applyDrawConstraints` directly — removes the buggy
  grid→angle→grid pipeline.
- `src/App.tsx`:
  - `DrawInteraction.useFrame` runs constraint on live cursor.
  - New `RubberBand` component renders the dashed preview + label.
  - `Text` import added to the drei import group.
  - `useMemo` added to the React import group.
