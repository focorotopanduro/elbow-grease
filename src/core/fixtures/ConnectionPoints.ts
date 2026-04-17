/**
 * ConnectionPoints — per-subtype drain/supply anchor geometry.
 *
 * For every fixture subtype and parameter combination, this module
 * computes the LOCAL-space positions of:
 *
 *   - drain              (DWV connection point — where the tailpiece exits)
 *   - coldSupply         (where cold branch ties in)
 *   - hotSupply          (where hot branch ties in, if applicable)
 *   - rimTop / rimBottom (for ADA dimension labels)
 *   - jetsRing           (whirlpool jet positions for the visual editor)
 *
 * The positions are in LOCAL (pre-rotation) coordinates — units in feet.
 * The FixtureVisualEditor applies the fixture's rotation on top.
 *
 * These handles are draggable in the editor; dragging them updates the
 * underlying params (e.g. dragging the drain handle on a tub sideways
 * snaps drainSide to left/center/right).
 */

import type { FixtureSubtype } from '../../engine/graph/GraphNode';

export interface ConnectionPoint {
  id: string;
  label: string;
  /** Local space [x, y, z] in feet. */
  position: [number, number, number];
  /** Role affects color + routing semantics. */
  role: 'drain' | 'cold' | 'hot' | 'overflow' | 'vent' | 'ref';
  /** Can user drag this handle? */
  draggable?: boolean;
  /** Which param key(s) this handle maps to. */
  drivenBy?: string[];
}

export interface FixtureFootprint {
  /** Full width (X) in feet — determines top-view canvas extent. */
  width: number;
  /** Depth (Z) in feet. */
  depth: number;
  /** Height (Y) in feet — determines elevation slice. */
  height: number;
}

export interface FixtureGeometry {
  footprint: FixtureFootprint;
  points: ConnectionPoint[];
}

// ── Helpers ─────────────────────────────────────────────────────

const INCH = 1 / 12;

function num(p: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const v = p?.[key];
  return typeof v === 'number' ? v : Number(v) || fallback;
}

// ── Per-subtype geometry computers ─────────────────────────────

function wcGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const roughIn = Number(p?.roughInDistance ?? 12);
  const drainRoughIn = num(p, 'drainRoughIn', 3) * INCH;
  const coldRoughIn = num(p, 'coldRoughIn', 8) * INCH;
  // Drain sits `roughIn` inches from back wall (z=-0.3) on the bowl axis
  const drainZ = -0.3 + roughIn * INCH;
  return {
    footprint: { width: 1.5, depth: 2.5, height: 2.5 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainRoughIn, drainZ], role: 'drain', draggable: true, drivenBy: ['roughInDistance', 'drainRoughIn'] },
      { id: 'cold',  label: 'Cold', position: [0.08, coldRoughIn, -0.3], role: 'cold', draggable: true, drivenBy: ['coldRoughIn'] },
    ],
  };
}

function lavGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 18) * INCH;
  const coldY  = num(p, 'coldRoughIn', 21) * INCH;
  const hotY   = num(p, 'hotRoughIn', 21) * INCH;
  const centers = String(p?.faucetCenters ?? '4');
  const spread = centers === '8' ? 4 * INCH : centers === 'single' ? 0 : 2 * INCH;
  return {
    footprint: { width: 2, depth: 1.5, height: 3 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainY, 0], role: 'drain', draggable: true, drivenBy: ['drainRoughIn'] },
      { id: 'cold',  label: 'Cold',  position: [spread, coldY, -0.15], role: 'cold', draggable: true, drivenBy: ['coldRoughIn'] },
      { id: 'hot',   label: 'Hot',   position: [-spread, hotY, -0.15], role: 'hot', draggable: true, drivenBy: ['hotRoughIn'] },
    ],
  };
}

function kitchenSinkGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 18) * INCH;
  const coldY  = num(p, 'coldRoughIn', 22) * INCH;
  const hotY   = num(p, 'hotRoughIn', 22) * INCH;
  const bowlCount = Number(p?.bowlCount ?? 2);
  const points: ConnectionPoint[] = [];
  if (bowlCount === 1) {
    points.push({ id: 'drain', label: 'Drain', position: [0, drainY, 0], role: 'drain', draggable: true });
  } else if (bowlCount === 2) {
    points.push(
      { id: 'drain_l', label: 'L-drain', position: [-0.15, drainY, 0], role: 'drain', draggable: true },
      { id: 'drain_r', label: 'R-drain', position: [0.15, drainY, 0], role: 'drain', draggable: true },
    );
  } else {
    points.push(
      { id: 'drain_l', label: 'L-drain', position: [-0.25, drainY, 0], role: 'drain', draggable: true },
      { id: 'drain_c', label: 'C-drain', position: [0, drainY, 0], role: 'drain', draggable: true },
      { id: 'drain_r', label: 'R-drain', position: [0.22, drainY, 0], role: 'drain', draggable: true },
    );
  }
  points.push(
    { id: 'cold', label: 'Cold', position: [0.08, coldY, -0.12], role: 'cold', draggable: true },
    { id: 'hot',  label: 'Hot',  position: [-0.08, hotY, -0.12], role: 'hot',  draggable: true },
  );
  if (p?.dishwasherConnected === true) {
    points.push({ id: 'dw', label: 'DW', position: [0.25, drainY + 0.05, -0.05], role: 'drain', draggable: false });
  }
  if (p?.potFiller === true) {
    points.push({ id: 'potfiller', label: 'Pot Filler', position: [0.25, 0.7, -0.12], role: 'cold', draggable: true });
  }
  return { footprint: { width: 3, depth: 1.8, height: 3 }, points };
}

function tubGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const lengthFt = num(p, 'length', 60) * INCH;
  const widthFt  = num(p, 'width', 32) * INCH;
  const drainSide = String(p?.drainSide ?? 'left');
  const drainZ = drainSide === 'right' ? -lengthFt/2 + 0.06 : drainSide === 'center' ? 0 : lengthFt/2 - 0.06;
  const drainY = num(p, 'drainRoughIn', 2) * INCH;
  const coldY  = num(p, 'coldRoughIn', 20) * INCH;
  const hotY   = num(p, 'hotRoughIn', 20) * INCH;
  const points: ConnectionPoint[] = [
    { id: 'drain', label: 'Drain', position: [0, drainY, drainZ], role: 'drain', draggable: true, drivenBy: ['drainSide'] },
    { id: 'cold',  label: 'Cold',  position: [-0.08, coldY, -drainZ * 0.9], role: 'cold', draggable: true },
    { id: 'hot',   label: 'Hot',   position: [0.08, hotY, -drainZ * 0.9], role: 'hot', draggable: true },
  ];
  if (p?.overflow === true) {
    points.push({ id: 'overflow', label: 'Overflow', position: [0, 0.32, drainZ * 0.9], role: 'overflow', draggable: false });
  }
  return { footprint: { width: widthFt + 0.2, depth: lengthFt + 0.2, height: 2 }, points };
}

function showerGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const panSize = String(p?.panSize ?? '36x36');
  const parts = panSize.split('x').map((s) => parseInt(s, 10) * INCH);
  const w = (parts[0] !== undefined && Number.isFinite(parts[0])) ? parts[0] : 3;
  const d = (parts[1] !== undefined && Number.isFinite(parts[1])) ? parts[1] : 3;
  const drainY = num(p, 'drainRoughIn', 2) * INCH;
  const coldY  = num(p, 'coldRoughIn', 48) * INCH;
  const hotY   = num(p, 'hotRoughIn', 48) * INCH;
  const linearDrain = String(p?.drainType ?? 'point') === 'linear';
  return {
    footprint: { width: w + 0.2, depth: d + 0.2, height: 7 },
    points: [
      { id: 'drain', label: linearDrain ? 'Linear Drain' : 'Drain', position: [0, drainY, linearDrain ? d/2 - 0.06 : 0], role: 'drain', draggable: !linearDrain, drivenBy: ['drainType'] },
      { id: 'cold',  label: 'Cold',  position: [-w/2 + 0.1, coldY, -d/2 + 0.05], role: 'cold', draggable: true },
      { id: 'hot',   label: 'Hot',   position: [w/2 - 0.1,  hotY,  -d/2 + 0.05], role: 'hot', draggable: true },
    ],
  };
}

function floorDrainGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const size = Number(p?.size ?? 2) * INCH;
  return {
    footprint: { width: Math.max(0.5, size * 3), depth: Math.max(0.5, size * 3), height: 0.5 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, 0, 0], role: 'drain', draggable: false },
    ],
  };
}

function laundryGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 30) * INCH;
  const coldY  = num(p, 'coldRoughIn', 36) * INCH;
  const hotY   = num(p, 'hotRoughIn', 36) * INCH;
  return {
    footprint: { width: 2, depth: 2, height: 4 },
    points: [
      { id: 'drain', label: 'Standpipe', position: [0, drainY, 0], role: 'drain', draggable: true },
      { id: 'cold',  label: 'Cold',      position: [0.15, coldY, -0.15], role: 'cold', draggable: true },
      { id: 'hot',   label: 'Hot',       position: [-0.15, hotY, -0.15], role: 'hot', draggable: true },
    ],
  };
}

function dishwasherGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 8) * INCH;
  const hotY   = num(p, 'hotRoughIn', 8) * INCH;
  return {
    footprint: { width: 2, depth: 2, height: 3 },
    points: [
      { id: 'drain', label: 'Drain', position: [0.3, drainY, 0], role: 'drain', draggable: true },
      { id: 'hot',   label: 'Hot',   position: [-0.3, hotY, 0], role: 'hot',   draggable: true },
    ],
  };
}

function clothesWasherGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 34) * INCH;
  const coldY  = num(p, 'coldRoughIn', 42) * INCH;
  const hotY   = num(p, 'hotRoughIn', 42) * INCH;
  return {
    footprint: { width: 2.5, depth: 2.5, height: 4 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainY, -0.3], role: 'drain', draggable: true },
      { id: 'cold',  label: 'Cold',  position: [0.1, coldY, -0.3], role: 'cold', draggable: true },
      { id: 'hot',   label: 'Hot',   position: [-0.1, hotY, -0.3], role: 'hot',  draggable: true },
    ],
  };
}

function hoseBibbGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const coldY = num(p, 'coldRoughIn', 24) * INCH;
  return {
    footprint: { width: 0.8, depth: 0.8, height: coldY + 0.5 },
    points: [
      { id: 'cold', label: 'Cold', position: [0, coldY, 0], role: 'cold', draggable: true },
    ],
  };
}

function urinalGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 22) * INCH;
  const coldY  = num(p, 'coldRoughIn', 45) * INCH;
  return {
    footprint: { width: 1.5, depth: 1.3, height: 4.5 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainY, 0], role: 'drain', draggable: true },
      ...(p?.waterless === true ? [] : [{ id: 'cold', label: 'Cold', position: [0, coldY, -0.1] as [number, number, number], role: 'cold' as const, draggable: true }]),
    ],
  };
}

function mopSinkGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 2) * INCH;
  const coldY  = num(p, 'coldRoughIn', 45) * INCH;
  const hotY   = num(p, 'hotRoughIn', 45) * INCH;
  return {
    footprint: { width: 2.5, depth: 2.5, height: 4 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainY, 0], role: 'drain', draggable: true },
      { id: 'cold',  label: 'Cold',  position: [0.2, coldY, -0.15], role: 'cold', draggable: true },
      { id: 'hot',   label: 'Hot',   position: [-0.2, hotY, -0.15], role: 'hot',  draggable: true },
    ],
  };
}

function drinkingFountainGeometry(p?: Record<string, unknown>): FixtureGeometry {
  const drainY = num(p, 'drainRoughIn', 17) * INCH;
  const coldY  = num(p, 'coldRoughIn', 30) * INCH;
  return {
    footprint: { width: 1.5, depth: 1, height: 3.5 },
    points: [
      { id: 'drain', label: 'Drain', position: [0, drainY, 0], role: 'drain', draggable: true },
      { id: 'cold',  label: 'Cold',  position: [0, coldY, -0.1], role: 'cold', draggable: true },
    ],
  };
}

// ── Dispatcher ─────────────────────────────────────────────────

export function getFixtureGeometry(
  subtype: FixtureSubtype,
  params?: Record<string, unknown>,
): FixtureGeometry {
  switch (subtype) {
    case 'water_closet':      return wcGeometry(params);
    case 'lavatory':          return lavGeometry(params);
    case 'kitchen_sink':      return kitchenSinkGeometry(params);
    case 'bathtub':           return tubGeometry(params);
    case 'shower':            return showerGeometry(params);
    case 'floor_drain':       return floorDrainGeometry(params);
    case 'laundry_standpipe': return laundryGeometry(params);
    case 'dishwasher':        return dishwasherGeometry(params);
    case 'clothes_washer':    return clothesWasherGeometry(params);
    case 'hose_bibb':         return hoseBibbGeometry(params);
    case 'urinal':            return urinalGeometry(params);
    case 'mop_sink':          return mopSinkGeometry(params);
    case 'drinking_fountain': return drinkingFountainGeometry(params);
  }
}

// ── Drag-snap helpers ──────────────────────────────────────────

/**
 * Snap a dragged drain position to the nearest legal side for tubs.
 * Returns the new `drainSide` value based on Z coordinate.
 */
export function snapTubDrainSideFromZ(z: number, tubLengthFt: number): 'left' | 'center' | 'right' {
  const L = tubLengthFt / 2;
  if (z > L * 0.5) return 'left';
  if (z < -L * 0.5) return 'right';
  return 'center';
}

/** Round to 0.5 inch. */
export function snapHalfInch(feetValue: number): number {
  return Math.round(feetValue * 24) / 24;
}
