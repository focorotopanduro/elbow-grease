/**
 * AutoRouteTrigger — auto-routes a newly-placed fixture to the nearest
 * existing pipe of matching system type.
 *
 * Flow (updated):
 *   1. User picks fixture from FIXTURE wheel → `pendingFixture` set.
 *   2. `FixturePlacementPreview` renders a ghost + drop-catcher plane.
 *   3. User clicks → FixturePlacementPreview commits the fixture into
 *      `fixtureStore` AND emits `EV.FIXTURE_PLACED`.
 *   4. This component listens for `EV.FIXTURE_PLACED`; looks up the
 *      customer's template for the subtype/variant, finds the nearest
 *      existing pipe endpoint, and calls `AutoRouter` to generate
 *      route alternatives via the Pareto frontier.
 *
 * Why this split? The old implementation did both the drop AND the
 * auto-route via a canvas-level native click listener. Problem: other
 * R3F handlers called `stopImmediatePropagation()` on pointerdown,
 * and the event priority was fragile. If an existing fixture's hitbox
 * caught the click first, the drop silently failed. Moving the drop
 * into R3F (FixturePlacementPreview) + keeping auto-route in the
 * event-bus listener makes both pieces independent and reliable.
 *
 * The component renders no visible UI — it's pure event orchestration.
 */

import { useEffect } from 'react';
import { useCustomerStore } from '@store/customerStore';
import { usePipeStore } from '@store/pipeStore';
import { eventBus } from '@core/EventBus';
import { EV, type Vec3 } from '@core/events';
import { getAutoRouter } from '@core/pathfinding/AutoRouter';
import type { SystemType } from '../../engine/graph/GraphNode';

// ── Helpers ─────────────────────────────────────────────────────

/** Find the closest pipe endpoint of the given system type to a target position. */
function findNearestEndpoint(
  target: Vec3,
  system: SystemType,
): Vec3 | null {
  const pipes = Object.values(usePipeStore.getState().pipes);
  const candidates: { pos: Vec3; dist: number }[] = [];

  for (const pipe of pipes) {
    if (pipe.system !== system) continue;
    // Check start + end of pipe.
    for (const pos of [pipe.points[0], pipe.points[pipe.points.length - 1]]) {
      if (!pos) continue;
      const dx = pos[0] - target[0];
      const dy = pos[1] - target[1];
      const dz = pos[2] - target[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      candidates.push({ pos, dist });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0]!.pos;
}

// ── Component ───────────────────────────────────────────────────

export function AutoRouteTrigger() {
  useEffect(() => {
    // Subscribe ONCE on mount. No frame-rate dep churn: the previous
    // approach rebuilt this listener every frame because a useCallback
    // depended on `raycaster/camera/pointer`; that race window
    // contributed to the "drop sometimes just doesn't fire" bug.
    const unsubscribe = eventBus.on(EV.FIXTURE_PLACED, (payload) => {
      // fixtureStore.addFixture emits with { id, subtype, position, params }.
      // Older emitters use { id, type, position, dfu }. Handle both.
      const p = payload as {
        id?: string;
        subtype?: string;
        type?: string;
        position?: Vec3;
        params?: Record<string, unknown>;
      };
      const pos = p.position;
      if (!pos || pos.length !== 3) return;
      const subtype = (p.subtype ?? p.type) as string | undefined;
      if (!subtype) return;
      // Tag carries the variant (set by FixturePlacementPreview via
      // addFixture paramOverrides). Fall back to pendingFixture for
      // any manually-emitted FIXTURE_PLACED.
      const variant = (p.params?.['tag'] as string | undefined)
        ?? useCustomerStore.getState().pendingFixture?.variant;
      if (!variant) return;

      const template = useCustomerStore
        .getState()
        .getActiveTemplate(subtype as never, variant);
      if (!template) return;

      const router = getAutoRouter();
      router.setExistingPipes(Object.values(usePipeStore.getState().pipes));

      // Waste connection — route this port to the nearest drain main.
      if (template.connections.waste) {
        const fromPort: Vec3 = [
          pos[0] + template.connections.waste.position[0],
          pos[1] + template.connections.waste.position[1],
          pos[2] + template.connections.waste.position[2],
        ];
        const nearestMain = findNearestEndpoint(fromPort, 'waste');
        if (nearestMain) {
          router.routeWithAlternatives(
            {
              startFixtureId: p.id ?? `fx-${Date.now()}`,
              endFixtureId: 'main',
              startPos: fromPort,
              endPos: nearestMain,
              system: 'waste',
              mode: 'hilo',
              fixtureSubtype: subtype as never,
            },
            4,
          );
        }
      }
    });

    return unsubscribe;
  }, []);

  return null;
}
