/**
 * Interaction command handlers — mode changes, draw-point accumulation,
 * diameter/material/plane settings.
 *
 * These mutations are inherently non-undoable (they're UI state, not
 * model state), so no snapshot/undo. They're still worth routing
 * through the bus for observability: the God Mode console will show
 * the user's mode transitions interleaved with their pipe/fixture
 * actions, which is exactly the context needed to diagnose "why did
 * the click drop a point instead of selecting?"
 */

import type { CommandHandler } from '../types';
import {
  useInteractionStore,
  type InteractionMode,
  type DrawPlane,
} from '@store/interactionStore';
import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

export interface InteractionSetModePayload {
  mode: InteractionMode;
}

export interface InteractionAddDrawPointPayload {
  point: Vec3;
}

export interface InteractionClearDrawPayload {
  // Separate from mode change so the God Mode console shows WHY the
  // points vanished (Escape vs. finishDraw vs. explicit clear).
  reason: 'escape' | 'finish' | 'explicit';
}

export interface InteractionFinishDrawPayload {
  // Nothing — the draw points live in the store.
}

export interface InteractionSetDrawPlanePayload {
  plane: DrawPlane;
}

export interface InteractionSetDrawDiameterPayload {
  diameter: number;
}

export interface InteractionSetDrawMaterialPayload {
  material: PipeMaterial;
}

// ── Handlers ───────────────────────────────────────────────────

export const interactionSetModeHandler: CommandHandler<InteractionSetModePayload, void> = {
  type: 'interaction.setMode',
  apply: (p) => {
    useInteractionStore.getState().setMode(p.mode);
  },
};

export const interactionAddDrawPointHandler: CommandHandler<
  InteractionAddDrawPointPayload,
  void
> = {
  type: 'interaction.addDrawPoint',
  preconditions: (_p) => {
    if (useInteractionStore.getState().mode !== 'draw') {
      return 'interaction.addDrawPoint: not in draw mode';
    }
    return null;
  },
  apply: (p) => {
    useInteractionStore.getState().addDrawPoint(p.point);
  },
};

export const interactionClearDrawHandler: CommandHandler<
  InteractionClearDrawPayload,
  void
> = {
  type: 'interaction.clearDraw',
  apply: () => {
    useInteractionStore.getState().clearDraw();
  },
};

export const interactionFinishDrawHandler: CommandHandler<
  InteractionFinishDrawPayload,
  Vec3[] | null
> = {
  type: 'interaction.finishDraw',
  apply: () => {
    return useInteractionStore.getState().finishDraw();
  },
};

export const interactionSetDrawPlaneHandler: CommandHandler<
  InteractionSetDrawPlanePayload,
  void
> = {
  type: 'interaction.setDrawPlane',
  apply: (p) => {
    useInteractionStore.getState().setDrawPlane(p.plane);
  },
};

export const interactionSetDrawDiameterHandler: CommandHandler<
  InteractionSetDrawDiameterPayload,
  void
> = {
  type: 'interaction.setDrawDiameter',
  preconditions: (p) => (p.diameter > 0 ? null : `diameter must be > 0 (got ${p.diameter})`),
  apply: (p) => {
    useInteractionStore.getState().setDrawDiameter(p.diameter);
  },
};

export const interactionSetDrawMaterialHandler: CommandHandler<
  InteractionSetDrawMaterialPayload,
  void
> = {
  type: 'interaction.setDrawMaterial',
  apply: (p) => {
    useInteractionStore.getState().setDrawMaterial(p.material);
  },
};

export const interactionHandlers = [
  interactionSetModeHandler,
  interactionAddDrawPointHandler,
  interactionClearDrawHandler,
  interactionFinishDrawHandler,
  interactionSetDrawPlaneHandler,
  interactionSetDrawDiameterHandler,
  interactionSetDrawMaterialHandler,
] as const;
