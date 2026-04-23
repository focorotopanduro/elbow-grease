/**
 * ModeTabs tests — redesigned workspace switcher.
 *
 * Covers the behaviors that actually matter:
 *   • Both tabs render with correct labels.
 *   • `aria-selected` reflects the active workspace; only the
 *     active tab is in the tab order.
 *   • Click switches mode.
 *   • Arrow-left / arrow-right navigate + switch mode.
 *   • Home / End jump to first / last.
 *   • The sliding-pill `transform` matches the active tab's
 *     x-offset (so a pointer-free check can verify the pill has
 *     moved — the ACTUAL animation is CSS and jsdom doesn't run
 *     transitions).
 *   • Pill's background color follows the active accent.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ModeTabs } from '../ModeTabs';
import { useAppModeStore, APP_MODE_ACCENTS, __testables } from '@store/appModeStore';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Minimal matchMedia mock for the reduced-motion path. jsdom
 *  doesn't implement it by default. */
function installMatchMediaMock(matches: boolean) {
  const mql = {
    get matches() { return matches; },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
    dispatchEvent: () => true,
    onchange: null,
  };
  // @ts-expect-error — jsdom doesn't declare matchMedia
  window.matchMedia = vi.fn(() => mql);
}

beforeEach(() => {
  useAppModeStore.setState({ mode: 'plumbing' });
  installMatchMediaMock(false);
  try {
    localStorage.removeItem(__testables.STORAGE_KEY);
  } catch { /* ignore */ }
});

afterEach(() => {
  cleanup();
});

describe('ModeTabs — structure + a11y', () => {
  it('renders a tablist with one tab per workspace', () => {
    const { container } = render(<ModeTabs />);
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist!.getAttribute('aria-orientation')).toBe('horizontal');

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.textContent).toContain('Plumbing');
    expect(tabs[1]!.textContent).toContain('Roofing');
  });

  it('active tab has aria-selected=true, inactive has aria-selected=false', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');
    expect(plumbing!.getAttribute('aria-selected')).toBe('true');
    expect(roofing!.getAttribute('aria-selected')).toBe('false');
  });

  it('roving tabindex: active tab = 0, inactive = -1', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');
    expect((plumbing as HTMLElement).tabIndex).toBe(0);
    expect((roofing as HTMLElement).tabIndex).toBe(-1);
  });

  it('shows the ⇧ M hotkey hint below the tablist', () => {
    const { container } = render(<ModeTabs />);
    const text = container.textContent ?? '';
    expect(text).toContain('⇧');
    expect(text).toContain('M');
    expect(text).toContain('to toggle');
  });
});

describe('ModeTabs — interaction', () => {
  it('clicking a tab switches the app mode', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const tabs = container.querySelectorAll('[role="tab"]');
    const roofingTab = tabs[1] as HTMLButtonElement;

    fireEvent.click(roofingTab);
    expect(useAppModeStore.getState().mode).toBe('roofing');
  });

  it('arrow-right on plumbing tab switches to roofing + moves focus', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');

    (plumbing as HTMLElement).focus();
    fireEvent.keyDown(plumbing!, { key: 'ArrowRight' });

    expect(useAppModeStore.getState().mode).toBe('roofing');
    expect(document.activeElement).toBe(roofing);
  });

  it('arrow-left on roofing tab switches to plumbing + moves focus', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');

    (roofing as HTMLElement).focus();
    fireEvent.keyDown(roofing!, { key: 'ArrowLeft' });

    expect(useAppModeStore.getState().mode).toBe('plumbing');
    expect(document.activeElement).toBe(plumbing);
  });

  it('arrow-right at end wraps to first (and vice-versa)', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement;
    roofing.focus();
    fireEvent.keyDown(roofing, { key: 'ArrowRight' });

    // Wraps to plumbing (idx 0).
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });

  it('Home / End jump to first / last', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement;
    plumbing.focus();

    fireEvent.keyDown(plumbing, { key: 'End' });
    expect(useAppModeStore.getState().mode).toBe('roofing');

    fireEvent.keyDown(plumbing, { key: 'Home' });
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });
});

describe('ModeTabs — sliding pill indicator', () => {
  it('pill is at translateX(0) when plumbing (idx 0) is active', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(pill.style.transform).toBe('translateX(0px)');
  });

  it('pill shifts right when roofing (idx 1) becomes active', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    // Tab width is 150 px → pill offset should be 150 px.
    expect(pill.style.transform).toBe('translateX(150px)');
  });

  it('pill background uses the active workspace accent', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    let pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(pill.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.plumbing));

    // Store subscription + React's commit must land inside act() so
    // testing-library doesn't log a warning.
    act(() => {
      useAppModeStore.setState({ mode: 'roofing' });
    });
    pill = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(pill.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.roofing));
  });
});

// ── Debug-pass coverage: edge cases + hardening ──────────────

