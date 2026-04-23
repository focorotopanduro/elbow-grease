/**
 * CappedEndpoints — renders a `CapPlug` for every record in the
 * `cappedEndpointStore`.
 *
 * Each cap marks an orphaned pipe endpoint left behind when a
 * neighboring pipe was deleted. The `ConnectivityManager` populates
 * the store; this component just draws what's there.
 *
 * Self-heal: when a pipe is re-added at a capped position, the
 * manager removes the cap and this renderer re-renders with one
 * fewer entry. No per-cap cleanup state lives here.
 */

import { useMemo } from 'react';
import { CapPlug } from '@ui/pipe/CapPlug';
import { useCappedEndpointStore } from '@store/cappedEndpointStore';
import { usePlumbingLayerStore } from '@store/plumbingLayerStore';
import { useFloorParams } from '@store/floorStore';

// System → accent color for the cap's retaining ring.
const SYSTEM_RING_COLOR: Record<string, string> = {
  cold_supply: '#29b6f6',
  hot_supply:  '#ff7043',
  waste:       '#ef5350',
  vent:        '#66bb6a',
  storm:       '#78909c',
};

export function CappedEndpoints() {
  const caps = useCappedEndpointStore((s) => s.caps);
  const systemVis = usePlumbingLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();

  const list = useMemo(() => Object.values(caps), [caps]);
  if (list.length === 0) return null;

  return (
    <group>
      {list.map((cap) => {
        if (!systemVis[cap.system]) return null;
        // Caps live at a single Y, so floor visibility uses that y.
        const fp = getFloorParams(cap.position[1], cap.position[1]);
        if (!fp.visible) return null;
        const ringColor = SYSTEM_RING_COLOR[cap.system] ?? '#ffa726';
        return (
          <CapPlug
            key={cap.id}
            position={cap.position}
            outward={cap.outward}
            pipeDiameterIn={cap.diameterIn}
            ringColor={ringColor}
          />
        );
      })}
    </group>
  );
}
