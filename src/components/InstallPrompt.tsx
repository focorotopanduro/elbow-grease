import { useEffect, useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { track } from '../lib/analytics';
import './InstallPrompt.css';

/**
 * InstallPrompt — Tier 6 PWA install affordance.
 *
 * Two distinct paths:
 *   1. **Web/Android (Chromium)** — uses the existing usePWAInstall
 *      hook to trigger `beforeinstallprompt`. Single-tap install.
 *   2. **iOS Safari** — `beforeinstallprompt` is never fired by Apple.
 *      We detect iOS + Safari and show a "How to add to Home Screen"
 *      hint instead. Per-device dismissal in localStorage.
 *
 * Suppression rules (all must pass to show):
 *   - User is online (no point on offline)
 *   - Not already installed (`installed` from hook OR display-mode standalone)
 *   - User hasn't dismissed THIS surface this session (web) / ever (iOS)
 *   - For web variant: `canInstall === true` (browser fired beforeinstallprompt)
 *   - 5-second engagement delay so prompt doesn't compete with first paint
 *
 * Tracked events:
 *   - cta_click('install_prompt_show', 'pwa', { platform })
 *   - cta_click('install_accept', 'pwa', { platform })
 *   - cta_click('install_dismiss', 'pwa', { platform })
 */

const SESSION_DISMISS_KEY = 'beit:pwa:dismissed:v1';
const IOS_DISMISS_KEY = 'beit:pwa:ios-dismissed:v1';
const SHOW_DELAY_MS = 5000;

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad / iPhone / iPod (excluding Edge/Chrome which spoof in their UA)
  const isIos = /iPad|iPhone|iPod/.test(ua) && !/MSStream/.test(ua);
  if (!isIos) return false;
  // Exclude Chrome on iOS (CriOS) and Firefox on iOS (FxiOS) which use
  // different install flows
  if (/CriOS|FxiOS/.test(ua)) return false;
  return true;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS legacy
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function readSessionDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function readIosDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(IOS_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
  } catch {
    /* private mode — silently skip */
  }
}

function writeIosDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(IOS_DISMISS_KEY, '1');
  } catch {
    /* silent */
  }
}

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 6 12 2 8 6" />
    <path d="M12 2v13" />
    <rect x="4" y="13" width="16" height="9" rx="2" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export default function InstallPrompt() {
  const { canInstall, installed, install } = usePWAInstall();
  // useNetworkStatus returns a boolean directly (online), not an object.
  const online = useNetworkStatus();
  const [iosUser, setIosUser] = useState(false);
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false); // analytics fired flag

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (installed || isStandalone()) return;
    if (!online) return;

    const ios = isIosSafari();
    setIosUser(ios);

    // Check appropriate dismissal store
    if (ios && readIosDismissed()) return;
    if (!ios && readSessionDismissed()) return;

    // For web/Android, the browser must have fired beforeinstallprompt
    if (!ios && !canInstall) return;

    // Engagement delay — wait 5s so the prompt doesn't compete with
    // initial paint or feel pushy on landing.
    const timer = window.setTimeout(() => {
      setVisible(true);
      if (!shown) {
        setShown(true);
        track('cta_click', {
          cta: 'install_prompt_show',
          placement: 'pwa',
          platform: ios ? 'ios' : 'web',
        });
      }
    }, SHOW_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [canInstall, installed, online, shown]);

  const onInstall = async () => {
    const accepted = await install();
    track('cta_click', {
      cta: accepted ? 'install_accept' : 'install_dismiss',
      placement: 'pwa',
      platform: 'web',
      via: 'prompt_button',
    });
    setVisible(false);
    if (!accepted) writeSessionDismissed();
  };

  const onDismiss = () => {
    setVisible(false);
    if (iosUser) {
      writeIosDismissed();
    } else {
      writeSessionDismissed();
    }
    track('cta_click', {
      cta: 'install_dismiss',
      placement: 'pwa',
      platform: iosUser ? 'ios' : 'web',
      via: 'dismiss_button',
    });
  };

  if (!visible) return null;

  // ── iOS variant — instructions, not auto-install ──
  if (iosUser) {
    return (
      <aside className="iprompt iprompt--ios" role="region" aria-label="Install Beit Building app">
        <div className="iprompt__body">
          <p className="iprompt__title">Add to Home Screen</p>
          <p className="iprompt__hint">
            Tap <span className="iprompt__icon-inline"><ShareIcon /></span>{' '}
            then <strong>Add to Home Screen</strong>{' '}
            <span className="iprompt__icon-inline"><PlusIcon /></span>
          </p>
        </div>
        <button
          type="button"
          className="iprompt__close"
          onClick={onDismiss}
          aria-label="Dismiss install hint"
        >
          Not now
        </button>
      </aside>
    );
  }

  // ── Web/Android variant — single-tap install ──
  return (
    <aside className="iprompt iprompt--web" role="region" aria-label="Install Beit Building app">
      <div className="iprompt__body">
        <p className="iprompt__title">Install Beit Building</p>
        <p className="iprompt__hint">
          Faster load. One-tap launch from your home screen.
        </p>
      </div>
      <div className="iprompt__actions">
        <button
          type="button"
          className="iprompt__install"
          onClick={onInstall}
          data-cta-source="install_prompt_install"
        >
          Install
        </button>
        <button
          type="button"
          className="iprompt__close"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
        >
          Not now
        </button>
      </div>
    </aside>
  );
}
