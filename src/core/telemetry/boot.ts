/**
 * Telemetry boot — wires SessionTelemetry to the featureFlagStore.
 *
 * Called once from App.tsx. Subscribes to the `telemetryEnabled` flag
 * and starts/stops the collector when it flips. If the flag is already
 * on at boot, collection begins immediately.
 *
 * Injects a scene-count provider that reads pipe + fixture counts from
 * their stores — the telemetry module itself must not import the UI
 * stores directly (that would introduce a cycle for tests).
 */

import { useFeatureFlagStore } from '@store/featureFlagStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { start, stop } from './SessionTelemetry';
import { logger } from '@core/logger/Logger';

const log = logger('TelemetryBoot');

export function bootSessionTelemetry(): () => void {
  const sceneCountReader = () => {
    try {
      const pipes = usePipeStore.getState().pipes;
      const fixtures = useFixtureStore.getState().fixtures;
      return {
        pipeCount: Object.keys(pipes).length,
        fixtureCount: Object.keys(fixtures).length,
      };
    } catch {
      return { pipeCount: 0, fixtureCount: 0 };
    }
  };

  const applyFlag = (enabled: boolean) => {
    if (enabled) {
      log.debug('telemetry start (flag on)');
      start({ sceneCountReader });
    } else {
      log.debug('telemetry stop (flag off)');
      stop();
    }
  };

  // Initial state.
  applyFlag(useFeatureFlagStore.getState().telemetryEnabled);

  // React to flag changes.
  const unsub = useFeatureFlagStore.subscribe((state, prev) => {
    if (state.telemetryEnabled !== prev.telemetryEnabled) {
      applyFlag(state.telemetryEnabled);
    }
  });

  return () => {
    unsub();
    stop();
  };
}
