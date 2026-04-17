/**
 * React hook for subscribing to EventBus channels.
 *
 * Automatically unsubscribes on unmount so R3F components can freely
 * listen to engine events without leaking listeners.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { eventBus, type Handler } from '@core/EventBus';

/** Subscribe to an event. The handler is stable across re-renders. */
export function useEvent<T>(event: string, handler: Handler<T>) {
  const saved = useRef(handler);
  saved.current = handler;

  useEffect(() => {
    const h: Handler<T> = (payload) => saved.current(payload);
    return eventBus.on<T>(event, h);
  }, [event]);
}

/** Subscribe and store the latest payload in state (triggers re-render). */
export function useEventState<T>(event: string, initial: T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    return eventBus.on<T>(event, setValue);
  }, [event]);

  return value;
}

/** Returns a stable emit function bound to a specific event. */
export function useEmit<T>(event: string): (payload: T) => void {
  return useCallback(
    (payload: T) => eventBus.emit<T>(event, payload),
    [event],
  );
}
