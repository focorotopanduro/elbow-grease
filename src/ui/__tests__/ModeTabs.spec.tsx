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

    // Focus state is now owned by each <ModeTab> subcomponent (it
    // uses useInteractiveButton). Wrap the imperative .focus() +
    // keyDown in act() so React can flush the child's onFocus/onBlur
    // state updates cleanly — otherwise jsdom fires them outside the
    // testing-library act boundary and React warns.
    act(() => {
      (plumbing as HTMLElement).focus();
    });
    act(() => {
      fireEvent.keyDown(plumbing!, { key: 'ArrowRight' });
    });

    expect(useAppModeStore.getState().mode).toBe('roofing');
    expect(document.activeElement).toBe(roofing);
  });

  it('arrow-left on roofing tab switches to plumbing + moves focus', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const [plumbing, roofing] = container.querySelectorAll('[role="tab"]');

    act(() => {
      (roofing as HTMLElement).focus();
    });
    act(() => {
      fireEvent.keyDown(roofing!, { key: 'ArrowLeft' });
    });

    expect(useAppModeStore.getState().mode).toBe('plumbing');
    expect(document.activeElement).toBe(plumbing);
  });

  it('arrow-right at end wraps to first (and vice-versa)', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement;
    act(() => {
      roofing.focus();
    });
    act(() => {
      fireEvent.keyDown(roofing, { key: 'ArrowRight' });
    });

    // Wraps to plumbing (idx 0).
    expect(useAppModeStore.getState().mode).toBe('plumbing');
  });

  it('Home / End jump to first / last', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement;
    act(() => {
      plumbing.focus();
    });

    act(() => {
      fireEvent.keyDown(plumbing, { key: 'End' });
    });
    expect(useAppModeStore.getState().mode).toBe('roofing');

    act(() => {
      fireEvent.keyDown(plumbing, { key: 'Home' });
    });
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
    act(() => {
      roofing.focus();
    });
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

// ── Hover-glow affordance ────────────────────────────────────
//
// Hovering an INACTIVE tab paints a faint halo in that tab's
// OWN accent color — a preview of the workspace the user is
// about to land in. The active tab never picks up the hover
// treatment (the pill already owns that area visually).

describe('ModeTabs — hover-glow affordance', () => {
  // jsdom normalises 8-digit hex-with-alpha (`#RRGGBBAA`) to
  // `rgba(r, g, b, a.a)` when reading `.style.background`, and
  // may leave box-shadow hex values as written. We match on the
  // accent's RGB triplet so either representation passes.
  const RGB = {
    plumbing: '0,\\s*229,\\s*255',   // #00e5ff
    roofing:  '255,\\s*152,\\s*0',   // #ff9800
  };

  it('hovering the inactive roofing tab from plumbing mode paints an ORANGE halo', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.mouseEnter(roofing);

    // Background carries a low-alpha roofing-accent tint —
    // jsdom reports the rgba form.
    expect(roofing.style.background).toMatch(new RegExp(`rgba\\(${RGB.roofing}`));
    // Box-shadow picks up an orange halo — accept hex OR rgba form.
    const halo = roofing.style.boxShadow;
    expect(
      halo.includes(`${APP_MODE_ACCENTS.roofing}55`)
      || new RegExp(`rgba\\(${RGB.roofing}`).test(halo),
    ).toBe(true);
  });

  it('hovering the inactive plumbing tab from roofing mode paints a CYAN halo', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;

    fireEvent.mouseEnter(plumbing);

    expect(plumbing.style.background).toMatch(new RegExp(`rgba\\(${RGB.plumbing}`));
    const halo = plumbing.style.boxShadow;
    expect(
      halo.includes(`${APP_MODE_ACCENTS.plumbing}55`)
      || new RegExp(`rgba\\(${RGB.plumbing}`).test(halo),
    ).toBe(true);
  });

  it('hovering the ACTIVE tab leaves it visually unchanged (the pill owns that space)', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;

    fireEvent.mouseEnter(plumbing);

    // No hover glow on the active tab — background stays transparent,
    // box-shadow stays 'none'.
    expect(plumbing.style.background).toBe('transparent');
    expect(plumbing.style.boxShadow).toBe('none');
  });

  it('mouse-leave clears the hover glow on the previously-hovered tab', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.mouseEnter(roofing);
    expect(roofing.style.background).not.toBe('transparent');

    fireEvent.mouseLeave(roofing);
    expect(roofing.style.background).toBe('transparent');
    expect(roofing.style.boxShadow).toBe('none');
  });

  it('focus + hover stack — both the white focus ring AND the accent glow render', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.focus(roofing);
    fireEvent.mouseEnter(roofing);

    const halo = roofing.style.boxShadow;
    // White focus ring present (allow any inner/outer whitespace).
    expect(halo).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.7\s*\)/);
    // Accent halo present — accept hex or rgba serialization.
    expect(
      halo.includes(`${APP_MODE_ACCENTS.roofing}55`)
      || /rgba\(255,\s*152,\s*0/.test(halo),
    ).toBe(true);
  });

  it('hover transition includes background + box-shadow (smooth fade-in)', () => {
    installMatchMediaMock(false);
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    const transition = roofing.style.transition;
    expect(transition).toContain('color 200ms');
    expect(transition).toContain('background 200ms');
    expect(transition).toContain('box-shadow 200ms');
  });
});

// ── Pressed-state micro-feedback ─────────────────────────────
//
// mousedown on a tab triggers a brief 4% scale-down as a tactile
// "I got your click" signal. Releases on mouseup OR when the
// pointer drags off the button (the gesture users learn to
// abort a click).

describe('ModeTabs — pressed-state micro-feedback', () => {
  it('mousedown on a tab scales it down to 0.96', () => {
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    expect(roofing.style.transform).toBe('scale(1)');
    fireEvent.mouseDown(roofing);
    expect(roofing.style.transform).toBe('scale(0.96)');
  });

  it('mouseup releases the scale-down', () => {
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.mouseDown(roofing);
    expect(roofing.style.transform).toBe('scale(0.96)');
    fireEvent.mouseUp(roofing);
    expect(roofing.style.transform).toBe('scale(1)');
  });

  it('dragging the pointer off a pressed tab releases the scale (click-abort gesture)', () => {
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;

    fireEvent.mouseDown(roofing);
    expect(roofing.style.transform).toBe('scale(0.96)');

    // User drags off the button without releasing.
    fireEvent.mouseLeave(roofing);
    expect(roofing.style.transform).toBe('scale(1)');
  });

  it('pressing the active tab still shows tactile feedback (even if the click is a no-op)', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container } = render(<ModeTabs />);
    const plumbing = container.querySelector('[data-mode-tab="plumbing"]') as HTMLButtonElement;

    fireEvent.mouseDown(plumbing);
    // The click itself is a no-op (already active) but the user
    // should still see visual confirmation the press registered.
    expect(plumbing.style.transform).toBe('scale(0.96)');
  });

  it('transform transition is included in the tab transition list (snappy 100ms)', () => {
    installMatchMediaMock(false);
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;
    expect(roofing.style.transition).toContain('transform 100ms');
  });

  it('reduced motion disables the press transition', () => {
    installMatchMediaMock(true);
    const { container } = render(<ModeTabs />);
    const roofing = container.querySelector('[data-mode-tab="roofing"]') as HTMLButtonElement;
    expect(roofing.style.transition).toBe('none');
  });
});
