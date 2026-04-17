/**
 * AutoRouter — user-facing API for automatic pipe routing.
 *
 * The user clicks two fixtures and the system produces a fully
 * code-compliant, gravity-correct, obstacle-avoiding pipe route
 * in milliseconds.
 *
 * Pipeline:
 *   1. Identify start/end fixtures and their system types
 *   2. Build SDF from current obstacles + existing pipes
 *   3. Run GravityAwareAStar with system-appropriate constraints
 *   4. Smooth the raw path (collinear removal, LOS skip, corner rounding)
 *   5. Generate HILO alternatives via ECBS diversity
 *   6. Emit results on EventBus for visual preview
 *
 * Supports three routing modes:
 *   SINGLE  — one best route, committed immediately
 *   HILO    — 4 Pareto-ranked alternatives for user selection
 *   MULTI   — auto-route waste + vent + supply as a coordinated system
 */

import { eventBus } from '../EventBus';
import { EV, type Vec3 } from '../events';
import { SignedDistanceField, DEFAULT_SDF_CONFIG } from './SignedDistanceField';
import {
  gravityAwareAStar,
  type RouteConstraints,
  type SearchResult,
  DEFAULT_CONSTRAINTS,
} from './GravityAwareAStar';
import { smoothPath } from './PathSmoother';
import { TRAP_ARM_MAX_FT, type FixtureSubtype } from '../../engine/graph/GraphNode';
import type { SystemType } from '../../engine/graph/GraphNode';
import type { CommittedPipe } from '../../store/pipeStore';

// ── Events ──────────────────────────────────────────────────────

export const AUTOROUTE_EV = {
  /** User initiated auto-route between two fixtures. */
  REQUEST:    'autoroute:request',
  /** Single best route found. */
  RESULT:     'autoroute:result',
  /** Multiple alternative routes found (HILO mode). */
  ALTERNATIVES: 'autoroute:alternatives',
  /** Auto-route in progress (for progress animation). */
  PROGRESS:   'autoroute:progress',
  /** Auto-route failed. */
  FAILED:     'autoroute:failed',
  /** Multi-system routing complete (waste+vent+supply). */
  MULTI_COMPLETE: 'autoroute:multi:complete',
} as const;

export type RoutingMode = 'single' | 'hilo' | 'multi';

export interface AutoRouteRequest {
  startFixtureId: string;
  endFixtureId: string;
  startPos: Vec3;
  endPos: Vec3;
  system: SystemType;
  mode: RoutingMode;
  fixtureSubtype?: FixtureSubtype;
}

export interface AutoRouteResult {
  path: Vec3[];
  rawPath: Vec3[];
  searchResult: SearchResult;
  constraints: RouteConstraints;
  system: SystemType;
  smoothed: boolean;
}

export interface MultiSystemResult {
  waste: AutoRouteResult | null;
  vent: AutoRouteResult | null;
  supply: AutoRouteResult | null;
}

// ── Obstacle building ───────────────────────────────────────────

export interface SceneObstacle {
  type: 'box' | 'cylinder';
  // Box
  min?: Vec3;
  max?: Vec3;
  // Cylinder
  center?: [number, number];
  radius?: number;
  yRange?: [number, number];
}

/**
 * Build an SDF from scene obstacles and existing pipes.
 */
function buildSDF(
  obstacles: SceneObstacle[],
  existingPipes: CommittedPipe[],
): SignedDistanceField {
  const sdf = new SignedDistanceField(DEFAULT_SDF_CONFIG);
  const cs = sdf.getCellSize();

  // Add structural obstacles
  for (const obs of obstacles) {
    if (obs.type === 'box' && obs.min && obs.max) {
      sdf.addBox(
        Math.round(obs.min[0] / cs), Math.round(obs.min[1] / cs), Math.round(obs.min[2] / cs),
        Math.round(obs.max[0] / cs), Math.round(obs.max[1] / cs), Math.round(obs.max[2] / cs),
      );
    } else if (obs.type === 'cylinder' && obs.center && obs.radius && obs.yRange) {
      sdf.addCylinder(
        Math.round(obs.center[0] / cs), Math.round(obs.center[1] / cs),
        Math.round(obs.radius / cs),
        Math.round(obs.yRange[0] / cs), Math.round(obs.yRange[1] / cs),
      );
    }
  }

  // Add existing pipes as soft avoidance zones
  for (const pipe of existingPipes) {
    sdf.addPipeRoute(pipe.points, pipe.diameter / 12 + 0.25); // pipe radius + 3" clearance
  }

  // Propagate distance field
  sdf.propagate();

  return sdf;
}

// ── Constraint builder ──────────────────────────────────────────

function constraintsForSystem(
  system: SystemType,
  fixtureSubtype?: FixtureSubtype,
): RouteConstraints {
  const base = { ...DEFAULT_CONSTRAINTS, system };

  switch (system) {
    case 'waste':
      base.minDrainageSlope = 0.25; // 1/4" per foot (IPC 704.1)
      base.maxTrapArm = fixtureSubtype
        ? (TRAP_ARM_MAX_FT[getTrapSize(fixtureSubtype)] ?? 5)
        : 5;
      base.maxLength = 100;
      break;

    case 'vent':
      base.minDrainageSlope = 0; // vents don't need slope
      base.maxTrapArm = Infinity; // no trap arm constraint
      base.maxLength = 50;
      break;

    case 'cold_supply':
    case 'hot_supply':
      base.minDrainageSlope = 0; // pressurized, no gravity constraint
      base.maxTrapArm = Infinity;
      base.maxLength = 150;
      break;

    case 'storm':
      base.minDrainageSlope = 0.125; // 1/8" per foot for storm
      base.maxTrapArm = Infinity;
      base.maxLength = 200;
      break;
  }

  return base;
}

