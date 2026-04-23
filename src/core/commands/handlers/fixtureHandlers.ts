/**
 * Fixture command handlers — analogous to pipeHandlers, one per mutation.
 *
 * Design notes:
 *   • `fixture.place` snapshots are nullable because addFixture generates
 *     the id internally; undo uses the returned id off the apply() call.
 *   • Param changes are high-frequency (slider drags). To keep the log
 *     readable, fixture.updateParam MERGES with its previous entry if
 *     (a) same id, (b) same key, (c) within 250ms. See CommandBus merge
 *     logic? -- No: simpler is to just log each tick. If it becomes
 *     painful, we add coalescing later (ADR entry reserved).
 */

import type { CommandHandler } from '../types';
import { useFixtureStore, type FixtureInstance } from '@store/fixtureStore';
import type { FixtureSubtype } from '../../../engine/graph/GraphNode';

// ── Payloads ───────────────────────────────────────────────────

export interface FixturePlacePayload {
  subtype: FixtureSubtype;
  position: [number, number, number];
  paramOverrides?: Record<string, unknown>;
}

export interface FixtureRemovePayload {
  id: string;
}

export interface FixtureSelectPayload {
  id: string | null;
}

export interface FixtureUpdateParamPayload {
  id: string;
  key: string;
  value: unknown;
}

export interface FixtureBulkUpdateParamsPayload {
  id: string;
  patch: Record<string, unknown>;
}

export interface FixtureSetPositionPayload {
  id: string;
  position: [number, number, number];
}

// ── Handlers ───────────────────────────────────────────────────

export const fixturePlaceHandler: CommandHandler<FixturePlacePayload, string> = {
  type: 'fixture.place',
  mode: 'plumbing',
  apply: (p) => {
    return useFixtureStore
      .getState()
      .addFixture(p.subtype, p.position, p.paramOverrides);
  },
  // Undo of place = remove. Snapshot stores the id, written in apply's
  // return path via the Phase 1 undo manager (when it lands). For now,
  // undo is optional on place.
};

export const fixtureRemoveHandler: CommandHandler<FixtureRemovePayload, void> = {
  type: 'fixture.remove',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useFixtureStore.getState().fixtures[p.id]) {
      return `fixture.remove: no fixture "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => useFixtureStore.getState().fixtures[p.id] ?? null,
  apply: (p) => {
    useFixtureStore.getState().removeFixture(p.id);
  },
  undo: (_p, snapshot) => {
    const fx = snapshot as FixtureInstance | null;
    if (!fx) return;
    useFixtureStore.getState().addFixture(fx.subtype, fx.position, fx.params);
  },
};

export const fixtureSelectHandler: CommandHandler<FixtureSelectPayload, void> = {
  type: 'fixture.select',
  mode: 'plumbing',
  preconditions: (p) => {
    if (p.id !== null && !useFixtureStore.getState().fixtures[p.id]) {
      return `fixture.select: no fixture "${p.id}"`;
    }
    return null;
  },
  apply: (p) => {
    useFixtureStore.getState().selectFixture(p.id);
  },
};

export const fixtureUpdateParamHandler: CommandHandler<FixtureUpdateParamPayload, void> = {
  type: 'fixture.updateParam',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useFixtureStore.getState().fixtures[p.id]) {
      return `fixture.updateParam: no fixture "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => ({
    prev: useFixtureStore.getState().fixtures[p.id]?.params[p.key],
  }),
  apply: (p) => {
    useFixtureStore.getState().updateParam(p.id, p.key, p.value);
  },
  undo: (p, snapshot) => {
    const prev = (snapshot as { prev: unknown }).prev;
    useFixtureStore.getState().updateParam(p.id, p.key, prev);
  },
};

export const fixtureBulkUpdateParamsHandler: CommandHandler<
  FixtureBulkUpdateParamsPayload,
  void
> = {
  type: 'fixture.bulkUpdateParams',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useFixtureStore.getState().fixtures[p.id]) {
      return `fixture.bulkUpdateParams: no fixture "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => {
    const fx = useFixtureStore.getState().fixtures[p.id];
    if (!fx) return null;
    // Only snapshot keys that will change
    const prior: Record<string, unknown> = {};
    for (const k of Object.keys(p.patch)) prior[k] = fx.params[k];
    return prior;
  },
  apply: (p) => {
    useFixtureStore.getState().bulkUpdateParams(p.id, p.patch);
  },
  undo: (p, snapshot) => {
    const prior = snapshot as Record<string, unknown> | null;
    if (!prior) return;
    useFixtureStore.getState().bulkUpdateParams(p.id, prior);
  },
};

export const fixtureSetPositionHandler: CommandHandler<FixtureSetPositionPayload, void> = {
  type: 'fixture.setPosition',
  mode: 'plumbing',
  preconditions: (p) => {
    if (!useFixtureStore.getState().fixtures[p.id]) {
      return `fixture.setPosition: no fixture "${p.id}"`;
    }
    return null;
  },
  snapshot: (p) => ({
    prev: useFixtureStore.getState().fixtures[p.id]?.position,
  }),
  apply: (p) => {
    useFixtureStore.getState().setPosition(p.id, p.position);
  },
  undo: (p, snapshot) => {
    const prev = (snapshot as { prev?: [number, number, number] }).prev;
    if (prev) useFixtureStore.getState().setPosition(p.id, prev);
  },
};

export const fixtureHandlers = [
  fixturePlaceHandler,
  fixtureRemoveHandler,
  fixtureSelectHandler,
  fixtureUpdateParamHandler,
  fixtureBulkUpdateParamsHandler,
  fixtureSetPositionHandler,
] as const;
