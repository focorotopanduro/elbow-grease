/**
 * FixturePresets — named parameter bundles users can apply with one click.
 *
 * Examples:
 *   - Water Closet:
 *       • ADA compliant (17.5″ seat, 18″ clearance, elongated bowl)
 *       • Commercial (wall-mount flushometer, 1.28 gpf, commercial flag)
 *       • High-efficiency residential (0.8 gpf, WaterSense)
 *   - Bathtub:
 *       • Standard alcove 60″
 *       • Soaker (72″ × 36″, center drain, overflow)
 *       • Whirlpool (6 jets, whirlpool on)
 *   - Kitchen sink:
 *       • Prep station (1-bowl + pot filler + instant hot)
 *       • Chef (3-bowl, 3/4 HP disposal, dishwasher, air gap)
 *
 * Presets are merged on top of current params (they don't overwrite
 * rotation, tag, or wallMounted unless explicitly included).
 */

import type { FixtureSubtype } from '../../engine/graph/GraphNode';

export interface Preset {
  id: string;
  label: string;
  description: string;
  params: Record<string, unknown>;
}

export const PRESETS: Partial<Record<FixtureSubtype, Preset[]>> = {
  water_closet: [
    {
      id: 'ada',
      label: 'ADA Compliant',
      description: '17.5″ seat, elongated bowl, 12″ rough-in',
      params: { seatHeight: 17.5, bowlShape: 'elongated', roughInDistance: 12, flushType: '1.28gpf', commercial: false },
    },
    {
      id: 'commercial',
      label: 'Commercial (wall-mount)',
      description: 'Flushometer, 1.28 gpf, heavy-duty',
      params: { wallMounted: true, commercial: true, flushType: '1.28gpf', bowlShape: 'elongated' },
    },
    {
      id: 'high_eff_res',
      label: 'High-Efficiency Residential',
      description: '0.8 gpf ultra-low flush, round-front',
      params: { flushType: '0.8gpf', bowlShape: 'round', commercial: false, roughInDistance: 12 },
    },
  ],
  bathtub: [
    {
      id: 'std_alcove',
      label: 'Standard Alcove 60″',
      description: '60×32 alcove, left drain, overflow',
      params: { tubStyle: 'alcove', length: 60, width: 32, drainSide: 'left', overflow: true, whirlpool: false },
    },
    {
      id: 'soaker',
      label: 'Soaker 72″',
      description: '72×36 freestanding, center drain',
      params: { tubStyle: 'freestand', length: 72, width: 36, drainSide: 'center', overflow: true, whirlpool: false },
    },
    {
      id: 'whirlpool',
      label: 'Whirlpool 6-jet',
      description: '60×32 whirlpool, 6 jets, overflow',
      params: { tubStyle: 'drop_in', length: 60, width: 32, whirlpool: true, jetCount: 6, overflow: true },
    },
    {
      id: 'walk_in',
      label: 'Walk-in 54″',
      description: '54×30 walk-in safety tub',
      params: { tubStyle: 'alcove', length: 54, width: 30, drainSide: 'left', overflow: true },
    },
  ],
  kitchen_sink: [
    {
      id: 'prep',
      label: 'Prep Station',
      description: 'Single bowl, pot filler, instant hot',
      params: { bowlCount: 1, bowlDepth: 10, potFiller: true, instantHotWater: true, dishwasherConnected: false, garbageDisposal: true, disposalHP: '0.5' },
    },
    {
      id: 'chef',
      label: 'Chef Kitchen',
      description: 'Triple bowl, 3/4 HP disposal, DW w/air gap',
      params: { bowlCount: 3, bowlDepth: 10, garbageDisposal: true, disposalHP: '0.75', dishwasherConnected: true, airGap: true },
    },
    {
      id: 'standard',
      label: 'Standard Double-bowl',
      description: 'Double bowl, 1/2 HP disposal, DW',
      params: { bowlCount: 2, bowlDepth: 9, garbageDisposal: true, disposalHP: '0.5', dishwasherConnected: true, airGap: false, potFiller: false },
    },
  ],
  shower: [
    {
      id: 'std_3x3',
      label: 'Standard 36×36',
      description: 'Point drain, pressure-balance valve',
      params: { panSize: '36x36', valveType: 'pressure_balance', drainType: 'point', rainHead: false, bodySprays: false, handheld: false, steamUnit: false },
    },
    {
      id: 'luxury',
      label: 'Luxury Spa',
      description: 'Rain head, body sprays, handheld, linear drain',
      params: { panSize: '48x36', valveType: 'thermostatic', drainType: 'linear', rainHead: true, bodySprays: true, handheld: true, steamUnit: false },
    },
    {
      id: 'walk_in_accessible',
      label: 'Walk-in Accessible',
      description: 'Curbless 60×32, linear drain, handheld',
      params: { panSize: '60x32', drainType: 'linear', handheld: true, valveType: 'thermostatic' },
    },
  ],
  lavatory: [
    {
      id: 'widespread',
      label: 'Widespread 8″',
      description: '8″ centers, rectangle basin',
      params: { faucetCenters: '8', basinShape: 'rectangle' },
    },
    {
      id: 'vessel',
      label: 'Vessel sink',
      description: 'Single-hole faucet, vessel basin',
      params: { faucetCenters: 'single', basinShape: 'vessel' },
    },
    {
      id: 'centerset',
      label: 'Centerset 4″',
      description: '4″ centerset, oval basin',
      params: { faucetCenters: '4', basinShape: 'oval' },
    },
  ],
  urinal: [
    {
      id: 'waterless',
      label: 'Waterless',
      description: 'No supply, cartridge trap',
      params: { waterless: true },
    },
    {
      id: 'pint',
      label: 'Pint-flush (0.125 gpf)',
      description: 'Low-flow high-efficiency',
      params: { waterless: false, flushType: '0.125gpf' },
    },
    {
      id: 'ada',
      label: 'ADA',
      description: 'Low-mount ADA height',
      params: { ada: true, waterless: false, flushType: '0.125gpf' },
    },
  ],
};

export function getPresetsFor(subtype: FixtureSubtype): Preset[] {
  return PRESETS[subtype] ?? [];
}
