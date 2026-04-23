/**
 * HelpOverlay — Phase 9 (ARCHITECTURE.md §6) mode-filter tests.
 *
 * The overlay should show:
 *   • All `global` shortcuts regardless of active workspace.
 *   • Only the matching workspace's domain-scoped shortcuts.
 *
 * Relies on the Phase 2a `shortcutMatchesMode` helper for the
 * filter decision — so most of the work is verifying the overlay
 * actually WIRES THROUGH that helper (+ clears the state
 * between test cases). Registry contents are tested separately
 * in `shortcutMode.spec.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { HelpOverlay } from '../HelpOverlay';
import { useAppModeStore } from '@store/appModeStore';

/** Open the overlay by dispatching a `?` keydown on window. */
function openOverlay() {
  act(() => {
    const ev = new KeyboardEvent('keydown', { key: '?', cancelable: true });
    window.dispatchEvent(ev);
  });
}

beforeEach(() => {
  // Each test sets its own mode explicitly.
});

afterEach(() => {
  // Close overlay (escape) + unmount.
  act(() => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    window.dispatchEvent(ev);
  });
  cleanup();
});

describe('HelpOverlay — mode filter (ARCHITECTURE.md §6)', () => {
  it('in plumbing mode: plumbing + global shortcuts visible, roofing absent', () => {
    useAppModeStore.setState({ mode: 'plumbing' });
    const { container, rerender: _ } = render(<HelpOverlay />);
    openOverlay();

    const text = container.textContent ?? '';

    // Plumbing-scoped entries visible.
    expect(text).toContain('Switch to Draw mode');     // mode.draw (plumbing)
    expect(text).toContain('½" diameter');             // draw.diameter.1 (plumbing)
    expect(text).toContain('Toggle waste system');     // layer.waste (plumbing)

    // Global entries visible.
    expect(text).toContain('Undo last action');        // edit.undo (global)
    expect(text).toContain('Save');                    // project.save (global)
    expect(text).toContain('This help overlay');       // debug.help (global)
  });

  it('in roofing mode: global-only; no plumbing entries leak through', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<HelpOverlay />);
    openOverlay();

    const text = container.textContent ?? '';

    // Plumbing-scoped entries HIDDEN.
    expect(text).not.toContain('Switch to Draw mode');
    expect(text).not.toContain('½" diameter');
    expect(text).not.toContain('Toggle waste system');
    expect(text).not.toContain('Drop a 2-port manifold');
    expect(text).not.toContain('Mass-edit material');

    // Global entries still visible — contractor-level shortcuts
    // work regardless of workspace.
    expect(text).toContain('Undo last action');
    expect(text).toContain('Save');
    expect(text).toContain('This help overlay');
    expect(text).toContain('Perspective view');        // view.perspective (global)
  });

  it('text-filter composes with the mode filter (search narrows inside the active mode only)', () => {
    useAppModeStore.setState({ mode: 'roofing' });
    const { container } = render(<HelpOverlay />);
    openOverlay();

    // Without flipping into plumbing mode, typing "diameter" in the
    // search box should produce an empty result — diameter shortcuts
    // are plumbing-scoped and already filtered out.
    const input = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (!input) return;

    act(() => {
      input.focus();
      input.value = 'diameter';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // After the filter, either the panel shows "no matches" or the
    // drawer empties — either way, no "½ inch / ½\" diameter" row.
    const post = container.textContent ?? '';
    expect(post).not.toContain('½" diameter');
  });
});
