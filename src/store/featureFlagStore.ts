/**
 * Feature Flag Store — one place for kill-switches and graduating features.
 *
 * Any refactor that changes runtime behavior (Phase 1 CommandBus, future
 * SharedArrayBuffer IPC, append-only save format) lands behind a flag
 * here. Default-off until the rollout plan in the ADR clears it to default-on.
 *
 * Why a store and not `import.meta.env` constants:
 *   - Users can toggle at runtime from the God Mode console to A/B a bug.
 *   - Tests can flip flags per-case without rebuilding.
 *   - The flag state itself is serializable → one-liner to include in
 *     bug reports ("what flags were on when this broke?").
 *
 * Persisted to localStorage so a user's flag preferences survive app
 * restarts. Defaults-only on first boot.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'elbow-grease-feature-flags';

export interface FeatureFlags {
  /**
   * Phase 1: route all store mutations through CommandBus.
   * When OFF: legacy direct-setter path (today's behavior).
   * When ON:  EventBus events translate to commands; direct setters
   *            warn in dev, are logged in prod.
   */
  commandBus: boolean;

  /**
   * Phase 1: expose the God Mode developer console
   * (Ctrl+Shift+G). Independent of commandBus so the console can
   * tail the legacy EventBus history when the bus isn't in use.
   */
  godMode: boolean;

  /**
   * Phase 3 placeholder: zero-copy simulation IPC via SharedArrayBuffer.
   * Off until the slab allocator lands.
   */
  sabIpc: boolean;

  /**
   * Phase 11.A — .elbow project bundle autosave.
   *   ON  → a bundle is written to localStorage every 10 s when the
   *         document is dirty, and `beforeunload` flushes one last write.
   *   OFF → autosave loop is dormant. Recovery on boot still runs so a
   *         user who toggles off doesn't orphan a prior autosave; and
   *         Ctrl+S / Ctrl+O always work regardless of this flag.
   *
   * Default ON — crash recovery is the expected behavior for CAD tools.
   */
  projectBundle: boolean;

  /**
   * Phase 2: attach full inference-chain traces to every
   * ComplianceViolation. Default OFF — traces cost CPU to build and
   * memory to ship across the worker boundary. Flip ON via Ctrl+Shift+D
   * (which also opens the ComplianceDebugger panel) or manually here.
   */
  complianceTrace: boolean;

  /**
   * Phase 6: drag-from-endpoint extension flow.
   *   ON  → glowing + glyph appears at every pipe endpoint while in
   *         Select mode; click-drag from it extends a new pipe using
   *         the currently-selected diameter + material.
   *   OFF → legacy behavior (endpoints only start pivot sessions).
   *
   * Default ON — the user explicitly requested this flow for the
   * Uponor workflow. If it clashes with a specific CAD gesture in the
   * wild, it flips off in the God Mode console instantly.
   */
  pipeExtendDrag: boolean;

  /**
   * Consolidation pass: 3D positional audio for pipe events (snap,
   * route, error, reward). Uses Web Audio + HRTF panning — when a
   * pipe snaps at [2, 0, -1], the click comes from that direction
   * in stereo. Dramatic win in VR; subtle on desktop. Default OFF so
   * the user opts in deliberately — audio feedback is a strong taste
   * preference that shouldn't surprise anyone on first launch.
   */
  spatialAudio: boolean;

  /**
   * Phase 10.A — logger threshold. Entries below this level are
   * discarded (zero-cost for the lazy-eval path).
   *
   *   trace < debug < info < warn < error < fatal
   *
   * Default:
   *   dev build  → 'info'
   *   prod build → 'warn'
   *
   * Override via the God Mode "Logs" tab.
   */
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /**
   * Phase 10.D — live perf HUD (FPS, frame-time sparkline, worker
   * latency, draw calls, heap).
   *   ON  → corner overlay updates at 10 Hz + renderer.info sampler
   *         mounts inside the Canvas.
   *   OFF → zero runtime cost (component returns null, sampler unmounted).
   *
   * Toggle via Ctrl+Shift+P or this store.
   */
  perfHud: boolean;

  /**
   * Phase 10.E — local-only session telemetry (1-minute buckets of
   * FPS/command/error counts). Aggregated in memory + persisted to
   * localStorage. Strictly NO network path — the data only leaves the
   * machine when the user clicks "Export" in the God Mode console.
   *
   * Default OFF. When OFF, the collector is literally dormant — no
   * subscriptions, no timers.
   */
  telemetryEnabled: boolean;

  /**
   * Phase 12.E — spring-arm camera (multi-raycast collision clamp).
   * When ON, an R3F post-process runs after OrbitControls and pulls
   * the camera in if obstacles sit between it and the orbit target.
   * Great for close-up fixture inspection; can feel intrusive in
   * top-down CAD views (constant floor-plane clamps). Default OFF.
   */
  springArmCamera: boolean;

  /**
   * Phase 14.AC.6–AC.9 — fixture → worker graph wiring.
   *   ON  → FIXTURE_PLACED / REMOVED / PARAMS_CHANGED events feed
   *         the SimulationBridge; fixture nodes enter the solver
   *         DAG with their real DFU + WSFU. 14.AC.7 adds proximity
   *         endpoint substitution so pipes drawn from / to a
   *         fixture splice its node into the edge. 14.AC.8 adds
   *         bundle-load rehydration so existing projects catch
   *         up on open.
   *   OFF → legacy pre-14.AC.6 behavior: fixtures live in the UI
   *         store only; solver sees an all-junction graph with
   *         zero accumulated DFU. Flag exists as a kill switch if
   *         a regression surfaces in the wild.
   *
   * Default ON as of 14.AC.9 — the pre-14.AC.6 state was a latent
   * correctness bug (compliance silently passed undersized stacks
   * because DFU propagation had nothing to propagate). Flipping
   * on makes the solver see real fixture load; compliance output
   * now reflects actual code risk. BOM is NOT affected by this
   * flip — that's 14.AC.10's domain.
   */
  fixtureGraph: boolean;
}

