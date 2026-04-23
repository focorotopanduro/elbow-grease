/**
 * Bundle — .elbow project file format.
 *
 * A bundle is a versioned snapshot of the document-level stores:
 * pipes, fixtures, walls, measurements. Ephemeral UI state (current
 * mode, selection, draw session, feature flags, onboarding status) is
 * NOT serialized — loading a bundle shouldn't change the user's
 * editor configuration, only the document contents.
 *
 * Format (JSON, pretty-printed):
 *
 *   {
 *     "version": 1,
 *     "meta":  { "createdAt", "savedAt", "appVersion", "name" },
 *     "data":  { "pipes": [...], "fixtures": [...], "walls": [...],
 *                "measurements": [...] }
 *   }
 *
 * Versioning strategy:
 *   • Every bundle carries `version`. Current schema = `1`.
 *   • `migrateBundle(unknown)` walks the version chain, returning a
 *     canonical latest-version bundle or throwing on irrecoverable
 *     shape. Every future schema bump adds a migrator, never
 *     rewrites old ones (append-only — see ADR 005 design rationale).
 *   • Unknown future versions are rejected (forward-incompat guard).
 *
 * Apply semantics:
 *   • `captureBundle()` reads the current stores into a Bundle.
 *   • `applyBundle(b)` replaces the stores' contents wholesale. Any
 *     existing in-memory state is discarded — the bundle is the new
 *     truth. Undo/redo stacks are cleared (re-entering history after
 *     a load would mean undoing into a fictional prior scene).
 */

import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { useFixtureStore, type FixtureInstance } from '@store/fixtureStore';
import { useWallStore, type Wall } from '@store/wallStore';
import { useMeasureStore, type Measurement } from '@store/measureStore';
import { useCustomerStore } from '@store/customerStore';
// Phase 14.R.26 — roofing-workspace persistence. The drawn sections,
// the active blueprint underlay (PDF / image / DXF rasterized to a
// data URL), and the FL estimator inputs all ride in the bundle so
// a saved .elbow file fully reproduces both plumbing and roofing
// projects.
import { useRoofStore } from '@store/roofStore';
import { useRoofingProjectStore, type RoofingProjectInput } from '@store/roofingProjectStore';
// Phase 9 — transient roofing interaction stores. Reset to idle
// on applyBundle so a file open never lands in the middle of a
// stale drag / calibrate / rotate session.
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { useRoofingCalibrationStore } from '@store/roofingCalibrationStore';
import { useRoofingDragStore } from '@store/roofingDragStore';
import { useRoofingVertexDragStore } from '@store/roofingVertexDragStore';
import { useRoofingRotationDragStore } from '@store/roofingRotationDragStore';
import { useRoofingAxisDragStore } from '@store/roofingAxisDragStore';
import {
  type RoofGraphSnapshot,
  emptyRoofSnapshot,
} from '@engine/roofing/RoofGraph';
import { logger } from '@core/logger/Logger';

const log = logger('Bundle');

// ── Schema ──────────────────────────────────────────────────────
//
// Versioning note (Phase 14.R.26): CURRENT_BUNDLE_VERSION is now 3.
// v1 + v2 bundles on disk remain readable — migrateBundle walks them
// forward. v3 adds an OPTIONAL `data.roof` field carrying drawn roof
// sections, the active blueprint underlay (with its data URL), and
// the FL estimator's flat-form input. Bundles without roofing data
// (pure-plumbing projects) serialize without the field.

export const CURRENT_BUNDLE_VERSION = 3 as const;

/** Human-readable extension — used by download + open dialogs. */
export const BUNDLE_EXTENSION = '.elbow';
export const BUNDLE_MIME = 'application/x-elbow-grease';

export interface BundleMeta {
  /** Wall-clock epoch ms when the bundle was first created. */
  createdAt: number;
  /** Wall-clock epoch ms at the most-recent save. */
  savedAt: number;
  /** App version that produced the save. Shown to the user on load for debug. */
  appVersion: string;
  /** Optional user-supplied document name. */
  name?: string;
}

export interface BundleData {
  pipes: CommittedPipe[];
  fixtures: FixtureInstance[];
  walls: Wall[];
  measurements: Measurement[];
  /**
   * Phase 14.R.26 — roofing workspace state. Optional so legacy
   * pure-plumbing bundles + autosave snapshots can omit it cleanly.
   */
  roof?: BundleRoof;
}

