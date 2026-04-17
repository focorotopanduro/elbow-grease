/**
 * Fixture Flow Profiles — modern low-flow fixture database.
 *
 * Each fixture type carries the parameters needed for probabilistic
 * demand modeling under the Modified Wistort Method:
 *
 *   q  — design flow rate (GPM) when the fixture is in use
 *   p  — probability of use during peak demand period
 *   t  — average duration of use (seconds)
 *   T  — peak demand interval (seconds, typically 300 = 5 min)
 *
 * The probability p = t / T represents the fraction of the peak
 * interval during which this fixture is expected to be drawing water.
 *
 * These values reflect 2024 UPC Appendix M / WaterSense standards,
 * NOT the 1940s Hunter's Curve assumptions:
 *
 *   Hunter (1940):  Lavatory = 2.0 GPM,  Toilet = 3.0 GPM (tank)
 *   Modern (2024):  Lavatory = 0.5 GPM,  Toilet = 1.28 GPM (WaterSense)
 *
 * This 60-75% reduction in individual fixture flow rates is the
 * primary reason Hunter's Curve oversizes modern systems.
 */

import type { FixtureSubtype } from '../graph/GraphNode';

// ── Flow profile ────────────────────────────────────────────────

export interface FlowProfile {
  /** Fixture subtype identifier. */
  subtype: FixtureSubtype;
  /** Human-readable name. */
  name: string;
  /** Design flow rate when active (GPM). */
  q: number;
  /** Average use duration during peak period (seconds). */
  t: number;
  /** Probability of use during peak interval p = t / T. */
  p: number;
  /** Whether this is a cold, hot, or both demand. */
  temperture: 'cold' | 'hot' | 'both';
  /** WSFU per Hunter's curve (for comparison). */
  hunterWSFU: number;
  /** WaterSense compliant? */
  waterSense: boolean;
}

// ── Peak demand interval ────────────────────────────────────────

/** Standard peak demand interval in seconds (UPC Appendix M). */
export const PEAK_INTERVAL_SEC = 300; // 5 minutes

// ── Modern fixture profiles (UPC 2024 / WaterSense) ─────────────

export const FLOW_PROFILES: Record<FixtureSubtype, FlowProfile> = {
  water_closet: {
    subtype: 'water_closet',
    name: 'Water Closet (Tank)',
    q: 1.28,        // WaterSense max: 1.28 GPF → ~2.7 GPM avg over flush cycle
    t: 28,           // ~28 sec flush cycle (1.28 gal / 2.7 GPM × 60)
    p: 28 / PEAK_INTERVAL_SEC,
    temperture: 'cold',
    hunterWSFU: 2.5,
    waterSense: true,
  },
  lavatory: {
    subtype: 'lavatory',
    name: 'Lavatory Faucet',
    q: 0.5,          // WaterSense max: 0.5 GPM (bathroom)
    t: 15,           // 15 sec typical hand wash
    p: 15 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 1.0,
    waterSense: true,
  },
  kitchen_sink: {
    subtype: 'kitchen_sink',
    name: 'Kitchen Faucet',
    q: 1.5,          // WaterSense max: 1.5 GPM (kitchen)
    t: 60,           // 60 sec typical kitchen use
    p: 60 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 1.4,
    waterSense: true,
  },
  bathtub: {
    subtype: 'bathtub',
    name: 'Bathtub Faucet',
    q: 4.0,          // Tub fill at 4 GPM
    t: 120,          // 2 min during peak (bath fill is ~10 min total)
    p: 120 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 2.0,
    waterSense: false,
  },
  shower: {
    subtype: 'shower',
    name: 'Showerhead',
    q: 2.0,          // WaterSense max: 2.0 GPM
    t: 240,          // 4 min of 5 min interval (showers are near-continuous)
    p: 240 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 2.0,
    waterSense: true,
  },
  floor_drain: {
    subtype: 'floor_drain',
    name: 'Floor Drain',
    q: 0,
    t: 0,
    p: 0,
    temperture: 'cold',
    hunterWSFU: 0,
    waterSense: false,
  },
  laundry_standpipe: {
    subtype: 'laundry_standpipe',
    name: 'Clothes Washer Connection',
    q: 3.0,          // Modern front-load fill rate
    t: 180,          // 3 min fill during 5 min peak
    p: 180 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 2.0,
    waterSense: false,
  },
  dishwasher: {
    subtype: 'dishwasher',
    name: 'Dishwasher',
    q: 1.0,          // Modern dishwasher fill rate
    t: 30,           // 30 sec fill cycle during peak
    p: 30 / PEAK_INTERVAL_SEC,
    temperture: 'hot',
    hunterWSFU: 1.4,
    waterSense: true,
  },
  clothes_washer: {
    subtype: 'clothes_washer',
    name: 'Clothes Washer',
    q: 3.0,
    t: 180,
    p: 180 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 2.0,
    waterSense: false,
  },
  hose_bibb: {
    subtype: 'hose_bibb',
    name: 'Hose Bibb',
    q: 5.0,          // Garden hose at 5 GPM
    t: 300,          // Assumed continuous during peak (watering)
    p: 300 / PEAK_INTERVAL_SEC,
    temperture: 'cold',
    hunterWSFU: 2.5,
    waterSense: false,
  },
  urinal: {
    subtype: 'urinal',
    name: 'Urinal (Flush Valve)',
    q: 0.5,          // WaterSense pint-flush: 0.5 GPF
    t: 8,            // ~8 sec flush cycle
    p: 8 / PEAK_INTERVAL_SEC,
    temperture: 'cold',
    hunterWSFU: 2.5,
    waterSense: true,
  },
  mop_sink: {
    subtype: 'mop_sink',
    name: 'Mop/Service Sink',
    q: 3.0,
    t: 90,
    p: 90 / PEAK_INTERVAL_SEC,
    temperture: 'both',
    hunterWSFU: 1.4,
    waterSense: false,
  },
  drinking_fountain: {
    subtype: 'drinking_fountain',
    name: 'Drinking Fountain',
    q: 0.25,
    t: 10,
    p: 10 / PEAK_INTERVAL_SEC,
    temperture: 'cold',
    hunterWSFU: 0.25,
    waterSense: true,
  },
};

/** Get the flow profile for a fixture subtype. */
export function getFlowProfile(subtype: FixtureSubtype): FlowProfile {
  return FLOW_PROFILES[subtype];
}

/** Get all profiles as an array. */
export function getAllProfiles(): FlowProfile[] {
  return Object.values(FLOW_PROFILES);
}
