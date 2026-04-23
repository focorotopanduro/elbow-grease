/**
 * Integration-test harness — shared setup for cross-module flow tests.
 *
 * Unit tests live next to their subject and isolate a single module.
 * Integration tests live under src/__tests__/integration/ and verify
 * that multiple modules wired through the EventBus + CommandBus + stores
 * behave as the app does at runtime.
 *
 * This harness provides:
 *   • `resetAllStores()` — wipe persistent + ephemeral state to a
 *     clean baseline before each test.
 *   • `bootEventWiring()` — idempotent; subscribes pipeStore to
 *     EV.PIPE_COMPLETE so tests can emit events and observe store
 *     updates (mirrors what bootPipeStore does at app startup).
 *   • Convenience seeders for the most common test fixtures.
 *
 * What the harness DOESN'T do:
 *   • Spin up the Web Worker. Integration tests run against the
 *     main-thread fallback path in SimulationBridge. Worker-specific
 *     behavior is covered by dedicated unit tests.
 *   • Boot the feature-flag store. Feature flags are per-test; flip
 *     them with `useFeatureFlagStore.setState(...)` in the test body
 *     when a test wants the CommandBus path vs. the legacy direct path.
 */

import { usePipeStore, bootPipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useWallStore } from '@store/wallStore';
import { useMeasureStore } from '@store/measureStore';
import { useCustomerStore } from '@store/customerStore';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { useOnboardingStore } from '@store/onboardingStore';
import { commandBus } from '@core/commands/CommandBus';
import { __resetLoggerForTests } from '@core/logger/Logger';
import { eventBus } from '@core/EventBus';

/** Reset every store the integration suites touch to a clean state. */
export function resetAllStores(): void {
  usePipeStore.setState({
    pipes: {},
    pipeOrder: [],
    selectedId: null,
    undoStack: [],
    redoStack: [],
    pivotSession: null,
  });

  useFixtureStore.setState({
    fixtures: {},
    selectedFixtureId: null,
  });

  useWallStore.setState({
    walls: {},
    selectedWallId: null,
    drawSession: null,
  });

  useMeasureStore.setState({
    measurements: {},
    pendingStart: null,
    previewEnd: null,
    pendingScalePair: null,
  });

  // Preserve the auto-seeded default customer; drop everything else.
  const defaultProfile = useCustomerStore.getState().profiles['default'];
  useCustomerStore.setState({
    profiles: defaultProfile ? { default: defaultProfile } : {},
    activeCustomerId: 'default',
    pendingFixture: null,
    editingFixture: null,
  });

  useOnboardingStore.setState({
    status: 'inactive',
    currentStepIdx: 0,
    dismissedAt: null,
    completedAt: null,
  });

  // Feature flags → defaults. Tests that need non-defaults flip after.
  useFeatureFlagStore.getState().reset();

  commandBus.clearLog();
  __resetLoggerForTests();

  try { localStorage.clear(); } catch { /* ignore */ }
}

/**
 * Register the EventBus → pipeStore subscription once, matching what
 * `bootPipeStore()` does in production. Idempotent across tests in
 * the same file thanks to the `booted` guard inside pipeStore.
 *
 * Tests that want the CommandBus path instead of the direct-event
 * path must set `useFeatureFlagStore.setState({ commandBus: true })`
 * BEFORE the event is emitted — the subscription checks the flag at
 * dispatch time.
 */
export function bootEventWiring(): void {
  bootPipeStore();
}

/** Emit an EventBus event and run the synchronous listeners. */
export function emit<T>(name: string, payload: T): void {
  eventBus.emit(name, payload);
}

/**
 * Seed a well-formed customer profile. Returns the customer id.
 * Useful for bundle tests that need a non-default customer.
 */
export function seedCustomer(name: string, extras: {
  contactName?: string;
  street?: string;
  city?: string;
} = {}): string {
  const id = `test-cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  useCustomerStore.setState({
    profiles: {
      ...useCustomerStore.getState().profiles,
      [id]: {
        id,
        name,
        templates: {},
        defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
        codes: [],
        markupPercent: 0,
        createdAt: new Date().toISOString(),
        contact: extras.contactName ? { personName: extras.contactName } : undefined,
        siteAddress: (extras.street || extras.city)
          ? { street: extras.street ?? '', city: extras.city ?? '', state: '', zip: '' }
          : undefined,
      },
    },
    activeCustomerId: id,
  });
  return id;
}
