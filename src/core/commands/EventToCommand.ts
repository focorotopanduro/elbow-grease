/**
 * EventToCommand — bridge from the legacy pub/sub EventBus to the new
 * CommandBus dispatcher.
 *
 * The EventBus is NOT going away: it still serves as the notification
 * channel for UI side effects (audio cues, overlay flashes, neuro
 * engagement ticks). What changes is that events which previously
 * caused STORE MUTATIONS now translate into commands instead.
 *
 * Subscribed events:
 *   EV.PIPE_COMPLETE        → pipe.add
 *   EV.PIPE_REMOVED         → (no command — already a consequence of a
 *                              pipe.remove dispatch in the new world)
 *   EV.FIXTURE_PLACED       → (no-op in new world; fixtureStore.addFixture
 *                              is already called via dispatch from the
 *                              drop path)
 *
 * In legacy (flag-off) mode this module is inert — the old direct-
 * mutation path in bootPipeStore() and friends continues as before.
 */

import { eventBus } from '@core/EventBus';
import { EV, type PipeCompletePayload } from '@core/events';
import { commandBus } from './CommandBus';
import { newCorrelationId } from './correlationId';
import { getFlag } from '@store/featureFlagStore';

type Unsubscribe = () => void;

let installed = false;
const subs: Unsubscribe[] = [];

export function installEventToCommand(): void {
  if (installed) return;
  installed = true;

  // ── PIPE_COMPLETE → pipe.add ────────────────────────────────
  subs.push(
    eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, (payload) => {
      if (!getFlag('commandBus')) return; // legacy path handles it
      commandBus.dispatch({
        type: 'pipe.add',
        payload: {
          id: payload.id,
          points: payload.points,
          diameter: payload.diameter,
          material: payload.material,
        },
        issuedBy: 'event',
        correlationId: newCorrelationId(),
      });
    }),
  );

  // Room for more translations as stores migrate. Each addition here
  // is paired with a TODO in the legacy path to remove the direct
  // mutation once the flag graduates to default-on without fallback.
}

export function uninstallEventToCommand(): void {
  for (const off of subs) off();
  subs.length = 0;
  installed = false;
}