/**
 * Phase 14.R.26 — roofing slice of the bundle. All three sub-fields
 * are optional so partial-state bundles (just sections, just an
 * underlay, etc.) round-trip cleanly.
 */
export interface BundleRoof {
  /** Full roof-graph snapshot (sections + vertices + measures + layers
   *  + pdf). The underlying type lives in `RoofGraph` and already has
   *  a serializer (`useRoofStore.serialize()`). */
  graph?: RoofGraphSnapshot;
  /** FL estimator's flat-form inputs (county, dims, system, etc.). */
  projectInput?: RoofingProjectInput;
}

/**
 * Project context — v2 addition. `customerId` is only meaningful in
 * the originating installation; bundles moved to another machine may
 * not have that customer in their store. `customerSnapshot` captures
 * the small set of human-readable fields that make sense to restore
 * even without the full profile.
 */
export interface BundleProject {
  customerId?: string;
  customerSnapshot?: {
    name: string;
    contactPerson?: string;
    siteStreet?: string;
    siteCity?: string;
    siteState?: string;
    notes?: string;
  };
}

export interface BundleV1 {
  version: 1;
  meta: BundleMeta;
  data: BundleData;
}

export interface BundleV2 {
  version: 2;
  meta: BundleMeta;
  data: BundleData;
  /** Optional — absent means "no customer associated". */
  project?: BundleProject;
}

export interface BundleV3 {
  version: 3;
  meta: BundleMeta;
  data: BundleData;
  project?: BundleProject;
}

export type Bundle = BundleV3;

// ── Capture ─────────────────────────────────────────────────────

export interface CaptureOptions {
  name?: string;
  createdAt?: number;
  appVersion?: string;
  /**
   * Phase 14.R.26 — when true, strip the PDF underlay's image data
   * URL from the captured bundle. Used by autosave so a multi-MB
   * blueprint doesn't blow past localStorage's 5–10 MB cap; the
   * sections + transforms + filename are still saved so the next
   * boot can ask the user to re-attach the underlay file. Explicit
   * Save (Ctrl+S → file) leaves this false so the .elbow file is
   * fully self-contained.
   */
  omitPdfImageData?: boolean;
}

/**
 * Snapshot the current stores into a Bundle. Deep-copy to decouple
 * the saved payload from the live state — mutating a live pipe after
 * capture shouldn't mutate the captured bundle.
 *
 * Phase 11.B: if `customerStore.activeCustomerId` points at a real
 * profile (and it isn't the auto-seeded 'default'), attach a project
 * reference + small customer snapshot. Scenes without a real customer
 * selected serialize without the project field.
 */
export function captureBundle(opts: CaptureOptions = {}): Bundle {
  const pipes = Object.values(usePipeStore.getState().pipes);
  const fixtures = Object.values(useFixtureStore.getState().fixtures);
  const walls = Object.values(useWallStore.getState().walls);
  const measurements = Object.values(useMeasureStore.getState().measurements);

  const now = Date.now();
  const bundle: Bundle = {
    version: CURRENT_BUNDLE_VERSION,
    meta: {
      createdAt: opts.createdAt ?? now,
      savedAt: now,
      appVersion: opts.appVersion ?? readAppVersion(),
      ...(opts.name ? { name: opts.name } : {}),
    },
    data: {
      pipes: deepClone(pipes),
      fixtures: deepClone(fixtures),
      walls: deepClone(walls),
      measurements: deepClone(measurements),
    },
  };

  const project = captureActiveCustomerProject();
  if (project) bundle.project = project;

  // Phase 14.R.26 — roofing slice.
  const roof = captureRoof(opts.omitPdfImageData ?? false);
  if (roof) bundle.data.roof = deepClone(roof);

  return bundle;
}

/**
 * Phase 14.AD.1 — serialize-in-one-pass capture.
 *
 * Autosave and anyone else who IMMEDIATELY writes the bundle to
 * storage doesn't need the `structuredClone` that `captureBundle`
 * performs — JSON.stringify is already a structural deep copy. The
 * in-memory Bundle object produced by `captureBundle` only matters
 * if a caller holds onto it and keeps editing the stores. Callers
 * that produce-then-forget (autosave tick, beforeunload flush)
 * can skip ~50% of the serialization cost by going straight to the
 * JSON string.
 *
 * Output is identical to `serializeBundle(captureBundle(opts))`.
 * Preserved by tests.
 */
