/**
 * useRafEvent — requestAnimationFrame-coalesced event subscription.
 *
 * Drop-in replacement for `useEvent` when the subscriber is EXPENSIVE
 * per-invocation (collision prediction, fitting regeneration, tube-
 * geometry rebuild) and is driven by a bursty source (pointermove-
 * driven route updates can fire 120+ times per second on a high-refresh
 * display — way past what humans can perceive).
 *
 * Contract:
 *
 *   • All emissions within the same animation frame collapse into ONE
 *     handler call that receives the MOST RECENT payload.
 *   • If no emissions have been queued, no handler call is made — we
 *     don't poll.
 *   • On unmount, any scheduled frame is cancelled and no trailing
 *     call fires.
 *
 * Typical load reduction: a 20-point drag that emits 20 PIPE_ROUTE_UPDATE
 * events across ~160ms (10 frames @ 60Hz) triggers 10 handler calls
 * instead of 20. On a 120Hz display it's closer to 10 vs 40. The
 * collision-prediction path benefits the most because its cost scales
 * with (elements × points) and was previously running on every single
 * intermediate state.
 *
 * Why a hook and not a bus-level throttle? Some subscribers DO need
 * every event (audio engine, FSM transitions, analytics). Keeping the
 * coalescing at the subscription call-site means we opt-in per hot
 * spot instead of blanket-throttling everyone.
 *
 * Test note: during vitest runs `requestAnimationFrame` is not
 * available in happy-dom by default; tests should either install a
 * polyfill or assert against the `flushCoalescedFrame` export that
 * tests can call directly.
 */

import { useEffect, useRef } from 'react';
import { eventBus, type Handler } from '@core/EventBus';
import { recordRafEmission, recordRafInvocation } from '@core/perf/PerfStats';

/** Cross-environment rAF — falls back to a microtask-ish setTimeout 0 when
 *  running in a non-browser test environment. */
const raf: (cb: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (cb) => requestAnimationFrame(cb)
    : (cb) => setTimeout(cb, 0) as unknown as number;

const cancelRaf: (id: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (id) => cancelAnimationFrame(id)
    : (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

/**
 * Subscribe to `event`, but coalesce bursts into one invocation per
 * animation frame using the latest payload. Handler identity can change
 * freely across re-renders; a ref is used so we don't resubscribe.
 */
export function useRafEvent<T>(event: string, handler: Handler<T>): void {
  const savedHandler = useRef(handler);
  savedHandler.current = handler;

  useEffect(() => {
    let frameId: number | null = null;
    let latest: { payload: T } | null = null;
    let disposed = false;

    const flush = () => {
      frameId = null;
      if (disposed || latest === null) return;
      const payload = latest.payload;
      latest = null;
      // Count handler invocations for the PerfHUD drop-rate readout
      // (Phase 14.AC.4). One integer add — keeps working path clean.
      recordRafInvocation();
      savedHandler.current(payload);
    };

    const listener: Handler<T> = (payload) => {
      // Count every raw emission so we can compute (received - fired)
      // savings in the PerfHUD. (Phase 14.AC.4.)
      recordRafEmission();
      latest = { payload };
      if (frameId === null) {
        frameId = raf(flush);
      }
    };

    const unsubscribe = eventBus.on<T>(event, listener);

    return () => {
      disposed = true;
      unsubscribe();
      if (frameId !== null) {
        cancelRaf(frameId);
        frameId = null;
      }
      latest = null;
    };
  }, [event]);
}
