/**
 * Spatial Pipe Interaction — bridges gesture input to pipe routing.
 *
 * Translates raw gesture events (pinch, drag, point, palm) into
 * high-level pipe operations (select fixture, route segment, confirm,
 * cancel). Works identically in VR (hand tracking) and desktop
 * (mouse-mapped gestures) so the FSM and HILO systems are agnostic
 * to input modality.
 *
 * This is where "embodied cognition" meets the engineering pipeline:
 * natural hand movements directly become pipe geometry.
 */

import { eventBus } from '../EventBus';
import { EV, type Vec3 } from '../events';
import { userFSM } from '../UserProgressFSM';
import {
  GESTURE_EV,
  type PinchPayload,
  type PointRayPayload,
  type PalmPayload,
} from '../xr/XRHandTracking';
import { HILO_EV } from '../hilo/HILOCoordinator';

// ── Spatial interaction events ──────────────────────────────────

export const SPATIAL_EV = {
  FIXTURE_HIT:      'spatial:fixture:hit',
  ROUTE_POINT_ADD:  'spatial:route:point',
  ROUTE_PREVIEW:    'spatial:route:preview',
  GRAB_START:       'spatial:grab:start',
  GRAB_MOVE:        'spatial:grab:move',
  GRAB_END:         'spatial:grab:end',
} as const;

export interface FixtureHitPayload {
  fixtureId: string;
  position: Vec3;
  hand: 'left' | 'right' | 'mouse';
}

// ── Spatial grid snapping ───────────────────────────────────────

function snapToGrid(pos: Vec3, gridSize: number): Vec3 {
  return [
    Math.round(pos[0] / gridSize) * gridSize,
    Math.round(pos[1] / gridSize) * gridSize,
    Math.round(pos[2] / gridSize) * gridSize,
  ];
}

// ── Interaction state ───────────────────────────────────────────

interface InteractionState {
  /** Currently building a route? */
  isRouting: boolean;
  /** Points accumulated for the current route. */
  routePoints: Vec3[];
  /** Start fixture ID. */
  startFixtureId: string | null;
  /** Grid snap size in world units. */
  gridSize: number;
  /** Minimum distance between route points to register a new one. */
  minPointDistance: number;
}

export class SpatialPipeInteraction {
  private state: InteractionState = {
    isRouting: false,
    routePoints: [],
    startFixtureId: null,
    gridSize: 0.5,
    minPointDistance: 0.3,
  };

  constructor() {
    this.wireGestures();
  }

  // ── Gesture → pipe operation mapping ────────────────────────

  private wireGestures(): void {
    // Pinch start → begin route or select fixture
    eventBus.on<PinchPayload>(GESTURE_EV.PINCH_START, (payload) => {
      const snapped = snapToGrid(payload.position, this.state.gridSize);

      if (!this.state.isRouting) {
        // First pinch: select fixture, begin route
        this.state.isRouting = true;
        this.state.routePoints = [snapped];
        this.state.startFixtureId = this.findNearestFixture(snapped);

        userFSM.send('SELECT_FIXTURE');
        userFSM.send('START_ROUTE');

        eventBus.emit(EV.PIPE_DRAG_START, {
          startPosition: snapped,
          fixtureId: this.state.startFixtureId ?? 'unknown',
        });

        eventBus.emit(EV.PIPE_SNAP, {
          position: snapped,
          snapType: 'grid' as const,
        });
      }
    });

    // Pinch move → add route points (breadcrumb trail)
    eventBus.on<PinchPayload>(GESTURE_EV.PINCH_MOVE, (payload) => {
      if (!this.state.isRouting) return;

      const snapped = snapToGrid(payload.position, this.state.gridSize);
      const last = this.state.routePoints[this.state.routePoints.length - 1];

      if (last && this.dist(snapped, last) >= this.state.minPointDistance) {
        this.state.routePoints.push(snapped);

        eventBus.emit(EV.PIPE_ROUTE_UPDATE, {
          points: [...this.state.routePoints],
          isValid: true,
          totalLength: this.totalLength(),
        });

        eventBus.emit(EV.PIPE_SNAP, {
          position: snapped,
          snapType: 'grid' as const,
        });
      }
    });

    // Pinch release → finalize route segment, enter preview
    eventBus.on<PinchPayload>(GESTURE_EV.PINCH_END, (payload) => {
      if (!this.state.isRouting) return;
      if (this.state.routePoints.length < 2) {
        // Too short — cancel
        this.cancelRoute();
        return;
      }

      const endSnapped = snapToGrid(payload.position, this.state.gridSize);
      this.state.routePoints.push(endSnapped);

      userFSM.send('FINISH_ROUTE');

      // Request HILO to generate optimized alternatives
      const start = this.state.routePoints[0]!;
      const end = this.state.routePoints[this.state.routePoints.length - 1]!;
      eventBus.emit(HILO_EV.REQUEST_ROUTES, { start, goal: end });

      this.state.isRouting = false;
    });

    // Open palm → cancel current route
    eventBus.on<PalmPayload>(GESTURE_EV.OPEN_PALM, () => {
      if (this.state.isRouting) {
        this.cancelRoute();
      }
    });

    // Point ray → raycast for distant fixture selection
    eventBus.on<PointRayPayload>(GESTURE_EV.POINT_RAY, (payload) => {
      eventBus.emit(SPATIAL_EV.FIXTURE_HIT, {
        fixtureId: this.findNearestFixture(payload.origin),
        position: payload.origin,
        hand: payload.hand,
      });
    });
  }

  /**
   * Desktop mouse fallback: call this from React pointer events
   * to emit the same gesture events that VR hand tracking produces.
   */
  emulateFromMouse(action: 'down' | 'move' | 'up', worldPos: Vec3): void {
    const payload: PinchPayload = {
      hand: 'right',
      position: worldPos,
      direction: [0, -1, 0],
      strength: action === 'up' ? 0 : 1,
    };

    switch (action) {
      case 'down':
        eventBus.emit(GESTURE_EV.PINCH_START, payload);
        break;
      case 'move':
        eventBus.emit(GESTURE_EV.PINCH_MOVE, payload);
        break;
      case 'up':
        eventBus.emit(GESTURE_EV.PINCH_END, payload);
        break;
    }
  }

  /** Cancel the current route and reset FSM. */
  cancelRoute(): void {
    this.state.isRouting = false;
    this.state.routePoints = [];
    this.state.startFixtureId = null;
    userFSM.send('CANCEL');
    eventBus.emit(EV.PIPE_CANCEL, null);
  }

  /** Get the route points accumulated so far. */
  getRoutePoints(): Vec3[] {
    return [...this.state.routePoints];
  }

  // ── Helpers ─────────────────────────────────────────────────

  private findNearestFixture(_pos: Vec3): string | null {
    // Placeholder — Phase 2 will register fixtures in a spatial index.
    return null;
  }

  private dist(a: Vec3, b: Vec3): number {
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private totalLength(): number {
    let len = 0;
    for (let i = 1; i < this.state.routePoints.length; i++) {
      len += this.dist(this.state.routePoints[i]!, this.state.routePoints[i - 1]!);
    }
    return len;
  }
}

export const spatialInteraction = new SpatialPipeInteraction();
