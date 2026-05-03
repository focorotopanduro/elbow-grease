import { useCallback, useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS, type AchievementId } from '../../../data/achievements';

const STORAGE_KEY = 'beit_wuv_achievements_v1';

/**
 * Achievement engine.
 *
 * - `unlocked`: Set of unlocked achievement IDs (persisted to localStorage)
 * - `unlock(id)`: idempotent — only fires the toast once per id
 * - `recent`: most recently-unlocked achievement (drives the toast)
 * - `dismissRecent()`: clears the toast (called after fade-out)
 */
export function useAchievements() {
  const [unlocked, setUnlocked] = useState<Set<AchievementId>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(arr.filter((id): id is AchievementId => id in ACHIEVEMENTS));
    } catch {
      return new Set();
    }
  });

  const [recent, setRecent] = useState<AchievementId | null>(null);
  const queueRef = useRef<AchievementId[]>([]);

  // Persist whenever unlocked changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(unlocked)));
    } catch {
      /* quota or private mode */
    }
  }, [unlocked]);

  // Show queued toasts one at a time
  useEffect(() => {
    if (recent || queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    setRecent(next);
  }, [recent]);

  const unlock = useCallback(
    (id: AchievementId) => {
      setUnlocked((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);

        // Queue toast
        queueRef.current.push(id);

        // Check for meta-achievement: all 4 storms = hurricane_pro
        const allStorms: AchievementId[] = [
          'survived_milton',
          'survived_ian',
          'survived_charley',
          'survived_andrew',
        ];
        if (
          allStorms.every((s) => next.has(s)) &&
          !next.has('hurricane_pro')
        ) {
          next.add('hurricane_pro');
          queueRef.current.push('hurricane_pro');
        }

        return next;
      });
    },
    [],
  );

  const dismissRecent = useCallback(() => setRecent(null), []);

  const reset = useCallback(() => {
    setUnlocked(new Set());
    queueRef.current = [];
    setRecent(null);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    }
  }, []);

  return { unlocked, unlock, recent, dismissRecent, reset };
}
