/**
 * PhaseClassifier — determines which construction phase a given object
 * belongs to, using geometry + system + subtype heuristics.
 *
 * Heuristics (applied in order; first match wins):
 *
 *   1. Explicit override via phaseStore.overrides → use that
 *   2. Fixture subtype:
 *        - floor_drain below Y=0 → underground
 *        - everything else → trim
 *   3. Pipe:
 *        - pipe's minimum Y < -0.5 ft → underground (below slab)
 *        - system is 'waste' or 'storm' AND any point has Y ≤ 0.1 → underground
 *        - otherwise → rough_in
 *
 * Trim phase for pipes is reserved for fixture-to-stop short connectors
 * (< 1 ft segments terminating at a fixture) — detected optionally.
 */

import type { ConstructionPhase } from './PhaseTypes';
import type { CommittedPipe } from '../../store/pipeStore';
import type { FixtureInstance } from '../../store/fixtureStore';

const SLAB_Y = 0;
const UNDERGROUND_MIN_Y = -0.5;

/**
 * Classify a single pipe to a construction phase.
 */
export function classifyPipe(pipe: CommittedPipe): ConstructionPhase {
  if (pipe.points.length === 0) return 'rough_in';

  let minY = pipe.points[0]![1];
  let maxY = pipe.points[0]![1];
  for (const pt of pipe.points) {
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }

  // Clearly below slab → underground
  if (minY < UNDERGROUND_MIN_Y) return 'underground';

  // DWV at or near slab → underground
  if ((pipe.system === 'waste' || pipe.system === 'storm') && minY <= SLAB_Y + 0.1) {
    return 'underground';
  }

  // Short supply stub (< 1 ft total run) near a typical fixture height → trim
  const totalLen = computeTotalLength(pipe);
  if (totalLen < 1.0 && (pipe.system === 'cold_supply' || pipe.system === 'hot_supply')) {
    return 'trim';
  }

  return 'rough_in';
}

function computeTotalLength(pipe: CommittedPipe): number {
  let total = 0;
  for (let i = 1; i < pipe.points.length; i++) {
    const a = pipe.points[i - 1]!;
    const b = pipe.points[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    total += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return total;
}

/**
 * Classify a fixture.
 *
 * Most fixtures are TRIM (installed after tile/drywall). The only
 * exceptions are floor drains set below slab and below-grade cleanouts
 * which would be handled in the underground phase.
 */
export function classifyFixture(fixture: FixtureInstance): ConstructionPhase {
  if (fixture.subtype === 'floor_drain' && fixture.position[1] <= SLAB_Y) {
    return 'underground';
  }
  return 'trim';
}
