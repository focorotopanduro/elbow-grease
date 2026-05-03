import { useEffect, useState } from 'react';
import { track } from '../lib/analytics';

/**
 * Subscribes to `navigator.onLine` + `online`/`offline` events to
 * surface the current connection state. Each transition fires
 * `network_offline` / `network_online` analytics events so you can
 * correlate form-submission failures with network blips.
 *
 * UX use: render a tiny banner if `online === false` so the user
 * knows WHY their submit failed (vs blaming you / the form).
 */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setOnline(true);
      track('network_online');
    };
    const handleOffline = () => {
      setOnline(false);
      track('network_offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
