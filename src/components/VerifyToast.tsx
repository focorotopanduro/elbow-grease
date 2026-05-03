import { useEffect, useRef, useState } from 'react';
import { VERIFY_EVENT, type VerifyEventDetail } from './dbprData';

/**
 * VerifyToast — a single root-mounted toast that surfaces step-by-step
 * paste guidance whenever ANY "Verify on DBPR" button on the page is
 * clicked. Listens for the custom DOM event dispatched by `verifyLicense`,
 * shows a glass card pinned to the lower-right of the viewport for ~9
 * seconds, then auto-dismisses (or stays visible while hovered).
 *
 * Why a single root component (instead of inline toasts per trust block):
 *   - Visitor clicks Verify → DBPR tab opens → they switch back to OUR
 *     tab → toast is right where their eye lands (lower right ≈ where
 *     OS notifications appear in Windows + macOS)
 *   - Multiple verify clicks queue cleanly through a single DOM owner
 *   - Page chrome stays unaffected if no one ever clicks
 */
const TOAST_MS = 9000;

export default function VerifyToast() {
  const [active, setActive] = useState<{ licenseNumber: string; copied: boolean; key: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    const onVerify = (e: Event) => {
      const detail = (e as CustomEvent<VerifyEventDetail>).detail;
      if (!detail) return;
      // Bumping the key forces a re-mount → the slide-in animation re-runs
      // even if the toast was already showing for a previous click.
      setActive({ ...detail, key: Date.now() });
    };
    document.addEventListener(VERIFY_EVENT, onVerify);
    return () => document.removeEventListener(VERIFY_EVENT, onVerify);
  }, []);

  // Auto-dismiss timer (paused while hovered so visitors have time to read)
  useEffect(() => {
    if (!active || paused) return;
    if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => {
      setActive(null);
    }, TOAST_MS);
    return () => {
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, [active, paused]);

  if (!active) return null;

  return (
    <div
      key={active.key}
      className="vt"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="vt__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </div>
      <div className="vt__body">
        <p className="vt__head">
          <strong>{active.licenseNumber}</strong> {active.copied ? 'copied to clipboard' : 'opening DBPR'}
        </p>
        <ol className="vt__steps">
          <li>Switch to the new <strong>Florida DBPR</strong> tab</li>
          <li>Paste in <strong>License Number</strong> — <kbd>Ctrl</kbd><span className="vt__plus">+</span><kbd>V</kbd> <span className="vt__or">(<kbd>⌘</kbd>+<kbd>V</kbd> on Mac)</span></li>
          <li>If asked, set <strong>License Category</strong> to <em>Construction Industry</em> — otherwise leave the dropdowns blank</li>
          <li>Click <strong>Search</strong> · the live state record opens</li>
        </ol>
      </div>
      <button
        type="button"
        className="vt__close"
        onClick={() => setActive(null)}
        aria-label="Dismiss"
      >×</button>
    </div>
  );
}
