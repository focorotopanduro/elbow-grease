import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_TIME_OF_DAY,
  TIME_OF_DAY,
  type TimeOfDayId,
} from '../../data/timeOfDay';

const URL_KEY = 't';
const STORAGE_KEY = 'wuv:tod:v1';
const VALID = Object.keys(TIME_OF_DAY) as TimeOfDayId[];

function readInitial(): TimeOfDayId {
  if (typeof window === 'undefined') return DEFAULT_TIME_OF_DAY;
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get(URL_KEY) as TimeOfDayId | null;
  if (fromUrl && VALID.includes(fromUrl)) return fromUrl;
  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY) as TimeOfDayId | null;
    if (fromStorage && VALID.includes(fromStorage)) return fromStorage;
  } catch { /* private mode */ }
  return DEFAULT_TIME_OF_DAY;
}

/**
 * useTimeOfDay — selects the lighting palette (dawn/midday/dusk/night).
 * Persisted to URL (`?t=dusk`) AND localStorage so the homeowner sees the
 * same scene on reload AND when sharing the link.
 *
 * Also exposes an auto-cycle "demo" mode that walks through the four
 * palettes every CYCLE_INTERVAL_MS seconds. URL is NOT updated while
 * cycling (would re-render every step + pollute history).
 */
const CYCLE_INTERVAL_MS = 6000;
const CYCLE_ORDER: TimeOfDayId[] = ['dawn', 'midday', 'dusk', 'night'];

export function useTimeOfDay() {
  const [tod, setTod] = useState<TimeOfDayId>(readInitial);
  const [cycling, setCycling] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || cycling) return;
    // URL (skip during cycle)
    const params = new URLSearchParams(window.location.search);
    if (tod === DEFAULT_TIME_OF_DAY) params.delete(URL_KEY);
    else params.set(URL_KEY, tod);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? '?' + qs : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    // localStorage
    try {
      window.localStorage.setItem(STORAGE_KEY, tod);
    } catch { /* ignore */ }
  }, [tod, cycling]);

  // Auto-cycle effect — walks through CYCLE_ORDER while `cycling` is true
  useEffect(() => {
    if (!cycling) return;
    const interval = window.setInterval(() => {
      setTod((current) => {
        const idx = CYCLE_ORDER.indexOf(current);
        const next = CYCLE_ORDER[(idx + 1) % CYCLE_ORDER.length];
        return next;
      });
    }, CYCLE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cycling]);

  const set = useCallback((id: TimeOfDayId) => {
    setCycling(false); // manual pick stops the cycle
    setTod(id);
  }, []);

  const toggleCycle = useCallback(() => setCycling((c) => !c), []);

  return { tod, set, palette: TIME_OF_DAY[tod], cycling, toggleCycle };
}
