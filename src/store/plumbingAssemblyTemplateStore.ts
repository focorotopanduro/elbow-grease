/**
 * plumbingAssemblyTemplateStore — Phase 14.C
 *
 * Renamed from `assemblyTemplateStore` in Phase 7 of the
 * hybrid-architecture refactor (ARCHITECTURE.md §3). The payload is
 * strictly plumbing: `CommittedPipe[]` + `FixtureInstance[]` pulled
 * from the plumbing entity stores. A future "roof section template"
 * library would need a parallel `roofingTemplateStore` with a
 * polygon + slope + material payload — generalising this store
 * would force a sum-type payload that benefits neither side.
 *
 * A persisted library of AssemblyTemplates. Each template is a
 * reusable snapshot of pipes + fixtures (normalized around their
 * centroid) that the user can drop into any scene.
 *
 * Responsibilities:
 *   - CRUD: save, rename, delete templates.
 *   - Persistence: localStorage-backed so the library survives restarts.
 *   - Scene integration: `applyTemplateToScene(id, anchorPos)` reads
 *     the template, mints fresh IDs, and pushes each pipe + fixture
 *     into the live scene stores.
 *
 * Keeping the pure math in `@core/templates/assemblyTemplate` means
 * this module is the only place that touches Zustand + localStorage —
 * i.e. the only side-effectful layer. 18 unit tests in
 * assemblyTemplate.spec.ts protect the normalization / offset math.
 */

import { create } from 'zustand';
import type { Vec3 } from '@core/events';
import {
  composeTemplate,
  instantiateTemplate,
  type AssemblyTemplate,
  type ComposeTemplateInput,
} from '@core/templates/assemblyTemplate';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { useFixtureStore, type FixtureInstance } from '@store/fixtureStore';

const STORAGE_KEY = 'elbow-grease-assembly-templates';
const STORAGE_VERSION = 1;

interface PersistShape {
  version: number;
  order: string[];
  templates: Record<string, AssemblyTemplate>;
}

interface TemplateState {
  templates: Record<string, AssemblyTemplate>;
  /** Display order — newest on top by default. */
  order: string[];

  /**
   * Snapshot the current scene (all pipes + fixtures) as a template.
   * Returns the new template ID, or null if the scene is empty.
   *
   * Phase 14.I — when `opts.pipeIds` / `opts.fixtureIds` are supplied,
   * only those items are captured. When omitted, every pipe and
   * fixture in the scene is captured (backward compatible).
   */
  saveCurrentSceneAsTemplate: (
    name: string,
    description?: string,
    opts?: { pipeIds?: readonly string[]; fixtureIds?: readonly string[] },
  ) => string | null;

  /** Delete a template from the library. */
  deleteTemplate: (id: string) => void;

  /** Rename a template in place. */
  renameTemplate: (id: string, name: string, description?: string) => void;

  /**
   * Instantiate a template into the current scene at `anchorPos`
   * (default origin). Returns the number of pipes + fixtures added,
   * or null if the template doesn't exist.
   */
  applyTemplateToScene: (
    id: string,
    anchorPos?: Vec3,
  ) => { pipesAdded: number; fixturesAdded: number } | null;

  /** True when the library has no templates yet. */
  isEmpty: () => boolean;
}

// ── Persistence ───────────────────────────────────────────────

function loadState(): { order: string[]; templates: Record<string, AssemblyTemplate> } {
  if (typeof window === 'undefined') return { order: [], templates: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], templates: {} };
    const parsed = JSON.parse(raw) as PersistShape;
    // Forward-compatible: if a future version bumps the schema, we
    // start fresh rather than crash. Templates are local-only.
    if (parsed.version !== STORAGE_VERSION) return { order: [], templates: {} };
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      templates: parsed.templates ?? {},
    };
  } catch {
    return { order: [], templates: {} };
  }
}

function saveState(order: string[], templates: Record<string, AssemblyTemplate>): void {
  if (typeof window === 'undefined') return;
  const payload: PersistShape = {
    version: STORAGE_VERSION,
    order,
    templates,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded — silently drop the save. Templates are a
    // convenience; losing one to quota is less bad than crashing
    // the panel. UI surface for quota errors is v2.
  }
}

// ── Helpers ───────────────────────────────────────────────────

