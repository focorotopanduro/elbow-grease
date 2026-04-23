/**
 * useFocusTrap — contain Tab/Shift+Tab focus cycling inside a
 * container while active, and restore focus to the element that
 * was focused before activation when the trap releases.
 *
 * Critical for modal dialogs (HelpOverlay, GodModeConsole,
 * ComplianceDebugger). Keyboard-only users otherwise Tab right
 * past the modal into the main page, lose track of "where am I".
 *
 * Usage:
 *
 *   function MyModal({ open }: { open: boolean }) {
 *     const ref = useFocusTrap<HTMLDivElement>(open);
 *     if (!open) return null;
 *     return <div ref={ref} role="dialog">...</div>;
 *   }
 *
 * Behavior:
 *   • On mount (active=true): record previous activeElement;
 *     move focus to the FIRST focusable descendant (or the
 *     container itself if none, via tabIndex=-1).
 *   • On Tab at last focusable → wraps to first.
 *   • On Shift+Tab at first focusable → wraps to last.
 *   • On unmount / active=false: restore focus to the recorded
 *     previous element.
 *
 * Does NOT handle Escape — callers own that (usually to close the
 * modal, which in turn sets active=false and triggers release).
 *
 * "Focusable" means any of: anchor with href, button,
 * [contenteditable], input (unless disabled), select, textarea,
 * or anything with explicit tabindex≥0. Hidden and disabled
 * elements are excluded.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

export function useFocusTrap<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    // Remember what had focus BEFORE we seize it.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the container.
    const focusables = queryFocusables(container);
    if (focusables.length > 0) {
      focusables[0]!.focus();
    } else {
      // Fallback: the container itself becomes focusable.
      if (!container.hasAttribute('tabindex')) {
        container.setAttribute('tabindex', '-1');
      }
      container.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const current = queryFocusables(container);
      if (current.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = current[0]!;
      const last = current[current.length - 1]!;
      const activeEl = document.activeElement;

      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeEl === last || !container.contains(activeEl)) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Attach on the CONTAINER (not window) so nested trapped modals
    // each see their own Tab events cleanly.
    container.addEventListener('keydown', onKeyDown);

    return () => {
      container.removeEventListener('keydown', onKeyDown);
      // Restore focus. Guard against the previously-focused node
      // having been removed from the DOM while the modal was open.
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          /* focus can throw on detached nodes — swallow */
        }
      }
    };
  }, [active]);

  return containerRef;
}

// ── Internal ──────────────────────────────────────────────────

function queryFocusables(root: HTMLElement): HTMLElement[] {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  // Filter out ones that are non-rendering (display:none / aria-hidden).
  return nodes.filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) {
      return false;
    }
    return true;
  });
}
