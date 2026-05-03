/**
 * useRasterMode — global toggle for the SVG↔PNG override system.
 *
 * The artist round-trip is "paint a PNG → see it in the scene". But to
 * EVALUATE the painting, the artist needs to compare against the SVG
 * fallback ("does my painted version actually look better?"). Without
 * this toggle, comparing means deleting the PNG, refreshing, looking,
 * restoring the file, refreshing, looking again — multi-step + fragile.
 *
 * Three ways to flip the toggle:
 *   1. URL param `?raster=off`  — survives reload, shareable link
 *   2. Keyboard shortcut Alt+R — instant toggle, ideal for compare
 *   3. JS API setRasterMode()   — for buttons / dev tools
 *
 * State is module-level so all <SceneElement> instances see the same
 * value without prop-drilling. Pub/sub via a Set of listeners keeps
 * React updates cheap (only the components that subscribe re-render).
 *
 * The URL is the source of truth: toggling via keyboard updates the URL
 * via history.replaceState, so reload preserves state and screenshots
 * with the URL show the same view to anyone who opens the link.
 */

import { useEffect, useState } from 'react';

export type RasterMode = 'on' | 'off';

const URL_PARAM = 'raster';

/** Read the initial mode from `?raster=off`. Defaults to 'on'. */
function readFromUrl(): RasterMode {
  if (typeof window === 'undefined') return 'on';
  try {
    const v = new URLSearchParams(window.location.search).get(URL_PARAM);
    return v === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

/** Reflect the mode back into the URL via history.replaceState (no
 *  history entry created — Back button still goes where it should). */
function writeToUrl(mode: RasterMode) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (mode === 'off') url.searchParams.set(URL_PARAM, 'off');
    else url.searchParams.delete(URL_PARAM);
    window.history.replaceState({}, '', url.toString());
  } catch {
    // history API unavailable (very rare); fail silently — the in-memory
    // state still updates so the visualizer responds.
  }
}

let currentMode: RasterMode = readFromUrl();
const listeners = new Set<(m: RasterMode) => void>();

export function getRasterMode(): RasterMode {
  return currentMode;
}

export function setRasterMode(mode: RasterMode): void {
  if (mode === currentMode) return;
  currentMode = mode;
  writeToUrl(mode);
  listeners.forEach((fn) => fn(mode));
}

export function toggleRasterMode(): void {
  setRasterMode(currentMode === 'on' ? 'off' : 'on');
}

/**
 * Hook for React components. Subscribes to the singleton store; returns
 * the current mode. Components re-render automatically on toggle.
 */
export function useRasterMode(): RasterMode {
  const [mode, setMode] = useState<RasterMode>(currentMode);
  useEffect(() => {
    listeners.add(setMode);
    // Sync once on mount in case the URL was changed between render
    // and effect (e.g. by a router on the same page).
    if (mode !== currentMode) setMode(currentMode);
    return () => {
      listeners.delete(setMode);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return mode;
}

/** Bind Alt+R as a global toggle, but only if focus isn't in a form
 *  control (don't hijack the artist while they're typing). Module-load
 *  time so the listener attaches once, regardless of how many
 *  <SceneElement>s exist. */
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || e.key.toLowerCase() !== 'r') return;
    if (e.ctrlKey || e.metaKey) return; // leave Ctrl+Alt+R for OS bindings
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    toggleRasterMode();
  });
}
