/**
 * InteractiveButton — thin wrapper around a native `<button>` that
 * applies the universal press + focus feedback from the
 * `useInteractiveButton` hook.
 *
 * The visual language this component imposes is intentionally
 * minimal — just two layers on top of whatever the caller specifies
 * in `style`:
 *
 *   • `transform: scale(0.96)` while pressed — the "I got your
 *     click" tactile beat that ModeTabs shipped (phase 14.R.3).
 *   • `boxShadow: 0 0 0 2px rgba(255,255,255,0.6)` while focused —
 *     a keyboard-user affordance that's visible on both dark and
 *     light backgrounds without carrying accent color (panels with
 *     multi-color buttons would otherwise become rainbow-halo soup).
 *
 * Anything ACCENT-aware (like the cyan/orange halo on ModeTabs
 * hover) lives in the consumer — that's color language per-surface
 * and doesn't belong in a shared primitive. This component only
 * knows about the white-on-dark interaction feedback that's
 * universal across the app.
 *
 * Usage:
 *
 *     <InteractiveButton
 *       style={{ background: active ? '#00e5ff22' : 'transparent' }}
 *       onClick={handleClick}
 *       title="Do the thing"
 *     >
 *       Label
 *     </InteractiveButton>
 *
 * The caller's `style` is spread first; the interaction overlay
 * (transform + boxShadow) is applied on top so the hook's feedback
 * wins in a collision. Outline is forced to `none` to avoid the
 * default browser focus ring on top of ours.
 */

import { useInteractiveButton } from './useInteractiveButton';

export interface InteractiveButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  /** Override the default focus-ring color. Defaults to
   *  `rgba(255,255,255,0.6)` (white at 60% alpha) which reads on
   *  most dark UI backgrounds. Rare override: use when the button
   *  sits on a near-white surface. */
  focusRingColor?: string;
  /** Override the default press-scale. Defaults to 0.96. Smaller
   *  values feel more tactile; values above 0.98 can read as noise. */
  pressScale?: number;
}

export function InteractiveButton({
  children,
  style,
  focusRingColor = 'rgba(255,255,255,0.6)',
  pressScale = 0.96,
  ...rest
}: InteractiveButtonProps) {
  const { pressed, focused, bindings } = useInteractiveButton();
  const focusShadow = focused ? `0 0 0 2px ${focusRingColor}` : 'none';
  return (
    <button
      {...bindings}
      {...rest}
      style={{
        ...style,
        transform: pressed ? `scale(${pressScale})` : 'scale(1)',
        boxShadow: focusShadow,
        outline: 'none',
      }}
    >
      {children}
    </button>
  );
}
