/**
 * FixtureStore — single source of truth for placed fixtures + their parameters.
 *
 * Each fixture is an instance of a FixtureSubtype with:
 *   - id              (uuid)
 *   - subtype         (water_closet, kitchen_sink, etc.)
 *   - position        ([x, y, z] in feet)
 *   - params          (subtype-specific map, schema in FixtureParams.ts)
 *   - connected       (pipe ids that terminate at this fixture)
 *   - createdTs
 *
 * Supports:
 *   - add / remove / updatePosition
 *   - selectFixture (opens FixtureParamWindow)
 *   - updateParam (atomic change of a single schema field)
 *   - bulkUpdateParams (patch)
 *   - cloneFixture (duplicate-and-offset)
 *
 * On param change, recomputes DFU/WSFU via the schema overrides and
 * emits FIXTURE_PARAMS_CHANGED so the simulation engine can re-solve.
 */

import { create } from 'zustand';
import { eventBus } from '@core/EventBus';
import { EV } from '@core/events';
import type { FixtureSubtype } from '../engine/graph/GraphNode';
import {
  defaultParamsFor,
  effectiveDFU,
  effectiveWSFU,
  PARAM_SCHEMA,
} from '@core/fixtures/FixtureParams';
import { DFU_TABLE, SUPPLY_TABLE } from '../engine/graph/GraphNode';

// ── Types ───────────────────────────────────────────────────────

export interface FixtureInstance {
  id: string;
  subtype: FixtureSubtype;
  position: [number, number, number];
  params: Record<string, unknown>;
  createdTs: number;
  /** Pipe IDs connected to this fixture. */
  connectedPipeIds: string[];
}

interface FixtureState {
  fixtures: Record<string, FixtureInstance>;
  selectedFixtureId: string | null;

  // Lifecycle
  addFixture: (subtype: FixtureSubtype, position: [number, number, number], paramOverrides?: Record<string, unknown>) => string;
  removeFixture: (id: string) => void;
  cloneFixture: (id: string, offset?: [number, number, number]) => string | null;
  setPosition: (id: string, position: [number, number, number]) => void;

  // Selection
  selectFixture: (id: string | null) => void;

  // Params
  updateParam: (id: string, key: string, value: unknown) => void;
  bulkUpdateParams: (id: string, patch: Record<string, unknown>) => void;
  resetParams: (id: string) => void;

  // Connections
  attachPipe: (fixtureId: string, pipeId: string) => void;
  detachPipe: (fixtureId: string, pipeId: string) => void;

  // Queries
  getEffectiveDFU: (id: string) => number;
  getEffectiveWSFU: (id: string) => { cold: number; hot: number };

  // Bulk seed (for DEMO / project load)
  seedFromList: (items: { subtype: FixtureSubtype; position: [number, number, number]; params?: Record<string, unknown> }[]) => void;
}

// ── ID generator (time-sortable) ────────────────────────────────

