import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { track } from '../lib/analytics';
import './PageImmersiveFAB.css';

/**
 * PageImmersiveFAB — page-level floating cluster for fullscreen +
 * PWA install. Fixed-position top-right, follows scroll. Visible
 * across the whole hurricane page (not just the sim).
 *
 * Differences from the previous in-sim FAB:
 *   1. **Page-level placement** — fixed-positioned on the viewport,
 *      not absolute on the sim viewport. Visible while scrolling
 *      through the sidebar HUD or the lead-form section.
 *   2. **Larger fullscreen target** — fullscreens the WHOLE sim
 *      section (.hup__viz), not just the SVG inside it. So the
 *      sidebar HUD + sim viewport both fill the screen — true
 *      videogame-console fullscreen.
 *   3. **Keyboard shortcut** — `F` toggles fullscreen anywhere on
 *      the page (except when a form input has focus).
 *   4. **Exit hint overlay** — when fullscreen is active, a small
 *      "Press Esc to exit" hint floats at the top, fades after 3s.
 *   5. **Auto-hide while idle** — after 4s without mouse movement
 *      in fullscreen mode, the FAB fades to 25% opacity so it
 *      doesn't compete with the sim. Hover/move brings it back.
 *
 * Renders nothing if neither fullscreen nor PWA install is supported.
 */

interface Props {
  /** Element to fullscreen. Typically the .hup__viz <section> ref
   *  (sim + its surrounding chrome). If omitted, falls back to
   *  document.documentElement (whole page). */
  fullscreenTargetRef: RefObject<HTMLElement | null>;
}

export default function PageImmersiveFAB({ fullscreenTargetRef }: Props) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showExitHint, setShowExitHint] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const exitHintTimer = useRef<number | null>(null);
  const { canInstall, installed, install } = usePWAInstall();

  // Track fullscreen state via the API event
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = document.fullscreenElement !== null;
      setIsFullscreen(active);
      if (active) {
        // Surface the exit hint for 3 seconds when entering fullscreen
        setShowExitHint(true);
        if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current);
        exitHintTimer.current = window.setTimeout(() => setShowExitHint(false), 3000);
      } else {
        setShowExitHint(false);
        if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current);
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (exitHintTimer.current) window.clearTimeout(exitHintTimer.current);
    };
  }, []);

  // IDLE FADE — in fullscreen mode, fade FAB after 4s of no mouse
  // movement so it doesn't visually compete with the sim. Any
  // movement / pointer event brings it back to full opacity.
  useEffect(() => {
    if (!isFullscreen) {
      setIdle(false);
      return;
    }
    const wake = () => {
      setIdle(false);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setIdle(true), 4000);
    };
    wake(); // start the timer immediately
    document.addEventListener('mousemove', wake);
    document.addEventListener('pointerdown', wake);
    return () => {
      document.removeEventListener('mousemove', wake);
      document.removeEventListener('pointerdown', wake);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        track('cta_click', { cta: 'fullscreen_exit', placement: 'page_fab' });
      } else {
        const target = fullscreenTargetRef.current ?? document.documentElement;
        if (target?.requestFullscreen) {
          await target.requestFullscreen({ navigationUI: 'hide' });
          track('cta_click', { cta: 'fullscreen_enter', placement: 'page_fab' });
        }
      }
    } catch {
      // User cancelled / browser blocked — silent
    }
  }, [fullscreenTargetRef]);

  // KEYBOARD SHORTCUT — `F` toggles fullscreen. Skipped if a form
  // field is focused (so users typing the letter F into the lead
  // form don't accidentally trigger fullscreen).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleFullscreen]);

  const handleInstall = useCallback(async () => {
    const accepted = await install();
    track('cta_click', {
      cta: accepted ? 'pwa_install_accepted' : 'pwa_install_dismissed',
      placement: 'page_fab',
    });
  }, [install]);

  // Fullscreen API isn't universally supported (Safari iOS only allows
  // it on <video> elements). Hide the button entirely if not supported.
  const fullscreenSupported =
    typeof document !== 'undefined' && document.fullscreenEnabled === true;

  // Don't render anything if neither button is available
  if (!fullscreenSupported && !canInstall) return null;

  return (
    <>
      <div
        className={`pfab ${isFullscreen ? 'pfab--fullscreen' : ''} ${idle ? 'pfab--idle' : ''}`}
        role="toolbar"
        aria-label="Display options"
      >
        {fullscreenSupported && (
          <button
            type="button"
            className="pfab__btn"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen (Esc or F)' : 'Enter fullscreen (F)'}
            title={isFullscreen ? 'Exit fullscreen — Esc or F' : 'Enter fullscreen — F'}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
            <span className="pfab__label">
              {isFullscreen ? 'Exit' : 'Fullscreen'}
            </span>
            <kbd className="pfab__kbd">F</kbd>
          </button>
        )}

        {canInstall && !installed && !isFullscreen && (
          <button
            type="button"
            className="pfab__btn pfab__btn--install"
            onClick={handleInstall}
            aria-label="Install hurricane simulator as an app"
            title="Install as a desktop app"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span className="pfab__label">Install app</span>
          </button>
        )}
      </div>

      {/* EXIT HINT — surfaces for 3s when entering fullscreen so
          users discover the keyboard shortcut. Pure decorative
          overlay, ignored by screen readers (it's redundant with
          the FAB's aria-label). */}
      {showExitHint && (
        <div className="pfab__exit-hint" aria-hidden="true">
          <kbd>Esc</kbd> or <kbd>F</kbd> to exit fullscreen
        </div>
      )}
    </>
  );
}