export function captureBundleSerialized(opts: CaptureOptions = {}): string {
  const pipes = Object.values(usePipeStore.getState().pipes);
  const fixtures = Object.values(useFixtureStore.getState().fixtures);
  const walls = Object.values(useWallStore.getState().walls);
  const measurements = Object.values(useMeasureStore.getState().measurements);

  const now = Date.now();
  const bundle: Bundle = {
    version: CURRENT_BUNDLE_VERSION,
    meta: {
      createdAt: opts.createdAt ?? now,
      savedAt: now,
      appVersion: opts.appVersion ?? readAppVersion(),
      ...(opts.name ? { name: opts.name } : {}),
    },
    // No deepClone — JSON.stringify below produces a fully
    // decoupled string representation. Any concurrent mutation of
    // the stores after stringify returns can't affect the bytes we
    // wrote.
    data: { pipes, fixtures, walls, measurements },
  };

  const project = captureActiveCustomerProject();
  if (project) bundle.project = project;

  // Phase 14.R.26 — roof slice. For autosave callers who pass
  // omitPdfImageData=true, this strips the heaviest field so the
  // serialized string stays localStorage-friendly even when a large
  // blueprint is loaded.
  const roof = captureRoof(opts.omitPdfImageData ?? false);
  if (roof) bundle.data.roof = roof;

  return JSON.stringify(bundle);
}

/**
 * Phase 14.R.26 — read roofing state into a BundleRoof. Returns null
 * when the roofing workspace is untouched (no sections drawn, default
 * estimator inputs, no PDF loaded). `omitPdfImageData` strips the
 * underlay's image data URL to keep autosaves within localStorage's
 * size budget while still remembering the filename, transforms, and
 * calibration.
 */
function captureRoof(omitPdfImageData: boolean): BundleRoof | null {
  try {
    const roof = useRoofStore.getState();
    const projectStore = useRoofingProjectStore.getState();
    const hasSections = roof.sectionOrder.length > 0;
    const hasPdf = Boolean(roof.pdf.pdfPath) || Boolean(roof.pdf.imageDataUrl);
    // Phase 14.R.27 — penetrations alone count as "content worth
    // snapshotting". A user who placed markers but hasn't drawn any
    // sections yet still needs their work to persist across saves.
    const hasPenetrations = roof.penetrationOrder.length > 0;

    // A snapshot is worth including when EITHER sections exist OR a
    // PDF is loaded OR penetrations have been placed. Estimator inputs
    // are always small; we attach them unconditionally in case the
    // user tweaked them even on an empty canvas.
    const roofSlice: BundleRoof = {};

    if (hasSections || hasPdf || hasPenetrations) {
      const snap = roof.serialize();
      if (omitPdfImageData && snap.pdf.imageDataUrl) {
        // Preserve everything EXCEPT the raw image bytes; the rest
        // (scale / transforms / filename / calibration anchors) is
        // small and useful for "remind me what blueprint I was
        // tracing" on reload.
        roofSlice.graph = {
          ...snap,
          pdf: { ...snap.pdf, imageDataUrl: undefined },
        };
      } else {
        roofSlice.graph = snap;
      }
    }

    // Estimator input — always include. Small, and lets a saved
    // project reopen with the contractor's county + system pre-filled.
    roofSlice.projectInput = { ...projectStore.input };

    return roofSlice;
  } catch {
    // Roofing stores not importable (e.g. some minimal test harness).
    return null;
  }
}

/**
 * Read the active customer from customerStore and return a project
 * descriptor, or null if there's no meaningful customer to record.
 * The auto-seeded 'default' profile is excluded — it represents "no
 * customer chosen yet" rather than a real contract.
 */
