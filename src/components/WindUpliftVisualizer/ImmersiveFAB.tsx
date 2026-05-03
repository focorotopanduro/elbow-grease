import { useCallback, useEffect, useState } from 'react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { track } from '../../lib/analytics';
import './ImmersiveFAB.css';

/**
 * ImmersiveFAB — floating action button cluster anchored to the
 * top-right of the simulator viewport. Hosts two power-user actions
 * that don't deserve their own page real estate but should always
 * be one tap away when present:
 *
 *   1. **Fullscreen toggle** — hits the Fullscreen API on the .wuv__viz
 *      element. True edge-to-edge sim mode, hides the page chrome.
 *      Auto-toggles its label between "Enter fullscreen" and "Exit"
 *      based on `document.fullscreenElement`.
 *
 *   2. **Install app** — only visible when the browser fired
 *      `beforeinstallprompt` (Chromium-based desktop + Android).
 *      Adds the sim to the user's home screen / app launcher so they
 *      can launch it like a native app, no browser chrome.
 *
 * Both actions fire `cta_click` analytics so you can measure adoption.
 *
 * Why a FAB and not inline buttons:
 *   - The sim viewport is the page's hero. Cluttering its edges with
 *     buttons distracts from the simulation itself.
 *   - A subtle floating cluster reads as "extra options" the user can
 *     ignore, vs an in-line bar that demands attention.
 */

interface Props {
  /** Element to fullscreen. Should be the .wuv__viz container so
   *  the SVG fills the viewport without dragging the rest of the
   *  page chrome along. */
  fullscreenTarget?: HTMLElement | null;
}

export default function ImmersiveFAB({ fullscreenTarget }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { canInstall, installed, install } = usePWAInstall();

  // Track fullscreen state via the API event (label flips to "Exit"
  // when active; flips back to "Enter" if user hits Esc to exit)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        track('cta_click', { cta: 'fullscreen_exit', placement: 'immersive_fab' });
      } else if (fullscreenTarget?.requestFullscreen) {
        await fullscreenTarget.requestFullscreen({ navigationUI: 'hide' });
        track('cta_click', { cta: 'fullscreen_enter', placement: 'immersive_fab' });
      }
    } catch {
      // User cancelled / browser blocked — silent
    }
  }, [fullscreenTarget]);

  const handleInstall = useCallback(async () => {
    const accepted = await install();
    track('cta_click', {
      cta: accepted ? 'pwa_install_accepted' : 'pwa_install_dismissed',
      placement: 'immersive_fab',
    });
  }, [install]);

  // Fullscreen API isn't universally supported (Safari iOS only allows
  // it on <video> elements). Hide the button entirely if not supported.
  const fullscreenSupported =
    typeof document !== 'undefined' &&
    document.fullscreenEnabled === true &&
    typeof fullscreenTarget?.requestFullscreen === 'function';

  // Don't render anything if no buttons are available — no empty FAB
  if (!fullscreenSupported && !canInstall) return null;

  return (
    <div className="wuv__fab" role="toolbar" aria-label="Display options">
      {fullscreenSupported && (
        <button
          type="button"
          className="wuv__fab-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Enter fullscreen'}
        >
          {/* Fullscreen icon — corner brackets that flip to "exit" arrows when active */}
          {isFullscreen ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          )}
        </button>
      )}

      {canInstall && !installed && (
        <button
          type="button"
          className="wuv__fab-btn wuv__fab-btn--install"
          onClick={handleInstall}
          aria-label="Install hurricane simulator as an app"
          title="Install as app"
        >
          {/* Download / install icon */}
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
          <span className="wuv__fab-label">Install</span>
        </button>
      )}
    </div>
  );
}