interface FeatureFlagState extends FeatureFlags {
  set: <K extends keyof FeatureFlags>(key: K, value: FeatureFlags[K]) => void;
  reset: () => void;
}

const DEFAULTS: FeatureFlags = {
  // Phase 1 is landing NOW. Default on — fallback path exists.
  // The flag stays so a user hitting a CommandBus-related bug can
  // flip it off from God Mode and keep working until we ship a fix.
  commandBus: true,
  // Dev console is hidden by default; Ctrl+Shift+G reveals it and
  // flips this flag on. Persisted so repeat use is frictionless.
  godMode: false,
  sabIpc: false,
  // Phase 11.A — autosave default ON; explicit Ctrl+S/Ctrl+O work regardless.
  projectBundle: true,
  complianceTrace: false,
  // Phase 6 — default on so the user sees it immediately. Togglable
  // in God Mode if it ever conflicts.
  pipeExtendDrag: true,
  // Consolidation: audio is opt-in.
  spatialAudio: false,
  // Phase 10.A — see Logger.ts for the default derivation (dev→info, prod→warn).
  // This store entry lets the user override at runtime.
  logLevel: 'info',
  // Phase 10.D — HUD opt-in; zero cost when off.
  perfHud: false,
  // Phase 10.E — telemetry opt-in; privacy-first, no network.
  telemetryEnabled: false,
  // Phase 12.E — spring-arm camera; opt-in for inspect workflows.
  springArmCamera: false,
  // Phase 14.AC.9 — fixture graph wiring default flipped to ON.
  // Kill switch if the wild surfaces a regression we missed.
  fixtureGraph: true,
};

function loadFromStorage(): FeatureFlags {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<FeatureFlags>;
    // Merge on top of DEFAULTS so new flags added in a release pick up
    // their default value without requiring the user to clear storage.
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveToStorage(flags: FeatureFlags): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    /* localStorage full or unavailable — silent */
  }
}

export const useFeatureFlagStore = create<FeatureFlagState>((set, get) => ({
  ...loadFromStorage(),

  set: (key, value) => {
    set({ [key]: value } as Partial<FeatureFlagState>);
    const { set: _setFn, reset: _resetFn, ...flagsOnly } = get();
    saveToStorage(flagsOnly as FeatureFlags);
  },

  reset: () => {
    set({ ...DEFAULTS });
    saveToStorage(DEFAULTS);
  },
}));

/** Imperative getter for non-React call sites (boot, bus handlers). */
export function getFlag<K extends keyof FeatureFlags>(key: K): FeatureFlags[K] {
  return useFeatureFlagStore.getState()[key];
}