function captureActiveCustomerProject(): BundleProject | null {
  try {
    const c = useCustomerStore.getState();
    const id = c.activeCustomerId;
    if (!id || id === 'default') return null;
    const profile = c.profiles[id];
    if (!profile) return null;

    const snap: BundleProject['customerSnapshot'] = { name: profile.name };
    if (profile.contact?.personName) snap.contactPerson = profile.contact.personName;
    if (profile.siteAddress?.street) snap.siteStreet = profile.siteAddress.street;
    if (profile.siteAddress?.city)   snap.siteCity   = profile.siteAddress.city;
    if (profile.siteAddress?.state)  snap.siteState  = profile.siteAddress.state;
    if (profile.notes)               snap.notes      = profile.notes;

    return { customerId: id, customerSnapshot: snap };
  } catch {
    // If the customer store isn't reachable (e.g. tests that didn't
    // import it), silently skip the project field.
    return null;
  }
}

// ── Apply ───────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  /** True if the bundle was migrated from an older schema. */
  migrated: boolean;
  /** Counts of each element type that landed. */
  counts: {
    pipes: number;
    fixtures: number;
    walls: number;
    measurements: number;
  };
  /**
   * Phase 11.B — surfaces the bundle's project tag so the caller can
   * toast "Loaded for {customerName}" or warn "Bundle references an
   * unknown customer".
   */
  project?: {
    customerId?: string;
    customerName?: string;
    /** True if customerId was present and we successfully activated it in customerStore. */
    customerResolved: boolean;
  };
}

/**
 * Replace current store state with the bundle's contents.
 *
 * Throws if the bundle is malformed (caller should try/catch and
 * surface a user-facing error). Accepts unknown JSON via `migrateBundle`.
 */
export function applyBundle(input: unknown): ApplyResult {
  const bundle = migrateBundle(input);

  // Re-index into the Record<string, T> shapes the stores expect.
  const pipeMap: Record<string, CommittedPipe> = {};
  const pipeOrder: string[] = [];
  for (const p of bundle.data.pipes) {
    pipeMap[p.id] = p;
    pipeOrder.push(p.id);
  }

  const fixtureMap: Record<string, FixtureInstance> = {};
  for (const f of bundle.data.fixtures) fixtureMap[f.id] = f;

  const wallMap: Record<string, Wall> = {};
  for (const w of bundle.data.walls) wallMap[w.id] = w;

  const measurementMap: Record<string, Measurement> = {};
  for (const m of bundle.data.measurements) measurementMap[m.id] = m;

  // Hard-reset each store. Using `setState` with the explicit shape
  // preserves the store's action methods (Zustand merges). Ephemeral
  // UI state (selection, draw sessions) is explicitly cleared — we
  // don't want a stale selected id pointing at a deleted pipe.
  usePipeStore.setState({
    pipes: pipeMap,
    pipeOrder,
    selectedId: null,
    undoStack: [],
    redoStack: [],
    pivotSession: null,
  });

  useFixtureStore.setState({
    fixtures: fixtureMap,
    selectedFixtureId: null,
  });

  useWallStore.setState({
    walls: wallMap,
    selectedWallId: null,
    drawSession: null,
  });

  useMeasureStore.setState({
    measurements: measurementMap,
    pendingStart: null,
    previewEnd: null,
    pendingScalePair: null,
  });

  // Phase 14.R.26 — restore roofing workspace. Reset to empty first
  // so a bundle without roof data wipes any in-memory roofing state
  // (a loaded file is the new source of truth, matching pipe/fixture
  // semantics above). Only when the bundle carries a roof slice do
  // we rehydrate further.
  applyRoofBundle(bundle.data.roof);

  const migrated = (input as { version?: number } | null)?.version !== CURRENT_BUNDLE_VERSION;

  // Phase 11.B — restore project/customer context if present.
  const projectResult = activateBundleCustomer(bundle.project);

  log.info('bundle applied', {
    pipes: bundle.data.pipes.length,
    fixtures: bundle.data.fixtures.length,
    walls: bundle.data.walls.length,
    measurements: bundle.data.measurements.length,
    migrated,
    customerResolved: projectResult?.customerResolved ?? false,
  });

  // Phase 14.AC.8 — surface the freshly-applied pipe + fixture
  // state into the worker graph. No-op when `fixtureGraph` flag is
  // off (legacy behaviour preserved). See
  // `rehydrateWorkerGraph.ts` for rationale; in short: the
  // `setState` calls above bypass the event bus, so the simulation
  // worker would otherwise never learn that a project just opened.
  //
  // Dynamic import keeps the Bundle module test-friendly: tests
  // that exercise `applyBundle` directly don't need to boot a
  // SimulationBridge / jsdom worker unless they explicitly want to.
  void import('../../engine/worker/rehydrateWorkerGraph').then(
    (m) => m.rehydrateWorkerGraph(),
  ).catch((err) => {
    log.warn('worker rehydration skipped', err);
  });

  return {
    ok: true,
    migrated,
    counts: {
      pipes: bundle.data.pipes.length,
      fixtures: bundle.data.fixtures.length,
      walls: bundle.data.walls.length,
      measurements: bundle.data.measurements.length,
    },
    ...(projectResult ? { project: projectResult } : {}),
  };
}

