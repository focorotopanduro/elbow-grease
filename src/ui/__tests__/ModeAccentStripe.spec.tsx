/**
 * ModeAccentStripe tests — peripheral-vision mode cue.
 *
 * Small surface: one `<div>` that re-renders when appMode flips.
 * What actually matters:
 *   • Always mounted (not conditional on mode — that's the point).
 *   • Background color matches `APP_MODE_ACCENTS[currentMode]`.
 *   • Flips color when the store changes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { ModeAccentStripe } from '../ModeAccentStripe';
import { useAppModeStore, APP_MODE_ACCENTS } from '@store/appModeStore';

/** jsdom normalises CSS hex colors to `rgb(r, g, b)` when reading
 *  `.style.background`. Convert the accent constants so comparisons
 *  work regardless of which form the style APIs surface. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

afterEach(() => {
  cleanup();
  useAppModeStore.setState({ mode: 'plumbing' });
});

describe('ModeAccentStripe', () => {
  it('renders with the plumbing accent color when in plumbing mode', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeAccentStripe />);
    const stripe = container.querySelector('div');
    expect(stripe).not.toBeNull();
    expect(stripe!.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.plumbing));
  });

  it('renders with the roofing accent color when in roofing mode', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeAccentStripe />);
    const stripe = container.querySelector('div');
    expect(stripe!.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.roofing));
  });

  it('flips color when the mode store changes', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeAccentStripe />);
    const stripe = container.querySelector('div')!;
    expect(stripe.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.plumbing));

    act(() => {
      useAppModeStore.setState({ mode: 'roofing' });
    });

    expect(stripe.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.roofing));
  });

  it('is non-interactive (pointer-events: none) — cannot swallow clicks', () => {
    const { container } = render(<ModeAccentStripe />);
    const stripe = container.querySelector('div')!;
    expect(stripe.style.pointerEvents).toBe('none');
  });
});
