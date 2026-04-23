/**
 * riserTemplates — Phase 14.Z
 *
 * Pre-built multi-floor riser assemblies — the feature the original
 * Python Elbow Grease shipped in its `riser_templates.csv` +
 * assembly-dialog plumbing.
 *
 * A "riser" is a vertical stack that carries drain + vent (or
 * supply) through multiple floors. Common configurations repeat
 * across residential and commercial jobs, so having pre-parameterized
 * templates saves plumbers from redrawing the same 3"/2" PVC stack
 * every time they start a new 2-story house.
 *
 * This module is PURE — it returns proposed pipes + fixtures.
 * Callers commit the result via `pipeStore.addPipe` + a direct
 * `useFixtureStore.setState` per entry. No React, no Zustand, no
 * Three. Fully unit-testable.
 *
 * Template catalog (commonly-needed):
 *   - 2-story residential DWV + vent (3" drain, 2" vent, cleanout)
 *   - 3-story residential DWV + vent
 *   - 2-story residential supply (3/4" PEX cold + hot)
 *   - Water-heater inlet + outlet pre-piped stub
 */

import type { Vec3 } from '@core/events';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';
import type { SystemType, FixtureSubtype } from '../../engine/graph/GraphNode';

// ── Template catalog ──────────────────────────────────────────

export type RiserId =
  | 'two_story_dwv'
  | 'three_story_dwv'
  | 'two_story_supply'
  | 'water_heater_stub';

export interface RiserTemplate {
  id: RiserId;
  label: string;
  description: string;
  /** How many floors the riser spans (for info/BOM). */
  floorCount: number;
  /** Approximate vertical extent, feet. */
  height: number;
}

export const RISER_CATALOG: Record<RiserId, RiserTemplate> = {
  two_story_dwv: {
    id: 'two_story_dwv',
    label: '2-story DWV stack',
    description:
      '3" vertical drain + 2" vent stack spanning two 9-ft floors. '
      + 'Includes accessible cleanout at base + wet-vent takeoffs at each floor.',
    floorCount: 2,
    height: 19,
  },
  three_story_dwv: {
    id: 'three_story_dwv',
    label: '3-story DWV stack',
    description:
      '4" drain + 2" vent stack spanning three 9-ft floors. '
      + 'Standard residential configuration for stacked baths.',
    floorCount: 3,
    height: 28,
  },
  two_story_supply: {
    id: 'two_story_supply',
    label: '2-story PEX supply',
    description:
      '3/4" PEX cold + hot riser spanning two floors with branch tees '
      + 'at each floor for fixture distribution.',
    floorCount: 2,
    height: 19,
  },
  water_heater_stub: {
    id: 'water_heater_stub',
    label: 'Water heater stub',
    description:
      'Pre-piped cold inlet + hot outlet stubs at typical water-heater '
      + 'connection heights, with expansion tank tee on the cold side.',
    floorCount: 1,
    height: 6,
  },
};

export function listRiserTemplates(): RiserTemplate[] {
  return Object.values(RISER_CATALOG);
}

// ── Proposed-entity shape ────────────────────────────────────

export interface RiserPipe {
  id: string;
  points: Vec3[];
  diameter: number;
  material: PipeMaterial;
  system: SystemType;
}

export interface RiserFixture {
  id: string;
  subtype: FixtureSubtype;
  position: Vec3;
  params: Record<string, unknown>;
}

export interface RiserResult {
  pipes: RiserPipe[];
  fixtures: RiserFixture[];
  /** Warnings (e.g. "anchored above grade — cleanout won't place") */
  warnings: string[];
}

// ── Id generation ─────────────────────────────────────────────

