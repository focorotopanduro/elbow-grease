/**
 * React hook that binds a FSM instance to component state.
 *
 * Re-renders the component on every FSM transition so the UI always
 * reflects the current interaction state.
 */

import { useEffect, useState, useCallback } from 'react';
import type { FSM } from '@core/FSM';

export function useFSM<S extends string, E extends string>(fsm: FSM<S, E>) {
  const [state, setState] = useState<S>(fsm.state);

  useEffect(() => {
    return fsm.subscribe((current) => setState(current));
  }, [fsm]);

  const send = useCallback((event: E) => fsm.send(event), [fsm]);
  const can = useCallback((event: E) => fsm.can(event), [fsm]);

  return { state, send, can } as const;
}
