/**
 * SnapPopulate — auto-populate fittings and stub-outs at fixture
 * connection points.
 *
 * When a user draws a pipe that connects to a fixture's supply or
 * waste port, this module automatically injects the canonical
 * "arrival hardware" — the fittings, stub-outs, and angle stops that
 * every plumber installs without thinking. This keeps the BOM
 * accurate and prevents the user from forgetting small-but-critical
 * parts in wall cavities.
 *
 * Per the Phase 1 blueprint:
 *
 *   SHOWER / TUB connection →  2× 1/2" 90° elbows (hot + cold supply)
 *                              + 1× 2" P-trap on waste
 *
 *   LAVATORY connection    →  2× 1/2" angle stops (hot + cold)
 *                              + 1× 1.5" P-trap on waste
 *
 *   TOILET connection      →  1× 3" closet flange (waste)
 *                              + 1× 1/2" angle stop (cold supply)
 *
 *   KITCHEN SINK           →  2× 1/2" angle stops (hot + cold)
 *                              + 1× 1.5" continuous waste + 1× P-trap
 *
 * The assembly is driven by fixture templates in the CustomerStore,
 * so "Builder A" can customize these drops to match their contracted
 * spec (e.g. always use Brasscraft angle stops, always use Oatey
 * closet flanges, always install isolation valves).
 *
 * All auto-populated items are tagged with a phase (rough_in or trim)
 * so they appear in the correct construction phase.
 */

import type { CommittedPipe } from '@store/pipeStore';
import type { FixtureTemplate, ConstructionPhase, PhasedAssemblyItem } from '@store/customerStore';
import type { Vec3 } from '@core/events';
import type { FixtureSubtype } from '../graph/GraphNode';
import type { FittingType, PipeMaterial } from '../graph/GraphEdge';

// ── Populated item ──────────────────────────────────────────────

export interface PopulatedItem {
  id: string;
  /** Position in world space. */
  position: Vec3;
  /** Rotation (Euler XYZ, radians). */
  rotation: Vec3;
  /** Diameter (inches). */
  diameter: number;
  /** Material. */
  material: PipeMaterial;
  /** Fitting type (if fitting). */
  fittingType?: FittingType;
  /** Pipe length (if pipe segment, feet). */
  length?: number;
  /** Phase it drops in. */
  phase: ConstructionPhase;
  /** Human label. */
  label: string;
  /** Cost (USD). */
  cost: number;
  /** Part number. */
  partNumber: string;
  /** Fixture this populates for. */
  fixtureId: string;
  /** Kind: supports BOM categorization. */
  kind: 'pipe' | 'fitting' | 'component';
}

// ── Connection detection ────────────────────────────────────────

const CONNECTION_TOLERANCE_FT = 0.25;

/**
 * A fixture instance placed in the scene. The SnapPopulate engine
 * compares pipe endpoints against these positions to detect
 * connection events.
 */
export interface FixtureInstance {
  id: string;
  subtype: FixtureSubtype;
  variant: string;
  position: Vec3;
  /** Rotation around Y (radians). Fixtures are typically placed axis-aligned. */
  rotation: number;
  /** The resolved template from the active customer. */
  template: FixtureTemplate;
}

/**
 * Given a pipe endpoint and a list of fixtures, find which connection
 * port (if any) it lands on.
 */
export interface ConnectionMatch {
  fixtureId: string;
  portName: 'waste' | 'vent' | 'cold' | 'hot';
  worldPortPos: Vec3;
  fixtureInstance: FixtureInstance;
}

export function detectConnection(
  endpoint: Vec3,
  fixtures: FixtureInstance[],
): ConnectionMatch | null {
  for (const f of fixtures) {
    const conns = f.template.connections;
    for (const portName of ['waste', 'vent', 'cold', 'hot'] as const) {
      const local = conns[portName]?.position;
      if (!local) continue;

      // Transform local offset → world using fixture position + rotation
      const rot = f.rotation;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const wx = f.position[0] + local[0] * c - local[2] * s;
      const wy = f.position[1] + local[1];
      const wz = f.position[2] + local[0] * s + local[2] * c;
      const worldPos: Vec3 = [wx, wy, wz];

      const dx = endpoint[0] - wx;
      const dy = endpoint[1] - wy;
      const dz = endpoint[2] - wz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= CONNECTION_TOLERANCE_FT) {
        return {
          fixtureId: f.id,
          portName,
          worldPortPos: worldPos,
          fixtureInstance: f,
        };
      }
    }
  }
  return null;
}

// ── Populate rules per fixture type ─────────────────────────────

/**
 * Given a fixture + pipe connection, return the items that should
 * automatically drop. The rules come from the template's phase
 * assembly — this function just filters to the items that "belong"
 * at the specified connection port.
 */