/**
 * Phase 14.R.26 — restore the bundle's roofing slice into the
 * roofStore + roofingProjectStore. Always resets in-memory roofing
 * state to a clean baseline first, then hydrates from the bundle
 * when the slice is present. Bundles without a roof slice (legacy
 * pure-plumbing) leave the roofing workspace blank.
 *
 * Undo/redo stacks are cleared — a freshly-loaded bundle should
 * never let the user Ctrl+Z into a fictional pre-load scene.
 * `RoofGraph.emptyRoofSnapshot()` gives us the canonical "no
 * content" state for the reset path.
 */
function applyRoofBundle(roof: BundleRoof | undefined): void {
  try {
    const baseSnap = roof?.graph ?? emptyRoofSnapshot();
    // Phase 14.R.27 — penetrations on the snapshot are optional
    // (older bundles predate R.27). Default to empty so a v3-pre-R.27
    // bundle opens with a clean penetration slate, and an R.27
    // bundle round-trips its markers unchanged.
    const penetrations = baseSnap.penetrations ?? {};
    const penetrationOrder = baseSnap.penetrationOrder && baseSnap.penetrationOrder.length > 0
      ? baseSnap.penetrationOrder
      : Object.keys(penetrations);
    useRoofStore.setState({
      sections: baseSnap.sections,
      sectionOrder: Object.keys(baseSnap.sections),
      vertices: baseSnap.vertices,
      measures: baseSnap.measures,
      layers: baseSnap.layers.map((l) => ({ ...l })),
      pdf: { ...baseSnap.pdf },
      selectedSectionId: null,
      penetrations,
      penetrationOrder,
      undoStack: [],
      redoStack: [],
      batchDepth: 0,
      dirtyDuringBatch: false,
    });

    // Phase 9 (post-Phase-4 cleanup) — reset every transient roofing
    // interaction store to idle. Without this, opening a file while
    // the user is mid-drag / mid-calibrate / mid-rotate would leave
    // the interaction session pointing at entities in the OLD file,
    // and the next pointer event would corrupt the newly-loaded
    // state. Matches what the plumbing-side `setState` calls above
    // already do for the equivalent transient slices
    // (pipivotSession, drawSession, pendingStart on walls/measures).
    resetTransientRoofingStores();

    // Project input: if the bundle has one, apply it; otherwise the
    // roofingProjectStore keeps its existing (localStorage-restored)
    // state, which is usually the user's own per-machine defaults.
    if (roof?.projectInput) {
      useRoofingProjectStore.getState().set({ ...roof.projectInput });
    }
  } catch (err) {
    log.warn('roof bundle restore skipped', err);
  }
}

/**
 * Phase 9 — drop every in-progress roofing interaction session to
 * idle. Called from `applyRoofBundle` so opening a file can never
 * strand a half-finished drag / calibrate / rotate session pointing
 * at entities that no longer exist (or exist in a different
 * file's coordinate frame).
 *
 * Each store exposes its own no-arg "end" action; we call them
 * rather than hand-constructing the idle state so the idle shape
 * stays owned by the store module. Wrapped in try/catch because
 * one malformed store shouldn't block the other resets — the whole
 * `applyRoofBundle` is also wrapped, but defence-in-depth is cheap
 * here.
 */
