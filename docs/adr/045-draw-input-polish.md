# ADR 045 — Draw Input Polish (Phase 14.S)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.S
- **Depends on:** 14.R (Locked-Angle Draw Cursor).

## Context

After 14.R shipped the constraint-locked draw cursor, three real-world
workflow gaps remained:

1. **No way to correct a misclick mid-draw.** A user 6 points into
   a complex route who mis-clicks has to Escape (throw away the
   whole route) and start over. Every other drawing app handles this
   with a single keystroke.

2. **No escape hatch for edge cases.** "Legal fitting angles" is the
   right default but there ARE cases where a field-fit adapter or a
   one-off union sits at a non-standard angle. Forcing users to
   change material to PEX (which then drops the constraint for ALL
   future segments) is over-broad. They need a per-click override.

3. **Snap targets are invisible until you touch them.** The cursor
   snaps cleanly, but the user has to wiggle around to discover
   where the snap points are. A visible "these are the 8 legal
   directions right now" guide would let them aim first, click
   second.

## Decision

Four narrow additions, all scoped to draw-mode:

### 1. `popDrawPoint` — single-point undo

New store action: removes the last committed point from the
in-progress polyline. Session stays alive (`mode: 'draw'`). If the
pop leaves the polyline empty, `isDrawing` drops to `false` but the
user stays in draw mode so their next click re-starts the polyline.

Wired to **Backspace** in `DrawInteraction`. Guarded against text-
input focus so it doesn't steal characters from the diameter input.

### 2. `addDrawPointRaw` — constraint bypass

New store action: grid-snap only, no angle / rise / length pipeline.
Near-duplicate check still runs (prevents pure-duplicate clicks from
the user double-clicking a single grid cell by accident).

Wired to **Alt + click** in `DrawInteraction`. Single-click scope —
the next click (Alt released) snaps normally. No lingering mode.

### 3. `DetentRing` — visual snap-target guide

Renders 8 faint rays from the last committed point out along each
legal relative direction. For the first committed point (no prior
segment to anchor off), rays fall back to the 4 cardinals so the
user always sees a compass. Fallback doesn't match the commit path
exactly (which relaxes the XZ-bend constraint when there's no prior
direction) but it's the most useful thing to show visually.

Per-frame, the ray closest to the cursor's current angle brightens
— gives the user an unambiguous "this is the detent you'll land on"
cue without needing to actually move the cursor there.

PEX material: unmounts (no detents to show on flexible pipe).

### 4. Detent-proximity brightening doubles as the "flash"

Original Phase 14.S plan included a separate `SnapFlash` animation
firing when the cursor moved into a legal angle. Cut: the detent
ring's per-frame brightening already provides the visual
confirmation, and a second overlay competing for attention would
muddy the signal. Keeping the design quiet.

## Trade-offs

- **Alt override is per-click, not persistent.** A user who wants
  a whole freeform segment must hold Alt for each click. Debated
  keeping it persistent until deliberate toggle-off — rejected
  because "I forgot Alt was on" errors would produce subtle illegal
  geometry the user wouldn't notice until the BOM showed odd
  fitting counts. Per-click is loud-enough intent.
- **Detent ring at the first point uses world cardinals.** Could
  argue the ring should omit at point 1 (nothing's constrained yet)
  — but showing something is better than a bare dot for user
  orientation. The rays at point 1 don't claim "these are your only
  options" (all 360° are legal for the first segment); they just
  show "the next click will grid-snap, here are the four axes."
- **No length-quantize on `addDrawPointRaw`.** Alt-bypass also
  skips the "length must be a grid multiple along the legal
  direction" rule. Intentional — the whole point of the bypass is
  to let the user place a point at the exact raw cursor location,
  not to impose a different variant of snap.

## Verification

- `npx vitest run` — 1036 tests pass (1025 prior + 11 new in
  `drawInput.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Enter draw mode, 2" PVC. Click to place a first point — a
     faint cyan + cool-blue 4-ray compass appears at that point.
  2. Click a second point — the ring now shows 7 rays at the
     relative legal set. Hover the cursor around; the ray closest
     to the cursor brightens.
  3. Hold Alt, click at a weird angle — a free-angle segment
     commits (rubber band ghost confirms the raw cursor location).
  4. Release Alt, next click snaps normally.
  5. Press Backspace — most recent point disappears, rubber band
     re-anchors to the new last point. Session stays alive.
  6. Press Backspace until the polyline is empty — you stay in
     draw mode (blue cursor + crosshair still visible).

## Files

- `src/store/interactionStore.ts`: added `addDrawPointRaw` and
  `popDrawPoint`. Public interface grew by two actions.
- `src/store/__tests__/drawInput.spec.ts`: 11 tests covering all
  three draw actions + Backspace-like flows.
- `src/App.tsx`:
  - `DrawInteraction.useEffect` click handler branches on `altKey`.
  - New `onKey` handler bound to the window for Backspace.
  - New `<DetentRing />` mount next to `<RubberBand />`.
  - `DetentRing` component ~80 LOC with per-frame brightening.
- `docs/adr/045-draw-input-polish.md` — this document.
