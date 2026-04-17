/**
 * AutoRouteTrigger — when a fixture is dropped from the FIXTURE wheel,
 * this component detects the drop position, finds the nearest existing
 * pipe network (main), and invokes HILOCoordinator to offer auto-route
 * alternatives via the Pareto frontier.
 *
 * Flow:
 *   1. User selects fixture from FIXTURE wheel (pendingFixture in customerStore)
 *   2. User clicks on canvas → fixture drops at that position
 *   3. AutoRouteTrigger finds the nearest committed pipe of matching system
 *   4. Calls HILOCoordinator.generateRoutes() for that endpoint pair
 *   5. User sees Pareto-ranked route candidates in RouteSuggestionPanel
 *   6. User picks one → pipe commits, adding to the network
 *
 * The component renders no visible UI — it's pure event orchestration.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCustomerStore } from '@store/customerStore';
import { useFixtureStore } from '@store/fixtureStore';
import { usePipeStore } from '@store/pipeStore';
import { useInteractionStore } from '@store/interactionStore';
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
    // Check start + end of pipe
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
  const { raycaster, camera, pointer } = useThree();
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
  const hit = useRef(new THREE.Vector3());

  const getGroundHit = useCallback((): Vec3 => {
    raycaster.setFromCamera(pointer, camera);
    raycaster.ray.intersectPlane(plane.current, hit.current);
    return [hit.current.x, hit.current.y, hit.current.z];
  }, [raycaster, camera, pointer]);

  useEffect(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const onClick = (e: MouseEvent) => {
      if (e.button !== 0) return;

      const pending = useCustomerStore.getState().pendingFixture;
      if (!pending) return;

      // Only act if we're in navigate mode (not drawing, not selecting)
      const mode = useInteractionStore.getState().mode;
      if (mode !== 'navigate') return;

      // Determine drop position
      const dropPos = getGroundHit();

      // Resolve the template from the active customer
      const template = useCustomerStore.getState().getActiveTemplate(
        pending.subtype,
        pending.variant,
      );
      if (!template) {
        // No customer template for this variant — still drop the basic
        // fixture so the user sees their click produced something.
        useFixtureStore.getState().addFixture(pending.subtype, dropPos, {
          tag: pending.variant,
        });
        eventBus.emit(EV.FIXTURE_PLACED, {
          id: `fx-${Date.now()}`,
          type: pending.subtype,
          position: dropPos,
          dfu: 0,
        });
        useCustomerStore.getState().setPendingFixture(null);
        return;
      }

      // Actually add the fixture to the authoritative fixtureStore so
      // FixtureLayerFromStore renders it. Previously only the event was
      // fired — nothing listened, so nothing ever appeared in the scene.
      useFixtureStore.getState().addFixture(pending.subtype, dropPos, {
        tag: pending.variant,
      });

      // Emit a fixture-placed event (for solver / auto-route consumers)
      const fixtureId = `fx-${Date.now()}`;
      eventBus.emit(EV.FIXTURE_PLACED, {
        id: fixtureId,
        type: pending.subtype,
        position: dropPos,
        dfu: 0,
      });

      // Try to auto-route each connection port to the nearest existing main
      const router = getAutoRouter();
      router.setExistingPipes(Object.values(usePipeStore.getState().pipes));

      // Waste connection
      if (template.connections.waste) {
        const fromPort: Vec3 = [
          dropPos[0] + template.connections.waste.position[0],
          dropPos[1] + template.connections.waste.position[1],
          dropPos[2] + template.connections.waste.position[2],
        ];
        const nearestMain = findNearestEndpoint(fromPort, 'waste');
        if (nearestMain) {
          router.routeWithAlternatives({
            startFixtureId: fixtureId,
            endFixtureId: 'main',
            startPos: fromPort,
            endPos: nearestMain,
            system: 'waste',
            mode: 'hilo',
            fixtureSubtype: pending.subtype,
          }, 4);
        }
      }

      // Clear the pending state — fixture has been placed
      useCustomerStore.getState().setPendingFixture(null);
    };

    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [getGroundHit]);

  return null;
}