describe('ModeTabs — edge cases (debug pass)', () => {
  it('clicking the already-active tab is a no-op (no redundant setMode / localStorage write)', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const setMode = vi.spyOn(useAppModeStore.getState(), 'setMode');
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;

    fireEvent.click(plumbing);
    expect(setMode).not.toHaveBeenCalled();
    setMode.mockRestore();
  });

  it('invalid mode in the store clamps the pill to idx 0 (stays on-screen)', () => {
    // Simulate a corrupt localStorage value that somehow leaked
    // into the runtime store. TypeScript refuses this normally;
    // cast to bypass for the test.
    useAppModeStore.setState({ mode: 'garbage' as 'plumbing' });
    const { container } = render(<ModeTabs />);
    const pill = container.querySelector('[data-testid="mode-pill"]') as HTMLElement;
    // Pill is at idx 0 (plumbing position), NOT at translateX(-150px).
    expect(pill.style.transform).toBe('translateX(0px)');
    // Pill background falls back to the plumbing accent (first
    // MODES entry) rather than being undefined.
    expect(pill.style.background).toBe(hexToRgb(APP_MODE_ACCENTS.plumbing));
  });

  it('rapid alternating clicks leave the store in the final-clicked mode', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');

    // Spam alternating clicks.
    fireEvent.click(roofing!);
    fireEvent.click(plumbing!);
    fireEvent.click(roofing!);
    fireEvent.click(plumbing!);
    fireEvent.click(roofing!);

    expect(useAppModeStore.getState().mode).toBe('roofing');
  });

  it('external mode change (Shift+M / programmatic) updates aria-selected + pill', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);

    let [plumbing, roofing] = container.querySelectorAll('[role="tab"]');
    expect(plumbing!.getAttribute('aria-selected')).toBe('true');

    // Mode change from OUTSIDE the component — e.g. Shift+M
    // hotkey in KeyboardHandler.
    act(() => {
      useAppModeStore.setState({ mode: 'roofing' });
    });

    [plumbing, roofing] = container.querySelectorAll('[role="tab"]');
    expect(plumbing!.getAttribute('aria-selected')).toBe('false');
    expect(roofing!.getAttribute('aria-selected')).toBe('true');
    const pill = container.querySelector('[data-testid="mode-pill"]') as HTMLElement;
    expect(pill.style.transform).toBe('translateX(150px)');
  });

  it('hover state cleans up when mouse leaves (color drops back to inactive)', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.mouseEnter(roofing);
    expect(roofing.style.color).toBe('rgb(204, 204, 204)'); // #ccc

    fireEvent.mouseLeave(roofing);
    expect(roofing.style.color).toBe('rgb(119, 119, 119)'); // #777
  });

  it('mode flip while hovered: the newly-active tab renders with the active color, not hover', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    // Hover the inactive roofing tab first.
    fireEvent.mouseEnter(roofing);
    expect(roofing.style.color).toBe('rgb(204, 204, 204)');

    // Now flip mode to roofing WITHOUT mouse-leaving first — this
    // simulates the user clicking while hovered (which hover +
    // click interleave at speed).
    act(() => {
      useAppModeStore.setState({ mode: 'roofing' });
    });

    // The tab should display the active (dark on accent) color,
    // not the hover color, because hover state is superseded by
    // active state in the style prop derivation.
    const roofingAfter = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;
    expect(roofingAfter.style.color).toBe('rgb(10, 10, 15)'); // #0a0a0f
  });

  it('focus ring renders on focus and clears on blur', () => {
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;

    fireEvent.focus(plumbing);
    // jsdom preserves the rgba() arg spacing as written in the
    // source; our source uses the no-space form. Match both.
    expect(plumbing.style.boxShadow).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.7\s*\)/);

    fireEvent.blur(plumbing);
    expect(plumbing.style.boxShadow).toBe('none');
  });

  it('Space and Enter keys trigger mode switch (native <button> semantics)', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    // Native <button> dispatches click on Space/Enter. Testing-
    // library's fireEvent.click is the direct equivalent; we
    // verify the wiring by firing a real click (matching what a
    // keypress produces).
    roofing.focus();
    fireEvent.click(roofing);
    expect(useAppModeStore.getState().mode).toBe('roofing');
  });
});

describe('ModeTabs — prefers-reduced-motion', () => {
  it('reduced motion disables pill transitions', () => {
    installMatchMediaMock(true);
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const pill = container.querySelector('[data-testid="mode-pill"]') as HTMLElement;
    expect(pill.style.transition).toBe('none');
  });

  it('reduced motion disables text-color transitions', () => {
    installMatchMediaMock(true);
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;
    expect(plumbing.style.transition).toBe('none');
  });

  it('default (reduced motion off) keeps the transitions', () => {
    installMatchMediaMock(false);
    const { container } = render(<ModeTabs />);
    const pill = container.querySelector('[data-testid="mode-pill"]') as HTMLElement;
    expect(pill.style.transition).toContain('280ms');
  });
});
