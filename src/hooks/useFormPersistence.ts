import { useEffect, useRef, useState } from 'react';

interface Options<T> {
  /** localStorage key — namespace per form so multiple forms don't collide. */
  key: string;
  /** Default values used when nothing is persisted. */
  initial: T;
  /** Debounce window for writes (ms). Default 350. */
  debounceMs?: number;
  /** Max age of persisted state (ms). Default 24h.
   *  Stale entries are dropped on read so users don't see data they
   *  no longer remember entering. */
  maxAgeMs?: number;
  /** Validate that the persisted shape matches expectations. Returning
   *  false discards the stored value (use for schema migrations). */
  validate?: (parsed: unknown) => parsed is T;
}

interface Stored<T> {
  v: 1;
  t: number;
  data: T;
}

/**
 * Persist a form's draft to localStorage with debounced writes + TTL +
 * schema validation. Restores on mount, clears on `clear()`.
 *
 * Why this matters:
 *   - Users hit "back", lose tab focus, or accidentally close the tab.
 *     Without persistence, a half-typed lead form loses everything →
 *     users feel punished, abandon → lost lead.
 *   - With persistence: they come back, the form is exactly as they
 *     left it. Conversion-rate impact is measurable on long-form fills.
 *
 * Returns:
 *   - [state, setState, { clear, restoredFromStorage }]
 *
 * Failure modes (silent):
 *   - localStorage disabled (private browsing, quota full, SSR)
 *   - JSON parse error (corrupted entry)
 *   - Schema mismatch
 *   In all cases the hook falls back to `initial` and writes are no-ops.
 */
export function useFormPersistence<T extends object>({
  key,
  initial,
  debounceMs = 350,
  maxAgeMs = 24 * 60 * 60 * 1000,
  validate,
}: Options<T>): [T, (next: T) => void, { clear: () => void; restoredFromStorage: boolean }] {
  const [restoredFromStorage, setRestored] = useState(false);
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initial;
      const parsed = JSON.parse(raw) as Stored<T>;
      if (!parsed || parsed.v !== 1 || typeof parsed.t !== 'number') return initial;
      if (Date.now() - parsed.t > maxAgeMs) {
        window.localStorage.removeItem(key);
        return initial;
      }
      if (validate && !validate(parsed.data)) {
        window.localStorage.removeItem(key);
        return initial;
      }
      // Restored successfully — flag it so the consumer can show a
      // "we kept your spot" banner if they want.
      // setRestored runs in effect (below) to avoid hydration warnings.
      return parsed.data;
    } catch {
      return initial;
    }
  });

  // Mark restored on mount (one tick after the lazy initializer above).
  // We can't setState synchronously inside the initializer.
  const restoredCheckRan = useRef(false);
  useEffect(() => {
    if (restoredCheckRan.current) return;
    restoredCheckRan.current = true;
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(key);
    if (raw) setRestored(true);
  }, [key]);

  // Debounced writer
  const writeTimer = useRef<number | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (writeTimer.current) window.clearTimeout(writeTimer.current);
    writeTimer.current = window.setTimeout(() => {
      try {
        const stored: Stored<T> = { v: 1, t: Date.now(), data: state };
        window.localStorage.setItem(key, JSON.stringify(stored));
      } catch {
        /* quota exceeded / private mode — silently skip */
      }
    }, debounceMs);
    return () => {
      if (writeTimer.current) window.clearTimeout(writeTimer.current);
    };
  }, [state, key, debounceMs]);

  // CROSS-TAB SYNC — listen to localStorage changes from OTHER tabs
  // of the same origin. Without this, opening two tabs of the lead
  // form means the user can fill divergent data in each and only the
  // last-touched tab wins. With this, edits made in tab B propagate
  // to tab A in near-real-time so both stay consistent.
  //
  // The `storage` event only fires in OTHER tabs (not the one that
  // wrote), so there's no infinite loop risk. Validate the inbound
  // payload before applying so a corrupted entry from another tab
  // doesn't break this tab's state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (e.newValue == null) return; // entry was cleared in another tab
      try {
        const parsed = JSON.parse(e.newValue) as Stored<T>;
        if (!parsed || parsed.v !== 1 || typeof parsed.t !== 'number') return;
        if (validate && !validate(parsed.data)) return;
        setState(parsed.data);
      } catch {
        /* ignore corrupted cross-tab payload */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, validate]);

  function clear() {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setRestored(false);
  }

  return [state, setState, { clear, restoredFromStorage }];
}