let seq = 0;
function newId(): string {
  seq = (seq + 1) & 0xffff;
  return `fx_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// ── Store ───────────────────────────────────────────────────────

export const useFixtureStore = create<FixtureState>((set, get) => ({
  fixtures: {},
  selectedFixtureId: null,

  addFixture: (subtype, position, paramOverrides) => {
    const id = newId();
    const params = { ...defaultParamsFor(subtype), ...(paramOverrides ?? {}) };
    const fixture: FixtureInstance = {
      id,
      subtype,
      position,
      params,
      createdTs: Date.now(),
      connectedPipeIds: [],
    };
    set((s) => ({ fixtures: { ...s.fixtures, [id]: fixture } }));
    eventBus.emit(EV.FIXTURE_PLACED, { id, subtype, position, params });
    return id;
  },

  removeFixture: (id) => {
    set((s) => {
      const copy = { ...s.fixtures };
      delete copy[id];
      return {
        fixtures: copy,
        selectedFixtureId: s.selectedFixtureId === id ? null : s.selectedFixtureId,
      };
    });
    eventBus.emit(EV.FIXTURE_REMOVED, { id });
  },

  cloneFixture: (id, offset = [1, 0, 0]) => {
    const src = get().fixtures[id];
    if (!src) return null;
    const newPos: [number, number, number] = [
      src.position[0] + offset[0],
      src.position[1] + offset[1],
      src.position[2] + offset[2],
    ];
    return get().addFixture(src.subtype, newPos, { ...src.params });
  },

  setPosition: (id, position) => {
    let subtype: FixtureSubtype | null = null;
    set((s) => {
      const f = s.fixtures[id];
      if (!f) return s;
      subtype = f.subtype;
      return { fixtures: { ...s.fixtures, [id]: { ...f, position } } };
    });
    // Phase 14.AC.11 — emit so the SimulationBridge (when
    // `fixtureGraph` is on) can refresh the worker DAG's fixture
    // node elevation and keep downstream math aligned with UI
    // position. Pre-14.AC.11 the store mutated silently and the
    // worker graph drifted out of sync with every move.
    if (subtype !== null) {
      eventBus.emit(EV.FIXTURE_MOVED, { id, subtype, position });
    }
  },

  selectFixture: (id) => {
    set({ selectedFixtureId: id });
    if (id) eventBus.emit(EV.FIXTURE_SELECTED, { id });
  },

  updateParam: (id, key, value) => {
    set((s) => {
      const f = s.fixtures[id];
      if (!f) return s;
      const params = { ...f.params, [key]: value };
      return { fixtures: { ...s.fixtures, [id]: { ...f, params } } };
    });
    const f = get().fixtures[id];
    if (f) {
      eventBus.emit(EV.FIXTURE_PARAMS_CHANGED, { id, subtype: f.subtype, params: f.params, changedKey: key });
    }
  },

  bulkUpdateParams: (id, patch) => {
    set((s) => {
      const f = s.fixtures[id];
      if (!f) return s;
      const params = { ...f.params, ...patch };
      return { fixtures: { ...s.fixtures, [id]: { ...f, params } } };
    });
    const f = get().fixtures[id];
    if (f) {
      eventBus.emit(EV.FIXTURE_PARAMS_CHANGED, { id, subtype: f.subtype, params: f.params, changedKey: null });
    }
  },

  resetParams: (id) => {
    set((s) => {
      const f = s.fixtures[id];
      if (!f) return s;
      return {
        fixtures: { ...s.fixtures, [id]: { ...f, params: defaultParamsFor(f.subtype) } },
      };
    });
  },

  attachPipe: (fixtureId, pipeId) => {
    set((s) => {
      const f = s.fixtures[fixtureId];
      if (!f) return s;
      if (f.connectedPipeIds.includes(pipeId)) return s;
      return {
        fixtures: {
          ...s.fixtures,
          [fixtureId]: { ...f, connectedPipeIds: [...f.connectedPipeIds, pipeId] },
        },
      };
    });
  },

  detachPipe: (fixtureId, pipeId) => {
    set((s) => {
      const f = s.fixtures[fixtureId];
      if (!f) return s;
      return {
        fixtures: {
          ...s.fixtures,
          [fixtureId]: {
            ...f,
            connectedPipeIds: f.connectedPipeIds.filter((p) => p !== pipeId),
          },
        },
      };
    });
  },

  getEffectiveDFU: (id) => {
    const f = get().fixtures[id];
    if (!f) return 0;
    return effectiveDFU(f.subtype, f.params, DFU_TABLE[f.subtype] ?? 0);
  },

  getEffectiveWSFU: (id) => {
    const f = get().fixtures[id];
    if (!f) return { cold: 0, hot: 0 };
    const fallbackRow = SUPPLY_TABLE[f.subtype] ?? { coldWSFU: 0, hotWSFU: 0 };
    return effectiveWSFU(f.subtype, f.params, {
      cold: fallbackRow.coldWSFU,
      hot: fallbackRow.hotWSFU,
    });
  },

  seedFromList: (items) => {
    const now = Date.now();
    const fixtures: Record<string, FixtureInstance> = {};
    for (const item of items) {
      const id = newId();
      fixtures[id] = {
        id,
        subtype: item.subtype,
        position: item.position,
        params: { ...defaultParamsFor(item.subtype), ...(item.params ?? {}) },
        createdTs: now,
        connectedPipeIds: [],
      };
    }
    set({ fixtures });
  },
}));

// ── Re-export the schema getter for convenience ─────────────────

export function getSchema(subtype: FixtureSubtype) {
  return PARAM_SCHEMA[subtype];
}
