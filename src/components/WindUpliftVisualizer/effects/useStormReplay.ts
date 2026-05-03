import { useEffect, useRef, useState } from 'react';
import type { NamedStorm } from '../../../data/orlando';

/**
 * Storm replay engine.
 *
 * Given a named storm, generates a continuous wind-speed time series:
 *
 *   t=0          → V_calm  (60 mph)
 *   t=rampIn     → V_peak  (linear ease-in)
 *   t=rampIn+sus → V_peak  (sustained, slight noise)
 *   t=duration   → V_low   (cubic ease-out — storms don't drop instantly)
 *
 * Total duration ~12 seconds. Each storm's profile (rampIn, sustained,
 * rampOut) is tuned to its real landfall character — Charley was a quick-
 * mover; Ian had a longer sustained eyewall; Milton degraded fast.
 */

const V_CALM = 60;
const V_LOW = 75;

interface Profile {
  rampIn: number;       // seconds to reach peak
  sustained: number;    // seconds at peak
  rampOut: number;      // seconds back down
}

const DEFAULT_PROFILE: Profile = { rampIn: 4, sustained: 3, rampOut: 5 };

/** Per-storm landfall character — informed by NHC HURDAT2 best-track data */
const STORM_PROFILES: Record<string, Profile> = {
  andrew_1992: { rampIn: 5, sustained: 2, rampOut: 4 },     // fast peak, brutal eye
  charley_2004: { rampIn: 3, sustained: 2, rampOut: 4 },     // very fast-moving
  ian_2022:    { rampIn: 5, sustained: 4, rampOut: 6 },     // slow + long eyewall
  milton_2024: { rampIn: 4, sustained: 3, rampOut: 5 },     // standard
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export interface ReplayState {
  isPlaying: boolean;
  isPaused: boolean;
  /** 0-1 progress through the entire timeline */
  progress: number;
  /** Computed wind speed for this instant */
  V: number;
  /** Storm currently being replayed, if any */
  storm: NamedStorm | null;
  /** Total timeline duration in seconds */
  duration: number;
  /** Current time in seconds */
  elapsed: number;
}

export function useStormReplay() {
  const [storm, setStorm] = useState<NamedStorm | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [V, setV] = useState(V_CALM);

  const startedAtRef = useRef<number>(0);
  const pauseAccumRef = useRef<number>(0);
  const pauseAtRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const profile: Profile = storm
    ? STORM_PROFILES[storm.id] ?? DEFAULT_PROFILE
    : DEFAULT_PROFILE;

  const duration = profile.rampIn + profile.sustained + profile.rampOut;

  // Compute V from elapsed time + storm peak
  const computeV = (t: number, peak: number): number => {
    const { rampIn, sustained, rampOut } = profile;
    if (t < rampIn) {
      return V_CALM + (peak - V_CALM) * easeInOutCubic(t / rampIn);
    } else if (t < rampIn + sustained) {
      // Sustained with subtle wobble
      const susT = (t - rampIn) / sustained;
      const wobble = Math.sin(susT * Math.PI * 4) * 4;
      return peak + wobble;
    } else if (t < duration) {
      const outT = (t - rampIn - sustained) / rampOut;
      return peak - (peak - V_LOW) * easeOutCubic(outT);
    }
    return V_LOW;
  };

  useEffect(() => {
    if (!isPlaying || isPaused || !storm) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tick = (now: number) => {
      const e = (now - startedAtRef.current - pauseAccumRef.current) / 1000;
      if (e >= duration) {
        setElapsed(duration);
        setV(reduce ? storm.peakMph : V_LOW);
        setIsPlaying(false);
        return;
      }
      setElapsed(e);
      setV(Math.round(computeV(e, storm.peakMph)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isPaused, storm, duration]);

  const start = (s: NamedStorm) => {
    setStorm(s);
    setIsPlaying(true);
    setIsPaused(false);
    setElapsed(0);
    pauseAccumRef.current = 0;
    startedAtRef.current = performance.now();
    setV(V_CALM);
  };

  const pause = () => {
    if (!isPlaying || isPaused) return;
    pauseAtRef.current = performance.now();
    setIsPaused(true);
  };

  const resume = () => {
    if (!isPlaying || !isPaused) return;
    pauseAccumRef.current += performance.now() - pauseAtRef.current;
    setIsPaused(false);
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setIsPlaying(false);
    setIsPaused(false);
    setStorm(null);
    setElapsed(0);
    setV(V_CALM);
    pauseAccumRef.current = 0;
  };

  const restart = () => {
    if (!storm) return;
    start(storm);
  };

  const state: ReplayState = {
    isPlaying,
    isPaused,
    progress: duration > 0 ? Math.min(1, elapsed / duration) : 0,
    V,
    storm,
    duration,
    elapsed,
  };

  return { state, start, pause, resume, stop, restart };
}