function resetTransientRoofingStores(): void {
  try { useRoofingDrawStore.getState().cancelDraft(); } catch { /* ignore */ }
  try { useRoofingCalibrationStore.getState().reset(); } catch { /* ignore */ }
  try { useRoofingDragStore.getState().endDrag(); } catch { /* ignore */ }
  try { useRoofingVertexDragStore.getState().endDrag(); } catch { /* ignore */ }
  try { useRoofingRotationDragStore.getState().endRotate(); } catch { /* ignore */ }
  try { useRoofingAxisDragStore.getState().endDrag(); } catch { /* ignore */ }
}

/**
 * Restore the bundle's customer reference in customerStore. If the
 * referenced customer exists on this machine, we flip the active
 * customer to it. If it doesn't, we leave the active customer alone
 * (the snapshot is still in the bundle file for reference) and
 * surface `customerResolved: false` so the caller can inform the user.
 */
function activateBundleCustomer(project: BundleProject | undefined): ApplyResult['project'] {
  if (!project) return undefined;
  try {
    const store = useCustomerStore.getState();
    const id = project.customerId;
    if (id && store.profiles[id]) {
      store.setActiveCustomer(id);
      return {
        customerId: id,
        customerName: store.profiles[id]!.name,
        customerResolved: true,
      };
    }
    return {
      customerId: id,
      customerName: project.customerSnapshot?.name,
      customerResolved: false,
    };
  } catch {
    return undefined;
  }
}

// ── Migrate ─────────────────────────────────────────────────────

/**
 * Walk an unknown-version bundle up to CURRENT_BUNDLE_VERSION.
 *
 * Each migrator is pure, small, and tested. Old migrators never
 * change once shipped — a v1 bundle saved in 2026 must still open in
 * a 2030 build that only supports v5+. This is the whole reason the
 * bundle format is versioned.
 */
export function migrateBundle(input: unknown): Bundle {
  if (input === null || typeof input !== 'object') {
    throw new Error('Bundle must be an object');
  }

  const b = input as Record<string, unknown>;
  const v = b.version;

  if (typeof v !== 'number') {
    throw new Error('Bundle is missing `version` field');
  }

  if (v > CURRENT_BUNDLE_VERSION) {
    throw new Error(
      `Bundle version ${v} is newer than the app supports (${CURRENT_BUNDLE_VERSION}). ` +
      `Update ELBOW GREASE, or open this bundle in a newer build.`,
    );
  }

  // Walk the version chain: v1 → v2 → v3. Every migrator only knows
  // the step before it; each subsequent bump tacks on another step.
  let current: BundleV1 | BundleV2 | BundleV3;
  if (v === 1) {
    current = migrateV2ToV3(migrateV1ToV2(validateV1(b)));
  } else if (v === 2) {
    current = migrateV2ToV3(validateV2(b));
  } else if (v === 3) {
    current = validateV3(b);
  } else {
    throw new Error(`Unknown bundle version: ${v}`);
  }

  return current as Bundle;
}

/**
 * Phase 11.B migrator — v1 → v2.
 *
 * v2's only addition is the optional `project` field. A v1 bundle
 * never had customer context, so we emit v2 with `project` absent
 * (which is valid — it means "no customer associated").
 *
 * Exported for direct testing.
 */
export function migrateV1ToV2(v1: BundleV1): BundleV2 {
  return {
    version: 2,
    meta: v1.meta,
    data: v1.data,
    // `project` intentionally omitted — no customer context available.
  };
}

/**
 * Phase 14.R.26 migrator — v2 → v3.
 *
 * v3's only addition is `data.roof`. Legacy v2 bundles never had
 * roofing state, so we emit v3 with `data.roof` absent (valid —
 * `applyRoofBundle` treats absence as "blank roofing workspace").
 *
 * Exported for direct testing.
 */
export function migrateV2ToV3(v2: BundleV2): BundleV3 {
  return {
    version: 3,
    meta: v2.meta,
    data: v2.data, // no roof field
    ...(v2.project ? { project: v2.project } : {}),
  };
}

function validateV1(b: Record<string, unknown>): BundleV1 {
  const meta = b.meta;
  const data = b.data;
  if (meta === null || typeof meta !== 'object') {
    throw new Error('Bundle.meta is missing or malformed');
  }
  if (data === null || typeof data !== 'object') {
    throw new Error('Bundle.data is missing or malformed');
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.pipes))        throw new Error('Bundle.data.pipes must be an array');
  if (!Array.isArray(d.fixtures))     throw new Error('Bundle.data.fixtures must be an array');
  if (!Array.isArray(d.walls))        throw new Error('Bundle.data.walls must be an array');
  if (!Array.isArray(d.measurements)) throw new Error('Bundle.data.measurements must be an array');

  return b as unknown as BundleV1;
}

