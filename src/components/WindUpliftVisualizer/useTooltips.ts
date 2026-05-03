import { useCallback, useEffect, useState } from 'react';

const URL_KEY = 'labels';
const STORAGE_KEY = 'wuv:labels:v1';

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get(URL_KEY) === '1') return true;
  if (params.get(URL_KEY) === '0') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch { return false; }
}

/**
 * useTooltips — controls the "Labels" mode that surfaces educational
 * tooltips on every major scene element. Persisted to URL (`?labels=1`)
 * AND localStorage so a contractor can deep-link an inspector to the
 * labeled view.
 */
export function useTooltips() {
  const [enabled, setEnabled] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (enabled) params.set(URL_KEY, '1');
    else params.delete(URL_KEY);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch { /* ignore */ }
  }, [enabled]);

  const set = useCallback((b: boolean) => setEnabled(b), []);
  const toggle = useCallback(() => setEnabled((v) => !v), []);

  return { enabled, set, toggle };
}