export function populateAtConnection(
  match: ConnectionMatch,
  connectingPipe: CommittedPipe,
): PopulatedItem[] {
  const out: PopulatedItem[] = [];
  const template = match.fixtureInstance.template;
  const portName = match.portName;

  // Filter template items by connection relevance
  const relevant: PhasedAssemblyItem[] = [];
  for (const phase of ['underground', 'rough_in', 'trim'] as ConstructionPhase[]) {
    const items = template.phases[phase] ?? [];
    for (const item of items) {
      // Match by label heuristic (real impl would use explicit port tags)
      const tag = portName.toLowerCase();
      const labelMatch = item.label.toLowerCase().includes(tag);
      if (labelMatch) relevant.push({ ...item });
    }
  }

  // If no explicit matches, add a default 90° elbow + stub for supply ports
  if (relevant.length === 0 && (portName === 'hot' || portName === 'cold')) {
    const diam = connectingPipe.diameter;
    const mat = connectingPipe.material as PipeMaterial;

    // Stub-out
    out.push({
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-stub`,
      position: match.worldPortPos,
      rotation: [0, 0, 0],
      diameter: diam,
      material: mat,
      length: 0.5,
      phase: 'rough_in',
      label: `${diam}" ${portName} supply stub-out`,
      cost: 0.5 + diam * 1,
      partNumber: `${mat.toUpperCase()}-STUB-${diam}`,
      fixtureId: match.fixtureId,
      kind: 'pipe',
    });

    // 90° elbow
    out.push({
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-elbow`,
      position: match.worldPortPos,
      rotation: [0, match.fixtureInstance.rotation, 0],
      diameter: diam,
      material: mat,
      fittingType: 'elbow_90',
      phase: 'rough_in',
      label: `${diam}" ${mat.replace('_', ' ')} 90° elbow (auto)`,
      cost: 1.2 + diam * 2,
      partNumber: `${mat.toUpperCase()}-ELB-1_4-${diam}`,
      fixtureId: match.fixtureId,
      kind: 'fitting',
    });
  }

  // Waste port: add P-trap if none exists in template
  if (relevant.length === 0 && portName === 'waste') {
    const diam = connectingPipe.diameter;
    out.push({
      id: `pop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-trap`,
      position: [match.worldPortPos[0], match.worldPortPos[1] - 0.5, match.worldPortPos[2]],
      rotation: [0, 0, 0],
      diameter: diam,
      material: 'pvc_sch40',
      fittingType: 'p_trap',
      phase: 'underground',
      label: `${diam}" PVC P-trap (auto)`,
      cost: 8 + diam * 3,
      partNumber: `PVC-PTRAP-${diam}`,
      fixtureId: match.fixtureId,
      kind: 'fitting',
    });
  }

  // Convert any template-matched items into populated items
  for (const item of relevant) {
    const worldPos: Vec3 = [
      match.fixtureInstance.position[0] + item.offset[0],
      match.fixtureInstance.position[1] + item.offset[1],
      match.fixtureInstance.position[2] + item.offset[2],
    ];

    const phase: ConstructionPhase = item.id.startsWith('sh-ug') || item.id.startsWith('wc-ug')
      ? 'underground'
      : item.id.includes('rin') ? 'rough_in' : 'trim';

    out.push({
      id: `pop-${item.id}-${Date.now()}`,
      position: worldPos,
      rotation: item.rotation,
      diameter: item.diameter ?? connectingPipe.diameter,
      material: (item.material ?? connectingPipe.material) as PipeMaterial,
      fittingType: item.fittingType as FittingType | undefined,
      length: item.length,
      phase,
      label: item.label,
      cost: item.cost,
      partNumber: item.partNumber ?? '',
      fixtureId: match.fixtureId,
      kind: item.kind === 'pipe' ? 'pipe'
          : item.kind === 'fitting' ? 'fitting'
          : 'component',
    });
  }

  return out;
}

// ── Full-network populate ──────────────────────────────────────

/**
 * Walk all pipes and detect connections, returning all auto-populated
 * items. Called once after any pipe is added or removed.
 */
export function populateAllConnections(
  pipes: CommittedPipe[],
  fixtures: FixtureInstance[],
): PopulatedItem[] {
  const out: PopulatedItem[] = [];
  const seenKeys = new Set<string>();

  for (const pipe of pipes) {
    const endpoints: Vec3[] = [pipe.points[0]!, pipe.points[pipe.points.length - 1]!];
    for (const ep of endpoints) {
      const match = detectConnection(ep, fixtures);
      if (!match) continue;

      const key = `${pipe.id}|${match.fixtureId}|${match.portName}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      out.push(...populateAtConnection(match, pipe));
    }
  }

  return out;
}

// ── Phase filter ────────────────────────────────────────────────

export function filterByPhase(
  items: PopulatedItem[],
  phases: ConstructionPhase[],
): PopulatedItem[] {
  const set = new Set(phases);
  return items.filter((i) => set.has(i.phase));
}
