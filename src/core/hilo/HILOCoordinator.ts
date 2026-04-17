/**
 * HILO Coordinator — Mixed-Initiative bridge.
 *
 * Orchestrates the full Human-in-the-Loop cycle:
 *   1. User initiates a route (start fixture → end fixture)
 *   2. ECBS generates diverse candidate routes
 *   3. Pareto frontier filters to non-dominated solutions
 *   4. Bayesian optimizer ranks by Expected Improvement
 *   5. Preference model re-weights by learned user tastes
 *   6. Top-K candidates presented as ghost previews
 *   7. User selects one → preference model updates → repeat
 *
 * The coordinator never forces a path. It proposes, the human disposes.
 */

import { eventBus } from '../EventBus';
import { EV, type Vec3 } from '../events';
import { ParetoFrontier, type RouteCandidate } from '../optimizer/ParetoFrontier';
import {
  BayesianOptimizer,
  defaultFeatureExtractor,
} from '../optimizer/BayesianOptimizer';
import {
  generateDiverseRoutes,
  ObstacleMap,
  type GridConfig,
} from '../pathfinding/ECBSRouter';
import { PreferenceModel } from './PreferenceModel';

// ── HILO-specific events ────────────────────────────────────────

export const HILO_EV = {
  /** Optimizer produced candidate routes. */
  ROUTES_GENERATED:    'hilo:routes:generated',
  /** User picked a route from the suggestions. */
  ROUTE_SELECTED:      'hilo:route:selected',
  /** User explicitly rejected all suggestions. */
  ROUTES_REJECTED:     'hilo:routes:rejected',
  /** Preference model updated after a choice. */
  PREFERENCE_UPDATED:  'hilo:preference:updated',
  /** Request the coordinator to generate routes. */
  REQUEST_ROUTES:      'hilo:request:routes',
} as const;

export interface RoutesGeneratedPayload {
  frontier: RouteCandidate[];
  ranked: RouteCandidate[];
  allCandidates: RouteCandidate[];
}

export interface RouteSelectedPayload {
  selected: RouteCandidate;
  alternatives: RouteCandidate[];
}

// ── Coordinator ─────────────────────────────────────────────────

export class HILOCoordinator {
  private frontier = new ParetoFrontier();
  private optimizer: BayesianOptimizer;
  private preference = new PreferenceModel();
  private obstacles: ObstacleMap;
  private gridConfig: GridConfig;

  /** How many top routes to present to the user. */
  private displayCount = 4;

  /** The most recently generated candidates (for selection tracking). */
  private currentCandidates: RouteCandidate[] = [];

  constructor(obstacles: ObstacleMap, gridConfig: GridConfig) {
    this.obstacles = obstacles;
    this.gridConfig = gridConfig;
    this.optimizer = new BayesianOptimizer(defaultFeatureExtractor);
    this.wireEvents();
  }

  /**
   * Generate diverse routes between two points and emit the
   * Pareto-ranked suggestions onto the EventBus.
   */
  generateRoutes(start: Vec3, goal: Vec3): RoutesGeneratedPayload {
    // 1. ECBS produces diverse candidates
    const raw = generateDiverseRoutes(
      start,
      goal,
      this.obstacles,
      this.gridConfig,
      8, // generate 8 raw candidates
    );

    // 2. Feed into Pareto frontier
    this.frontier.clear();
    this.frontier.insertBatch(raw);

    // 3. Observe all candidates in the Bayesian optimizer
    for (const c of raw) this.optimizer.observe(c);

    // 4. Rank frontier by learned preferences
    const weights = this.preference.getWeights();
    const ranked = this.frontier.rankByPreference(weights);

    // 5. Use Bayesian EI to select most informative subset
    const topK = this.optimizer.selectNextBatch(ranked, weights, this.displayCount);

    const payload: RoutesGeneratedPayload = {
      frontier: this.frontier.getFrontier(),
      ranked: topK,
      allCandidates: raw,
    };

    this.currentCandidates = topK;
    eventBus.emit(HILO_EV.ROUTES_GENERATED, payload);
    return payload;
  }

  /**
   * User selected a route. Update preference model and emit.
   */
  selectRoute(routeId: string): RouteCandidate | null {
    const selected = this.currentCandidates.find((c) => c.id === routeId);
    if (!selected) return null;

    const alternatives = this.currentCandidates.filter((c) => c.id !== routeId);

    // Update preference model
    this.preference.recordChoice(selected, alternatives);

    const payload: RouteSelectedPayload = { selected, alternatives };
    eventBus.emit(HILO_EV.ROUTE_SELECTED, payload);
    eventBus.emit(HILO_EV.PREFERENCE_UPDATED, this.preference.getWeights());

    // Bridge to pipe completion event
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: selected.id,
      points: selected.points,
      diameter: 2, // default, will be sized by Phase 2 engine
      material: 'PVC',
    });

    return selected;
  }

  /** Get current preference weights (for UI display). */
  getPreferences() {
    return this.preference.getWeights();
  }

  /** Get the current frontier size. */
  get frontierSize() {
    return this.frontier.frontierSize;
  }

  /** Reset everything for a new design session. */
  reset(): void {
    this.frontier.clear();
    this.optimizer.reset();
    this.preference.reset();
    this.currentCandidates = [];
  }

  // ── Event wiring ──────────────────────────────────────────────

  private wireEvents(): void {
    eventBus.on<{ start: Vec3; goal: Vec3 }>(
      HILO_EV.REQUEST_ROUTES,
      ({ start, goal }) => {
        this.generateRoutes(start, goal);
      },
    );
  }
}

// ── Factory ─────────────────────────────────────────────────────

/** Create a coordinator with default grid settings. */
export function createHILOCoordinator(obstacles?: ObstacleMap): HILOCoordinator {
  const config: GridConfig = {
    cellSize: 0.5,            // 6-inch grid cells
    dimensions: [40, 20, 40], // 20×10×20 ft workspace
    minDrainageSlope: 0.25 / 12, // 1/4" per foot (IPC standard)
    maxTrapArm: 5.0,          // 5 ft for 1.25" trap (IPC 906.1)
  };
  return new HILOCoordinator(obstacles ?? new ObstacleMap(), config);
}