function getTrapSize(subtype: FixtureSubtype): number {
  const map: Partial<Record<FixtureSubtype, number>> = {
    water_closet: 3,
    lavatory: 1.5,
    kitchen_sink: 1.5,
    bathtub: 1.5,
    shower: 2,
    floor_drain: 2,
  };
  return map[subtype] ?? 1.5;
}

// ── AutoRouter class ────────────────────────────────────────────

export class AutoRouter {
  private obstacles: SceneObstacle[] = [];
  private existingPipes: CommittedPipe[] = [];

  /** Set the current scene obstacles. */
  setObstacles(obstacles: SceneObstacle[]): void {
    this.obstacles = obstacles;
  }

  /** Update the existing pipe inventory (for avoidance). */
  setExistingPipes(pipes: CommittedPipe[]): void {
    this.existingPipes = pipes;
  }

  /**
   * Route a single pipe between two positions.
   */
  route(request: AutoRouteRequest): AutoRouteResult | null {
    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'building_sdf' });

    // Build SDF
    const sdf = buildSDF(this.obstacles, this.existingPipes);

    // Build constraints
    const constraints = constraintsForSystem(
      request.system,
      request.fixtureSubtype,
    );

    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'searching' });

    // Run A*
    const searchResult = gravityAwareAStar(
      request.startPos,
      request.endPos,
      sdf,
      constraints,
    );

    if (!searchResult.success) {
      eventBus.emit(AUTOROUTE_EV.FAILED, {
        reason: searchResult.failureReason,
        request,
      });
      return null;
    }

    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'smoothing' });

    // Smooth the raw path
    const smoothed = smoothPath(searchResult.path, sdf);

    const result: AutoRouteResult = {
      path: smoothed,
      rawPath: searchResult.path,
      searchResult,
      constraints,
      system: request.system,
      smoothed: true,
    };

    eventBus.emit(AUTOROUTE_EV.RESULT, result);
    return result;
  }

  /**
   * Generate multiple alternative routes (HILO mode).
   * Runs A* multiple times with progressive SDF penalties
   * on previously found paths.
   */
  routeWithAlternatives(
    request: AutoRouteRequest,
    count: number = 4,
  ): AutoRouteResult[] {
    const results: AutoRouteResult[] = [];
    const sdf = buildSDF(this.obstacles, this.existingPipes);
    const constraints = constraintsForSystem(request.system, request.fixtureSubtype);

    for (let i = 0; i < count; i++) {
      eventBus.emit(AUTOROUTE_EV.PROGRESS, {
        phase: 'searching',
        alternative: i + 1,
        total: count,
      });

      const searchResult = gravityAwareAStar(
        request.startPos,
        request.endPos,
        sdf,
        constraints,
      );

      if (!searchResult.success) continue;

      const smoothed = smoothPath(searchResult.path, sdf);

      results.push({
        path: smoothed,
        rawPath: searchResult.path,
        searchResult,
        constraints,
        system: request.system,
        smoothed: true,
      });

      // Add this path as soft obstacle for diversity
      sdf.addPipeRoute(searchResult.path, 1.5);
    }

    if (results.length > 0) {
      eventBus.emit(AUTOROUTE_EV.ALTERNATIVES, { routes: results });
    } else {
      eventBus.emit(AUTOROUTE_EV.FAILED, {
        reason: 'No valid routes found',
        request,
      });
    }

    return results;
  }

  /**
   * Multi-system auto-route: given two fixtures, route waste, vent,
   * and supply pipes as a coordinated system.
   *
   * Order: waste first (determines slope), then vent (follows waste),
   * then supply (independent of gravity).
   */
  routeMultiSystem(request: AutoRouteRequest): MultiSystemResult {
    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'multi_waste' });

    // 1. Route waste (gravity-constrained)
    const wasteResult = this.route({
      ...request,
      system: 'waste',
    });

    // Add waste pipe to avoidance for vent/supply
    if (wasteResult) {
      this.existingPipes = [
        ...this.existingPipes,
        {
          id: `temp-waste`,
          points: wasteResult.path,
          diameter: 2,
          material: 'pvc_sch40',
          system: 'waste',
          color: '#ef5350',
          visible: true,
          selected: false,
        },
      ];
    }

    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'multi_vent' });

    // 2. Route vent (rises from waste to atmosphere)
    // Vent starts near the fixture trap and goes up
    const ventStart = request.startPos;
    const ventEnd: Vec3 = [
      request.startPos[0],
      request.startPos[1] + 8, // rise 8 feet to roof
      request.startPos[2],
    ];
    const ventResult = this.route({
      ...request,
      startPos: ventStart,
      endPos: ventEnd,
      system: 'vent',
    });

    eventBus.emit(AUTOROUTE_EV.PROGRESS, { phase: 'multi_supply' });

    // 3. Route supply (pressurized, no gravity)
    const supplyResult = this.route({
      ...request,
      system: 'cold_supply',
    });

    const multiResult: MultiSystemResult = {
      waste: wasteResult,
      vent: ventResult,
      supply: supplyResult,
    };

    eventBus.emit(AUTOROUTE_EV.MULTI_COMPLETE, multiResult);
    return multiResult;
  }
}

// ── Singleton ───────────────────────────────────────────────────

let router: AutoRouter | null = null;

export function getAutoRouter(): AutoRouter {
  if (!router) router = new AutoRouter();
  return router;
}
