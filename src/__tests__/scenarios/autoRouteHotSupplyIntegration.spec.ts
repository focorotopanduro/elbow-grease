/**
 * autoRoute + hot-supply integration scenario — Phase 14.Y.3 + 14.Y.4.
 *
 * End-to-end: place a water heater, place a lavatory, run
 * `autoRouteSelectedFixture`, then sync-flush the hot-supply
 * propagation and assert the hot route was reclassified.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { usePipeStore } from '../../store/pipeStore';
import { useFixtureStore } from '../../store/fixtureStore';
import { autoRouteSelectedFixture } from '../../ui/fixtures/useAutoRouteShortcut';
import {
  bootHotSupplyPropagation,
  __flushHotSupplyPropagation,
  __stopHotSupplyPropagation,
} from '../../core/fixtures/bootHotSupplyPropagation';

function resetStores() {
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
}

describe('auto-route + hot-supply propagation integration', () => {
  beforeEach(() => {
    resetStores();
    bootHotSupplyPropagation();
  });
  afterEach(() => {
    __stopHotSupplyPropagation();
  });

  it('auto-routed hot route ends up classified hot_supply', () => {
    // 1. Place a water heater
    const whId = useFixtureStore.getState().addFixture(
      'water_heater', [10, 0, 0], { capacityGal: 50, energy: 'gas' },
    );
    // 2. Place a lavatory
    const lavId = useFixtureStore.getState().addFixture(
      'lavatory', [0, 2.5, 0],
    );
    // 3. Select the lavatory
    useFixtureStore.getState().selectFixture(lavId);
    // 4. Auto-route
    const count = autoRouteSelectedFixture();
    expect(count).toBeGreaterThan(0);
    // 5. Flush the propagation (debounced normally)
    __flushHotSupplyPropagation();

    // Every pipe whose role is 'hot' from autoRoute should END at
    // the water heater's hot outlet → classified hot_supply after
    // propagation runs.
    const pipes = Object.values(usePipeStore.getState().pipes);
    const hotSupplyPipes = pipes.filter((p) => p.system === 'hot_supply');
    expect(hotSupplyPipes.length).toBeGreaterThanOrEqual(1);

    // Cold stubs should stay cold (no WH cold main to disrupt)
    const coldPipes = pipes.filter((p) => p.system === 'cold_supply');
    expect(coldPipes.length).toBeGreaterThanOrEqual(1);

    // Drain pipes remain waste
    const drainPipes = pipes.filter((p) => p.system === 'waste');
    expect(drainPipes.length).toBeGreaterThanOrEqual(1);

    // Silence unused-var lint for whId (kept for scenario clarity)
    expect(whId).toBeTruthy();
  });

  it('removing water heater reverts previously-hot pipes to cold', () => {
    // Setup: WH + lavatory + auto-route
    const whId = useFixtureStore.getState().addFixture(
      'water_heater', [10, 0, 0], { capacityGal: 50, energy: 'gas' },
    );
    const lavId = useFixtureStore.getState().addFixture(
      'lavatory', [0, 2.5, 0],
    );
    useFixtureStore.getState().selectFixture(lavId);
    autoRouteSelectedFixture();
    __flushHotSupplyPropagation();

    // Verify at least one hot pipe exists
    const pipesA = Object.values(usePipeStore.getState().pipes);
    expect(pipesA.some((p) => p.system === 'hot_supply')).toBe(true);

    // Remove the water heater
    useFixtureStore.getState().removeFixture(whId);
    __flushHotSupplyPropagation();

    // All previously-hot pipes should revert to cold_supply
    const pipesB = Object.values(usePipeStore.getState().pipes);
    expect(pipesB.every((p) => p.system !== 'hot_supply')).toBe(true);
  });
});