let seq = 0;
function newId(prefix: string): string {
  seq = (seq + 1) & 0xffff;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

// ── Template implementations ─────────────────────────────────

function buildTwoStoryDWV(anchor: Vec3): RiserResult {
  const [x, y, z] = anchor;
  const floorHeight = 9;
  // Stack goes from slab (y) up through 2 floors
  const slabY = y;
  const floor1Y = slabY + floorHeight;
  const stackTopY = floor1Y + floorHeight;
  return {
    pipes: [
      // 3" drain stack, slab → top
      {
        id: newId('riser_drain'),
        points: [[x, slabY, z], [x, stackTopY, z]],
        diameter: 3,
        material: 'pvc_sch40',
        system: 'waste',
      },
      // 2" vent stack, offset 1 ft +X of the drain
      {
        id: newId('riser_vent'),
        points: [[x + 1, floor1Y, z], [x + 1, stackTopY + 1, z]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'vent',
      },
      // Wet-vent cross-connection at first floor
      {
        id: newId('riser_wetvent'),
        points: [[x, floor1Y, z], [x + 1, floor1Y, z]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'vent',
      },
    ],
    fixtures: [
      // Cleanout at base of stack (IPC 708.3.4)
      {
        id: newId('riser_co'),
        subtype: 'cleanout_access',
        position: [x, slabY + 0.25, z],
        params: { rotationDeg: 0 },
      },
    ],
    warnings: [],
  };
}

function buildThreeStoryDWV(anchor: Vec3): RiserResult {
  const [x, y, z] = anchor;
  const floorHeight = 9;
  const slabY = y;
  const floor1Y = slabY + floorHeight;
  const floor2Y = floor1Y + floorHeight;
  const stackTopY = floor2Y + floorHeight;
  return {
    pipes: [
      // 4" drain stack (bigger than 2-story to handle 3× DFU)
      {
        id: newId('riser_drain'),
        points: [[x, slabY, z], [x, stackTopY, z]],
        diameter: 4,
        material: 'pvc_sch40',
        system: 'waste',
      },
      // 2" vent stack
      {
        id: newId('riser_vent'),
        points: [[x + 1, floor1Y, z], [x + 1, stackTopY + 1, z]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'vent',
      },
      // Wet-vent takeoffs at each floor
      {
        id: newId('riser_wetvent1'),
        points: [[x, floor1Y, z], [x + 1, floor1Y, z]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'vent',
      },
      {
        id: newId('riser_wetvent2'),
        points: [[x, floor2Y, z], [x + 1, floor2Y, z]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'vent',
      },
    ],
    fixtures: [
      {
        id: newId('riser_co'),
        subtype: 'cleanout_access',
        position: [x, slabY + 0.25, z],
        params: { rotationDeg: 0 },
      },
    ],
    warnings: [],
  };
}

function buildTwoStorySupply(anchor: Vec3): RiserResult {
  const [x, y, z] = anchor;
  const floorHeight = 9;
  const slabY = y;
  const floor1Y = slabY + floorHeight;
  const stackTopY = floor1Y + floorHeight;
  return {
    pipes: [
      // Cold riser
      {
        id: newId('riser_cold'),
        points: [[x, slabY, z], [x, stackTopY, z]],
        diameter: 0.75,
        material: 'pex',
        system: 'cold_supply',
      },
      // Hot riser offset 8" +X
      {
        id: newId('riser_hot'),
        points: [[x + 8 / 12, slabY, z], [x + 8 / 12, stackTopY, z]],
        diameter: 0.75,
        material: 'pex',
        system: 'hot_supply',
      },
      // Branch tees at floor 1 (cold + hot)
      {
        id: newId('riser_coldbranch1'),
        points: [[x, floor1Y, z], [x, floor1Y, z + 1.5]],
        diameter: 0.5,
        material: 'pex',
        system: 'cold_supply',
      },
      {
        id: newId('riser_hotbranch1'),
        points: [[x + 8 / 12, floor1Y, z], [x + 8 / 12, floor1Y, z + 1.5]],
        diameter: 0.5,
        material: 'pex',
        system: 'hot_supply',
      },
    ],
    fixtures: [],
    warnings: [],
  };
}

function buildWaterHeaterStub(anchor: Vec3): RiserResult {
  const [x, y, z] = anchor;
  // WH connection is typically 5-6 ft above slab (on top of 50-gal tank).
  const tankTopY = y + 5;
  // Two short horizontal stubs pointing away from where the tank will sit.
  return {
    pipes: [
      // Cold inlet stub — runs from supply main (above ceiling) down to tank top.
      {
        id: newId('riser_whcold'),
        points: [[x - 0.5, tankTopY + 2, z], [x - 0.5, tankTopY, z]],
        diameter: 0.75,
        material: 'pex',
        system: 'cold_supply',
      },
      // Hot outlet stub — up from tank to supply main.
      {
        id: newId('riser_whhot'),
        points: [[x + 0.5, tankTopY, z], [x + 0.5, tankTopY + 2, z]],
        diameter: 0.75,
        material: 'pex',
        system: 'hot_supply',
      },
      // Expansion-tank tee on the cold side (code-required in many jurisdictions)
      {
        id: newId('riser_expansiontee'),
        points: [[x - 0.5, tankTopY + 1, z], [x - 1.2, tankTopY + 1, z]],
        diameter: 0.5,
        material: 'pex',
        system: 'cold_supply',
      },
    ],
    fixtures: [
      // Expansion tank on the branch
      {
        id: newId('riser_extank'),
        subtype: 'expansion_tank',
        position: [x - 1.2, tankTopY + 1, z],
        params: { rotationDeg: 0 },
      },
    ],
    warnings: [],
  };
}

// ── Dispatcher ────────────────────────────────────────────────

/**
 * Place the given riser template at `anchor` (world-space point).
 * `anchor` is treated as the BASE of the stack (slab-level typical
 * for DWV risers; floor-level for supply risers; floor-level for
 * the water-heater stub).
 *
 * The returned result contains fully-formed pipes + fixtures the
 * caller commits to their respective stores via public APIs.
 */
export function placeRiser(
  templateId: RiserId,
  anchor: Vec3,
): RiserResult {
  switch (templateId) {
    case 'two_story_dwv':     return buildTwoStoryDWV(anchor);
    case 'three_story_dwv':   return buildThreeStoryDWV(anchor);
    case 'two_story_supply':  return buildTwoStorySupply(anchor);
    case 'water_heater_stub': return buildWaterHeaterStub(anchor);
  }
}
