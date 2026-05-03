import { useCallback, useEffect, useState } from 'react';

/**
 * usePWAInstall — wraps the browser's `beforeinstallprompt` event so
 * a component can render an "Install app" button only when the
 * browser actually supports installation AND the page is install-eligible.
 *
 * Browsers that fire `beforeinstallprompt` (Chromium-based: Chrome,
 * Edge, Opera, Brave, Samsung Internet on both desktop + Android).
 * NOT fired by Safari (iOS or macOS) — Apple uses Add-to-Home-Screen
 * via a manual gesture instead, which the existing apple-mobile-web-app
 * meta tags handle.
 *
 * Eligibility criteria the browser checks before firing the event:
 *   - Site served over HTTPS (or localhost)
 *   - Has a valid web manifest with required fields
 *   - Has icons of correct sizes
 *   - User has visited the site before / engaged for ~30 sec
 *   - Not already installed
 *
 * Hook contract:
 *   - `canInstall`     true when the prompt is queued + ready to show
 *   - `install()`      async — shows the prompt, returns true on accept
 *   - `installed`      true after a successful install (also set if the
 *                      user installed via the browser menu without our
 *                      button — we listen for `appinstalled`)
 */

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export function usePWAInstall(): {
  canInstall: boolean;
  installed: boolean;
  install: () => Promise<boolean>;
} {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // stop the browser's default mini-infobar
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // Detect already-installed state — when the page is launched from
    // the home screen / desktop shortcut, display-mode media query
    // returns 'standalone' (Chrome/Edge/Android) or
    // navigator.standalone is true (iOS Safari legacy).
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    ) {
      setInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    if (!deferredPrompt) return false;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null); // can only prompt once per event
      return choice.outcome === 'accepted';
    } catch {
      return false;
    }
  }, [deferredPrompt]);

  return {
    canInstall: deferredPrompt !== null && !installed,
    installed,
    install,
  };
}
