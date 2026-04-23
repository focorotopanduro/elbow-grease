/**
 * useInteractiveButton — small state-machine hook for chrome buttons.
 *
 * Consolidates the hover / pressed / focused trio that the ModeTabs
 * redesign worked out (phase 14.R.3 debug pass) so other
 * accent-carrying chrome buttons can adopt the same edge-case-correct
 * behaviour without re-deriving it from scratch.
 *
 * What the hook owns:
 *   • Three independent boolean state atoms — `hovered`, `pressed`,
 *     `focused`.
 *   • A `bindings` object that plugs straight into a native `<button>`
 *     (spread-safe: `<button {...bindings}>`).
 *
 * What the hook intentionally does NOT own:
 *   • Any visual styling. Each caller composes its own halo / scale
 *     / background from the state — visual language is aesthetic
 *     judgment that should live in the component, not in a shared
 *     hook. A state-management hook stays composable; a
 *     style-management hook becomes a vocabulary fight.
 *   • `prefers-reduced-motion`. Each caller imports `useReducedMotion`
 *     directly so the transition string sits next to the rest of the
 *     component's style. The hook is visual-agnostic.
 *
 * Edge cases this hook gets right (and why):
 *
 *   1. **Mouseleave during press releases press.** Users learn from
 *      native OS buttons to drag off a button to abort a click. If we
 *      left `pressed=true` after mouseleave, the button would stay
 *      squished indefinitely. So `onMouseLeave` clears BOTH `hovered`
 *      AND `pressed`.
 *
 *   2. **MouseUp always clears press, even outside.** Normal click
 *      lifecycle: mousedown → mouseup on the same element. The
 *      handler just sets `pressed=false` unconditionally — matches
 *      the moment the user lets go.
 *
 *   3. **Hovered + focused can both be true simultaneously.** Keyboard
 *      user tabs to a button (focused=true) then mouse-hovers a
 *      different button (hovered=true on different button). Each
 *      button gets its own hook instance, so their states don't
 *      interfere. For components where the SAME button is focused
 *      and hovered, both flags are true and the caller composes both
 *      indicators (focus ring + hover glow stacked).
 *
 *   4. **No touch-specific handlers.** Touch clicks synthesize
 *      mouse-down / mouse-up / mouse-enter / mouse-leave via the
 *      browser, and `mouseleave` catches any drag-off during a touch
 *      drag. Adding `onTouchStart` / `onPointerCancel` would
 *      double-fire on hybrid devices (laptop with touchscreen).
 *
 * Usage pattern:
 *
 *     function MyButton() {
 *       const { hovered, pressed, focused, bindings } = useInteractiveButton();
 *       return (
 *         <button
 *           {...bindings}
 *           style={{
 *             transform: pressed ? 'scale(0.96)' : 'scale(1)',
 *             boxShadow: focused ? '0 0 0 2px white' : 'none',
 *             background: hovered ? '#333' : 'transparent',
 *           }}
 *         >…</button>
 *       );
 *     }
 */

import { useMemo, useState } from 'react';

/** Read-only interaction state of a button. */
export interface InteractiveButtonState {
  /** Mouse is currently over the button. */
  hovered: boolean;
  /** Mouse button is pressed down on this button. Cleared on mouseup
   *  OR if the user drags off mid-press. */
  pressed: boolean;
  /** Button has keyboard focus. */
  focused: boolean;
}

/** Event handlers to spread onto a native `<button>`. Shape matches
 *  React's synthetic event handler props exactly so TypeScript is
 *  happy with `<button {...bindings}>`. */
export interface InteractiveButtonBindings {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onMouseDown: () => void;
  onMouseUp: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Returns the current interaction state plus the event handlers to
 * drive it. Call once per button.
 *
 * The `bindings` object is stable across renders (memoized once) so
 * spreading it onto a button doesn't thrash React's event handler
 * attachment on every parent re-render.
 */
export function useInteractiveButton(): InteractiveButtonState & {
  bindings: InteractiveButtonBindings;
} {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);

  // Memoize the bindings so the identity is stable — consumers that
  // spread them onto a child aren't triggering handler reattachment
  // on every parent re-render. The setters from useState are already
  // stable, so this is safe with an empty dep list.
  const bindings = useMemo<InteractiveButtonBindings>(
    () => ({
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => {
        setHovered(false);
        // Release pressed too — user dragged off to abort the click.
        // Matches native OS button behaviour.
        setPressed(false);
      },
      onMouseDown: () => setPressed(true),
      onMouseUp: () => setPressed(false),
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    }),
    [],
  );

  return { hovered, pressed, focused, bindings };
}
