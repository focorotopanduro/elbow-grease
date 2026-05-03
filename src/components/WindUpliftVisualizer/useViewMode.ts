import { useCallback, useEffect, useState } from 'react';

export type ViewMode = 'front' | 'iso';

const URL_KEY = 'view';
const VALID: ViewMode[] = ['front', 'iso'];

function readUrl(): ViewMode {
  if (typeof window === 'undefined') return 'front';
  const params = new URLSearchParams(window.location.search);
  const raw = params.get(URL_KEY) as ViewMode | null;
  return raw && VALID.includes(raw) ? raw : 'front';
}

function writeUrl(v: ViewMode) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (v === 'front') params.delete(URL_KEY);
  else params.set(URL_KEY, v);
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}

/**
 * useViewMode — front view vs isometric "engineer mode". Persisted to URL
 * so a shared link preserves the chosen view. Defaults to 'front' (the
 * homeowner-friendly emotional view).
 */
export function useViewMode() {
  const [mode, setMode] = useState<ViewMode>(readUrl);

  useEffect(() => {
    writeUrl(mode);
  }, [mode]);

  const set = useCallback((v: ViewMode) => setMode(v), []);
  const toggle = useCallback(
    () => setMode((m) => (m === 'front' ? 'iso' : 'front')),
    [],
  );

  return { mode, set, toggle };
}