function validateV3(b: Record<string, unknown>): BundleV3 {
  // v3 shares v2's shape; additionally `data.roof` may be present
  // with any of { graph, projectInput }. We accept any object there
  // and rely on applyRoofBundle's try/catch to handle malformed
  // slices gracefully (log a warning, keep the bundle load going).
  const v2 = validateV2(b);
  const data = (b as { data?: unknown }).data as Record<string, unknown>;
  const roof = data.roof;
  if (roof !== undefined && (roof === null || typeof roof !== 'object')) {
    throw new Error('Bundle.data.roof must be an object when present');
  }
  return {
    version: 3,
    meta: v2.meta,
    data: v2.data, // data already spread from validateV2; roof field rides along
    ...(v2.project ? { project: v2.project } : {}),
  };
}

function validateV2(b: Record<string, unknown>): BundleV2 {
  // v2 shares v1's shape on meta + data, with an OPTIONAL project field.
  const v1 = validateV1(b);
  const project = (b as { project?: unknown }).project;
  if (project !== undefined) {
    if (project === null || typeof project !== 'object') {
      throw new Error('Bundle.project must be an object when present');
    }
    const p = project as Record<string, unknown>;
    if (p.customerId !== undefined && typeof p.customerId !== 'string') {
      throw new Error('Bundle.project.customerId must be a string when present');
    }
    if (p.customerSnapshot !== undefined) {
      if (p.customerSnapshot === null || typeof p.customerSnapshot !== 'object') {
        throw new Error('Bundle.project.customerSnapshot must be an object when present');
      }
      const snap = p.customerSnapshot as Record<string, unknown>;
      if (typeof snap.name !== 'string') {
        throw new Error('Bundle.project.customerSnapshot.name is required');
      }
    }
  }
  return {
    ...v1,
    version: 2,
    ...(project !== undefined ? { project: project as BundleProject } : {}),
  };
}

// ── Serialize ───────────────────────────────────────────────────

export function serializeBundle(bundle: Bundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function parseBundle(raw: string): Bundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Bundle is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return migrateBundle(parsed);
}

// ── File I/O (browser) ──────────────────────────────────────────

/**
 * Trigger a browser download of the bundle as a .elbow file. Uses
 * Blob + anchor click — universal, no lib dependency, works in Tauri
 * (which translates to a native save dialog) and in plain Chromium.
 */
export function downloadBundle(bundle: Bundle, filename?: string): void {
  if (typeof document === 'undefined') return;
  const name = filename ?? suggestFilename(bundle);
  const blob = new Blob([serializeBundle(bundle)], { type: BUNDLE_MIME });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * Prompt the user to pick a .elbow file and return the parsed bundle.
 * Creates a hidden <input type="file"> — works in Tauri + plain browsers.
 * Resolves with null if the user cancels.
 */
export function requestBundleUpload(): Promise<Bundle | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise<Bundle | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${BUNDLE_EXTENSION},application/json,${BUNDLE_MIME}`;
    // Hide and append so the picker spawns — required on some browsers.
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => { try { input.remove(); } catch { /* ignore */ } };

    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) { cleanup(); resolve(null); return; }
        const text = await file.text();
        const bundle = parseBundle(text);
        cleanup();
        resolve(bundle);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    input.click();
  });
}

// ── Helpers ─────────────────────────────────────────────────────

function deepClone<T>(v: T): T {
  // structuredClone is standard in modern Chromium + the Tauri webview.
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

function readAppVersion(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_APP_VERSION ?? env?.PACKAGE_VERSION ?? 'unknown';
}

function suggestFilename(bundle: Bundle): string {
  const name = (bundle.meta.name ?? 'project').replace(/[^a-z0-9-_]/gi, '-').slice(0, 40);
  const stamp = new Date(bundle.meta.savedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${name}-${stamp}${BUNDLE_EXTENSION}`;
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  validateV1,
  validateV2,
  deepClone,
  suggestFilename,
  captureActiveCustomerProject,
  activateBundleCustomer,
};