function readCurrentScene(): { pipes: CommittedPipe[]; fixtures: FixtureInstance[] } {
  const pipeState = usePipeStore.getState();
  const fixtureState = useFixtureStore.getState();
  const pipes = pipeState.pipeOrder
    .map((id) => pipeState.pipes[id])
    .filter((p): p is CommittedPipe => !!p);
  const fixtures = Object.values(fixtureState.fixtures);
  return { pipes, fixtures };
}

// ── Store ─────────────────────────────────────────────────────

export const usePlumbingAssemblyTemplateStore = create<TemplateState>((set, get) => {
  const initial = loadState();
  return {
    templates: initial.templates,
    order: initial.order,

    saveCurrentSceneAsTemplate: (name, description, opts) => {
      let { pipes, fixtures } = readCurrentScene();
      // Phase 14.I — filter to the selected subset if lists were passed.
      if (opts?.pipeIds !== undefined) {
        const keep = new Set(opts.pipeIds);
        pipes = pipes.filter((p) => keep.has(p.id));
      }
      if (opts?.fixtureIds !== undefined) {
        const keep = new Set(opts.fixtureIds);
        fixtures = fixtures.filter((f) => keep.has(f.id));
      }
      if (pipes.length === 0 && fixtures.length === 0) return null;

      const input: ComposeTemplateInput = {
        name: name.trim() || 'Untitled Template',
        pipes,
        fixtures,
        ...(description !== undefined && description.trim().length > 0
          ? { description: description.trim() }
          : {}),
      };
      const tpl = composeTemplate(input);

      set((s) => {
        const nextTemplates = { ...s.templates, [tpl.id]: tpl };
        const nextOrder = [tpl.id, ...s.order.filter((x) => x !== tpl.id)];
        saveState(nextOrder, nextTemplates);
        return { templates: nextTemplates, order: nextOrder };
      });
      return tpl.id;
    },

    deleteTemplate: (id) => {
      set((s) => {
        if (!s.templates[id]) return s;
        const { [id]: _, ...rest } = s.templates;
        const nextOrder = s.order.filter((x) => x !== id);
        saveState(nextOrder, rest);
        return { templates: rest, order: nextOrder };
      });
    },

    renameTemplate: (id, name, description) => {
      set((s) => {
        const existing = s.templates[id];
        if (!existing) return s;
        const updated: AssemblyTemplate = {
          ...existing,
          name: name.trim() || existing.name,
          ...(description !== undefined
            ? description.trim().length > 0
              ? { description: description.trim() }
              : {}
            : {}),
        };
        const nextTemplates = { ...s.templates, [id]: updated };
        saveState(s.order, nextTemplates);
        return { templates: nextTemplates };
      });
    },

    applyTemplateToScene: (id, anchorPos = [0, 0, 0]) => {
      const tpl = get().templates[id];
      if (!tpl) return null;

      const instantiated = instantiateTemplate(tpl, anchorPos);
      const pipeActions = usePipeStore.getState();
      const fixtureActions = useFixtureStore.getState();

      // Pipes: use the minted IDs so each instance is uniquely tracked.
      // system/color fields on CommittedPipe are re-derived by addPipe,
      // so we lose the saved SystemType here; for drain-system templates
      // where the user cares about system classification, the solver
      // will re-assign on next pass. Acceptable MVP trade-off.
      for (const p of instantiated.pipes) {
        pipeActions.addPipe({
          id: p.id,
          points: p.points,
          diameter: p.diameter,
          material: p.material,
        });
      }

      // Fixtures: addFixture takes (subtype, position, paramOverrides)
      // and mints its own ID — we don't need to pre-mint.
      for (const f of instantiated.fixtures) {
        fixtureActions.addFixture(f.subtype, f.position, f.params);
      }

      return {
        pipesAdded: instantiated.pipes.length,
        fixturesAdded: instantiated.fixtures.length,
      };
    },

    isEmpty: () => get().order.length === 0,
  };
});

// ── Non-React getter for programmatic access ─────────────────

export function getActiveTemplates(): AssemblyTemplate[] {
  const s = usePlumbingAssemblyTemplateStore.getState();
  return s.order.map((id) => s.templates[id]).filter((t): t is AssemblyTemplate => !!t);
}
