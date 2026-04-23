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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ModeTabs } from '../ModeTabs';
import { useAppModeStore, APP_MODE_ACCENTS } from '@store/appModeStore';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

beforeEach(() => {
  useAppModeStore.setState({ mode: 'plumbing' });
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
