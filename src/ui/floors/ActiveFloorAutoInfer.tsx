/**
 * ActiveFloorAutoInfer — headless component that switches the active
 * floor to match newly-committed pipes.
 *
 * Behavior:
 *   - Subscribes to pipeStore
 *   - When a NEW pipe appears (ID not seen before), resolves its
 *     primary floor (lowest-order floor it overlaps) and sets that
 *     floor active IF the pipe is entirely outside the current
 *     active floor. Prevents nagging switches when the user is
 *     already drawing on the floor they mean.
 *
 * Mount inside <App> once (outside Canvas).
 */

import { useEffect, useRef } from 'react';
import { usePipeStore } from '@store/pipeStore';
import { useFloorStore } from '@store/floorStore';
import { primaryFloorForPipe, pipeIsOnActiveFloor } from '@core/floor/FloorResolver';

export function ActiveFloorAutoInfer() {
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = usePipeStore.subscribe((state) => {
      const pipes = state.pipes;
      for (const id in pipes) {
        if (seen.current.has(id)) continue;
        seen.current.add(id);

        const pipe = pipes[id]!;
        // If the newly committed pipe doesn't touch the active floor at all,
        // switch active to its primary floor.
        if (!pipeIsOnActiveFloor(pipe)) {
          const primary = primaryFloorForPipe(pipe);
          if (primary) {
            useFloorStore.getState().setActiveFloor(primary.id);
          }
        }
      }
      // Prune removed IDs from the seen set
      if (seen.current.size > 200) {
        const alive = new Set(Object.keys(pipes));
        for (const id of seen.current) if (!alive.has(id)) seen.current.delete(id);
      }
    });
    return unsub;
  }, []);

  return null;
}
